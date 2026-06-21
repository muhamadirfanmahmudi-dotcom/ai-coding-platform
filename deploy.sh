#!/bin/bash
set -e

echo "===== 1. 更新系统 ====="
apt-get update -y

echo "===== 2. 安装 Node.js 22 ====="
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "Node: $(node -v)"
echo "npm: $(npm -v)"

echo "===== 3. 安装 PM2 ====="
npm install -g pm2

echo "===== 4. 清理旧项目 ====="
pm2 kill 2>/dev/null || true
rm -rf /root/ai-coding-platform || true
kill $(lsof -t -i:3000) 2>/dev/null || true
kill $(lsof -t -i:80) 2>/dev/null || true

echo "===== 5. 克隆项目 ====="
cd /root
git clone https://github.com/muhamadirfanmahmudi-dotcom/ai-coding-platform.git
cd ai-coding-platform

echo "===== 6. 安装依赖 ====="
npm install

echo "===== 7. 创建 .env ====="
cat > .env << 'EOF'
PORT=3000
HOST=0.0.0.0
DATABASE_URL="file:./dev.db"
EOF

echo "===== 8. 启动（PM2） ====="
pm2 start npm --name "vibe-coding" -- run dev
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo "===== 9. 安装 Nginx 做反向代理 ====="
apt-get install -y nginx
cat > /etc/nginx/sites-available/vibe-coding << 'NGINX'
server {
    listen 80;
    server_name _;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 支持（Socket.IO）
        proxy_read_timeout 86400;
    }

    # Socket.IO 需要长连接
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/vibe-coding /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

echo ""
echo "========================================"
echo "✅ 部署完成！"
echo "访问地址: http://47.98.113.89"
echo "========================================"
