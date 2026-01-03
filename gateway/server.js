const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy для работы за nginx (важно для правильной работы cookies и HTTPS)
app.set('trust proxy', 1);

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Настройка сессий (важно: имя cookie должно совпадать с оригинальным)
const isHttps = process.env.NODE_ENV === 'production' || process.env.BEHIND_HTTPS_PROXY === 'true';
const cookieSecure = isHttps;

app.use(session({
  secret: process.env.SESSION_SECRET || 'beauty-studio-secret-key-change-in-production',
  resave: true, // Синхронизировано с auth-service и user-service
  saveUninitialized: false,
  name: 'beauty.studio.sid', // Имя cookie должно совпадать с оригинальным
  cookie: {
    secure: cookieSecure,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 часа
    sameSite: 'lax',
    path: '/'
  }
}));

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));

// Проксирование к микросервисам
const services = {
  auth: process.env.AUTH_SERVICE_URL || 'http://auth-service:3001',
  user: process.env.USER_SERVICE_URL || 'http://user-service:3002',
  booking: process.env.BOOKING_SERVICE_URL || 'http://booking-service:3003',
  catalog: process.env.CATALOG_SERVICE_URL || 'http://catalog-service:3004',
  file: process.env.FILE_SERVICE_URL || 'http://file-service:3005',
  notification: process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3006',
  telegram: process.env.TELEGRAM_SERVICE_URL || 'http://telegram-service:3007'
};

// Настройка прокси с передачей сессий
const proxyOptions = {
  changeOrigin: true,
  cookieDomainRewrite: '',
  timeout: 60000, // 60 секунд timeout (увеличено для стабильности)
  proxyTimeout: 60000,
  xfwd: true, // Передавать оригинальные заголовки
  secure: false, // Отключить проверку SSL для внутренних соединений
  onProxyReq: (proxyReq, req, res) => {
    // Передаем сессию через заголовки (если нужно)
    if (req.session) {
      // Сессии передаются через cookies автоматически
    }
  },
  onError: (err, req, res) => {
    console.error(`[Gateway] Проксирование ошибка для ${req.method} ${req.path}:`, err.message);
    console.error(`[Gateway] Целевой сервис: ${req.url}`);
    console.error(`[Gateway] Код ошибки: ${err.code || 'N/A'}`);
    if (process.env.NODE_ENV === 'development') {
      console.error(`[Gateway] Полный стек ошибки:`, err);
    }
    if (!res.headersSent) {
      res.status(502).json({ 
        success: false, 
        message: 'Сервис временно недоступен',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  },
  onProxyRes: (proxyRes, req, res) => {
    // Копируем Set-Cookie заголовки от auth-service в ответ gateway
    // Это важно для правильной работы сессий
    if (proxyRes.headers['set-cookie']) {
      res.setHeader('Set-Cookie', proxyRes.headers['set-cookie']);
    }
  }
};

// HTML страницы (должны быть ДО API проксирования)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/index.html'));
});

app.get('/booking', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/booking.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/register.html'));
});

app.get('/register/master', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/register-master.html'));
});

app.get('/master', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/master.html'));
});

app.get('/master/calendar', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/master.html'));
});

app.get('/master/profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/master.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/admin.html'));
});

app.get('/calendar', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/calendar.html'));
});

app.get('/services', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/services.html'));
});

app.get('/users', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/users.html'));
});

app.get('/clients', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/clients.html'));
});

app.get('/client-cabinet', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/client-cabinet.html'));
});

app.get('/register-client', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/register-client.html'));
});

app.get('/login-client', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/login-client.html'));
});

app.get('/landing', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/landing.html'));
});

// Health check (перед API проксированием)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gateway', timestamp: new Date().toISOString() });
});

// Проксирование API запросов (после HTML страниц)
// Auth endpoints
app.use('/api/register', createProxyMiddleware({ target: services.auth, ...proxyOptions }));
app.use('/api/register/master', createProxyMiddleware({ target: services.auth, ...proxyOptions }));
app.use('/api/register-client', createProxyMiddleware({ target: services.user, ...proxyOptions }));
app.use('/api/login', createProxyMiddleware({ target: services.auth, ...proxyOptions }));
app.use('/api/login-client', createProxyMiddleware({ target: services.user, ...proxyOptions }));
app.use('/api/logout', createProxyMiddleware({ target: services.auth, ...proxyOptions }));
app.use('/api/logout-client', createProxyMiddleware({ target: services.user, ...proxyOptions }));

// User endpoints
app.use('/api/user', createProxyMiddleware({ target: services.user, ...proxyOptions }));
app.use('/api/users', createProxyMiddleware({ target: services.user, ...proxyOptions }));
app.use('/api/salon', createProxyMiddleware({ target: services.user, ...proxyOptions }));
app.use('/api/salons', createProxyMiddleware({ target: services.user, ...proxyOptions }));
app.use('/api/clients', createProxyMiddleware({ target: services.user, ...proxyOptions }));
app.use('/api/client', createProxyMiddleware({ target: services.user, ...proxyOptions }));

app.use('/api/bookings', createProxyMiddleware({ target: services.booking, ...proxyOptions }));

app.use('/api/services', createProxyMiddleware({ target: services.catalog, ...proxyOptions }));
app.use('/api/masters', createProxyMiddleware({ target: services.catalog, ...proxyOptions }));

app.use('/api/minio', createProxyMiddleware({ target: services.file, ...proxyOptions }));

app.use('/api/notifications', createProxyMiddleware({ target: services.notification, ...proxyOptions }));

app.use('/api/telegram', createProxyMiddleware({ target: services.telegram, ...proxyOptions }));
app.use('/api/bot', createProxyMiddleware({ target: services.telegram, ...proxyOptions }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚪 API Gateway запущен на порту ${PORT}`);
});
