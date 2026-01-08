# Исправление Health Check для всех сервисов

## Проблема
Все сервисы использовали `wget` в health check, но в Docker образах установлен только `curl`. Это приводило к тому, что health check не проходил, и контейнеры помечались как unhealthy.

## Исправления

### 1. Заменен wget на curl во всех сервисах
- ✅ auth-service (3001)
- ✅ user-service (3002)
- ✅ booking-service (3003)
- ✅ catalog-service (3004)
- ✅ file-service (3005)
- ✅ notification-service (3006)
- ✅ telegram-service (3007)

### 2. Добавлен start_period для сервисов с БД
Добавлен `start_period: 40s` для всех сервисов, которые инициализируют базу данных:
- auth-service
- user-service
- booking-service
- catalog-service
- notification-service
- telegram-service

Это дает время на инициализацию БД перед началом health checks.

### 3. Обновлены Dockerfile
Добавлен `wget` в Dockerfile для всех сервисов (на случай, если понадобится):
```dockerfile
RUN apk add --no-cache curl wget
```

## Применение исправлений

```bash
# Пересобрать все образы
docker-compose -f docker-compose.microservices.yml build

# Перезапустить все сервисы
docker-compose -f docker-compose.microservices.yml up -d

# Проверить статус
docker-compose -f docker-compose.microservices.yml ps

# Проверить логи проблемных сервисов
docker logs beauty-studio-user --tail 50
```

## Проверка health check

Для каждого сервиса можно проверить health check вручную:

```bash
# Auth Service
docker exec beauty-studio-auth curl -f http://localhost:3001/health

# User Service
docker exec beauty-studio-user curl -f http://localhost:3002/health

# Booking Service
docker exec beauty-studio-booking curl -f http://localhost:3003/health

# Catalog Service
docker exec beauty-studio-catalog curl -f http://localhost:3004/health

# File Service
docker exec beauty-studio-file curl -f http://localhost:3005/health

# Notification Service
docker exec beauty-studio-notification curl -f http://localhost:3006/health

# Telegram Service
docker exec beauty-studio-telegram curl -f http://localhost:3007/health
```

## Диагностика

Если health check все еще не проходит:

1. **Проверить логи сервиса**:
   ```bash
   docker logs beauty-studio-user --tail 100
   ```

2. **Проверить, что сервис запущен**:
   ```bash
   docker exec beauty-studio-user ps aux
   ```

3. **Проверить, что порт слушается**:
   ```bash
   docker exec beauty-studio-user netstat -tlnp | grep 3002
   ```

4. **Проверить инициализацию БД**:
   - В логах должно быть: `✅ База данных инициализирована`
   - Если нет - проверить подключение к БД

5. **Проверить health endpoint напрямую**:
   ```bash
   docker exec beauty-studio-user curl -v http://localhost:3002/health
   ```

## Конфигурация health check

Текущая конфигурация для всех сервисов:
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:PORT/health"]
  interval: 30s      # Проверка каждые 30 секунд
  timeout: 10s       # Таймаут 10 секунд
  retries: 3         # 3 попытки перед пометкой как unhealthy
  start_period: 40s  # 40 секунд на инициализацию перед началом проверок
```

## Результат

После применения исправлений все сервисы должны успешно проходить health check и запускаться в правильном порядке.

