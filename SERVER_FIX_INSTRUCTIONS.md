# 🔧 ИНСТРУКЦИЯ ПО ИСПРАВЛЕНИЮ СЕРВЕРА clientix.uz

## 📊 **НАЙДЕННЫЕ ПРОБЛЕМЫ:**

### ✅ **Что работает:**
1. Docker контейнеры запущены
2. Gateway (3000) - работает ✅
3. User-service (3002) - работает ✅
4. Auth-service (3001) - работает ✅
5. PostgreSQL - работает ✅
6. Redis - работает ✅
7. API endpoints работают **внутри Docker сети**

### ❌ **Главная проблема:**
**Nginx контейнер НЕ проксирует запросы на gateway!**

Текущая конфигурация nginx использует дефолтные настройки и отдаёт статику из `/usr/share/nginx/html` вместо проксирования на gateway:3000.

**Результат:**
- ✅ https://clientix.uz/ - главная страница работает
- ❌ https://clientix.uz/api/* - все API endpoints возвращают 404
- ❌ Кнопки на главной странице не работают
- ❌ Регистрация/вход не работают

---

## 🛠️ **РЕШЕНИЕ:**

### **Вариант 1: Исправить nginx конфигурацию Docker контейнера (РЕКОМЕНДУЕТСЯ)**

#### Шаг 1: Подключитесь к серверу
```bash
ssh root@155.212.184.10
```

#### Шаг 2: Найдите проект
```bash
cd /root/bs1  # или где находится ваш проект
ls -la
```

#### Шаг 3: Создайте правильный nginx.conf
```bash
cat > nginx/nginx.conf << 'EOFNGINX'
events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    upstream gateway {
        server gateway:3000;
    }

    # HTTP -> HTTPS redirect
    server {
        listen 80;
        server_name clientix.uz;
        return 301 https://$host$request_uri;
    }

    # HTTPS
    server {
        listen 443 ssl http2;
        server_name clientix.uz;

        # SSL certificates (mounted from host)
        ssl_certificate /etc/letsencrypt/live/clientix.uz/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/clientix.uz/privkey.pem;

        # SSL configuration
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;

        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

        # Proxy ALL requests to gateway
        location / {
            proxy_pass http://gateway;
            proxy_http_version 1.1;

            # WebSocket support
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';

            # Forward headers
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            # Cache bypass
            proxy_cache_bypass $http_upgrade;

            # Timeouts
            proxy_connect_timeout 90;
            proxy_send_timeout 90;
            proxy_read_timeout 90;
        }

        # File upload limit
        client_max_body_size 50M;

        # Logs
        access_log /var/log/nginx/access.log;
        error_log /var/log/nginx/error.log;
    }
}
EOFNGINX
```

#### Шаг 4: Проверьте docker-compose.yml
Убедитесь, что nginx смонтирован правильно:
```bash
cat docker-compose.microservices.yml | grep -A 20 "nginx:"
```

Должно быть примерно так:
```yaml
nginx:
  image: nginx:alpine
  container_name: beauty-studio-nginx
  ports:
    - "80:80"
    - "443:443"
  volumes:
    - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    - /etc/letsencrypt:/etc/letsencrypt:ro
  depends_on:
    - gateway
  networks:
    - beauty-network
```

#### Шаг 5: Перезапустите nginx
```bash
docker-compose -f docker-compose.microservices.yml restart nginx

# Проверьте логи
docker logs beauty-studio-nginx --tail 50
```

#### Шаг 6: Проверьте работу
```bash
# Health check
curl http://localhost/health

# API test
curl -X POST http://localhost/api/register-client \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","phone":"+998901234567"}'
```

---

### **Вариант 2: Использовать host nginx (альтернатива)**

Если Docker nginx не работает, можно использовать nginx на хосте:

#### Шаг 1: Остановите Docker nginx
```bash
docker-compose -f docker-compose.microservices.yml stop nginx
```

#### Шаг 2: Создайте конфигурацию для host nginx
```bash
cat > /etc/nginx/sites-available/clientix.uz << 'EOFNGINX'
server {
    listen 80;
    listen [::]:80;
    server_name clientix.uz;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name clientix.uz;

    # SSL
    ssl_certificate /etc/letsencrypt/live/clientix.uz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/clientix.uz/privkey.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Proxy to Gateway
    location / {
        proxy_pass http://127.0.0.1:3000;
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
EOFNGINX
```

#### Шаг 3: Активируйте конфигурацию
```bash
ln -sf /etc/nginx/sites-available/clientix.uz /etc/nginx/sites-enabled/clientix.uz
rm /etc/nginx/sites-enabled/default  # Удалите дефолтный конфиг

# Проверьте синтаксис
nginx -t

# Перезапустите nginx
systemctl restart nginx
systemctl status nginx
```

---

## ✅ **ПРОВЕРКА ПОСЛЕ ИСПРАВЛЕНИЯ:**

### 1. Проверьте health check:
```bash
curl https://clientix.uz/health
```
Ожидаемый результат:
```json
{"status":"ok","service":"gateway","timestamp":"2026-01-18...","redis":"connected"}
```

### 2. Проверьте API регистрации:
```bash
curl -X POST https://clientix.uz/api/register-client \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","phone":"+998901234567"}'
```
Ожидаемый результат:
```json
{"success":true,"message":"Регистрация успешна"}
```

### 3. Проверьте в браузере:
- Откройте https://clientix.uz/
- Нажмите "Начать бесплатно" → должно открыться модальное окно
- Нажмите "Войти в систему" → должно открыться модальное окно

### 4. Проверьте стили (если есть проблема):
```bash
# Если стили не загружаются
curl -I https://clientix.uz/style.css
```

---

## 📝 **ДОПОЛНИТЕЛЬНО:**

### Обновить код app.js для landing
Уже исправлено в локальном репозитории. Нужно задеплоить:
```bash
cd /root/bs1
git pull origin main
docker-compose -f docker-compose.microservices.yml restart landing-service
```

---

## 🚨 **ЕСЛИ ЧТО-ТО НЕ РАБОТАЕТ:**

### Проверьте логи:
```bash
# Gateway
docker logs beauty-studio-gateway --tail 100

# User service
docker logs beauty-studio-user --tail 100

# Nginx
docker logs beauty-studio-nginx --tail 100

# Все unhealthy сервисы
docker ps -a | grep unhealthy
```

### Перезапустите все сервисы:
```bash
cd /root/bs1
docker-compose -f docker-compose.microservices.yml restart
```

### Проверьте порты:
```bash
netstat -tulpn | grep -E '80|443|3000|3001|3002'
```

---

## 📞 **НУЖНА ПОМОЩЬ?**

Отправьте мне вывод этих команд:
```bash
docker ps -a
docker logs beauty-studio-nginx --tail 50
docker logs beauty-studio-gateway --tail 50
curl http://localhost:3000/health
```
