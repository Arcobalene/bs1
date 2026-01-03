# Проверка ошибки 502 Bad Gateway на /api/login

## Быстрая диагностика

Выполните эти команды на сервере для диагностики:

### 1. Проверьте статус всех сервисов:
```bash
docker-compose -f docker-compose.microservices.yml ps
```

Убедитесь, что `beauty-studio-auth` в статусе "Up" или "Up (healthy)".

### 2. Проверьте логи auth-service:
```bash
docker-compose -f docker-compose.microservices.yml logs auth-service --tail=100
```

Ищите:
- `✅ База данных инициализирована`
- `🔐 Auth Service запущен на порту 3001`
- Ошибки подключения к БД
- Ошибки инициализации

### 3. Проверьте логи gateway (важно!):
```bash
docker-compose -f docker-compose.microservices.yml logs gateway --tail=50 | grep -i "error\|502\|проксирование"
```

Ищите строки вида:
- `[Gateway] Проксирование ошибка для POST /api/login: ...`
- Это покажет точную причину ошибки

### 4. Проверьте доступность auth-service из gateway:
```bash
docker exec beauty-studio-gateway wget -O- http://auth-service:3001/health
```

Должен вернуть: `{"status":"ok","service":"auth-service",...}`

Если не работает, проверьте сеть Docker.

### 5. Проверьте, что auth-service слушает на порту 3001:
```bash
docker exec beauty-studio-auth wget -O- http://localhost:3001/health
```

Должен вернуть JSON с status: "ok".

### 6. Проверьте сеть Docker:
```bash
docker network inspect beauty-network | grep -A 5 "beauty-studio-auth\|beauty-studio-gateway"
```

## Возможные причины и решения:

### Если auth-service не запущен:
```bash
docker-compose -f docker-compose.microservices.yml up -d auth-service
```

### Если auth-service падает при старте:
1. Проверьте логи: `docker logs beauty-studio-auth`
2. Убедитесь, что БД запущена: `docker ps | grep db`
3. Проверьте переменные окружения для подключения к БД

### Если auth-service не может подключиться к БД:
1. Проверьте, что БД запущена: `docker ps | grep beauty-studio-db`
2. Проверьте логи БД: `docker logs beauty-studio-db`
3. Проверьте переменные окружения в docker-compose.microservices.yml

### Если проблема с сетью Docker:
```bash
# Пересоздайте сеть и контейнеры
docker-compose -f docker-compose.microservices.yml down
docker-compose -f docker-compose.microservices.yml up -d
```

### Если все сервисы запущены, но ошибка 502 остается:
1. Перезапустите gateway и auth-service:
```bash
docker-compose -f docker-compose.microservices.yml restart auth-service gateway
```

2. Или пересоберите:
```bash
docker-compose -f docker-compose.microservices.yml up -d --build auth-service gateway
```

## После проверки

Пришлите вывод команд:
1. `docker-compose -f docker-compose.microservices.yml ps`
2. `docker-compose -f docker-compose.microservices.yml logs gateway --tail=30`
3. `docker-compose -f docker-compose.microservices.yml logs auth-service --tail=30`

Это поможет точно определить проблему.

