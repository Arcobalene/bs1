# Исправление проблем с Content Security Policy (CSP)

## Проблемы

1. **CSP блокировал inline скрипты**: `script-src 'self'` не разрешал выполнение inline скриптов в HTML
2. **Tracking Prevention блокировал Font Awesome**: Браузер блокировал загрузку ресурсов с CDN

## Решение

### 1. Обновлена конфигурация Helmet (server.js)

**Изменения:**
- ✅ Добавлен `'unsafe-inline'` в `scriptSrc` для разрешения inline скриптов
- ✅ Добавлен `data:` в `fontSrc` для корректной загрузки шрифтов
- ✅ Отключен `crossOriginEmbedderPolicy` для совместимости с CDN
- ✅ Условная настройка `upgradeInsecureRequests` (только в production)
- ✅ Условная настройка `hsts` (отключен в development)

**Код:**
```javascript
const helmetConfig = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Разрешаем inline скрипты
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"]
    }
  },
  hsts: process.env.NODE_ENV === 'production' ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  } : false,
  crossOriginEmbedderPolicy: false
};
```

### 2. Обновлена загрузка Font Awesome (views/index.html)

**Изменения:**
- ✅ Добавлен `crossorigin="anonymous"` для CORS
- ✅ Добавлен `referrerpolicy="no-referrer"` для предотвращения отправки referrer

**Код:**
```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" crossorigin="anonymous" referrerpolicy="no-referrer">
```

## Почему использован 'unsafe-inline'?

В проекте используются inline скрипты и стили напрямую в HTML файлах. Для более безопасного решения рекомендуется:

1. **Использовать nonce** (рекомендуется для production):
   ```javascript
   // Генерация nonce для каждого запроса
   const crypto = require('crypto');
   const nonce = crypto.randomBytes(16).toString('base64');
   
   // В CSP
   scriptSrc: ["'self'", `'nonce-${nonce}'`]
   
   // В HTML
   <script nonce="${nonce}">...</script>
   ```

2. **Вынести inline скрипты в отдельные файлы** (более безопасно):
   - Перенести все `<script>` блоки в отдельные `.js` файлы
   - Подключить их через `<script src="/app.js"></script>`
   - Это также улучшит кэширование

## Дополнительные рекомендации

1. **Для production**: Рассмотрите использование nonce вместо 'unsafe-inline'
2. **Локальная загрузка Font Awesome**: Для полного контроля можно скачать Font Awesome и разместить локально
3. **Минификация**: Использовать минифицированные версии скриптов

## Проверка

После внесения изменений:
- ✅ Inline скрипты должны выполняться без ошибок CSP
- ✅ Font Awesome должен загружаться корректно
- ✅ В консоли браузера не должно быть ошибок CSP

