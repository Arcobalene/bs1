const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const https = require('https');

// Импортируем общие модули
const { users: dbUsers, initDatabase } = require('./shared/database');
const { normalizeToE164 } = require('./shared/utils');

const app = express();
const PORT = process.env.PORT || 3007;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL || '';

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Trust proxy для работы за gateway/nginx
app.set('trust proxy', 1);

// Настройка сессий
const isHttps = process.env.NODE_ENV === 'production' || process.env.BEHIND_HTTPS_PROXY === 'true';
const cookieSecure = isHttps;

app.use(session({
  secret: process.env.SESSION_SECRET || 'beauty-studio-secret-key-change-in-production',
  resave: true,
  saveUninitialized: false,
  name: 'beauty.studio.sid',
  cookie: {
    secure: cookieSecure,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    path: '/'
  }
}));

// Middleware для проверки аутентификации
function requireAuth(req, res, next) {
  // Проверяем сессию или заголовок X-User-ID от gateway (для синхронизации сессий)
  const userIdFromHeader = req.headers['x-user-id'];
  
  if (userIdFromHeader) {
    // Если userId передан через заголовок от gateway, синхронизируем сессию
    if (!req.session.userId) {
      req.session.userId = parseInt(userIdFromHeader);
    }
    if (req.headers['x-original-user-id'] && !req.session.originalUserId) {
      req.session.originalUserId = parseInt(req.headers['x-original-user-id']);
    }
  }
  
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, message: 'Требуется авторизация' });
  }
  next();
}

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
    const user = await dbUsers.getById(req.session.userId);
    if (!user || user.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    const settings = user.telegram_settings || {};
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Ошибка получения настроек Telegram:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
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
    console.error('Ошибка обновления настроек Telegram:', error);
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
    console.error('Ошибка получения токена:', error);
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
    console.error('Ошибка получения ссылки:', error);
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
    console.error('Ошибка привязки Telegram:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Отвязать Telegram аккаунт
app.post('/api/telegram/unlink', requireAuth, async (req, res) => {
  try {
    await dbUsers.update(req.session.userId, { telegramId: null });
    res.json({ success: true, message: 'Telegram аккаунт отвязан' });
  } catch (error) {
    console.error('Ошибка отвязки Telegram:', error);
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
    console.error('Ошибка получения webhook:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Webhook от Telegram
app.post('/api/telegram/webhook', async (req, res) => {
  try {
    const update = req.body;
    
    // Обработка update от Telegram
    if (update.message) {
      const { chat, text } = update.message;
      const telegramId = chat.id;
      
      // Поиск пользователя по telegramId
      const user = await dbUsers.getByTelegramId(telegramId);
      if (user) {
        // Обработка команд
        if (text && text.startsWith('/start')) {
          const match = text.match(/\/start connect_(\d+)/);
          if (match) {
            const userId = parseInt(match[1]);
            await dbUsers.update(userId, { telegramId });
          }
        }
      }
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Ошибка обработки webhook:', error);
    res.json({ ok: true }); // Всегда отвечаем OK для Telegram
  }
});

// API: Поиск владельца по телефону
app.get('/api/owners/by-phone/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const normalizedPhone = normalizeToE164(phone);
    const user = await dbUsers.getByPhone(normalizedPhone);
    
    if (user && user.role === 'user') {
      res.json({ success: true, user: { id: user.id, username: user.username, salonName: user.salon_name } });
    } else {
      res.json({ success: false, message: 'Владелец не найден' });
    }
  } catch (error) {
    console.error('Ошибка поиска владельца:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'telegram-service', timestamp: new Date().toISOString() });
});

// Обработчик ошибок
app.use((err, req, res, next) => {
  if (err.message && (err.message.includes('request aborted') || err.message.includes('aborted'))) {
    return;
  }
  
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    if (!res.headersSent) {
      return res.status(400).json({ success: false, message: 'Неверный формат JSON' });
    }
    return;
  }
  
  console.error('Ошибка:', err.message);
  if (!res.headersSent) {
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Запуск сервера
(async () => {
  try {
    await initDatabase();
    console.log('✅ База данных инициализирована');
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`📱 Telegram Service запущен на порту ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Ошибка инициализации:', error);
    process.exit(1);
  }
})();
