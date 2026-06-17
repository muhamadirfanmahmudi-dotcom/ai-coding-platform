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

// ─── Singleton Export ────────────────────────────────
export const db = new Database();
