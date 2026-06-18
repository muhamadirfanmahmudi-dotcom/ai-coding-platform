import { Router, Request, Response } from 'express';
import { gitRepo } from '../services/git-repo';
import { db } from '../services/database';

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

  if (!sid) {
    return null;
  }

  const decoded = decodeSid(sid);
  if (!decoded) {
    return null;
  }

  const user = db.getUserById(decoded.id);
  if (!user) {
    return null;
  }

  return { userId: user.id, role: decoded.role };
}

function checkRepoAccess(orderId: string, userId: string, role: string, isWrite: boolean): boolean {
  const order = db.getOrderById(orderId);
  if (!order) {
    return false;
  }

  if (order.developerId !== userId) {
    return false;
  }

  if (isWrite && role !== 'developer') {
    return false;
  }

  return true;
}

gitRoutes.get('/:orderId/info/refs', (req: Request, res: Response) => {
  try {
    const orderId = paramOrderId(req);
    const service = req.query.service as string;

    const auth = authenticateUser(req);
    if (!auth) {
      res.status(401).set('WWW-Authenticate', 'Basic realm="Git"').send('Unauthorized');
      return;
    }

    if (!service || !['git-upload-pack', 'git-receive-pack'].includes(service)) {
      res.status(400).send('Invalid service');
      return;
    }

    const isWrite = service === 'git-receive-pack';
    if (!checkRepoAccess(orderId, auth.userId, auth.role, isWrite)) {
      res.status(403).send('Forbidden');
      return;
    }

    if (!gitRepo.repoExists(orderId)) {
      if (isWrite) {
        gitRepo.createBareRepo(orderId);
      } else {
        res.status(404).send('Repository not found');
        return;
      }
    }

    gitRepo.updateServerInfo(orderId);

    const refs = gitRepo.getRefs(orderId);

    res.set({
      'Content-Type': `application/x-git-${service}-advertisement`,
      'Cache-Control': 'no-cache',
    });

    const packetLines = formatRefsForGit(refs, service);
    res.send(packetLines);
  } catch (err: any) {
    console.error(`[Git] info/refs error:`, err);
    res.status(500).send('Internal Server Error');
  }
});

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
    if (!auth) {
      res.status(401).set('WWW-Authenticate', 'Basic realm="Git"').send('Unauthorized');
      return;
    }

    if (!checkRepoAccess(orderId, auth.userId, auth.role, false)) {
      res.status(403).send('Forbidden');
      return;
    }

    if (!gitRepo.repoExists(orderId)) {
      res.status(404).send('Repository not found');
      return;
    }

    const head = gitRepo.getHead(orderId);
    res.set('Content-Type', 'text/plain');
    res.send(head);
  } catch (err: any) {
    console.error(`[Git] HEAD error:`, err);
    res.status(500).send('Internal Server Error');
  }
});

async function handleGitService(req: Request, res: Response, service: string): Promise<void> {
  try {
    const orderId = paramOrderId(req);
    const isWrite = service === 'git-receive-pack';

    const auth = authenticateUser(req);
    if (!auth) {
      res.status(401).set('WWW-Authenticate', 'Basic realm="Git"').send('Unauthorized');
      return;
    }

    if (!checkRepoAccess(orderId, auth.userId, auth.role, isWrite)) {
      res.status(403).send('Forbidden');
      return;
    }

    if (!gitRepo.repoExists(orderId)) {
      if (isWrite) {
        gitRepo.createBareRepo(orderId);
      } else {
        res.status(404).send('Repository not found');
        return;
      }
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const input = Buffer.concat(chunks);

        let result: { stdout: Buffer; stderr: Buffer };

        if (service === 'git-upload-pack') {
          result = await gitRepo.handleUploadPack(orderId);
        } else {
          result = await gitRepo.handleReceivePack(orderId, input);
        }

        if (isWrite && result.stdout.length > 0) {
          setTimeout(() => {
            gitRepo.syncToDatabase(orderId);
          }, 100);
        }

        const contentType = service === 'git-upload-pack'
          ? 'application/x-git-upload-pack-result'
          : 'application/x-git-receive-pack-result';

        res.set({
          'Content-Type': contentType,
          'Cache-Control': 'no-cache',
        });

        res.send(result.stdout);
      } catch (err: any) {
        console.error(`[Git] ${service} error:`, err);
        res.status(500).send('Internal Server Error');
      }
    });
  } catch (err: any) {
    console.error(`[Git] ${service} error:`, err);
    res.status(500).send('Internal Server Error');
  }
}

function formatRefsForGit(refs: string, service: string): string {
  const output: string[] = [];

  output.push(`# service=${service}\n`);
  output.push('0000');

  const lines = refs.split('\n').filter(l => l.trim());

  for (const line of lines) {
    const parts = line.split(' ');
    if (parts.length >= 2) {
      const hash = parts[0];
      const ref = parts[1];
      const packetLine = `${hash} ${ref}\0`;
      output.push(`${packetLength(packetLine)}${packetLine}`);
    }
  }

  output.push('0000');

  return output.join('');
}

function packetLength(line: string): string {
  const len = line.length + 4;
  return len.toString(16).padStart(4, '0');
}
