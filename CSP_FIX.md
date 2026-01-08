# Исправление Content Security Policy (CSP)

## Проблема
Браузер блокирует выполнение inline скриптов из-за строгой политики CSP:
```
Executing inline script violates the following Content Security Policy directive 'script-src 'self''. 
Either the 'unsafe-inline' keyword, a hash ('sha256-KT3TLyqs1XAcKdYp2JKJQJGpZ7JXS3LJP/aykGJIGNE='), 
or a nonce ('nonce-...') is required to enable inline execution.
```

## Причина
Helmet устанавливает строгую CSP политику, которая блокирует inline скрипты. В HTML файлах используются inline скрипты (например, в `views/index.html` на строке 643).

## Решение
Настроена CSP политика в helmet для разрешения inline скриптов и стилей:

```javascript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false
}));
```

## Что разрешено

### script-src
- `'self'` - скрипты с того же домена
- `'unsafe-inline'` - inline скрипты (необходимо для работы приложения)
- `'unsafe-eval'` - eval() и подобные функции (может понадобиться для некоторых библиотек)
- `https://cdnjs.cloudflare.com` - CDN для внешних библиотек

### style-src
- `'self'` - стили с того же домена
- `'unsafe-inline'` - inline стили (используются в HTML)
- `https://cdnjs.cloudflare.com` - CDN для внешних стилей

### img-src
- `'self'` - изображения с того же домена
- `data:` - data URI для встроенных изображений
- `https:` - изображения с HTTPS источников

### font-src
- `'self'` - шрифты с того же домена
- `https://cdnjs.cloudflare.com` - CDN для внешних шрифтов

### connect-src
- `'self'` - AJAX запросы к тому же домену

### Блокировано
- `frameSrc: ["'none'"]` - запрещены iframe
- `objectSrc: ["'none'"]` - запрещены object/embed

## Применение исправлений

```bash
# Пересобрать образ gateway
docker-compose -f docker-compose.microservices.yml build gateway

# Перезапустить gateway
docker-compose -f docker-compose.microservices.yml up -d gateway

# Проверить логи
docker logs beauty-studio-gateway --tail 50
```

## Альтернативные решения (для будущего)

Если нужно усилить безопасность, можно использовать:

1. **Nonce-based CSP**:
   ```javascript
   const crypto = require('crypto');
   const nonce = crypto.randomBytes(16).toString('base64');
   // Передавать nonce в HTML и использовать в CSP
   ```

2. **Hash-based CSP**:
   - Вычислить SHA256 хеш каждого inline скрипта
   - Добавить хеш в CSP директиву `script-src`

3. **Вынести inline скрипты в отдельные файлы**:
   - Переместить все inline скрипты в отдельные .js файлы
   - Загружать их через `<script src="...">`

## Безопасность

⚠️ **Важно**: `'unsafe-inline'` и `'unsafe-eval'` снижают уровень безопасности CSP. Для production рекомендуется:
- Использовать nonce или hash для inline скриптов
- Минимизировать использование inline скриптов
- Выносить скрипты в отдельные файлы

## Проверка

После применения исправлений:
1. Откройте страницу в браузере
2. Проверьте консоль браузера (F12) - не должно быть ошибок CSP
3. Убедитесь, что все скрипты выполняются корректно

