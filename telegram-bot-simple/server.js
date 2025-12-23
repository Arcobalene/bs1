require('dotenv').config();
const express = require('express');
const { sendNotificationToOwner, getOwnerByPhone } = require('./bot');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware для парсинга JSON
app.use(express.json());

// Логирование запросов
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============================================================================
// ВЕБХУКИ ОТ САЙТА clientix.uz
// ============================================================================

/**
 * POST /webhook/booking
 * Новое бронирование
 * 
 * Ожидаемый формат запроса:
 * {
 *   "salon_phone": "998903175511",
 *   "booking_data": {
 *     "client_name": "Иван",
 *     "service": "Стрижка",
 *     "date": "15 января",
 *     "time": "14:00",
 *     "client_phone": "+998901234567",
 *     "master": "Мария",
 *     "comment": "Дополнительные пожелания"
 *   }
 * }
 */
app.post('/webhook/booking', async (req, res) => {
  try {
    const { salon_phone, booking_data } = req.body;

    // Валидация
    if (!salon_phone) {
      return res.status(400).json({
        success: false,
        error: 'salon_phone обязателен'
      });
    }

    if (!booking_data) {
      return res.status(400).json({
        success: false,
        error: 'booking_data обязателен'
      });
    }

    console.log(`📥 Получено уведомление о новой записи для салона: ${salon_phone}`);

    // Нормализуем номер телефона
    const normalizedPhone = salon_phone.replace(/\D/g, '')
      .replace(/^8/, '7')
      .replace(/^\+/, '');

    // Находим владельца по номеру телефона
    getOwnerByPhone(normalizedPhone, (err, owner) => {
      if (err) {
        console.error('Ошибка поиска владельца:', err);
        return res.status(500).json({
          success: false,
          error: 'Ошибка поиска владельца'
        });
      }

      if (!owner) {
        console.log(`⚠️  Владелец с номером ${normalizedPhone} не найден в базе бота`);
        return res.status(404).json({
          success: false,
          error: 'Владелец не найден в базе бота'
        });
      }

      // Отправляем уведомление
      sendNotificationToOwner(owner.id, 'booking', booking_data)
        .then(() => {
          console.log(`✅ Уведомление о записи отправлено владельцу ${owner.id}`);
          res.json({
            success: true,
            message: 'Уведомление отправлено',
            owner_id: owner.id
          });
        })
        .catch((error) => {
          console.error('Ошибка отправки уведомления:', error);
          res.status(500).json({
            success: false,
            error: 'Ошибка отправки уведомления'
          });
        });
    });

  } catch (error) {
    console.error('Ошибка обработки вебхука booking:', error);
    res.status(500).json({
      success: false,
      error: 'Внутренняя ошибка сервера'
    });
  }
});

/**
 * POST /webhook/cancel
 * Отмена бронирования
 * 
 * Ожидаемый формат запроса:
 * {
 *   "salon_phone": "998903175511",
 *   "booking_data": {
 *     "client_name": "Иван",
 *     "service": "Стрижка",
 *     "date": "15 января",
 *     "time": "14:00",
 *     "reason": "Отменено клиентом"
 *   }
 * }
 */
app.post('/webhook/cancel', async (req, res) => {
  try {
    const { salon_phone, booking_data } = req.body;

    // Валидация
    if (!salon_phone) {
      return res.status(400).json({
        success: false,
        error: 'salon_phone обязателен'
      });
    }

    if (!booking_data) {
      return res.status(400).json({
        success: false,
        error: 'booking_data обязателен'
      });
    }

    console.log(`📥 Получено уведомление об отмене записи для салона: ${salon_phone}`);

    // Нормализуем номер телефона
    const normalizedPhone = salon_phone.replace(/\D/g, '')
      .replace(/^8/, '7')
      .replace(/^\+/, '');

    // Находим владельца по номеру телефона
    getOwnerByPhone(normalizedPhone, (err, owner) => {
      if (err) {
        console.error('Ошибка поиска владельца:', err);
        return res.status(500).json({
          success: false,
          error: 'Ошибка поиска владельца'
        });
      }

      if (!owner) {
        console.log(`⚠️  Владелец с номером ${normalizedPhone} не найден в базе бота`);
        return res.status(404).json({
          success: false,
          error: 'Владелец не найден в базе бота'
        });
      }

      // Отправляем уведомление
      sendNotificationToOwner(owner.id, 'cancel', booking_data)
        .then(() => {
          console.log(`✅ Уведомление об отмене отправлено владельцу ${owner.id}`);
          res.json({
            success: true,
            message: 'Уведомление об отмене отправлено',
            owner_id: owner.id
          });
        })
        .catch((error) => {
          console.error('Ошибка отправки уведомления:', error);
          res.status(500).json({
            success: false,
            error: 'Ошибка отправки уведомления'
          });
        });
    });

  } catch (error) {
    console.error('Ошибка обработки вебхука cancel:', error);
    res.status(500).json({
      success: false,
      error: 'Внутренняя ошибка сервера'
    });
  }
});

/**
 * POST /webhook/reminder
 * Напоминание о записи
 * 
 * Ожидаемый формат запроса:
 * {
 *   "salon_phone": "998903175511",
 *   "booking_data": {
 *     "client_name": "Иван",
 *     "service": "Стрижка",
 *     "date": "15 января",
 *     "time": "14:00"
 *   }
 * }
 */
app.post('/webhook/reminder', async (req, res) => {
  try {
    const { salon_phone, booking_data } = req.body;

    // Валидация
    if (!salon_phone) {
      return res.status(400).json({
        success: false,
        error: 'salon_phone обязателен'
      });
    }

    if (!booking_data) {
      return res.status(400).json({
        success: false,
        error: 'booking_data обязателен'
      });
    }

    console.log(`📥 Получено напоминание о записи для салона: ${salon_phone}`);

    // Нормализуем номер телефона
    const normalizedPhone = salon_phone.replace(/\D/g, '')
      .replace(/^8/, '7')
      .replace(/^\+/, '');

    // Находим владельца по номеру телефона
    getOwnerByPhone(normalizedPhone, (err, owner) => {
      if (err) {
        console.error('Ошибка поиска владельца:', err);
        return res.status(500).json({
          success: false,
          error: 'Ошибка поиска владельца'
        });
      }

      if (!owner) {
        console.log(`⚠️  Владелец с номером ${normalizedPhone} не найден в базе бота`);
        return res.status(404).json({
          success: false,
          error: 'Владелец не найден в базе бота'
        });
      }

      // Отправляем уведомление
      sendNotificationToOwner(owner.id, 'reminder', booking_data)
        .then(() => {
          console.log(`✅ Напоминание отправлено владельцу ${owner.id}`);
          res.json({
            success: true,
            message: 'Напоминание отправлено',
            owner_id: owner.id
          });
        })
        .catch((error) => {
          console.error('Ошибка отправки напоминания:', error);
          res.status(500).json({
            success: false,
            error: 'Ошибка отправки напоминания'
          });
        });
    });

  } catch (error) {
    console.error('Ошибка обработки вебхука reminder:', error);
    res.status(500).json({
      success: false,
      error: 'Внутренняя ошибка сервера'
    });
  }
});

/**
 * POST /webhook/test
 * Тестовый вебхук
 */
app.post('/webhook/test', async (req, res) => {
  try {
    const { salon_phone } = req.body;

    if (!salon_phone) {
      return res.status(400).json({
        success: false,
        error: 'salon_phone обязателен'
      });
    }

    console.log(`📥 Тестовый запрос для салона: ${salon_phone}`);

    // Нормализуем номер телефона
    const normalizedPhone = salon_phone.replace(/\D/g, '')
      .replace(/^8/, '7')
      .replace(/^\+/, '');

    // Находим владельца по номеру телефона
    getOwnerByPhone(normalizedPhone, (err, owner) => {
      if (err) {
        console.error('Ошибка поиска владельца:', err);
        return res.status(500).json({
          success: false,
          error: 'Ошибка поиска владельца'
        });
      }

      if (!owner) {
        return res.status(404).json({
          success: false,
          error: 'Владелец не найден в базе бота'
        });
      }

      // Отправляем тестовое уведомление
      sendNotificationToOwner(owner.id, 'test', {})
        .then(() => {
          res.json({
            success: true,
            message: 'Тестовое уведомление отправлено',
            owner_id: owner.id
          });
        })
        .catch((error) => {
          console.error('Ошибка отправки тестового уведомления:', error);
          res.status(500).json({
            success: false,
            error: 'Ошибка отправки уведомления'
          });
        });
    });

  } catch (error) {
    console.error('Ошибка обработки тестового вебхука:', error);
    res.status(500).json({
      success: false,
      error: 'Внутренняя ошибка сервера'
    });
  }
});

/**
 * GET /health
 * Проверка работоспособности сервера
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'telegram-salon-bot-webhook'
  });
});

/**
 * GET /
 * Информация об API
 */
app.get('/', (req, res) => {
  res.json({
    service: 'Telegram Salon Bot Webhook Server',
    version: '1.0.0',
    endpoints: {
      'POST /webhook/booking': 'Новая запись',
      'POST /webhook/cancel': 'Отмена записи',
      'POST /webhook/reminder': 'Напоминание о записи',
      'POST /webhook/test': 'Тестовый запрос',
      'GET /health': 'Проверка работоспособности'
    },
    documentation: 'См. README.md'
  });
});

// Обработка 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint не найден'
  });
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('Ошибка сервера:', err);
  res.status(500).json({
    success: false,
    error: 'Внутренняя ошибка сервера'
  });
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`✅ Веб-сервер запущен на порту ${PORT}`);
  console.log(`📡 Вебхуки принимаются на:`);
  console.log(`   POST http://localhost:${PORT}/webhook/booking`);
  console.log(`   POST http://localhost:${PORT}/webhook/cancel`);
  console.log(`   POST http://localhost:${PORT}/webhook/reminder`);
  console.log(`   POST http://localhost:${PORT}/webhook/test`);
  console.log(`   GET  http://localhost:${PORT}/health`);
});

