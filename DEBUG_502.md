# Диагностика 502 ошибки

Auth-service работает нормально (проверено через `docker logs`).

Теперь нужно проверить, почему gateway не может до него достучаться.

## Выполните на сервере:

### 1. Проверьте логи gateway при попытке входа:
```bash
docker logs beauty-studio-gateway --tail=50
```

Ищите строки вида:
- `[Gateway] Проксирование ошибка для POST /api/login: ...`
- `[Gateway] Код ошибки: ...`

### 2. Проверьте доступность auth-service из gateway:
```bash
docker exec beauty-studio-gateway wget -O- http://auth-service:3001/health
```

Если не работает, попробуйте:
```bash
docker exec beauty-studio-gateway ping -c 2 auth-service
```

### 3. Проверьте сеть Docker:
```bash
docker network inspect beauty-network | grep -A 10 "beauty-studio-auth\|beauty-studio-gateway"
```

### 4. Проверьте, что оба контейнера в одной сети:
```bash
docker inspect beauty-studio-gateway | grep -A 5 Networks
docker inspect beauty-studio-auth | grep -A 5 Networks
```

### 5. Попробуйте подключиться напрямую из gateway к auth-service:
```bash
docker exec beauty-studio-gateway wget --spider -v http://auth-service:3001/health 2>&1
```

Это покажет детальную информацию о попытке подключения.

## Возможные проблемы:

1. **Контейнеры в разных сетях** - пересоздайте:
   ```bash
   docker-compose -f docker-compose.microservices.yml down
   docker-compose -f docker-compose.microservices.yml up -d
   ```

2. **DNS не разрешает auth-service** - проверьте имя сервиса в docker-compose

3. **Проблемы с портом** - убедитесь, что auth-service слушает на 0.0.0.0:3001

