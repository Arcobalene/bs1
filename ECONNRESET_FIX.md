# Исправление ошибки ECONNRESET

## Проблема
Ошибка `ECONNRESET: socket hang up` означает, что auth-service закрывает соединение до того, как gateway получает ответ.

## Что было исправлено:

### 1. Gateway (gateway/server.js)
- ✅ Увеличил timeout с 30 до 60 секунд
- ✅ Добавил `xfwd: true` для передачи оригинальных заголовков
- ✅ Добавил `secure: false` для отключения проверки SSL во внутренних соединениях

### 2. Auth Service (services/auth-service/server.js)
- ✅ Добавил явное сохранение сессии через `req.session.save()` перед отправкой ответа
- ✅ Добавил обработку ошибок при сохранении сессии

## Возможные причины ECONNRESET:

1. **Сессия не сохраняется** - теперь используется явное сохранение
2. **Таймауты** - увеличены до 60 секунд
3. **Проблемы с MemoryStore** - в продакшене лучше использовать Redis или другую БД для сессий

## После исправлений:

Перезапустите auth-service и gateway:
```bash
docker-compose -f docker-compose.microservices.yml restart auth-service gateway
```

Или пересоберите:
```bash
docker-compose -f docker-compose.microservices.yml up -d --build auth-service gateway
```

## Рекомендации для продакшена:

В продакшене рекомендуется использовать Redis или PostgreSQL для хранения сессий вместо MemoryStore:

```javascript
const RedisStore = require('connect-redis')(session);
app.use(session({
  store: new RedisStore({ ... }),
  // ... остальные настройки
}));
```

Это решит проблему с памятью и масштабируемостью.

