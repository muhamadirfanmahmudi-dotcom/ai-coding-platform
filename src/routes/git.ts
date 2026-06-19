import { Router, Request, Response } from 'express';
import { gitRepo } from '../services/git-repo';
import { db } from '../services/database';
import { spawn } from 'child_process';
import path from 'path';

export const gitRoutes = Router();

function paramOrderId(req: Request): string {
  const id = req.params.orderId;
  return Array.isArray(id) ? id[0] : (id || '');
}

function decodeSid(sid: string): { id: string; role: string } | null {
  try {
    const raw = Buffer.from(sid, 'base64').toString('utf-8');
    const data = JSON.parse(raw);
    if (data.id && data.role) return { id: data.id, role: data.role };
    return null;
  } catch {
    return null;
  }
}

function authenticateUser(req: Request): { userId: string; role: string } | null {
  const authHeader = req.headers.authorization;
  let sid = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    sid = authHeader.slice(7);
  }
  if (!sid) {
    sid = (req.query.sid as string) || '';
  }
  if (!sid) return null;
  const decoded = decodeSid(sid);
  if (!decoded) return null;
  const user = db.getUserById(decoded.id);
  if (!user) return null;
  return { userId: user.id, role: decoded.role };
}

function checkRepoAccess(orderId: string, userId: string, _role: string, _isWrite: boolean): boolean {
  const order = db.getOrderById(orderId);
  if (!order) return false;
  if (order.developerId !== userId) return false;
  return true;
}

function pktLine(data: string | Buffer): Buffer {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  const len = buf.length + 4;
  const header = Buffer.from(len.toString(16).padStart(4, '0'), 'ascii');
  return Buffer.concat([header, buf]);
}

function pktFlush(): Buffer {
  return Buffer.from('0000', 'ascii');
}

gitRoutes.get('/:orderId/info/refs', (req: Request, res: Response) => {
  try {
    const orderId = paramOrderId(req);
    const service = req.query.service as string;
    const auth = authenticateUser(req);
    if (!auth) { res.status(401).set('WWW-Authenticate', 'Basic realm="Git"').send('Unauthorized'); return; }
    if (!service || !['git-upload-pack', 'git-receive-pack'].includes(service)) { res.status(400).send('Invalid service'); return; }
    if (!checkRepoAccess(orderId, auth.userId, auth.role, service === 'git-receive-pack')) { res.status(403).send('Forbidden'); return; }
    if (!gitRepo.repoExists(orderId)) {
      if (service === 'git-receive-pack') { gitRepo.createBareRepo(orderId); }
      else { res.status(404).send('Repository not found'); return; }
    }

    const repoPath = gitRepo.getRepoPath(orderId);
    const { execSync } = require('child_process');
    try { execSync('git update-server-info', { cwd: repoPath, stdio: 'ignore' }); } catch {}

    const refsPath = path.join(repoPath, 'info', 'refs');
    const fs = require('fs');
    let refsContent = '';
    if (fs.existsSync(refsPath)) {
      refsContent = fs.readFileSync(refsPath, 'utf-8');
    }

    const output: Buffer[] = [];
    output.push(pktLine(`# service=${service}\n`));
    output.push(pktFlush());

    const lines = refsContent.split('\n').filter((l: string) => l.trim());
    for (const line of lines) {
      const parts = line.split(' ');
      if (parts.length >= 2) {
        const hash = parts[0];
        const ref = parts[1];
        output.push(pktLine(`${hash} ${ref}\0`));
      }
    }
    output.push(pktFlush());

    const body = Buffer.concat(output);
    res.set({
      'Content-Type': `application/x-git-${service}-advertisement`,
      'Cache-Control': 'no-cache',
      'Content-Length': body.length.toString(),
    });
    res.end(body);
  } catch (err: any) {
    console.error('[Git] info/refs error:', err);
    res.status(500).send('Internal Server Error');
  }
});

function handleGitService(req: Request, res: Response, service: string): void {
  const orderId = paramOrderId(req);
  const auth = authenticateUser(req);
  if (!auth) { res.status(401).set('WWW-Authenticate', 'Basic realm="Git"').send('Unauthorized'); return; }
  if (!checkRepoAccess(orderId, auth.userId, auth.role, service === 'git-receive-pack')) { res.status(403).send('Forbidden'); return; }
  if (!gitRepo.repoExists(orderId)) {
    if (service === 'git-receive-pack') { gitRepo.createBareRepo(orderId); }
    else { res.status(404).send('Repository not found'); return; }
  }

  const repoPath = gitRepo.getRepoPath(orderId);
  const args = service === 'git-upload-pack'
    ? ['upload-pack', '--stateless-rpc', '--strict', repoPath]
    : ['receive-pack', '--stateless-rpc', '--strict', repoPath];

  const input = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

  const proc = spawn('git', args);
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  // 超时保护：60 秒后杀掉挂起的 git 进程
  const gitTimer = setTimeout(() => {
    console.error(`[Git] ${service} timed out, killing process`);
    proc.kill('SIGKILL');
  }, 60000);

  proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
  proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

  proc.stdin.write(input);
  proc.stdin.end();

  proc.on('close', (code) => {
    clearTimeout(gitTimer);
    const body = Buffer.concat(stdoutChunks);
    const contentType = service === 'git-upload-pack'
      ? 'application/x-git-upload-pack-result'
      : 'application/x-git-receive-pack-result';

    if (service === 'git-receive-pack' && body.length > 0) {
      setTimeout(() => gitRepo.syncToDatabase(orderId), 200);
    }

    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'Content-Length': body.length.toString(),
    });
    res.end(body);
  });

  proc.on('error', (err) => {
    console.error(`[Git] ${service} spawn error:`, err);
    if (!res.headersSent) {
      res.status(500).send('Internal Server Error');
    }
  });
}

gitRoutes.post('/:orderId/git-upload-pack', (req: Request, res: Response) => {
  handleGitService(req, res, 'git-upload-pack');
});

gitRoutes.post('/:orderId/git-receive-pack', (req: Request, res: Response) => {
  handleGitService(req, res, 'git-receive-pack');
});

gitRoutes.get('/:orderId/HEAD', (req: Request, res: Response) => {
  try {
    const orderId = paramOrderId(req);
    const auth = authenticateUser(req);
    if (!auth) { res.status(401).set('WWW-Authenticate', 'Basic realm="Git"').send('Unauthorized'); return; }
    if (!checkRepoAccess(orderId, auth.userId, auth.role, false)) { res.status(403).send('Forbidden'); return; }
    if (!gitRepo.repoExists(orderId)) { res.status(404).send('Repository not found'); return; }
    const head = gitRepo.getHead(orderId);
    res.set('Content-Type', 'text/plain');
    res.send(head);
  } catch (err: any) {
    console.error('[Git] HEAD error:', err);
    res.status(500).send('Internal Server Error');
  }
});
