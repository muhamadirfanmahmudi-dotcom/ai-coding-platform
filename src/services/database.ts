import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

// ─── SQLite Database Manager ──────────────────────────

class Database {
  private db!: SqlJsDatabase;
  private dbPath: string;

  constructor() {
    const url = config.databaseUrl;
    if (url.startsWith('file:')) {
      this.dbPath = path.resolve(__dirname, '../../', url.slice(5));
    } else {
      this.dbPath = path.resolve(__dirname, '../../', url);
    }
  }

  async connect(): Promise<void> {
    const SQL = await initSqlJs();

    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
      console.log(`[DB] Loaded: ${this.dbPath}`);
    } else {
      this.db = new SQL.Database();
      console.log(`[DB] Created: ${this.dbPath}`);
    }

    this.db.run('PRAGMA journal_mode=WAL;');
    this.db.run('PRAGMA foreign_keys=ON;');
    this.migrate();
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'buyer' CHECK(role IN ('buyer','developer')),
        sid TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        user_info TEXT,
        problem TEXT,
        features TEXT,
        anti_features TEXT,
        success_criteria TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','claimed','in_progress','reviewing','completed','cancelled')),
        buyer_id TEXT NOT NULL,
        developer_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (buyer_id) REFERENCES users(id),
        FOREIGN KEY (developer_id) REFERENCES users(id)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS order_progress (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        title TEXT,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (order_id) REFERENCES orders(id)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS order_stages (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        stage_order INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','in_progress','completed')),
        content TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (order_id) REFERENCES orders(id)
      )
    `);

    // ─── Code Repository Tables ──────────────────────────

    this.db.run(`
      CREATE TABLE IF NOT EXISTS code_repos (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL UNIQUE,
        default_branch TEXT NOT NULL DEFAULT 'main',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (order_id) REFERENCES orders(id)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS code_branches (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        name TEXT NOT NULL,
        head_commit_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (repo_id) REFERENCES code_repos(id) ON DELETE CASCADE,
        UNIQUE(repo_id, name)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS code_commits (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL,
        ref TEXT NOT NULL,
        message TEXT NOT NULL,
        parent_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (repo_id) REFERENCES code_repos(id) ON DELETE CASCADE,
        UNIQUE(repo_id, ref)
      )
    `);

    // Add description column if not exists (migration for existing DBs)
    try {
      this.db.run(`ALTER TABLE code_commits ADD COLUMN description TEXT DEFAULT ''`);
    } catch {} // column already exists

    this.db.run(`
      CREATE TABLE IF NOT EXISTS code_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        commit_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        file_size INTEGER,
        action TEXT NOT NULL DEFAULT 'add'
          CHECK(action IN ('add','modify','delete')),
        FOREIGN KEY (commit_id) REFERENCES code_commits(id) ON DELETE CASCADE,
        UNIQUE(commit_id, file_path)
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS code_blobs (
        hash TEXT PRIMARY KEY,
        content BLOB NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Migrate: add role column to users if missing
    const userCols = this.db.exec(`PRAGMA table_info(users)`);
    if (userCols.length > 0) {
      const colNames = userCols[0].values.map((v: any) => v[1]);
      if (!colNames.includes('role')) {
        this.db.run(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'buyer'`);
        console.log('[DB] Added users.role');
      }
    }

    this.save();
    console.log('[DB] Migration completed');
  }

  save(): void {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  close(): void {
    this.save();
    this.db.close();
  }

  // ═══════════════════════════════════════════════════
  //  User Methods
  // ═══════════════════════════════════════════════════

  createUser(params: { id: string; name: string; email: string; password: string; role?: string }) {
    this.db.run(
      `INSERT INTO users (id, name, email, password, role, sid) VALUES (?, ?, ?, ?, ?, '')`,
      [params.id, params.name, params.email, params.password, params.role || 'buyer']
    );
    this.save();
    return this.getUserById(params.id)!;
  }

  getUserById(id: string) {
    const stmt = this.db.prepare(`SELECT * FROM users WHERE id = ?`);
    stmt.bind([id]);
    if (stmt.step()) {
      return rowToUser(stmt.getAsObject());
    }
    stmt.free();
    return null;
  }

  getUserByEmail(email: string) {
    const stmt = this.db.prepare(`SELECT * FROM users WHERE email = ?`);
    stmt.bind([email]);
    if (stmt.step()) {
      return rowToUser(stmt.getAsObject());
    }
    stmt.free();
    return null;
  }

  updateUserSid(id: string, sid: string) {
    this.db.run(
      `UPDATE users SET sid = ?, updated_at = datetime('now') WHERE id = ?`,
      [sid, id]
    );
    this.save();
  }

  // ═══════════════════════════════════════════════════
  //  Order Methods
  // ═══════════════════════════════════════════════════

  createOrder(params: {
    id: string;
    title: string;
    description: string;
    userInfo?: string;
    problem?: string;
    features?: string;
    antiFeatures?: string;
    successCriteria?: string;
    buyerId: string;
  }) {
    this.db.run(
      `INSERT INTO orders (id, title, description, user_info, problem, features, anti_features, success_criteria, buyer_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.id, params.title, params.description,
        params.userInfo || null, params.problem || null,
        params.features || null, params.antiFeatures || null,
        params.successCriteria || null, params.buyerId
      ]
    );
    this.save();
    return this.getOrderById(params.id)!;
  }

  getOrderById(id: string) {
    const stmt = this.db.prepare(`SELECT * FROM orders WHERE id = ?`);
    stmt.bind([id]);
    if (stmt.step()) {
      return rowToOrder(stmt.getAsObject());
    }
    stmt.free();
    return null;
  }

  listHallOrders() {
    const stmt = this.db.prepare(`SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at DESC`);
    const orders: any[] = [];
    while (stmt.step()) {
      orders.push(rowToOrder(stmt.getAsObject()));
    }
    stmt.free();
    return orders;
  }

  listMyOrders(buyerId: string) {
    const stmt = this.db.prepare(`SELECT * FROM orders WHERE buyer_id = ? ORDER BY created_at DESC`);
    stmt.bind([buyerId]);
    const orders: any[] = [];
    while (stmt.step()) {
      orders.push(rowToOrder(stmt.getAsObject()));
    }
    stmt.free();
    return orders;
  }

  listDeveloperOrders(developerId: string) {
    const stmt = this.db.prepare(`SELECT * FROM orders WHERE developer_id = ? ORDER BY created_at DESC`);
    stmt.bind([developerId]);
    const orders: any[] = [];
    while (stmt.step()) {
      orders.push(rowToOrder(stmt.getAsObject()));
    }
    stmt.free();
    return orders;
  }

  updateOrder(id: string, data: Record<string, any>) {
    const setClauses: string[] = [];
    const params: any[] = [];

    for (const [key, value] of Object.entries(data)) {
      const col = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      setClauses.push(`${col} = ?`);
      params.push(value ?? null);
    }

    setClauses.push(`updated_at = datetime('now')`);
    params.push(id);

    this.db.run(
      `UPDATE orders SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );
    this.save();
    return this.getOrderById(id)!;
  }

  // ═══════════════════════════════════════════════════
  //  Order Progress Methods
  // ═══════════════════════════════════════════════════

  addProgress(params: { id: string; orderId: string; title?: string; content: string }) {
    this.db.run(
      `INSERT INTO order_progress (id, order_id, title, content) VALUES (?, ?, ?, ?)`,
      [params.id, params.orderId, params.title || null, params.content]
    );
    this.save();
  }

  getOrderProgress(orderId: string) {
    const stmt = this.db.prepare(`SELECT * FROM order_progress WHERE order_id = ? ORDER BY created_at ASC`);
    stmt.bind([orderId]);
    const items: any[] = [];
    while (stmt.step()) {
      items.push(rowToProgress(stmt.getAsObject()));
    }
    stmt.free();
    return items;
  }

  // ═══════════════════════════════════════════════════
  //  Order Stages Methods
  // ═══════════════════════════════════════════════════

  initStages(orderId: string) {
    const stages = [
      { key: 'requirement', name: '需求分析', order: 1 },
      { key: 'design', name: '系统设计', order: 2 },
      { key: 'techstack', name: '技术选型', order: 3 },
      { key: 'implementation', name: '开发阶段', order: 4 },
      { key: 'testing', name: '测试阶段', order: 5 },
    ];
    for (const s of stages) {
      this.db.run(
        `INSERT INTO order_stages (id, order_id, stage, stage_order, status) VALUES (?, ?, ?, ?, 'pending')`,
        [`${orderId}_${s.key}`, orderId, s.key, s.order]
      );
    }
    this.save();
  }

  getStages(orderId: string) {
    const stmt = this.db.prepare(`SELECT * FROM order_stages WHERE order_id = ? ORDER BY stage_order ASC`);
    stmt.bind([orderId]);
    const items: any[] = [];
    while (stmt.step()) {
      items.push(rowToStage(stmt.getAsObject()));
    }
    stmt.free();
    return items;
  }

  getStage(orderId: string, stage: string) {
    const stmt = this.db.prepare(`SELECT * FROM order_stages WHERE order_id = ? AND stage = ?`);
    stmt.bind([orderId, stage]);
    if (stmt.step()) {
      const item = rowToStage(stmt.getAsObject());
      stmt.free();
      return item;
    }
    stmt.free();
    return null;
  }

  updateStage(orderId: string, stage: string, data: { status?: string; content?: string }) {
    const setClauses: string[] = [];
    const params: any[] = [];
    if (data.status) { setClauses.push('status = ?'); params.push(data.status); }
    if (data.content !== undefined) { setClauses.push('content = ?'); params.push(data.content); }
    setClauses.push(`updated_at = datetime('now')`);
    params.push(orderId, stage);
    this.db.run(`UPDATE order_stages SET ${setClauses.join(', ')} WHERE order_id = ? AND stage = ?`, params);
    this.save();
  }

  // ═══════════════════════════════════════════════════════
  //  Code Repository Methods
  // ═══════════════════════════════════════════════════════

  initRepo(params: { id: string; orderId: string; defaultBranch?: string }) {
    const branchName = params.defaultBranch || 'main';
    this.db.run(
      `INSERT INTO code_repos (id, order_id, default_branch) VALUES (?, ?, ?)`,
      [params.id, params.orderId, branchName]
    );
    // Create default branch
    this.db.run(
      `INSERT INTO code_branches (id, repo_id, name) VALUES (?, ?, ?)`,
      [`${params.id}:${branchName}`, params.id, branchName]
    );
    this.save();
    return this.getRepoByOrderId(params.orderId)!;
  }

  getRepoByOrderId(orderId: string) {
    const stmt = this.db.prepare(`SELECT * FROM code_repos WHERE order_id = ?`);
    stmt.bind([orderId]);
    if (stmt.step()) {
      const row = rowToRepo(stmt.getAsObject());
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  getRepo(id: string) {
    const stmt = this.db.prepare(`SELECT * FROM code_repos WHERE id = ?`);
    stmt.bind([id]);
    if (stmt.step()) {
      const row = rowToRepo(stmt.getAsObject());
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  // ═══════════════════════════════════════════════════════
  //  Branch Methods
  // ═══════════════════════════════════════════════════════

  createBranch(repoId: string, name: string, headCommitId?: string) {
    const id = `${repoId}:${name}`;
    this.db.run(
      `INSERT INTO code_branches (id, repo_id, name, head_commit_id) VALUES (?, ?, ?, ?)`,
      [id, repoId, name, headCommitId || null]
    );
    this.save();
    return this.getBranch(repoId, name)!;
  }

  getBranch(repoId: string, name: string) {
    const stmt = this.db.prepare(`SELECT * FROM code_branches WHERE repo_id = ? AND name = ?`);
    stmt.bind([repoId, name]);
    if (stmt.step()) {
      const row = rowToBranch(stmt.getAsObject());
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  listBranches(repoId: string) {
    const stmt = this.db.prepare(`SELECT * FROM code_branches WHERE repo_id = ? ORDER BY name`);
    stmt.bind([repoId]);
    const items: any[] = [];
    while (stmt.step()) {
      items.push(rowToBranch(stmt.getAsObject()));
    }
    stmt.free();
    return items;
  }

  updateBranchHead(repoId: string, name: string, commitId: string) {
    this.db.run(
      `UPDATE code_branches SET head_commit_id = ? WHERE repo_id = ? AND name = ?`,
      [commitId, repoId, name]
    );
    this.save();
  }

  deleteBranch(repoId: string, name: string) {
    if (name === 'main') return false;
    this.db.run(`DELETE FROM code_branches WHERE repo_id = ? AND name = ?`, [repoId, name]);
    this.save();
    return true;
  }

  // ═══════════════════════════════════════════════════════
  //  Commit Methods
  // ═══════════════════════════════════════════════════════

  createCommit(params: {
    id: string;
    repoId: string;
    message: string;
    description?: string;
    parentId?: string;
  }) {
    // Generate ref (v1, v2, v3...)
    const count = this.getCommitCount(params.repoId) + 1;
    const ref = `v${count}`;

    this.db.run(
      `INSERT INTO code_commits (id, repo_id, ref, message, description, parent_id) VALUES (?, ?, ?, ?, ?, ?)`,
      [params.id, params.repoId, ref, params.message, params.description || '', params.parentId || null]
    );
    this.save();
    return this.getCommit(params.id)!;
  }

  updateCommitMessage(commitId: string, message: string, description?: string) {
    if (description !== undefined) {
      this.db.run(`UPDATE code_commits SET message = ?, description = ? WHERE id = ?`, [message, description, commitId]);
    } else {
      this.db.run(`UPDATE code_commits SET message = ? WHERE id = ?`, [message, commitId]);
    }
    this.save();
  }

  getCommit(id: string) {
    const stmt = this.db.prepare(`SELECT * FROM code_commits WHERE id = ?`);
    stmt.bind([id]);
    if (stmt.step()) {
      const row = rowToCommit(stmt.getAsObject());
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  getCommitByRef(repoId: string, ref: string) {
    const stmt = this.db.prepare(`SELECT * FROM code_commits WHERE repo_id = ? AND ref = ?`);
    stmt.bind([repoId, ref]);
    if (stmt.step()) {
      const row = rowToCommit(stmt.getAsObject());
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  getCommitByHash(repoId: string, hash: string) {
    const stmt = this.db.prepare(`SELECT * FROM code_commits WHERE repo_id = ? AND id = ?`);
    stmt.bind([repoId, hash]);
    if (stmt.step()) {
      const row = rowToCommit(stmt.getAsObject());
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  getCommitCount(repoId: string): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) AS cnt FROM code_commits WHERE repo_id = ?`);
    stmt.bind([repoId]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as any;
      stmt.free();
      return row.cnt;
    }
    stmt.free();
    return 0;
  }

  listCommits(repoId: string, branchName?: string, limit = 50) {
    if (branchName) {
      const branch = this.getBranch(repoId, branchName);
      if (!branch || !branch.headCommitId) return [];
      const commits: any[] = [];
      let currentId: string | null = branch.headCommitId;
      while (currentId && commits.length < limit) {
        const commit = this.getCommit(currentId);
        if (!commit) break;
        commits.push(commit);
        currentId = commit.parentId;
      }
      return commits;
    }
    const stmt = this.db.prepare(`SELECT * FROM code_commits WHERE repo_id = ? ORDER BY created_at DESC LIMIT ?`);
    stmt.bind([repoId, limit]);
    const items: any[] = [];
    while (stmt.step()) {
      items.push(rowToCommit(stmt.getAsObject()));
    }
    stmt.free();
    return items;
  }

  // ═══════════════════════════════════════════════════════
  //  File & Blob Methods
  // ═══════════════════════════════════════════════════════

  addCommitFile(params: {
    commitId: string;
    filePath: string;
    fileHash: string;
    fileSize: number;
    action: string;
  }) {
    this.db.run(
      `INSERT OR REPLACE INTO code_files (commit_id, file_path, file_hash, file_size, action)
       VALUES (?, ?, ?, ?, ?)`,
      [params.commitId, params.filePath, params.fileHash, params.fileSize, params.action]
    );
  }

  getCommitFiles(commitId: string) {
    const stmt = this.db.prepare(`SELECT * FROM code_files WHERE commit_id = ? ORDER BY file_path`);
    stmt.bind([commitId]);
    const items: any[] = [];
    while (stmt.step()) {
      items.push(rowToCommitFile(stmt.getAsObject()));
    }
    stmt.free();
    return items;
  }

  storeBlob(hash: string, content: Buffer | Uint8Array, size: number) {
    const buf = content instanceof Buffer ? content : Buffer.from(content);
    const stmt = this.db.prepare(`SELECT hash FROM code_blobs WHERE hash = ?`);
    stmt.bind([hash]);
    if (!stmt.step()) {
      stmt.free();
      this.db.run(`INSERT INTO code_blobs (hash, content, size) VALUES (?, ?, ?)`, [hash, buf, size]);
      this.save();
    } else {
      stmt.free();
    }
  }

  getBlob(hash: string): Buffer | null {
    const stmt = this.db.prepare(`SELECT content FROM code_blobs WHERE hash = ?`);
    stmt.bind([hash]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as any;
      stmt.free();
      // sql.js returns Uint8Array for BLOB columns
      return row.content ? Buffer.from(row.content) : null;
    }
    stmt.free();
    return null;
  }

  // ═══════════════════════════════════════════════════════
  //  Tree & Diff Methods
  // ═══════════════════════════════════════════════════════

  getTreeAtCommit(commitId: string): { filePath: string; fileHash: string; fileSize: number; action: string }[] {
    const files = new Map<string, { filePath: string; fileHash: string; fileSize: number; action: string }>();
    let currentId: string | null = commitId;

    while (currentId) {
      const cf = this.db.prepare(`SELECT * FROM code_files WHERE commit_id = ? ORDER BY file_path`);
      cf.bind([currentId]);
      while (cf.step()) {
        const row = rowToCommitFile(cf.getAsObject());
        if (row.action === 'delete') {
          files.delete(row.filePath);
        } else {
          // Only keep the first (most recent) occurrence — we walk from HEAD backwards
          if (!files.has(row.filePath)) {
            files.set(row.filePath, { filePath: row.filePath, fileHash: row.fileHash, fileSize: row.fileSize, action: 'add' });
          }
        }
      }
      cf.free();

      const commit = this.getCommit(currentId);
      currentId = commit?.parentId || null;
    }
    return Array.from(files.values());
  }

  getTreeAtBranch(repoId: string, branchName: string) {
    const branch = this.getBranch(repoId, branchName);
    if (!branch || !branch.headCommitId) return [];
    return this.getTreeAtCommit(branch.headCommitId);
  }

  diffCommits(fromCommitId: string, toCommitId: string):
    { path: string; action: string; beforeHash: string | null; afterHash: string | null }[] {

    const fromFiles = new Map<string, string>();
    const fromStmt = this.db.prepare(`SELECT file_path, file_hash FROM code_files WHERE commit_id = ?`);
    fromStmt.bind([fromCommitId]);
    while (fromStmt.step()) {
      const row = fromStmt.getAsObject() as any;
      fromFiles.set(row.file_path, row.file_hash);
    }
    fromStmt.free();

    const toFiles = new Map<string, string>();
    const toStmt = this.db.prepare(`SELECT file_path, file_hash FROM code_files WHERE commit_id = ?`);
    toStmt.bind([toCommitId]);
    while (toStmt.step()) {
      const row = toStmt.getAsObject() as any;
      toFiles.set(row.file_path, row.file_hash);
    }
    toStmt.free();

    const allPaths = new Set([...fromFiles.keys(), ...toFiles.keys()]);
    const changes: { path: string; action: string; beforeHash: string | null; afterHash: string | null }[] = [];

    for (const path of allPaths) {
      const beforeHash = fromFiles.get(path) || null;
      const afterHash = toFiles.get(path) || null;
      if (beforeHash && !afterHash) {
        changes.push({ path, action: 'delete', beforeHash, afterHash: null });
      } else if (!beforeHash && afterHash) {
        changes.push({ path, action: 'add', beforeHash: null, afterHash });
      } else if (beforeHash !== afterHash) {
        changes.push({ path, action: 'modify', beforeHash, afterHash });
      }
    }

    return changes;
  }
}

// ─── Row Mappers ──────────────────────────────────────

function rowToUser(row: any) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    password: row.password,
    role: row.role,
    sid: row.sid,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToOrder(row: any) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    userInfo: row.user_info,
    problem: row.problem,
    features: row.features,
    antiFeatures: row.anti_features,
    successCriteria: row.success_criteria,
    status: row.status,
    buyerId: row.buyer_id,
    developerId: row.developer_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToProgress(row: any) {
  return {
    id: row.id,
    orderId: row.order_id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
  };
}

function rowToStage(row: any) {
  return {
    id: row.id,
    orderId: row.order_id,
    stage: row.stage,
    stageOrder: row.stage_order,
    status: row.status,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Code Repo Row Mappers ─────────────────────────────

function rowToRepo(row: any) {
  return {
    id: row.id,
    orderId: row.order_id,
    defaultBranch: row.default_branch,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToBranch(row: any) {
  return {
    id: row.id,
    repoId: row.repo_id,
    name: row.name,
    headCommitId: row.head_commit_id,
    createdAt: row.created_at,
  };
}

function rowToCommit(row: any) {
  return {
    id: row.id,
    repoId: row.repo_id,
    ref: row.ref,
    message: row.message,
    description: row.description || '',
    parentId: row.parent_id,
    createdAt: row.created_at,
  };
}

function rowToCommitFile(row: any) {
  return {
    id: row.id,
    commitId: row.commit_id,
    filePath: row.file_path,
    fileHash: row.file_hash,
    fileSize: row.file_size,
    action: row.action,
  };
}

// ─── Singleton Export ────────────────────────────────
export const db = new Database();
