#!/bin/bash

# Скрипт для установки Telegram webhook
# Использование: ./setup-webhook.sh

BOT_TOKEN="8550847275:AAGh903FdyipqOGzO12Su0anbTRC3jdBZDE"
WEBHOOK_URL="http://155.212.184.10/api/telegram/webhook"

echo "🔗 Установка webhook для Telegram бота..."
echo "   URL: $WEBHOOK_URL"
echo ""

# Устанавливаем webhook
curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"${WEBHOOK_URL}\"}"

echo ""
echo ""
echo "✅ Webhook установлен!"
echo ""
echo "Проверка статуса webhook:"
curl "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"

echo ""
echo ""
echo "Теперь отправьте /start connect в боте для проверки!"

