# Nginx в docker-compose.microservices.yml

## ✅ Добавлено

Сервис nginx успешно добавлен в `docker-compose.microservices.yml`:

- **Контейнер**: `beauty-studio-nginx`
- **Порты**: `80:80`, `443:443`
- **Сеть**: `beauty-network`
- **Зависимость**: Запускается после `gateway`
- **Volumes**: 
  - `./nginx/nginx.conf` → конфигурация
  - `/etc/letsencrypt` → SSL сертификаты
  - `nginx-cache` → кэш
  - `nginx-logs` → логи

## Конфигурация

Nginx проксирует все запросы на `gateway:3000` (API Gateway), который затем маршрутизирует их к соответствующим микросервисам.

## Запуск

```bash
# Запустить все сервисы включая nginx
docker-compose -f docker-compose.microservices.yml up -d

# Проверить статус nginx
docker-compose -f docker-compose.microservices.yml ps nginx

# Посмотреть логи nginx
docker-compose -f docker-compose.microservices.yml logs nginx
```

## Проверка

После запуска nginx должен быть доступен:

```bash
# Проверить HTTP (редирект на HTTPS)
curl -I http://clientix.uz/

# Проверить HTTPS
curl -k https://clientix.uz/health
```

## Важно

- Nginx использует SSL сертификаты из `/etc/letsencrypt/live/clientix.uz/`
- Убедитесь, что сертификаты доступны на хосте
- Если сертификатов нет, можно временно использовать самоподписанные или отключить HTTPS

