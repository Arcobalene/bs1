# Исправление проблемы с auth-service health check

## Проблема
Контейнер `beauty-studio-auth` не проходит health check и помечен как unhealthy, что блокирует запуск зависимых сервисов.

## Причины
1. **Несоответствие инструментов**: В docker-compose используется `wget`, но в Dockerfile установлен только `curl`
2. **Недостаточное время на инициализацию**: Сервис инициализирует базу данных асинхронно, что может занять время
3. **Отсутствует start_period**: Health check начинается сразу, не давая времени на запуск

## Исправления

### 1. Добавлен wget в Dockerfile
```dockerfile
RUN apk add --no-cache curl wget
```

### 2. Изменен health check в docker-compose
- Заменен `wget` на `curl` (более надежный)
- Добавлен `start_period: 40s` для инициализации БД

### 3. Проверка health check endpoint
Health check endpoint реализован правильно:
```javascript
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'auth-service', timestamp: new Date().toISOString() });
});
```

## Применение исправлений

После применения изменений:

```bash
# Пересобрать образ auth-service
docker-compose -f docker-compose.microservices.yml build auth-service

# Перезапустить сервисы
docker-compose -f docker-compose.microservices.yml up -d

# Проверить статус
docker-compose -f docker-compose.microservices.yml ps

# Проверить логи
docker logs beauty-studio-auth --tail 50
```

## Диагностика

Если проблема сохраняется:

1. **Проверить логи**:
   ```bash
   docker logs beauty-studio-auth
   ```

2. **Проверить, что БД доступна**:
   ```bash
   docker exec beauty-studio-auth curl http://localhost:3001/health
   ```

3. **Проверить инициализацию БД**:
   - В логах должно быть: `✅ База данных инициализирована`
   - Если нет - проверить подключение к БД

4. **Проверить health check вручную**:
   ```bash
   docker exec beauty-studio-auth curl -f http://localhost:3001/health
   ```

## Дополнительные улучшения (опционально)

Если проблема сохраняется, можно улучшить health check endpoint:

```javascript
app.get('/health', async (req, res) => {
  try {
    // Проверка подключения к БД
    const dbCheck = await dbUsers.pool.query('SELECT 1');
    
    res.json({ 
      status: 'ok', 
      service: 'auth-service',
      database: 'connected',
      timestamp: new Date().toISOString() 
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'error', 
      service: 'auth-service',
      database: 'disconnected',
      error: error.message 
    });
  }
});
```

Это позволит health check проверять не только HTTP доступность, но и готовность БД.

