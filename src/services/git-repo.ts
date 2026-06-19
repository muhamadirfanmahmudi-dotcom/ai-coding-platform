import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { db } from './database';

const REPOS_ROOT = path.resolve(__dirname, '../../repos');

export interface GitRepoInfo {
  orderId: string;
  repoPath: string;
  exists: boolean;
}

export class GitRepoManager {
  getRepoPath(orderId: string): string {
    return path.join(REPOS_ROOT, `${orderId}.git`);
  }

  repoExists(orderId: string): boolean {
    const repoPath = this.getRepoPath(orderId);
    return fs.existsSync(repoPath) && fs.existsSync(path.join(repoPath, 'HEAD'));
  }

  createBareRepo(orderId: string): GitRepoInfo {
    const repoPath = this.getRepoPath(orderId);

    if (this.repoExists(orderId)) {
      return { orderId, repoPath, exists: true };
    }

    if (!fs.existsSync(REPOS_ROOT)) {
      fs.mkdirSync(REPOS_ROOT, { recursive: true });
    }

    execSync(`git init --bare "${repoPath}"`, { stdio: 'ignore', timeout: 30000 });

    const infoDir = path.join(repoPath, 'info');
    if (!fs.existsSync(infoDir)) {
      fs.mkdirSync(infoDir, { recursive: true });
    }

    const hooksDir = path.join(repoPath, 'hooks');
    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }

    this.createPostReceiveHook(orderId, repoPath);

    console.log(`[Git] Created bare repo: ${repoPath}`);
    return { orderId, repoPath, exists: true };
  }

  private createPostReceiveHook(orderId: string, repoPath: string): void {
    const hookPath = path.join(repoPath, 'hooks', 'post-receive');
    const hookContent = `#!/bin/sh
echo "Syncing to database for order: ${orderId}"
# Hook will be called by our Git HTTP handler
`;
    fs.writeFileSync(hookPath, hookContent, { mode: 0o755 });
  }

  updateServerInfo(orderId: string): void {
    const repoPath = this.getRepoPath(orderId);
    if (!this.repoExists(orderId)) {
      return;
    }
    try {
      execSync(`git update-server-info`, { cwd: repoPath, stdio: 'ignore', timeout: 15000 });
    } catch (err) {
      console.error(`[Git] update-server-info failed for ${orderId}:`, err);
    }
  }

  getRefs(orderId: string): string {
    const repoPath = this.getRepoPath(orderId);
    const refsPath = path.join(repoPath, 'info', 'refs');

    if (!fs.existsSync(refsPath)) {
      this.updateServerInfo(orderId);
    }

    if (fs.existsSync(refsPath)) {
      return fs.readFileSync(refsPath, 'utf-8');
    }
    return '';
  }

  getHead(orderId: string): string {
    const repoPath = this.getRepoPath(orderId);
    const headPath = path.join(repoPath, 'HEAD');

    if (fs.existsSync(headPath)) {
      return fs.readFileSync(headPath, 'utf-8');
    }
    return 'ref: refs/heads/main\n';
  }

  getObjectsInfoRefs(orderId: string): string {
    const repoPath = this.getRepoPath(orderId);
    const objectsPath = path.join(repoPath, 'objects', 'info', 'packs');

    if (!fs.existsSync(objectsPath)) {
      this.updateServerInfo(orderId);
    }

    if (fs.existsSync(objectsPath)) {
      return fs.readFileSync(objectsPath, 'utf-8');
    }
    return '';
  }

  async handleUploadPack(orderId: string): Promise<{ stdout: Buffer; stderr: Buffer }> {
    const repoPath = this.getRepoPath(orderId);

    return new Promise((resolve, reject) => {
      const proc = spawn('git', ['upload-pack', '--stateless-rpc', '--strict', repoPath]);
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      proc.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      proc.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

      proc.on('close', (code) => {
        if (code !== 0) {
          console.error(`[Git] upload-pack failed for ${orderId}:`, Buffer.concat(stderr).toString());
        }
        resolve({
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
        });
      });

      proc.on('error', reject);
    });
  }

  async handleReceivePack(orderId: string, input: Buffer): Promise<{ stdout: Buffer; stderr: Buffer }> {
    const repoPath = this.getRepoPath(orderId);

    return new Promise((resolve, reject) => {
      const proc = spawn('git', ['receive-pack', '--stateless-rpc', '--strict', repoPath]);
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      proc.stdin.write(input);
      proc.stdin.end();

      proc.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      proc.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

      proc.on('close', (code) => {
        if (code !== 0) {
          console.error(`[Git] receive-pack failed for ${orderId}:`, Buffer.concat(stderr).toString());
        }
        resolve({
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
        });
      });

      proc.on('error', reject);
    });
  }

  syncToDatabase(orderId: string): void {
    const repoPath = this.getRepoPath(orderId);
    if (!this.repoExists(orderId)) {
      return;
    }

    try {
      const repo = db.getRepoByOrderId(orderId);
      if (!repo) {
        console.log(`[Git] No repo record in DB for order ${orderId}, skipping sync`);
        return;
      }

      const logOutput = execSync(
        'git log --all --format="%H|%s|%ai|%P" --reverse',
        { cwd: repoPath, encoding: 'utf-8', timeout: 15000 }
      ).trim();

      if (!logOutput) {
        return;
      }

      const lines = logOutput.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const [hash, message, dateStr, parentHash] = line.split('|');

        const existingCommit = db.getCommitByHash(repo.id, hash);
        if (existingCommit) {
          continue;
        }

        const parentId = parentHash ? db.getCommitByHash(repo.id, parentHash)?.id : undefined;

        const commit = db.createCommit({
          id: hash,
          repoId: repo.id,
          message: message || 'No message',
          parentId,
        });

        const filesOutput = execSync(
          `git diff-tree --no-commit-id -r ${hash}`,
          { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }
        ).trim();

        if (filesOutput) {
          const fileLines = filesOutput.split('\n').filter(l => l.trim());
          for (const fileLine of fileLines) {
            const parts = fileLine.split('\t');
            if (parts.length >= 2) {
              const modeAndHash = parts[0].split(' ');
              const filePath = parts[1];
              const action = modeAndHash[0] === 'A' ? 'add' :
                            modeAndHash[0] === 'D' ? 'delete' : 'modify';

              db.addCommitFile({
                commitId: commit.id,
                filePath,
                fileHash: modeAndHash[2] || '',
                fileSize: 0,
                action: action as any,
              });
            }
          }
        }

        const branchesOutput = execSync(
          `git branch --contains ${hash}`,
          { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }
        ).trim();

        const branchNames = branchesOutput.split('\n')
          .map(b => b.replace(/^\*?\s*/, '').trim())
          .filter(b => b && !b.includes('->'));

        for (const branchName of branchNames) {
          const existingBranch = db.getBranch(repo.id, branchName);
          if (existingBranch) {
            db.updateBranchHead(repo.id, branchName, commit.id);
          } else {
            db.createBranch(repo.id, branchName, commit.id);
          }
        }
      }

      this.updateServerInfo(orderId);
      console.log(`[Git] Synced repo ${orderId} to database`);
    } catch (err) {
      console.error(`[Git] Sync to database failed for ${orderId}:`, err);
    }
  }
}

export const gitRepo = new GitRepoManager();
