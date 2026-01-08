# Исправление ошибки "Cannot read properties of undefined (reading 'userId')"

## Проблема
Gateway возвращал ошибку 500 при запросе к корневому пути `/`:
```
{"success":false,"error":{"code":"INTERNAL_ERROR","message":"Cannot read properties of undefined (reading 'userId')"}}
```

## Причина
Доступ к `req.session.userId` без проверки, что `req.session` существует. Это происходило в нескольких местах:
1. Строка 225: `!req.session.userId` без проверки `req.session`
2. Строка 265: `req.session.userId = ...` без проверки `req.session`
3. Строка 529: `req.session.userId = ...` без проверки `req.session`

## Исправления

### 1. Добавлена проверка на строке 225
**Было:**
```javascript
if (req.cookies && req.cookies['beauty.studio.sid'] && !req.session.userId && req.path.startsWith('/api/')) {
```

**Стало:**
```javascript
if (req.cookies && req.cookies['beauty.studio.sid'] && req.session && !req.session.userId && req.path.startsWith('/api/')) {
```

### 2. Добавлена проверка на строке 265
**Было:**
```javascript
if (result.success && result.user && result.user.id) {
  req.session.userId = result.user.id;
  ...
}
```

**Стало:**
```javascript
if (result.success && result.user && result.user.id && req.session) {
  req.session.userId = result.user.id;
  ...
}
```

### 3. Добавлена проверка на строке 529
**Было:**
```javascript
req.session.userId = result.userId;
req.session.originalUserId = result.userId;
req.session.touch();
```

**Стало:**
```javascript
if (req.session) {
  req.session.userId = result.userId;
  req.session.originalUserId = result.userId;
  req.session.touch();
}
```

### 4. Улучшена безопасность доступа в других местах
- Строка 91: Используется `(req.session && req.session.userId) ? req.session.userId : null`
- Строка 197: Используется `(req.session && req.session.userId) ? req.session.userId : null`
- Строка 208: Уже есть проверка `if (req.session && req.session.userId)`
- Строка 342: Уже есть проверка `if (req.session && req.session.userId)`

## Применение исправлений

```bash
# Пересобрать образ gateway
docker-compose -f docker-compose.microservices.yml build gateway

# Перезапустить gateway
docker-compose -f docker-compose.microservices.yml up -d gateway

# Проверить логи
docker logs beauty-studio-gateway --tail 50

# Проверить, что ошибка исправлена
curl http://localhost:3000/
```

## Диагностика

Если проблема сохраняется:

1. **Проверить логи gateway**:
   ```bash
   docker logs beauty-studio-gateway --tail 100
   ```

2. **Проверить, что сессия инициализирована**:
   - В логах должно быть: `Session store initialized` или `Using MemoryStore`
   - Проверить, что Redis доступен (если используется)

3. **Проверить health check**:
   ```bash
   curl http://localhost:3000/health
   ```

4. **Проверить доступность views**:
   ```bash
   docker exec beauty-studio-gateway ls -la /app/views/
   ```

## Дополнительные улучшения

Для предотвращения подобных проблем в будущем:
1. Всегда проверять `req.session` перед доступом к его свойствам
2. Использовать optional chaining (`req.session?.userId`) где возможно
3. Добавить middleware для инициализации сессии, если она не существует

## Результат

После применения исправлений:
- ✅ Gateway корректно обрабатывает запросы к `/`
- ✅ Нет ошибок при отсутствии сессии
- ✅ Безопасный доступ к свойствам сессии

