# Исправление ошибки 504 Gateway Timeout

## Проблема
Ошибка `504 Gateway Timeout` при обращении к `/api/login` означает, что gateway не может получить ответ от auth-service в течение установленного таймаута.

## Что было исправлено:

### 1. Gateway (gateway/server.js)
- Добавлены таймауты в `proxyOptions`:
  - `timeout: 30000` (30 секунд)
  - `proxyTimeout: 30000` (30 секунд)
- Улучшена обработка ошибок в `onError`

### 2. Nginx (nginx/nginx.conf)
- Таймауты уже были настроены (60 секунд):
  - `proxy_connect_timeout 60s`
  - `proxy_send_timeout 60s`
  - `proxy_read_timeout 60s`

### 3. Docker Compose
- Обновлены `depends_on` для gateway с `condition: service_started`

## Возможные причины 504:

1. **Auth-service не запущен**
   - Проверьте: `docker ps | grep auth`
   - Запустите: `docker-compose -f docker-compose.microservices.yml up -d auth-service`

2. **Auth-service не может подключиться к БД**
   - Проверьте логи: `docker logs beauty-studio-auth`
   - Убедитесь, что БД запущена: `docker ps | grep db`

3. **Auth-service долго инициализируется**
   - Проверьте логи инициализации БД
   - Увеличьте таймауты, если нужно

4. **Проблемы с сетью Docker**
   - Убедитесь, что все сервисы в одной сети `beauty-network`
   - Проверьте: `docker network inspect beauty-network`

## Что делать:

1. Проверьте статус всех сервисов:
   ```bash
   docker-compose -f docker-compose.microservices.yml ps
   ```

2. Проверьте логи auth-service:
   ```bash
   docker-compose -f docker-compose.microservices.yml logs auth-service
   ```

3. Проверьте логи gateway:
   ```bash
   docker-compose -f docker-compose.microservices.yml logs gateway
   ```

4. Перезапустите сервисы, если нужно:
   ```bash
   docker-compose -f docker-compose.microservices.yml restart auth-service gateway
   ```

## После исправлений:

Перезапустите gateway и nginx для применения изменений:
```bash
docker-compose -f docker-compose.microservices.yml restart gateway nginx
```

