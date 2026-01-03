# АНАЛИЗ ОШИБКИ 502 Bad Gateway на /api/login

## НАЙДЕННЫЕ ФАЙЛЫ С ЛОГИНОМ

### 1. КЛИЕНТСКАЯ ЧАСТЬ (Frontend)

**views/login.html (строки 87-108):**
```javascript
const response = await fetch('/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data)
});

const result = await response.json(); // ❌ ПРОБЛЕМА: нет проверки response.ok!
```

**Проблема:** Запрос выполняется, но НЕТ проверки `response.ok` перед парсингом JSON. Если сервер возвращает 502, код пытается парсить JSON из ошибки, что может вызывать проблемы.

### 2. GATEWAY (gateway/server.js:167)
```javascript
app.use('/api/login', createProxyMiddleware({ target: services.auth, ...proxyOptions }));
```
- Проксирует на: `http://auth-service:3001`
- Обработчик ошибок: есть (onError возвращает 502)

### 3. AUTH-SERVICE (services/auth-service/server.js:140)
```javascript
app.post('/api/login', loginLimiter, async (req, res) => {
  // ... обработка логина
});
```
- Endpoint настроен правильно

## ВОЗМОЖНЫЕ ПРИЧИНЫ 502:

1. ✅ **Auth-service не запущен** - но по логам он запущен
2. ✅ **Проблемы с сетью Docker** - нужно проверить
3. ✅ **Auth-service падает при обработке запроса** - нужно проверить логи
4. ✅ **Клиентский код не обрабатывает ошибки правильно** - найдено!

## ПРОБЛЕМА В КЛИЕНТСКОМ КОДЕ:

В `views/login.html` отсутствует проверка `response.ok` перед парсингом JSON. Если сервер возвращает 502, код пытается парсить JSON из ошибки, что может вызвать дополнительные проблемы.

## ИСПРАВЛЕНИЕ:

Добавить проверку `response.ok` и правильную обработку ошибок.

