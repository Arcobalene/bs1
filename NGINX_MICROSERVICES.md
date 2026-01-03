# Настройка Nginx для микросервисной архитектуры

## Изменения в конфигурации

Для работы с микросервисной архитектурой nginx теперь проксирует запросы на **API Gateway** (`gateway:3000`) вместо монолитного приложения (`beauty-studio:3000`).

## Обновленная конфигурация

Файл `nginx/nginx.conf` был обновлен:

```nginx
location / {
    # Старая конфигурация (монолит):
    # proxy_pass http://beauty-studio:3000;
    
    # Новая конфигурация (микросервисы):
    proxy_pass http://gateway:3000;
    ...
}
```

## Как это работает

1. **Клиент** → HTTPS запрос на `https://clientix.uz`
2. **nginx** → Принимает HTTPS, расшифровывает SSL
3. **nginx** → Проксирует HTTP запрос на `http://gateway:3000` (API Gateway)
4. **API Gateway** → Маршрутизирует запросы к соответствующим микросервисам:
   - `/api/register`, `/api/login` → Auth Service (3001)
   - `/api/user`, `/api/users` → User Service (3002)
   - `/api/bookings` → Booking Service (3003)
   - `/api/services`, `/api/masters` → Catalog Service (3004)
   - `/api/minio` → File Service (3005)
   - `/api/notifications` → Notification Service (3006)
   - `/api/telegram`, `/api/bot` → Telegram Service (3007)
   - HTML страницы → Gateway (статические файлы и views)

## Добавление nginx в docker-compose.microservices.yml

Если нужно добавить nginx в docker-compose для микросервисов, добавьте:

```yaml
  nginx:
    image: nginx:alpine
    container_name: beauty-studio-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
      - nginx-cache:/var/cache/nginx
      - nginx-logs:/var/log/nginx
    networks:
      - beauty-network
    depends_on:
      gateway:
        condition: service_started
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
```

И добавьте volumes:

```yaml
volumes:
  nginx-cache:
    driver: local
  nginx-logs:
    driver: local
```

## Проверка конфигурации

```bash
# Проверить конфигурацию
docker-compose exec nginx nginx -t

# Перезагрузить конфигурацию
docker-compose exec nginx nginx -s reload

# Посмотреть логи
docker-compose logs nginx
```

## Важные замечания

1. **Имя контейнера**: В Docker сети контейнер API Gateway называется `gateway` (как определено в docker-compose.microservices.yml)

2. **Сеть**: nginx должен быть в той же Docker сети (`beauty-network`), что и все микросервисы

3. **Зависимости**: nginx должен ждать запуска gateway перед стартом

4. **SSL сертификаты**: Пути к сертификатам остаются прежними (`/etc/letsencrypt/live/clientix.uz/`)

