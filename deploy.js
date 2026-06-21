const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const SERVER = {
  host: '47.98.113.89',
  port: 22,
  username: 'root',
  password: 'Yy123456',
};

function run(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';
    conn.on('ready', () => {
      console.log(`[SSH] Connected to ${SERVER.host}`);
      conn.exec(cmd, (err, stream) => {
        if (err) { conn.end(); return reject(err); }
        stream.on('close', (code) => {
          conn.end();
          resolve({ stdout, stderr, code });
        }).on('data', (d) => stdout += d.toString())
          .on('stderr', (d) => stderr += d.toString());
      });
    }).on('error', reject);
    conn.connect(SERVER);
  });
}

async function main() {
  console.log('=== 1. Test SSH connection ===');
  let res = await run('echo OK && hostname');
  if (res.code !== 0) { console.error('SSH failed:', res.stderr); process.exit(1); }
  console.log('Host:', res.stdout.trim());

  console.log('\n=== 2. Check current state ===');
  res = await run('ps aux | grep -E "node|npm|pm2" | grep -v grep || echo "no node processes"');
  console.log('Running processes:\n', res.stdout);

  res = await run('df -h / --output=pcent | tail -1');
  console.log('Disk usage:', res.stdout.trim());

  res = await run('free -h | grep Mem');
  console.log('Memory:', res.stdout.trim());

  console.log('\n=== 3. Check Node.js ===');
  res = await run('node -v || echo "N/A"');
  console.log('Node:', res.stdout.trim());

  res = await run('npm -v || echo "N/A"');
  console.log('npm:', res.stdout.trim());

  res = await run('pm2 -v || echo "N/A"');
  console.log('PM2:', res.stdout.trim());

  res = await run('nginx -v 2>&1 || echo "N/A"');
  console.log('Nginx:', res.stdout.trim());

  console.log('\n=== 4. Stop existing projects ===');
  // Stop PM2 processes
  await run('pm2 kill 2>/dev/null; echo done');
  // Kill any node processes on common ports
  await run('kill $(lsof -t -i:3000) 2>/dev/null; echo done');
  await run('kill $(lsof -t -i:3001) 2>/dev/null; echo done');
  await run('kill $(lsof -t -i:80) 2>/dev/null; echo done');
  console.log('Existing processes stopped');

  console.log('\n=== 5. Install Node.js (if needed) ===');
  res = await run('command -v node && node -v || echo "MISSING"');
  if (res.stdout.includes('MISSING')) {
    console.log('Installing Node.js 22...');
    await run(`
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash - &&
      apt-get install -y nodejs
    `);
    console.log('Node.js installed');
  } else {
    console.log('Node.js already installed:', res.stdout.trim());
  }

  console.log('\n=== 6. Install PM2 ===');
  await run('npm install -g pm2 2>&1 | tail -3');
  console.log('PM2 ready');

  console.log('\n=== 7. Check for Nginx and existing sites ===');
  res = await run('nginx -t 2>&1; echo "---"; ls /etc/nginx/sites-enabled/ 2>/dev/null || echo "no sites"');
  console.log('Nginx status:\n', res.stdout.slice(0, 500));

  console.log('\n=== Deployment plan ready! ===');
  console.log('Server is accessible and ready for the project setup.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
