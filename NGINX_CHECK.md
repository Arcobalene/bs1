# Проверка конфигурации Nginx

## Текущая конфигурация

✅ **nginx.conf обновлен** для работы с микросервисной архитектурой:
- Проксирование на `gateway:3000` вместо `beauty-studio:3000`
- Все остальные настройки остались прежними

## Что нужно сделать

### Вариант 1: Использовать существующий nginx (рекомендуется)

Если nginx уже запущен отдельно на хосте, просто обновите конфигурацию:

```bash
# Скопировать обновленную конфигурацию
sudo cp nginx/nginx.conf /etc/nginx/nginx.conf

# Проверить конфигурацию
sudo nginx -t

# Перезагрузить nginx
sudo systemctl reload nginx
# или
sudo nginx -s reload
```

### Вариант 2: Добавить nginx в docker-compose.microservices.yml

Если хотите запускать nginx в Docker вместе с микросервисами, добавьте сервис nginx в docker-compose.microservices.yml (см. NGINX_MICROSERVICES.md)

## Проверка работы

После обновления конфигурации проверьте:

```bash
# Проверить, что gateway доступен
curl http://localhost:3000/health

# Проверить через nginx (если nginx на хосте)
curl -k https://clientix.uz/health

# Проверить логи nginx
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log
```

## Важные изменения

- ❌ **Старая конфигурация**: `proxy_pass http://beauty-studio:3000;`
- ✅ **Новая конфигурация**: `proxy_pass http://gateway:3000;`

Это единственное изменение, необходимое для работы с микросервисной архитектурой.

