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

// Логирование всех входящих запросов для отладки
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[Gateway] Входящий запрос: ${req.method} ${req.path}`);
  }
  next();
});

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
  cookieDomainRewrite: false, // Не перезаписываем домен cookies
  timeout: 120000, // 120 секунд timeout (увеличено для стабильности)
  proxyTimeout: 120000,
  xfwd: true, // Передавать оригинальные заголовки
  secure: false, // Отключить проверку SSL для внутренних соединений
  onProxyReq: (proxyReq, req, res) => {
    // Логируем запрос для отладки
    console.log(`[Gateway] Проксирование ${req.method} ${req.path} -> ${proxyReq.path}`);
    
    // Передаем cookies от клиента к сервису
    if (req.headers.cookie) {
      proxyReq.setHeader('Cookie', req.headers.cookie);
    }
  },
  onError: (err, req, res) => {
    console.error(`[Gateway] Проксирование ошибка для ${req.method} ${req.path}:`, err.message);
    console.error(`[Gateway] Целевой сервис: ${req.url}`);
    console.error(`[Gateway] Код ошибки: ${err.code || 'N/A'}`);
    
    // Игнорируем ECONNRESET если ответ уже отправлен
    if (err.code === 'ECONNRESET' && res.headersSent) {
      console.log(`[Gateway] Соединение закрыто после отправки ответа (это нормально)`);
      return;
    }
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      console.error(`[Gateway] Сервис недоступен или не отвечает. Проверьте, запущен ли сервис.`);
    }
    
    if (process.env.NODE_ENV === 'development') {
      console.error(`[Gateway] Полный стек ошибки:`, err);
    }
    
    if (!res.headersSent) {
      const statusCode = err.code === 'ETIMEDOUT' ? 504 : (err.code === 'ECONNRESET' ? 502 : 502);
      res.status(statusCode).json({ 
        success: false, 
        message: err.code === 'ETIMEDOUT' ? 'Превышено время ожидания ответа от сервиса' : 
                 err.code === 'ECONNRESET' ? 'Соединение с сервисом прервано' :
                 'Сервис временно недоступен',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  },
  onProxyRes: (proxyRes, req, res) => {
    // Копируем Set-Cookie заголовки от сервиса в ответ gateway
    // Это важно для правильной работы сессий
    if (proxyRes.headers['set-cookie']) {
      // Если Set-Cookie это массив, обрабатываем каждый элемент
      const setCookieHeaders = Array.isArray(proxyRes.headers['set-cookie']) 
        ? proxyRes.headers['set-cookie'] 
        : [proxyRes.headers['set-cookie']];
      
      setCookieHeaders.forEach(cookie => {
        res.appendHeader('Set-Cookie', cookie);
      });
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
app.use('/api/register', createProxyMiddleware({ 
  target: services.auth, 
  ...proxyOptions,
  logLevel: 'debug'
}));
app.use('/api/register/master', createProxyMiddleware({ target: services.auth, ...proxyOptions }));
app.use('/api/register-client', createProxyMiddleware({ target: services.user, ...proxyOptions }));
app.use('/api/login', createProxyMiddleware({ 
  target: services.auth, 
  ...proxyOptions,
  logLevel: 'debug',
  onProxyReq: (proxyReq, req, res) => {
    // Логируем только безопасную информацию (без пароля)
    const safeBody = req.body ? {
      username: req.body.username,
      // Пароль не логируем по соображениям безопасности
      hasPassword: !!req.body.password
    } : null;
    console.log(`[Gateway] Проксирование LOGIN ${req.method} ${req.path} -> ${services.auth}${req.path}`);
    console.log(`[Gateway] Safe body info:`, safeBody);
    console.log(`[Gateway] Content-Type:`, req.headers['content-type']);
    console.log(`[Gateway] Body length:`, req.body ? JSON.stringify(req.body).length : 0);
    
    // Передаем cookies от клиента к сервису
    if (req.headers.cookie) {
      proxyReq.setHeader('Cookie', req.headers.cookie);
    }
    
    // Убеждаемся, что Content-Type установлен
    if (!proxyReq.getHeader('Content-Type') && req.headers['content-type']) {
      proxyReq.setHeader('Content-Type', req.headers['content-type']);
    }
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log(`[Gateway] Получен ответ от auth-service: ${proxyRes.statusCode}`);
    // Вызываем оригинальный onProxyRes из proxyOptions
    if (proxyOptions.onProxyRes) {
      proxyOptions.onProxyRes(proxyRes, req, res);
    }
  },
  onError: (err, req, res) => {
    console.error(`[Gateway] Ошибка проксирования LOGIN:`, err.message);
    console.error(`[Gateway] Код ошибки:`, err.code);
    // Вызываем оригинальный onError из proxyOptions
    if (proxyOptions.onError) {
      proxyOptions.onError(err, req, res);
    }
  }
}));
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

// Фото мастеров должны проксироваться в file-service (ПЕРЕД общим /api/masters)
app.use('/api/masters/photos', createProxyMiddleware({ target: services.file, ...proxyOptions }));
app.use('/api/master/photos', createProxyMiddleware({ target: services.file, ...proxyOptions }));
app.use('/api/masters', createProxyMiddleware({ target: services.catalog, ...proxyOptions }));

app.use('/api/minio', createProxyMiddleware({ target: services.file, ...proxyOptions }));

app.use('/api/notifications', createProxyMiddleware({ target: services.notification, ...proxyOptions }));

app.use('/api/telegram', createProxyMiddleware({ target: services.telegram, ...proxyOptions }));
app.use('/api/bot', createProxyMiddleware({ target: services.telegram, ...proxyOptions }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚪 API Gateway запущен на порту ${PORT}`);
});
