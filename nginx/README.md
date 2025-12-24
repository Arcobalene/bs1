# Nginx конфигурация для Beauty Studio

Этот каталог содержит конфигурацию nginx для работы в качестве reverse proxy.

## Структура

- `nginx.conf` - основная конфигурация nginx

## Настройка

### Домены

По умолчанию настроены домены:
- `clientix.uz`
- `www.clientix.uz`

Если нужно изменить домены, отредактируйте `nginx.conf`:

```nginx
server_name your-domain.com www.your-domain.com;
```

### SSL сертификаты

Конфигурация ожидает сертификаты Let's Encrypt по пути:
- `/etc/letsencrypt/live/clientix.uz/fullchain.pem`
- `/etc/letsencrypt/live/clientix.uz/privkey.pem`

Эти пути монтируются из хоста в Docker контейнер.

### Проксирование

Nginx проксирует запросы на:
- `http://beauty-studio:3000` (внутри Docker сети)

Это означает, что nginx и beauty-studio должны быть в одной сети (`beauty-network`).

## Обновление конфигурации

После изменения `nginx.conf`:

```bash
# Перезагрузить конфигурацию без остановки контейнера
docker-compose exec nginx nginx -s reload

# Или перезапустить контейнер
docker-compose restart nginx
```

## Проверка конфигурации

Проверить конфигурацию перед перезагрузкой:

```bash
docker-compose exec nginx nginx -t
```

## Логи

Логи nginx доступны через:

```bash
# Доступные логи
docker-compose logs nginx

# Только ошибки
docker-compose logs nginx | grep error

# Только доступы
docker-compose logs nginx | grep access
```

Или через volume `nginx-logs`:
- `/var/log/nginx/access.log`
- `/var/log/nginx/error.log`

