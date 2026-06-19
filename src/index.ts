import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import { userRoutes } from './routes/users';
import { orderRoutes } from './routes/orders';
import { repoRoutes } from './routes/repos';
// ⚠️ 真实 Git Smart HTTP 路由已暂时禁用 —— 用内置 SQLite 版本管理替代
// 问题：git-repo.ts 的 syncToDatabase 用 execSync 会阻塞事件循环，导致卡死
// import { gitRoutes } from './routes/git';
import { db } from './services/database';

const app = express();

// ─── Middleware ──────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ─── Serve frontend static files ────────────────────────
app.use((req, res, next) => {
  // Aggressively disable caching for HTML
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use(express.static(path.resolve(__dirname, '../frontend'), { maxAge: 0, etag: false, lastModified: false }));

// ─── Routes ─────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', uptime: process.uptime() } });
});

app.use('/api/users', userRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/repos', repoRoutes);
// app.use('/git', gitRoutes);  // 已禁用，见上方 import

// Fallback: serve index.html for SPA-like routing
app.get('*', (_req, res) => {
  res.sendFile(path.resolve(__dirname, '../frontend/index.html'));
});

// ─── Start ──────────────────────────────────────────────
async function main() {
  try {
    await db.connect();
    console.log('[DB] SQLite database ready');

    app.listen(config.port, config.host, () => {
      console.log(`[Server] Running at http://${config.host}:${config.port}`);
      console.log(`[Server] Health check: http://localhost:${config.port}/api/health`);
    });
  } catch (err) {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
  }
}

main();

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err);
  process.exit(1);
});

async function shutdown(signal: string) {
  console.log(`\n[Server] Received ${signal} — shutting down...`);
  db.close();
  console.log('[Server] Database closed');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
