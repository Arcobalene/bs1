# ИСПРАВЛЕНИЕ ОШИБКИ 502 Bad Gateway на /api/login

## НАЙДЕННАЯ ПРОБЛЕМА

### Проблема в клиентском коде (views/login.html)

**Строки 87-93:**
- Отсутствует проверка `response.ok` перед парсингом JSON
- Отсутствует `credentials: 'include'` для передачи cookies (сессий)
- Нет правильной обработки HTTP ошибок (502, 504, etc.)

## ВНЕСЁННЫЕ ИСПРАВЛЕНИЯ

### 1. ✅ Исправлен клиентский код (views/login.html)

**БЫЛО:**
```javascript
const response = await fetch('/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data)
});

const result = await response.json(); // ❌ Нет проверки response.ok!
```

**СТАЛО:**
```javascript
const response = await fetch('/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include', // ✅ Для передачи cookies (сессий)
  body: JSON.stringify(data)
});

// ✅ Проверяем статус ответа перед парсингом JSON
if (!response.ok) {
  // Правильная обработка ошибок 502, 504, etc.
  let errorMessage = 'Ошибка сервера';
  try {
    const errorData = await response.json();
    errorMessage = errorData.message || errorMessage;
  } catch (e) {
    if (response.status === 502) {
      errorMessage = 'Сервис временно недоступен. Попробуйте позже.';
    } else if (response.status === 504) {
      errorMessage = 'Превышено время ожидания. Попробуйте позже.';
    } else {
      errorMessage = `Ошибка ${response.status}: ${response.statusText}`;
    }
  }
  errorAlert.textContent = errorMessage;
  errorAlert.style.display = 'block';
  return;
}

const result = await response.json();
```

## АНАЛИЗ БАКЕНДА

### Gateway (gateway/server.js)
- ✅ Проксирование настроено правильно
- ✅ Обработчик ошибок есть (onError)
- ✅ Настройки timeout правильные (60 секунд)
- ✅ Копирование Set-Cookie заголовков настроено

### Auth-service (services/auth-service/server.js)
- ✅ Endpoint /api/login настроен правильно
- ✅ Middleware для парсинга body есть
- ✅ Session middleware настроен
- ✅ Trust proxy настроен

## ВОЗМОЖНЫЕ ДОПОЛНИТЕЛЬНЫЕ ПРОБЛЕМЫ

Если ошибка 502 всё ещё возникает после исправления клиентского кода, проверьте:

1. **Auth-service запущен:**
   ```bash
   docker-compose -f docker-compose.microservices.yml ps auth-service
   ```

2. **Логи auth-service:**
   ```bash
   docker logs beauty-studio-auth --tail=50
   ```

3. **Логи gateway:**
   ```bash
   docker logs beauty-studio-gateway --tail=50 | grep -i "error\|502\|login"
   ```

4. **Доступность auth-service из gateway:**
   ```bash
   docker exec beauty-studio-gateway wget -O- http://auth-service:3001/health
   ```

5. **Сеть Docker:**
   ```bash
   docker network inspect beauty-network
   ```

## СТАТУС ИСПРАВЛЕНИЙ

- ✅ Клиентский код исправлен (правильная обработка ошибок)
- ✅ Добавлен `credentials: 'include'` для передачи cookies
- ⚠️ Если проблема сохраняется, нужно проверить логи серверов

