# Настройка HTTPS для Beauty Studio

Это руководство поможет вам настроить HTTPS для вашего сайта с использованием сертификатов Let's Encrypt.

## Шаг 1: Получение SSL сертификата

Используйте скрипт `get_certificate.py` для получения сертификата Let's Encrypt:

```bash
# Получение сертификата через webroot (рекомендуется)
sudo python3 get_certificate.py \
  --email admin@example.com \
  --domain example.com \
  --webroot \
  --webroot-path /var/www/html
```

Или используйте certbot напрямую:

```bash
sudo certbot certonly --webroot \
  -w /var/www/html \
  -d example.com \
  -d www.example.com \
  --email admin@example.com \
  --agree-tos \
  --non-interactive
```

После успешного получения сертификаты будут находиться в:
- Сертификат: `/etc/letsencrypt/live/example.com/fullchain.pem`
- Приватный ключ: `/etc/letsencrypt/live/example.com/privkey.pem`

## Шаг 2: Настройка переменных окружения

Скопируйте пример конфигурации:

```bash
cp env.https.example .env
```

Отредактируйте `.env` файл:

```env
USE_HTTPS=true
HTTPS_PORT=3443
DOMAIN=example.com
SSL_DOMAIN=example.com
SSL_CERT_PATH=/etc/letsencrypt/live
FORCE_HTTPS=true
PORT=3000
```

## Шаг 3: Убедитесь, что Node.js имеет доступ к сертификатам

Сертификаты Let's Encrypt находятся в `/etc/letsencrypt/live/`, который доступен только root. Есть несколько вариантов:

### Вариант 1: Запуск от root (не рекомендуется для production)

```bash
sudo node server.js
```

### Вариант 2: Дать права на чтение сертификатов (рекомендуется)

```bash
# Создайте группу для доступа к сертификатам
sudo groupadd ssl-cert

# Добавьте пользователя в группу
sudo usermod -a -G ssl-cert $USER

# Дайте права группе на чтение сертификатов
sudo chgrp -R ssl-cert /etc/letsencrypt/live/
sudo chmod -R g+r /etc/letsencrypt/live/
sudo chmod 750 /etc/letsencrypt/live/

# Перелогиньтесь, чтобы применить изменения группы
```

### Вариант 3: Использование nginx в качестве reverse proxy (рекомендуется для production)

См. раздел "Настройка через nginx reverse proxy" ниже.

## Шаг 4: Запуск приложения

```bash
# Загрузите переменные окружения
export $(cat .env | xargs)

# Запустите приложение
node server.js
```

Приложение должно запуститься с HTTPS и автоматически перенаправлять все HTTP запросы на HTTPS.

## Настройка через nginx reverse proxy (рекомендуется для production)

Использование nginx в качестве reverse proxy - это лучший вариант для production, так как:

1. nginx может запускаться от root и иметь доступ к сертификатам
2. nginx лучше оптимизирован для работы с SSL/TLS
3. Легче управлять обновлением сертификатов

### 1. Установите nginx

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install nginx

# CentOS/RHEL
sudo yum install nginx
```

### 2. Получите сертификат через nginx

```bash
sudo python3 get_certificate.py \
  --email admin@example.com \
  --domain example.com \
  --nginx
```

Или используйте certbot напрямую:

```bash
sudo certbot --nginx -d example.com -d www.example.com
```

### 3. Настройте nginx как reverse proxy

Создайте файл `/etc/nginx/sites-available/beauty-studio`:

```nginx
server {
    listen 80;
    server_name example.com www.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com www.example.com;

    # SSL сертификаты Let's Encrypt
    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    # SSL настройки безопасности
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Заголовки безопасности
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Проксирование на Node.js приложение
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Таймауты
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Для Let's Encrypt верификации
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Логи
    access_log /var/log/nginx/beauty-studio-access.log;
    error_log /var/log/nginx/beauty-studio-error.log;
}
```

Активируйте конфигурацию:

```bash
sudo ln -s /etc/nginx/sites-available/beauty-studio /etc/nginx/sites-enabled/
sudo nginx -t  # Проверка конфигурации
sudo systemctl reload nginx
```

### 4. Настройте приложение

В этом случае приложение должно работать через HTTP на порту 3000, а HTTPS обрабатывается nginx. 

В `.env` файле:
```env
USE_HTTPS=false  # Отключаем HTTPS в Node.js, так как nginx обрабатывает SSL
PORT=3000
```

## Автоматическое обновление сертификатов

Let's Encrypt сертификаты действительны 90 дней. Certbot автоматически обновляет их, если вы настроили автоматическое обновление.

Проверьте, что автоматическое обновление включено:

```bash
sudo certbot renew --dry-run
```

Добавьте в crontab для автоматического обновления:

```bash
sudo crontab -e
```

Добавьте строку:

```
0 0 1 * * certbot renew --quiet && systemctl reload nginx
```

## Проверка работы HTTPS

1. Откройте браузер и перейдите на `https://example.com`
2. Проверьте, что в адресной строке есть значок замка
3. Проверьте редирект с HTTP на HTTPS: `http://example.com` должен автоматически перенаправить на `https://example.com`

## Устранение проблем

### Ошибка: "SSL сертификат не найден"

- Убедитесь, что путь к сертификатам указан правильно
- Проверьте, что сертификат существует: `sudo ls -la /etc/letsencrypt/live/example.com/`
- Убедитесь, что приложение имеет права на чтение сертификатов

### Ошибка: "EACCES: permission denied"

- Проверьте права доступа к файлам сертификатов
- Используйте один из вариантов из Шага 3

### Ошибка: "self signed certificate" в браузере

- Убедитесь, что вы используете правильный домен (тот, для которого получен сертификат)
- Проверьте, что сертификат действителен: `sudo certbot certificates`

### Порт 443 занят

Если вы используете nginx, он уже слушает порт 443. В этом случае используйте nginx как reverse proxy (см. раздел выше) и не включайте `USE_HTTPS=true` в Node.js приложении.

## Настройка HTTPS в Docker

Если вы используете Docker, вам нужно:

1. Убедиться, что сертификаты доступны в контейнере. Отредактируйте `docker-compose.postgres.yml` и раскомментируйте строку с монтированием сертификатов:

```yaml
volumes:
  - ./views:/app/views
  - ./public:/app/public
  # Раскомментируйте и укажите правильный путь к сертификатам на хосте:
  - /etc/letsencrypt/live:/etc/letsencrypt/live:ro
```

2. Добавьте переменные окружения в `.env` файл:

```env
USE_HTTPS=true
HTTPS_PORT=3443
DOMAIN=example.com
SSL_DOMAIN=example.com
SSL_CERT_PATH=/etc/letsencrypt/live
FORCE_HTTPS=true
```

Переменные окружения уже добавлены в `docker-compose.postgres.yml`, они будут автоматически подхвачены из `.env` файла.

3. Порты уже настроены в `docker-compose.postgres.yml`:
   - Порт 3000 - HTTP (для редиректа)
   - Порт 3443 - HTTPS

4. Запустите контейнер:

```bash
docker-compose -f docker-compose.postgres.yml up -d
```

**Примечание**: При использовании Docker рекомендуется использовать nginx как reverse proxy на хосте (см. раздел "Настройка через nginx reverse proxy" выше), а не включать HTTPS внутри контейнера. Это более безопасно и эффективно.

## Дополнительная информация

- [Документация Let's Encrypt](https://letsencrypt.org/docs/)
- [Документация Certbot](https://certbot.eff.org/docs/)
- [Документация nginx SSL](https://nginx.org/en/docs/http/configuring_https_servers.html)

