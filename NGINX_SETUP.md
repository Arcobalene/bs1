# Настройка Node.js приложения за nginx reverse proxy

Если вы используете nginx как reverse proxy с SSL termination (как в вашем случае), настройка Node.js приложения немного отличается.

## Ваша текущая конфигурация nginx

Ваш nginx уже правильно настроен:
- Обрабатывает SSL/HTTPS на порту 443
- Проксирует запросы на Node.js приложение по HTTP (порт 3000)
- Передает заголовки `X-Forwarded-Proto`, `X-Real-IP`, и другие

## Настройка Node.js приложения

### 1. Отключите HTTPS в Node.js

Поскольку nginx уже обрабатывает HTTPS, Node.js должен работать только по HTTP.

В `.env` файле или переменных окружения установите:

```env
USE_HTTPS=false
PORT=3000
BEHIND_HTTPS_PROXY=true
TRUST_PROXY=true
```

**Объяснение переменных:**
- `USE_HTTPS=false` - отключает встроенный HTTPS сервер в Node.js
- `BEHIND_HTTPS_PROXY=true` - сообщает приложению, что оно работает за HTTPS прокси (для secure cookies)
- `TRUST_PROXY=true` - включает поддержку заголовков от reverse proxy (по умолчанию уже включено)

### 2. Убедитесь, что приложение слушает на правильном адресе

В вашем случае nginx проксирует на `http://155.212.184.10:3000`. 

Убедитесь, что Node.js приложение слушает на всех интерфейсах (0.0.0.0), а не только на localhost:

```env
HOST=0.0.0.0  # или просто не указывайте, по умолчанию слушает на всех интерфейсах
PORT=3000
```

### 3. Проверка работы

После настройки:

1. Приложение должно запускаться только на HTTP (порт 3000)
2. Secure cookies будут работать правильно (благодаря `BEHIND_HTTPS_PROXY=true`)
3. HSTS заголовки будут добавляться для HTTPS запросов
4. `req.secure` будет правильно определяться через заголовок `X-Forwarded-Proto`

## Полный пример .env файла

```env
# Отключить встроенный HTTPS (nginx обрабатывает SSL)
USE_HTTPS=false

# Порт для HTTP (nginx проксирует на этот порт)
PORT=3000

# Работа за HTTPS прокси
BEHIND_HTTPS_PROXY=true
TRUST_PROXY=true

# Остальные настройки...
NODE_ENV=production
SESSION_SECRET=your-secret-key-here
DB_TYPE=postgres
DB_HOST=db
DB_PORT=5432
DB_NAME=beauty_studio
DB_USER=beauty_user
DB_PASSWORD=beauty_password
```

## Как это работает

1. **Клиент** → HTTPS запрос на `https://clientix.uz`
2. **nginx** → Принимает HTTPS, расшифровывает SSL
3. **nginx** → Проксирует HTTP запрос на `http://155.212.184.10:3000` с заголовками:
   - `X-Forwarded-Proto: https`
   - `X-Real-IP: <клиентский IP>`
   - `X-Forwarded-For: <клиентский IP>`
   - `Host: clientix.uz`
4. **Node.js** → Видит заголовок `X-Forwarded-Proto: https`, понимает что запрос был HTTPS
5. **Node.js** → Устанавливает secure cookies и добавляет HSTS заголовки

## Улучшение конфигурации nginx (опционально)

Ваша текущая конфигурация работает, но можно добавить несколько улучшений:

```nginx
events {
    worker_connections 1024;
}

http {
    # HTTP → HTTPS редирект
    server {
        listen 80;
        server_name clientix.uz www.clientix.uz;
        
        # Редирект на HTTPS
        return 301 https://$server_name$request_uri;
        
        # Для Let's Encrypt renewal (если используете веб-рут)
        location /.well-known/acme-challenge/ {
            root /usr/share/nginx/html;
        }
    }

    # HTTPS сервер
    server {
        listen 443 ssl http2;
        server_name clientix.uz www.clientix.uz;
        
        # SSL сертификаты
        ssl_certificate /etc/letsencrypt/live/clientix.uz/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/clientix.uz/privkey.pem;
        
        # Улучшенные SSL настройки безопасности
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
        ssl_prefer_server_ciphers off;
        ssl_session_cache shared:SSL:10m;
        ssl_session_timeout 10m;
        
        # Заголовки безопасности (nginx тоже должен их добавлять)
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        
        location / {
            proxy_pass http://155.212.184.10:3000;
            
            # Основные заголовки для reverse proxy
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Host $server_name;
            
            # Для WebSocket (если используется)
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            
            # Таймауты
            proxy_connect_timeout 60s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;
            
            # Буферизация
            proxy_buffering off;
        }
    }
}
```

## Проверка

После настройки проверьте:

1. **Проверка secure cookies:**
   ```bash
   curl -I https://clientix.uz/login
   ```
   В ответе должен быть заголовок `Set-Cookie` с флагом `Secure`

2. **Проверка HSTS:**
   ```bash
   curl -I https://clientix.uz/
   ```
   Должен быть заголовок `Strict-Transport-Security`

3. **Проверка редиректа HTTP → HTTPS:**
   ```bash
   curl -I http://clientix.uz/
   ```
   Должен быть редирект `301` на `https://clientix.uz/`

## Устранение проблем

### Проблема: Cookies не работают (не устанавливаются)

**Решение:** Убедитесь, что `BEHIND_HTTPS_PROXY=true` установлено, и что nginx передает заголовок `X-Forwarded-Proto: https`

### Проблема: Сайт показывает "Not Secure" в браузере

**Решение:** Проверьте, что nginx правильно передает `X-Forwarded-Proto: https`, и что `TRUST_PROXY=true`

### Проблема: Бесконечные редиректы

**Решение:** Убедитесь, что `USE_HTTPS=false` и что редирект HTTP → HTTPS обрабатывается только nginx

## Дополнительная информация

- [Express trust proxy](https://expressjs.com/en/guide/behind-proxies.html)
- [nginx proxy_pass документация](http://nginx.org/en/docs/http/ngx_http_proxy_module.html)

