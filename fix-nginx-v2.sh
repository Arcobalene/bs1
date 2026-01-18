#!/bin/bash
set -e

echo "=== FIXING NGINX CONFIGURATION V2 ==="

PROJECT_DIR="/root/bs1"
cd $PROJECT_DIR

# Создаём правильную конфигурацию с корректными путями к SSL
cat > nginx/nginx.conf << 'EOFNGINX'
events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log warn;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;

    gzip on;
    gzip_vary on;
    gzip_min_length 1000;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    upstream gateway {
        server gateway:3000;
    }

    # HTTP -> HTTPS redirect
    server {
        listen 80;
        listen [::]:80;
        server_name clientix.uz www.clientix.uz;
        return 301 https://$host$request_uri;
    }

    # HTTPS Server
    server {
        listen 443 ssl;
        listen [::]:443 ssl;
        http2 on;
        server_name clientix.uz www.clientix.uz;

        # SSL - путь к сертификатам Let's Encrypt (монтируется из хоста)
        ssl_certificate /etc/letsencrypt/live/clientix.uz/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/clientix.uz/privkey.pem;

        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;

        # Security Headers
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;

        client_max_body_size 50M;

        # Proxy ALL requests to Gateway
        location / {
            proxy_pass http://gateway;
            proxy_http_version 1.1;

            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            proxy_connect_timeout 90s;
            proxy_send_timeout 90s;
            proxy_read_timeout 90s;

            proxy_cache_bypass $http_upgrade;
            proxy_redirect off;
        }
    }
}
EOFNGINX

echo "✅ Config created"

# Проверяем монтирование SSL в docker-compose
echo ""
echo "Проверяем docker-compose.yml..."
grep -A 20 "nginx:" docker-compose.microservices.yml | grep -E "volumes:|letsencrypt"

echo ""
echo "Перезапускаем nginx..."
docker-compose -f docker-compose.microservices.yml restart nginx

echo ""
echo "Ожидание запуска..."
sleep 5

echo ""
echo "Проверяем логи nginx..."
docker logs beauty-studio-nginx --tail 30

echo ""
echo "=== Тестирование ==="
echo "1. Health check:"
curl -s http://localhost/health || echo "Не работает через HTTP"

echo ""
echo "2. HTTPS test (локально):"
docker exec beauty-studio-gateway curl -s http://localhost:3000/health

echo ""
echo "=== ГОТОВО ==="
