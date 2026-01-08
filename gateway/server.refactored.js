/**
 * API Gateway - Рефакторенная версия
 * Использует структурированное логирование, централизованную обработку ошибок
 * и валидацию конфигурации
 */

const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');

// Импорт общих модулей
const { validateEnv } = require('../shared/config');
const { createLogger } = require('../shared/logger');
const { errorHandler, asyncHandler } = require('../shared/errors');

// Валидация переменных окружения
const config = validateEnv();

// Создание логгера
const logger = createLogger('Gateway');

// Инициализация Express приложения
const app = express();
const PORT = config.PORT;

// Сохраняем логгер в app.locals для доступа в middleware
app.locals.logger = logger;

// Trust proxy для работы за nginx
app.set('trust proxy', 1);

// Безопасность: Helmet для защиты HTTP заголовков
app.use(helmet({
  contentSecurityPolicy: config.NODE_ENV === 'production' ? undefined : false,
  crossOriginEmbedderPolicy: false
}));

// CORS настройка
app.use(cors({
  origin: config.NODE_ENV === 'production' ? false : true, // В production настраивается через nginx
  credentials: true
}));

// Сжатие ответов
app.use(compression());

// Rate limiting для защиты от DDoS
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100, // максимум 100 запросов с одного IP
  message: { success: false, message: 'Слишком много запросов, попробуйте позже' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

// Парсинг JSON и URL-encoded (только для не-API запросов)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  express.json({ limit: '10mb' })(req, res, next);
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  express.urlencoded({ extended: true, limit: '10mb' })(req, res, next);
});

// Cookie parser
app.use(cookieParser());

// Структурированное логирование запросов
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    logger.info('Incoming request', {
      method: req.method,
      path: req.path,
      ip: req.ip,
      userId: req.session?.userId || null
    });
  }
  next();
});

// Настройка сессий
const isHttps = config.NODE_ENV === 'production' || config.BEHIND_HTTPS_PROXY;
let sessionStore = null;
let redisClient = null;

/**
 * Инициализация Redis для хранения сессий
 */
async function initRedis() {
  try {
    logger.info('Initializing Redis connection...');
    
    redisClient = createClient({
      socket: {
        host: config.REDIS_HOST,
        port: config.REDIS_PORT,
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            logger.warn('Redis connection retries exceeded, using MemoryStore');
            return false;
          }
          return Math.min(retries * 100, 3000);
        }
      },
      password: config.REDIS_PASSWORD || undefined
    });

    redisClient.on('error', (err) => {
      logger.error('Redis error', { error: err.message });
    });

    redisClient.on('connect', () => {
      logger.info('Redis connected');
    });

    redisClient.on('ready', () => {
      logger.info('Redis ready');
    });

    // Подключение с таймаутом
    await Promise.race([
      redisClient.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Redis connection timeout')), 5000)
      )
    ]);

    // Создание Redis store
    sessionStore = new RedisStore({
      client: redisClient,
      prefix: 'beauty-studio:session:'
    });
    
    logger.info('Redis session store initialized');
    return true;
  } catch (error) {
    logger.error('Redis connection failed', { error: error.message });
    logger.warn('Using MemoryStore for sessions (not recommended for production)');
    sessionStore = null;
    return false;
  }
}

/**
 * Инициализация приложения
 */
async function initApp() {
  // Инициализация Redis
  const redisAvailable = await initRedis();

  // Настройка express-session
  app.use(session({
    store: sessionStore || undefined,
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'beauty.studio.sid',
    rolling: false,
    cookie: {
      secure: isHttps,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 часа
      sameSite: 'lax',
      path: '/'
    }
  }));

  logger.info('Session configuration', {
    store: redisAvailable ? 'Redis' : 'MemoryStore',
    secure: isHttps
  });
}

// Middleware для логирования состояния сессии
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') && req.session) {
    logger.debug('Session state', {
      path: req.path,
      userId: req.session.userId || null,
      sessionID: req.sessionID || null
    });
  }
  next();
});

// Middleware для автоматического сохранения сессии
app.use((req, res, next) => {
  const originalEnd = res.end.bind(res);
  res.end = function(...args) {
    if (req.session && req.session.userId) {
      req.session.touch();
      req.session.save((err) => {
        if (err) {
          logger.error('Session save error', { error: err.message, path: req.path });
        } else {
          logger.debug('Session saved', { userId: req.session.userId, path: req.path });
        }
      });
    }
    return originalEnd(...args);
  };
  next();
});

// Middleware для синхронизации сессии gateway с user-service
app.use(asyncHandler(async (req, res, next) => {
  if (req.cookies && req.cookies['beauty.studio.sid'] && !req.session.userId && req.path.startsWith('/api/')) {
    if (!req.path.includes('/login') && !req.path.includes('/register')) {
      logger.debug('Attempting session synchronization', { path: req.path });
      
      try {
        const http = require('http');
        const url = require('url');
        const userServiceUrl = url.parse(config.USER_SERVICE_URL);
        const cookieHeader = req.headers.cookie || '';

        const options = {
          hostname: userServiceUrl.hostname,
          port: userServiceUrl.port || 3002,
          path: '/api/user',
          method: 'GET',
          headers: { 'Cookie': cookieHeader },
          timeout: 5000
        };

        await new Promise((resolve) => {
          const userReq = http.request(options, (userRes) => {
            let data = '';
            userRes.on('data', (chunk) => { data += chunk; });
            userRes.on('end', async () => {
              try {
                if (userRes.statusCode !== 200) {
                  logger.debug('Session sync failed', { statusCode: userRes.statusCode });
                  resolve();
                  return;
                }

                const contentType = userRes.headers['content-type'] || '';
                if (!contentType.includes('application/json')) {
                  logger.debug('Invalid content type in session sync', { contentType });
                  resolve();
                  return;
                }

                const result = JSON.parse(data);
                if (result.success && result.user && result.user.id) {
                  req.session.userId = result.user.id;
                  req.session.originalUserId = result.user.id;
                  req.session.touch();

                  await new Promise((saveResolve) => {
                    req.session.save((err) => {
                      if (err) {
                        logger.error('Session save error during sync', { error: err.message });
                      } else {
                        logger.info('Session synchronized', { userId: result.user.id });
                      }
                      saveResolve();
                    });
                  });
                }
              } catch (e) {
                logger.warn('Session sync parse error', { error: e.message });
              }
              resolve();
            });
          });

          userReq.on('error', (err) => {
            logger.warn('Session sync request error', { error: err.message });
            resolve();
          });

          userReq.on('timeout', () => {
            userReq.destroy();
            logger.warn('Session sync timeout');
            resolve();
          });

          userReq.end();
        });
      } catch (e) {
        logger.warn('Session sync exception', { error: e.message });
      }
    }
  }
  next();
}));

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));

// Конфигурация микросервисов
const services = {
  auth: config.AUTH_SERVICE_URL,
  user: config.USER_SERVICE_URL,
  booking: config.BOOKING_SERVICE_URL,
  catalog: config.CATALOG_SERVICE_URL,
  file: config.FILE_SERVICE_URL,
  notification: config.NOTIFICATION_SERVICE_URL,
  telegram: config.TELEGRAM_SERVICE_URL
};

// Настройка прокси
const proxyOptions = {
  changeOrigin: true,
  cookieDomainRewrite: false,
  timeout: 120000,
  proxyTimeout: 120000,
  xfwd: true,
  secure: false,
  onProxyReq: (proxyReq, req, res) => {
    logger.debug('Proxying request', {
      method: req.method,
      path: req.path,
      target: proxyReq.path,
      userId: req.session?.userId || null
    });

    if (req.headers.cookie) {
      proxyReq.setHeader('Cookie', req.headers.cookie);
    }

    if (req.session && req.session.userId) {
      proxyReq.setHeader('X-User-ID', req.session.userId.toString());
      if (req.session.originalUserId) {
        proxyReq.setHeader('X-Original-User-ID', req.session.originalUserId.toString());
      }
      req.session.touch();
    }
  },
  onProxyRes: (proxyRes, req, res) => {
    logger.debug('Proxy response', {
      method: req.method,
      path: req.path,
      statusCode: proxyRes.statusCode
    });

    if (proxyRes.headers['set-cookie']) {
      const setCookieHeaders = Array.isArray(proxyRes.headers['set-cookie'])
        ? proxyRes.headers['set-cookie']
        : [proxyRes.headers['set-cookie']];

      setCookieHeaders.forEach(cookie => {
        res.appendHeader('Set-Cookie', cookie);
      });
    }
  },
  onError: (err, req, res) => {
    logger.error('Proxy error', {
      method: req.method,
      path: req.path,
      error: err.message,
      code: err.code
    });

    if (err.code === 'ECONNRESET' && res.headersSent) {
      logger.debug('Connection reset after response sent (normal)');
      return;
    }

    if (!res.headersSent) {
      const statusCode = err.code === 'ETIMEDOUT' ? 504 : 502;
      res.status(statusCode).json({
        success: false,
        message: err.code === 'ETIMEDOUT' ? 'Превышено время ожидания ответа от сервиса' :
                 err.code === 'ECONNRESET' ? 'Соединение с сервисом прервано' :
                 'Сервис временно недоступен',
        error: config.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
};

// HTML страницы
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/index.html'));
});

app.get('/booking', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/booking.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/register.html'));
});

app.get('/register/master', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/register-master.html'));
});

app.get('/master', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/master.html'));
});

app.get('/master/calendar', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/master.html'));
});

app.get('/master/profile', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/master.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/admin.html'));
});

app.get('/calendar', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/calendar.html'));
});

app.get('/services', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/services.html'));
});

app.get('/users', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/users.html'));
});

app.get('/clients', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/clients.html'));
});

app.get('/client-cabinet', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/client-cabinet.html'));
});

app.get('/register-client', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/register-client.html'));
});

app.get('/login-client', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/login-client.html'));
});

app.get('/landing', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/landing.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'gateway',
    timestamp: new Date().toISOString(),
    redis: redisClient && redisClient.isReady ? 'connected' : 'disconnected'
  });
});

// API проксирование
// Auth endpoints
app.use('/api/register', createProxyMiddleware({
  target: services.auth,
  ...proxyOptions
}));

app.use('/api/register/master', createProxyMiddleware({
  target: services.auth,
  ...proxyOptions
}));

app.use('/api/register-client', createProxyMiddleware({
  target: services.user,
  ...proxyOptions
}));

// Login с особой обработкой для синхронизации сессии
app.use('/api/login', createProxyMiddleware({
  target: services.auth,
  ...proxyOptions,
  selfHandleResponse: true,
  onProxyReq: (proxyReq, req, res) => {
    logger.debug('Proxying login request', {
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length']
    });

    if (req.headers.cookie) {
      proxyReq.setHeader('Cookie', req.headers.cookie);
    }

    if (!proxyReq.getHeader('Content-Type') && req.headers['content-type']) {
      proxyReq.setHeader('Content-Type', req.headers['content-type']);
    }
  },
  onProxyRes: (proxyRes, req, res) => {
    logger.debug('Login response received', { statusCode: proxyRes.statusCode });

    const chunks = [];

    proxyRes.on('data', (chunk) => {
      chunks.push(chunk);
    });

    proxyRes.on('end', async () => {
      try {
        const body = Buffer.concat(chunks).toString();
        const result = JSON.parse(body);

        if (proxyRes.statusCode === 200 && result.success && result.userId) {
          logger.info('Login successful, syncing session', {
            userId: result.userId,
            sessionID: req.sessionID
          });

          req.session.userId = result.userId;
          req.session.originalUserId = result.userId;
          req.session.touch();

          try {
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                logger.error('Session save timeout after login');
                reject(new Error('Session save timeout'));
              }, 5000);

              req.session.save((err) => {
                clearTimeout(timeout);
                if (err) {
                  logger.error('Session save error after login', { error: err.message });
                  reject(err);
                } else {
                  logger.info('Session synced after login', {
                    userId: result.userId,
                    sessionID: req.sessionID
                  });
                  resolve();
                }
              });
            });
          } catch (saveError) {
            logger.error('Critical session save error', { error: saveError.message });
          }
        }
      } catch (e) {
        logger.warn('Login response parse error', { error: e.message });
      }

      if (!res.headersSent) {
        res.status(proxyRes.statusCode);

        Object.keys(proxyRes.headers).forEach(key => {
          const lowerKey = key.toLowerCase();
          if (lowerKey !== 'content-length' && lowerKey !== 'transfer-encoding' &&
              lowerKey !== 'connection' && lowerKey !== 'set-cookie') {
            res.setHeader(key, proxyRes.headers[key]);
          }
        });

        res.setHeader('Content-Length', Buffer.byteLength(Buffer.concat(chunks)));
        res.end(Buffer.concat(chunks));
      } else if (!res.finished) {
        res.end();
      }
    });

    proxyRes.on('error', (err) => {
      logger.error('Login response error', { error: err.message });
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
      } else if (!res.finished) {
        res.end();
      }
    });
  }
}));

app.use('/api/login-client', createProxyMiddleware({
  target: services.user,
  ...proxyOptions
}));

app.use('/api/logout', createProxyMiddleware({
  target: services.auth,
  ...proxyOptions
}));

app.use('/api/logout-client', createProxyMiddleware({
  target: services.user,
  ...proxyOptions
}));

// User endpoints
app.use('/api/user', createProxyMiddleware({
  target: services.user,
  ...proxyOptions
}));

app.use('/api/users', createProxyMiddleware({
  target: services.user,
  ...proxyOptions
}));

app.use('/api/salon', createProxyMiddleware({
  target: services.user,
  ...proxyOptions
}));

app.use('/api/salons', createProxyMiddleware({
  target: services.user,
  ...proxyOptions
}));

app.use('/api/clients', createProxyMiddleware({
  target: services.user,
  ...proxyOptions
}));

app.use('/api/client', createProxyMiddleware({
  target: services.user,
  ...proxyOptions
}));

// Booking endpoints
app.use('/api/bookings', createProxyMiddleware({
  target: services.booking,
  ...proxyOptions
}));

// Catalog endpoints
app.use('/api/services', createProxyMiddleware({
  target: services.catalog,
  ...proxyOptions
}));

// File endpoints (должны быть перед общим /api/masters)
app.use('/api/masters/photos', createProxyMiddleware({
  target: services.file,
  ...proxyOptions
}));

app.use('/api/master/photos', createProxyMiddleware({
  target: services.file,
  ...proxyOptions
}));

app.use('/api/masters', createProxyMiddleware({
  target: services.catalog,
  ...proxyOptions
}));

app.use('/api/minio', createProxyMiddleware({
  target: services.file,
  ...proxyOptions
}));

// Notification endpoints
app.use('/api/notifications', createProxyMiddleware({
  target: services.notification,
  ...proxyOptions
}));

// Telegram endpoints
app.use('/api/telegram', createProxyMiddleware({
  target: services.telegram,
  ...proxyOptions
}));

app.use('/api/bot', createProxyMiddleware({
  target: services.telegram,
  ...proxyOptions
}));

// Централизованная обработка ошибок (должна быть последней)
app.use(errorHandler);

// Обработка 404
app.use((req, res) => {
  logger.warn('Route not found', { method: req.method, path: req.path });
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Маршрут не найден'
    }
  });
});

// Инициализация и запуск сервера
async function startServer() {
  try {
    logger.info('Starting application initialization...');
    
    await initApp();
    
    logger.info('Session store', {
      type: sessionStore ? 'Redis' : 'MemoryStore (fallback)'
    });

    const server = app.listen(PORT, '0.0.0.0', () => {
      const address = server.address();
      logger.info('Gateway started', {
        port: PORT,
        address: `${address.address}:${address.port}`,
        environment: config.NODE_ENV
      });
    });

    server.on('error', (err) => {
      logger.error('Server error', {
        error: err.message,
        code: err.code
      });

      if (err.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use`);
      }
      process.exit(1);
    });

    server.on('listening', () => {
      const address = server.address();
      logger.info('Server listening', {
        address: `${address.address}:${address.port}`
      });
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down gracefully...');
      server.close(() => {
        logger.info('Server closed');
        if (redisClient) {
          redisClient.quit().then(() => {
            logger.info('Redis connection closed');
            process.exit(0);
          });
        } else {
          process.exit(0);
        }
      });
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down gracefully...');
      server.close(() => {
        logger.info('Server closed');
        if (redisClient) {
          redisClient.quit().then(() => {
            logger.info('Redis connection closed');
            process.exit(0);
          });
        } else {
          process.exit(0);
        }
      });
    });

  } catch (error) {
    logger.error('Critical initialization error', {
      error: error.message,
      stack: error.stack
    });
    
    // Запускаем сервер с MemoryStore в случае ошибки
    logger.warn('Starting server with MemoryStore fallback');
    
    const server = app.listen(PORT, '0.0.0.0', () => {
      const address = server.address();
      logger.info('Gateway started with MemoryStore', {
        port: PORT,
        address: `${address.address}:${address.port}`
      });
    });

    server.on('listening', () => {
      const address = server.address();
      logger.info('Server listening', {
        address: `${address.address}:${address.port}`
      });
    });
  }
}

// Запуск сервера
startServer().catch((error) => {
  logger.error('Fatal error during startup', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

