const express = require('express');
const https = require('https');
const rateLimit = require('express-rate-limit');

// Импортируем общие модули
const { users: dbUsers, initDatabase } = require('../../shared/database');
const { normalizeToE164 } = require('../../shared/utils');
const { setupStandardMiddleware, requireAuth, errorHandler } = require('../../shared/middleware');
const { createLogger } = require('../../shared/logger');
const { validatePositiveInt } = require('../../shared/validators');

const app = express();
const PORT = process.env.PORT || 3007;
const logger = createLogger('telegram-service');
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL || '';
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

// Rate limiting для публичных эндпоинтов
const phoneLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 30, // 30 запросов на IP
  message: { success: false, message: 'Слишком много запросов, попробуйте позже' }
});

// Rate limiting для webhook (защита от DDoS)
const webhookLimiter = rateLimit({
  windowMs: 1000, // 1 секунда
  max: 100, // 100 запросов в секунду (Telegram может отправлять много)
  message: { ok: true } // Всегда отвечаем OK для Telegram
});

// Настройка стандартного middleware
setupStandardMiddleware(app);

// Session управляется централизованно в gateway
// Сервис получает userId через заголовок X-User-ID от gateway

// Функция для отправки запроса к Telegram API
function sendTelegramRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!TELEGRAM_BOT_TOKEN) {
      return reject(new Error('TELEGRAM_BOT_TOKEN не настроен'));
    }

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${TELEGRAM_BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.ok) {
            resolve(result.result);
          } else {
            reject(new Error(result.description || 'Telegram API error'));
          }
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify(params));
    req.end();
  });
}

// API: Получить настройки Telegram (админ)
app.get('/api/telegram/settings', requireAuth, async (req, res) => {
  try {
    logger.info(`GET /api/telegram/settings, userId: ${req.session.userId}`);

    if (!req.session.userId) {
      logger.error('Нет userId в сессии');
      return res.status(401).json({ success: false, message: 'Требуется авторизация' });
    }

    const user = await dbUsers.getById(req.session.userId);
    logger.info(`Пользователь найден: ${user ? 'да' : 'нет'}`);

    if (!user) {
      logger.error(`Пользователь с id ${req.session.userId} не найден`);
      return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    if (user.role !== 'user') {
      logger.error(`Неверная роль пользователя: ${user.role}`);
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    const settings = user.telegram_settings || {};
    logger.info('Настройки Telegram загружены');
    res.json({ success: true, settings });
  } catch (error) {
    logger.error('Ошибка получения настроек Telegram', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// API: Обновить настройки Telegram (админ)
app.post('/api/telegram/settings', requireAuth, async (req, res) => {
  try {
    const user = await dbUsers.getById(req.session.userId);
    if (!user || user.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    const { settings } = req.body;
    await dbUsers.update(user.id, { telegramSettings: settings });
    res.json({ success: true, message: 'Настройки обновлены' });
  } catch (error) {
    logger.error('Ошибка обновления настроек Telegram', { error: error.message });
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить токен бота
app.get('/api/telegram/bot-token', requireAuth, async (req, res) => {
  try {
    const user = await dbUsers.getById(req.session.userId);
    if (!user || user.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    const settings = user.telegram_settings || {};
    const token = settings.botToken || '';
    res.json({ success: true, token: token ? '***' : '' });
  } catch (error) {
    logger.error('Ошибка получения токена', { error: error.message });
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить ссылку для подключения
app.get('/api/telegram/connect-link', requireAuth, async (req, res) => {
  try {
    if (!TELEGRAM_BOT_TOKEN) {
      return res.json({ success: false, message: 'Бот не настроен' });
    }

    try {
      const botInfo = await sendTelegramRequest('getMe');
      const botUsername = botInfo.username;
      const link = `https://t.me/${botUsername}?start=connect_${req.session.userId}`;
      res.json({ success: true, link });
    } catch (error) {
      res.json({ success: false, message: 'Ошибка получения информации о боте' });
    }
  } catch (error) {
    logger.error('Ошибка получения ссылки', { error: error.message });
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Привязать Telegram аккаунт
app.post('/api/telegram/link', requireAuth, async (req, res) => {
  try {
    const { telegramId } = req.body;
    if (!telegramId) {
      return res.status(400).json({ success: false, message: 'Не указан telegramId' });
    }

    await dbUsers.update(req.session.userId, { telegramId: parseInt(telegramId) });
    res.json({ success: true, message: 'Telegram аккаунт привязан' });
  } catch (error) {
    logger.error('Ошибка привязки Telegram', { error: error.message });
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Отвязать Telegram аккаунт
app.post('/api/telegram/unlink', requireAuth, async (req, res) => {
  try {
    await dbUsers.update(req.session.userId, { telegramId: null });
    res.json({ success: true, message: 'Telegram аккаунт отвязан' });
  } catch (error) {
    logger.error('Ошибка отвязки Telegram', { error: error.message });
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить информацию о webhook
app.get('/api/telegram/webhook', requireAuth, async (req, res) => {
  try {
    const user = await dbUsers.getById(req.session.userId);
    if (!user || user.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    if (!TELEGRAM_BOT_TOKEN) {
      return res.json({ success: false, message: 'Бот не настроен' });
    }

    try {
      const webhookInfo = await sendTelegramRequest('getWebhookInfo');
      res.json({ success: true, webhookInfo });
    } catch (error) {
      res.json({ success: false, message: 'Ошибка получения информации о webhook' });
    }
  } catch (error) {
    logger.error('Ошибка получения webhook', { error: error.message });
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Webhook от Telegram
app.post('/api/telegram/webhook', webhookLimiter, async (req, res) => {
  try {
    // Валидация секретного токена webhook (если настроен)
    if (TELEGRAM_WEBHOOK_SECRET) {
      const receivedToken = req.headers['x-telegram-bot-api-secret-token'];
      if (receivedToken !== TELEGRAM_WEBHOOK_SECRET) {
        logger.warn('Получен webhook с неверным секретным токеном');
        return res.status(403).json({ ok: false, error: 'Invalid webhook token' });
      }
    }

    const update = req.body;

    // Обработка update от Telegram
    if (update.message) {
      const { chat, text } = update.message;
      const telegramId = chat.id;

      // Обработка команд
      if (text && text.startsWith('/start')) {
        const match = text.match(/\/start connect_(\d+)/);
        if (match) {
          const userIdValidation = validatePositiveInt(match[1], 'userId');
          if (userIdValidation.valid) {
            // Проверяем, что пользователь существует перед обновлением
            const targetUser = await dbUsers.getById(userIdValidation.value);
            if (targetUser) {
              await dbUsers.update(userIdValidation.value, { telegramId });
              logger.info('Telegram аккаунт привязан через webhook', { userId: userIdValidation.value, telegramId });
            }
          }
        }
      }
    }

    res.json({ ok: true });
  } catch (error) {
    logger.error('Ошибка обработки webhook', { error: error.message });
    res.json({ ok: true }); // Всегда отвечаем OK для Telegram
  }
});

// API: Поиск владельца по телефону (с rate limiting и минимальными данными)
app.get('/api/owners/by-phone/:phone', phoneLookupLimiter, async (req, res) => {
  try {
    const { phone } = req.params;
    const normalizedPhone = normalizeToE164(phone);
    const user = await dbUsers.getByPhone(normalizedPhone);

    if (user && user.role === 'user') {
      // Возвращаем только минимально необходимые данные (без username для безопасности)
      res.json({
        success: true,
        user: {
          id: user.id,
          salonName: user.salon_name || 'Салон красоты'
        }
      });
    } else {
      res.json({ success: false, message: 'Владелец не найден' });
    }
  } catch (error) {
    logger.error('Ошибка поиска владельца', { error: error.message });
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'telegram-service', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

// Запуск сервера
(async () => {
  try {
    await initDatabase();
    logger.info('База данных инициализирована');

    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Telegram Service запущен на порту ${PORT}`);
    });
  } catch (error) {
    logger.error('Ошибка инициализации', { error: error.message });
    process.exit(1);
  }
})();
