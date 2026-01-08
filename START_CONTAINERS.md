# Инструкция по запуску контейнеров

## Проблема: Контейнеры в состоянии "Created"

Контейнеры созданы, но не запущены. Это может быть из-за:
1. Зависимостей (depends_on) - другие сервисы еще не готовы
2. Ошибок при запуске
3. Проблем с health checks

## Решение

### 1. Проверьте статус всех контейнеров

```bash
docker ps -a --filter "name=beauty-studio"
```

### 2. Проверьте логи контейнеров

```bash
# Gateway
docker logs beauty-studio-gateway

# Nginx
docker logs beauty-studio-nginx
```

### 3. Запустите контейнеры через docker-compose

```bash
# Перейти в директорию проекта
cd ~/bs1

# Запустить все сервисы
docker-compose -f docker-compose.microservices.yml up -d

# Или запустить конкретные сервисы
docker-compose -f docker-compose.microservices.yml up -d gateway nginx
```

### 4. Если контейнеры не запускаются из-за зависимостей

Проверьте, что все зависимости запущены:

```bash
# Проверить статус всех сервисов
docker-compose -f docker-compose.microservices.yml ps

# Запустить все сервисы в правильном порядке
docker-compose -f docker-compose.microservices.yml up -d db redis
docker-compose -f docker-compose.microservices.yml up -d auth-service user-service
docker-compose -f docker-compose.microservices.yml up -d gateway
docker-compose -f docker-compose.microservices.yml up -d nginx
```

### 5. Если контейнеры падают сразу после запуска

Проверьте логи:

```bash
# Посмотреть последние логи
docker logs beauty-studio-gateway --tail 50
docker logs beauty-studio-nginx --tail 50

# Следить за логами в реальном времени
docker logs -f beauty-studio-gateway
```

### 6. Принудительный запуск (если health checks блокируют)

Если health checks не проходят, можно временно запустить без ожидания:

```bash
# Запустить gateway без ожидания health check
docker start beauty-studio-gateway

# Запустить nginx без ожидания health check
docker start beauty-studio-nginx
```

### 7. Проверка после запуска

```bash
# Проверить, что контейнеры запущены
docker ps --filter "name=beauty-studio"

# Проверить статус через docker-compose
docker-compose -f docker-compose.microservices.yml ps

# Проверить health status
docker inspect beauty-studio-gateway | grep -A 10 Health
docker inspect beauty-studio-nginx | grep -A 10 Health
```

## Типичные проблемы

### Gateway не запускается

1. **Redis не готов**:
   ```bash
   docker logs beauty-studio-redis
   docker start beauty-studio-redis
   ```

2. **Ошибки в коде**:
   ```bash
   docker logs beauty-studio-gateway
   # Проверьте на наличие SyntaxError, ModuleNotFoundError и т.д.
   ```

3. **Проблемы с путями**:
   - Убедитесь, что volumes правильно смонтированы
   - Проверьте, что файлы существуют в контейнере

### Nginx не запускается

1. **Gateway не готов**:
   ```bash
   # Nginx ждет, пока gateway станет healthy
   docker logs beauty-studio-gateway
   docker logs beauty-studio-nginx
   ```

2. **Ошибки конфигурации**:
   ```bash
   # Проверить синтаксис nginx.conf
   docker exec beauty-studio-nginx nginx -t
   ```

3. **SSL сертификаты отсутствуют**:
   - Если сертификаты не найдены, nginx не запустится
   - Проверьте путь: `/etc/letsencrypt/live/clientix.uz/`

## Быстрый старт

```bash
# 1. Перейти в директорию проекта
cd ~/bs1

# 2. Остановить все контейнеры (если запущены)
docker-compose -f docker-compose.microservices.yml down

# 3. Запустить все сервисы
docker-compose -f docker-compose.microservices.yml up -d

# 4. Проверить статус
docker-compose -f docker-compose.microservices.yml ps

# 5. Проверить логи
docker-compose -f docker-compose.microservices.yml logs -f gateway
```

## Отладка

Если контейнеры все еще не запускаются:

1. **Проверьте docker-compose.yml на ошибки**:
   ```bash
   docker-compose -f docker-compose.microservices.yml config
   ```

2. **Проверьте, что все образы собраны**:
   ```bash
   docker images | grep bs1
   ```

3. **Пересоберите образы**:
   ```bash
   docker-compose -f docker-compose.microservices.yml build --no-cache gateway
   docker-compose -f docker-compose.microservices.yml up -d gateway
   ```

4. **Проверьте сеть Docker**:
   ```bash
   docker network ls
   docker network inspect bs_beauty-network
   ```

