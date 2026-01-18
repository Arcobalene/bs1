#!/bin/bash
set -e

echo "=== NGINX FINAL FIX ==="

PROJECT_DIR="/root/bs1"
cd $PROJECT_DIR

echo "1. Останавливаем nginx контейнер..."
docker-compose -f docker-compose.microservices.yml stop nginx

echo ""
echo "2. Создаём правильную конфигурацию..."
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

        # SSL сертификаты (монтируются из /etc/letsencrypt на хосте)
        ssl_certificate /etc/letsencrypt/live/clientix.uz/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/clientix.uz/privkey.pem;

        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;

        # Security Headers
        add_header Strict-Transport-Security "max-age=31536000" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;

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

            proxy_read_timeout 90s;
            proxy_cache_bypass $http_upgrade;
        }
    }
}
EOFNGINX

echo "✅ Конфигурация создана в nginx/nginx.conf"

echo ""
echo "3. Проверяем содержимое конфига..."
head -20 nginx/nginx.conf

echo ""
echo "4. Удаляем старый контейнер..."
docker-compose -f docker-compose.microservices.yml rm -f nginx

echo ""
echo "5. Пересоздаём контейнер..."
docker-compose -f docker-compose.microservices.yml up -d nginx

echo ""
echo "6. Ждём запуска (10 секунд)..."
sleep 10

echo ""
echo "7. Проверяем статус контейнера..."
docker ps | grep nginx

echo ""
echo "8. Проверяем логи..."
docker logs beauty-studio-nginx --tail 20

echo ""
echo "9. Проверяем конфиг внутри контейнера..."
echo "SSL certificate path:"
docker exec beauty-studio-nginx cat /etc/nginx/nginx.conf | grep ssl_certificate

echo ""
echo "10. Проверяем наличие сертификатов в контейнере..."
docker exec beauty-studio-nginx ls -la /etc/letsencrypt/live/clientix.uz/ 2>&1 || echo "Сертификаты не найдены!"

echo ""
echo "=== ТЕСТИРОВАНИЕ ==="

echo "Test 1: Gateway health check (изнутри Docker):"
docker exec beauty-studio-gateway curl -s http://localhost:3000/health

echo ""
echo "Test 2: Через nginx (HTTP - должен редиректить):"
curl -I http://localhost/ 2>&1 | head -5

echo ""
echo "Test 3: Проверка через внешний домен:"
curl -k -I https://clientix.uz/health 2>&1 | head -10

echo ""
echo "=== ГОТОВО ==="
echo "Проверьте сайт: https://clientix.uz/"
