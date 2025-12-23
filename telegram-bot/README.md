# Telegram Bot Service для Beauty Studio

Микросервис Telegram-бота для отправки уведомлений о записях в салоны красоты.

## Структура

```
telegram-bot/
├── Dockerfile          # Конфигурация Docker образа
├── .dockerignore       # Игнорируемые файлы для Docker
├── package.json        # Зависимости Node.js
├── bot.js             # Основной файл (бот + веб-сервер)
└── README.md          # Эта документация
```

## Функции

✅ Регистрация владельцев по номеру телефона  
✅ Отправка уведомлений о новых записях, отменах, напоминаниях  
✅ Работа в группах Telegram  
✅ Healthcheck для Docker  
✅ Интеграция с основным приложением через REST API  

## Переменные окружения

```env
# Обязательные
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Опциональные
TELEGRAM_BOT_PORT=3001
SQLITE_PATH=/app/data/bot_database.sqlite
MAIN_APP_URL=http://beauty-studio:3000
NODE_ENV=production
```

## API Эндпоинты

### Для внутреннего использования (основное приложение)

**POST /api/notify/booking** - Уведомление о новой записи

```json
{
  "salon_phone": "998903175511",
  "salon_id": 1,
  "booking_data": {
    "client_name": "Иван",
    "name": "Иван",
    "service": "Стрижка",
    "date": "2024-01-15",
    "time": "14:00",
    "phone": "+998901234567",
    "master": "Мария",
    "comment": "Дополнительные пожелания"
  }
}
```

**POST /api/notify/cancellation** - Уведомление об отмене

```json
{
  "salon_phone": "998903175511",
  "booking_data": {
    "client_name": "Иван",
    "service": "Стрижка",
    "date": "2024-01-15",
    "time": "14:00",
    "reason": "Отменено клиентом"
  }
}
```

**POST /api/notify/reminder** - Напоминание о записи

```json
{
  "salon_phone": "998903175511",
  "booking_data": {
    "client_name": "Иван",
    "service": "Стрижка",
    "date": "2024-01-15",
    "time": "14:00"
  }
}
```

**GET /api/owners** - Список зарегистрированных владельцев

**GET /health** - Healthcheck для Docker

### Старые эндпоинты (для обратной совместимости)

- `POST /webhook/booking` → использует ту же логику что `/api/notify/booking`
- `POST /webhook/cancel` → использует ту же логику что `/api/notify/cancellation`
- `POST /webhook/reminder` → использует ту же логику что `/api/notify/reminder`

## Команды бота

**В личных сообщениях:**
- `/start` - Регистрация по номеру телефона
- `/myinfo` - Информация о профиле
- `/chats` - Список подключенных чатов
- `/test` - Тестовое уведомление
- `/help` - Справка

**В группах:**
- `/setup_group` - Подключить группу к уведомлениям

## Интеграция с основным приложением

### 1. Добавьте API эндпоинт в основное приложение

В `server.js` добавьте эндпоинт для получения владельца по номеру телефона:

```javascript
// API: Получить владельца по номеру телефона (для Telegram бота)
app.get('/api/owners/by-phone/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const normalizedPhone = phone.replace(/\D/g, '').replace(/^8/, '7').replace(/^\+/, '');
    
    const user = await dbUsers.getByPhone(normalizedPhone);
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'Владелец не найден' 
      });
    }
    
    res.json({
      success: true,
      owner: {
        id: user.id,
        username: user.username,
        name: user.username,
        salon_name: user.salon_name,
        phone: user.salon_phone
      }
    });
  } catch (error) {
    console.error('Ошибка получения владельца по телефону:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});
```

### 2. Отправка уведомлений из основного приложения

В коде создания/обновления записи (например, в `server.js`):

```javascript
// После успешного создания записи
const axios = require('axios');

try {
  await axios.post('http://telegram-bot:3001/api/notify/booking', {
    salon_id: userId,
    salon_phone: user.salon_phone,
    booking_data: {
      client_name: name,
      service: service,
      date: date,
      time: time,
      phone: phone,
      master: master,
      comment: comment
    }
  }, {
    timeout: 3000
  });
} catch (error) {
  // Логируем, но не прерываем создание записи
  console.error('Ошибка отправки уведомления в Telegram:', error.message);
}
```

## Запуск через Docker Compose

```bash
# Из корня проекта
docker-compose build telegram-bot
docker-compose up -d telegram-bot

# Просмотр логов
docker-compose logs -f telegram-bot

# Проверка healthcheck
curl http://localhost:3001/health
```

## База данных

Бот использует SQLite базу данных, которая сохраняется в Docker volume `telegram-bot-data`.

Таблицы:
- `owners` - зарегистрированные владельцы салонов
- `group_chats` - подключенные групповые чаты
- `notifications` - логи уведомлений

## Логирование

Все логи выводятся в stdout/stderr в формате JSON для удобного парсинга в Docker:

```json
{"level":"INFO","msg":"Уведомление отправлено","type":"booking","owner_id":1}
{"level":"ERROR","msg":"Ошибка отправки","error":"Network error"}
```

## Troubleshooting

**Бот не запускается:**
- Проверьте `TELEGRAM_BOT_TOKEN` в `.env`
- Проверьте логи: `docker-compose logs telegram-bot`

**Уведомления не приходят:**
- Проверьте, что владелец зарегистрирован через `/start`
- Проверьте логи бота на наличие ошибок
- Убедитесь, что основной сервис доступен: `curl http://beauty-studio:3000/api/user`

**Healthcheck падает:**
- Проверьте, что бот запущен: `docker-compose ps telegram-bot`
- Проверьте логи: `docker-compose logs telegram-bot`

