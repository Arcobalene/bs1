const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');

// Импортируем общие модули
const { services, masters, users: dbUsers, initDatabase } = require('./shared/database');

const app = express();
const PORT = process.env.PORT || 3004;

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

// API: Обновить услуги
app.post('/api/services', requireAuth, async (req, res) => {
  try {
    const { services: servicesList } = req.body;
    const user = await dbUsers.getById(req.session.userId);
    
    if (!user || user.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    if (!Array.isArray(servicesList)) {
      return res.status(400).json({ success: false, message: 'services должен быть массивом' });
    }

    await services.setForUser(user.id, servicesList);
    res.json({ success: true, message: 'Услуги обновлены' });
  } catch (error) {
    console.error('Ошибка обновления услуг:', error);
    res.status(500).json({ success: false, message: error.message || 'Ошибка сервера' });
  }
});

// API: Получить услуги салона (публично)
app.get('/api/services/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const salonServices = await services.getByUserId(parseInt(userId));
    res.json({ success: true, services: salonServices });
  } catch (error) {
    console.error('Ошибка получения услуг:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Обновить мастеров
app.post('/api/masters', requireAuth, async (req, res) => {
  try {
    const { masters: mastersList } = req.body;
    const user = await dbUsers.getById(req.session.userId);
    
    if (!user || user.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    if (!Array.isArray(mastersList)) {
      return res.status(400).json({ success: false, message: 'masters должен быть массивом' });
    }

    await masters.setForUser(user.id, mastersList);
    res.json({ success: true, message: 'Мастера обновлены' });
  } catch (error) {
    console.error('Ошибка обновления мастеров:', error);
    res.status(500).json({ success: false, message: error.message || 'Ошибка сервера' });
  }
});

// API: Получить мастеров салона (публично)
app.get('/api/masters/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const salonMasters = await masters.getByUserId(parseInt(userId));
    res.json({ success: true, masters: salonMasters });
  } catch (error) {
    console.error('Ошибка получения мастеров:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Поиск мастеров
app.get('/api/masters/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || query.trim().length < 2) {
      return res.json({ success: true, masters: [] });
    }

    // Получаем всех мастеров (в реальном приложении можно добавить полнотекстовый поиск)
    // Здесь упрощенная версия - возвращаем пустой массив
    // Для полноценного поиска нужен более сложный SQL запрос
    res.json({ success: true, masters: [] });
  } catch (error) {
    console.error('Ошибка поиска мастеров:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'catalog-service', timestamp: new Date().toISOString() });
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
      console.log(`📋 Catalog Service запущен на порту ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Ошибка инициализации:', error);
    process.exit(1);
  }
})();
