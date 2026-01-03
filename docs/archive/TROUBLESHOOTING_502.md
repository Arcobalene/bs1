# Решение проблемы 502 Bad Gateway

## Проблема
Ошибка `502 Bad Gateway` при обращении к `/api/login` означает, что gateway не может связаться с auth-service.

## Возможные причины:

1. **Auth-service не запущен**
2. **Auth-service не может подключиться к БД**
3. **Проблемы с сетью Docker**
4. **Auth-service падает при старте**

## Диагностика:

### 1. Проверьте статус сервисов:
```bash
docker-compose -f docker-compose.microservices.yml ps
```

### 2. Проверьте логи auth-service:
```bash
docker-compose -f docker-compose.microservices.yml logs auth-service
```

Проверьте, есть ли ошибки:
- Ошибки подключения к БД
- Ошибки инициализации
- Ошибки запуска

### 3. Проверьте логи gateway:
```bash
docker-compose -f docker-compose.microservices.yml logs gateway
```

### 4. Проверьте, доступен ли auth-service из gateway:
```bash
docker exec beauty-studio-gateway wget -O- http://auth-service:3001/health
```

Должен вернуть JSON с `{"status":"ok",...}`

### 5. Проверьте статус БД:
```bash
docker-compose -f docker-compose.microservices.yml ps db
```

### 6. Проверьте, что auth-service запустился:
```bash
docker logs beauty-studio-auth | tail -50
```

Должны увидеть:
```
✅ База данных инициализирована
🔐 Auth Service запущен на порту 3001
```

## Решения:

### Если auth-service не запущен:
```bash
docker-compose -f docker-compose.microservices.yml up -d auth-service
```

### Если auth-service падает при старте:
1. Проверьте логи для выявления ошибки
2. Убедитесь, что БД запущена и доступна
3. Проверьте переменные окружения

### Если проблема с сетью:
```bash
# Проверьте сеть
docker network inspect beauty-network

# Пересоздайте сеть (если нужно)
docker-compose -f docker-compose.microservices.yml down
docker-compose -f docker-compose.microservices.yml up -d
```

### Если проблема с БД:
```bash
# Проверьте статус БД
docker-compose -f docker-compose.microservices.yml ps db

# Проверьте логи БД
docker-compose -f docker-compose.microservices.yml logs db

# Перезапустите БД (если нужно)
docker-compose -f docker-compose.microservices.yml restart db
```

## Быстрое решение:

Попробуйте перезапустить все сервисы:
```bash
docker-compose -f docker-compose.microservices.yml restart auth-service gateway
```

Или пересоздать:
```bash
docker-compose -f docker-compose.microservices.yml up -d --build auth-service gateway
```

