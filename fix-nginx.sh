#!/bin/bash
set -e

echo "=== FIXING NGINX CONFIGURATION ==="

# Find project directory
PROJECT_DIR="/root/bs1"
if [ ! -d "$PROJECT_DIR" ]; then
    echo "Error: Project directory not found"
    exit 1
fi

cd $PROJECT_DIR

# Create new nginx config for Docker container
cat > nginx/nginx.conf << 'EOFNGINX'
events {
    worker_connections 1024;
}

http {
    upstream gateway {
        server gateway:3000;
    }

    server {
        listen 80;
        server_name clientix.uz;
        return 301 https://$host$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name clientix.uz;

        ssl_certificate /etc/nginx/ssl/fullchain.pem;
        ssl_certificate_key /etc/nginx/ssl/privkey.pem;

        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;

        # Proxy to Gateway
        location / {
            proxy_pass http://gateway;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
            proxy_read_timeout 90;
        }

        client_max_body_size 50M;
    }
}
EOFNGINX

echo "Config created at nginx/nginx.conf"

# Restart nginx container
echo "Restarting nginx container..."
docker-compose -f docker-compose.microservices.yml restart nginx

echo "Waiting for nginx to start..."
sleep 5

# Test
echo "Testing configuration..."
docker logs beauty-studio-nginx --tail 20

echo "=== DONE ==="
