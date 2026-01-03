# Диагностика ошибки 502 Bad Gateway

## Проблема
Gateway не может связаться с auth-service, возвращается ошибка 502.

## Что было улучшено:

### 1. Gateway (gateway/server.js)
- ✅ Добавлено подробное логирование ошибок проксирования
- ✅ Логирование запросов в development режиме

### 2. Docker Compose
- ✅ Добавлена переменная `BEHIND_HTTPS_PROXY=true` для auth-service и gateway

## Диагностика на сервере:

### 1. Проверьте статус всех сервисов:
```bash
docker-compose -f docker-compose.microservices.yml ps
```

Все сервисы должны быть в статусе "Up" или "Up (healthy)".

### 2. Проверьте логи auth-service:
```bash
docker-compose -f docker-compose.microservices.yml logs auth-service --tail=50
```

Ищите:
- `✅ База данных инициализирована`
- `🔐 Auth Service запущен на порту 3001`
- Ошибки подключения к БД
- Ошибки инициализации

### 3. Проверьте логи gateway:
```bash
docker-compose -f docker-compose.microservices.yml logs gateway --tail=50
```

Ищите:
- `[Gateway] Проксирование ошибка` - это покажет, почему не может связаться с auth-service
- Ошибки подключения

### 4. Проверьте доступность auth-service из gateway:
```bash
docker exec beauty-studio-gateway wget -O- http://auth-service:3001/health
```

Должен вернуть: `{"status":"ok","service":"auth-service",...}`

### 5. Проверьте сеть Docker:
```bash
docker network inspect beauty-network
```

Убедитесь, что `beauty-studio-auth` и `beauty-studio-gateway` в списке контейнеров.

### 6. Проверьте, что auth-service слушает на правильном порту:
```bash
docker exec beauty-studio-auth netstat -tlnp | grep 3001
```

Или:
```bash
docker exec beauty-studio-auth wget -O- http://localhost:3001/health
```

## Возможные решения:

### Если auth-service не запущен:
```bash
docker-compose -f docker-compose.microservices.yml up -d auth-service
```

### Если auth-service падает:
1. Проверьте логи на ошибки
2. Убедитесь, что БД запущена: `docker ps | grep db`
3. Проверьте переменные окружения

### Если проблема с сетью:
```bash
# Пересоздайте сеть
docker-compose -f docker-compose.microservices.yml down
docker-compose -f docker-compose.microservices.yml up -d
```

### Если auth-service не может подключиться к БД:
1. Проверьте, что БД запущена и здорова
2. Проверьте логи БД: `docker logs beauty-studio-db`
3. Проверьте переменные окружения для подключения к БД

## После исправлений:

Перезапустите сервисы:
```bash
docker-compose -f docker-compose.microservices.yml restart auth-service gateway
```

Или пересоберите:
```bash
docker-compose -f docker-compose.microservices.yml up -d --build auth-service gateway
```

