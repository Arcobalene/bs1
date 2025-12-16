# Инструкция по установке Telegram Webhook

## Текущая ситуация

Из логов видно, что:
- ✅ Бот запущен и работает
- ✅ Токен бота настроен: `8550847275:AAGh903FdyipqOGzO12Su0anbTRC3jdBZDE`
- ❌ Webhook не установлен (TELEGRAM_WEBHOOK_URL не установлен)

## Решение 1: Установка webhook вручную (быстро)

Выполните на сервере:

```bash
curl -X POST "https://api.telegram.org/bot8550847275:AAGh903FdyipqOGzO12Su0anbTRC3jdBZDE/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "http://155.212.184.10/api/telegram/webhook"}'
```

Или используйте скрипт:

```bash
chmod +x setup-webhook.sh
./setup-webhook.sh
```

## Решение 2: Установка через переменную окружения (рекомендуется)

### Шаг 1: Добавьте переменную в .env файл

Создайте или отредактируйте файл `.env` в корне проекта:

```bash
TELEGRAM_WEBHOOK_URL=http://155.212.184.10/api/telegram/webhook
```

### Шаг 2: Перезапустите микросервис

```bash
docker-compose -f docker-compose.postgres.yml restart telegram-bot
```

### Шаг 3: Проверьте логи

```bash
docker logs beauty-studio-telegram-bot --tail 20
```

Должно появиться:
```
✅ Webhook успешно установлен: http://155.212.184.10/api/telegram/webhook
```

## Проверка webhook

После установки проверьте статус:

```bash
curl "https://api.telegram.org/bot8550847275:AAGh903FdyipqOGzO12Su0anbTRC3jdBZDE/getWebhookInfo"
```

Должно вернуть:
```json
{
  "ok": true,
  "result": {
    "url": "http://155.212.184.10/api/telegram/webhook",
    "has_custom_certificate": false,
    "pending_update_count": 0
  }
}
```

## Важно: HTTPS vs HTTP

⚠️ **Telegram требует HTTPS для webhook в production!**

Если ваш сервер использует HTTP (как в примере `http://155.212.184.10`), то:
1. Либо настройте HTTPS (рекомендуется)
2. Либо используйте для тестирования (не рекомендуется для production)

Для production обязательно используйте HTTPS:
```bash
TELEGRAM_WEBHOOK_URL=https://155.212.184.10/api/telegram/webhook
```

## После установки webhook

1. Отправьте `/start connect` в боте
2. Проверьте логи:
   ```bash
   docker logs beauty-studio-telegram-bot --tail 50 -f
   ```
3. Должны увидеть:
   ```
   📨 Получен webhook запрос от Telegram
   📝 Обработка команды /start: telegramId=...
   ✅ Запрос контакта отправлен
   ```

## Удаление webhook (если нужно)

```bash
curl -X POST "https://api.telegram.org/bot8550847275:AAGh903FdyipqOGzO12Su0anbTRC3jdBZDE/deleteWebhook"
```

