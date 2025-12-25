const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Minio = require('minio');
const https = require('https');
const http = require('http');
const { pool, users: dbUsers, services, masters, salonMasters, bookings, notifications, migrateFromJSON } = require('./database');
const { 
  timeToMinutes, 
  formatTime, 
  formatDate, 
  checkTimeOverlap, 
  validatePhone, 
  validateUsername, 
  validatePassword,
  validateEmail,
  validateId,
  sanitizeString,
  normalizeToE164,
  formatBooking 
} = require('./utils');

const app = express();
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// Настройка HTTPS
// По умолчанию отключен (предполагается использование nginx reverse proxy)
const USE_HTTPS = process.env.USE_HTTPS === 'true';
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || '/etc/letsencrypt/live';
const SSL_DOMAIN = process.env.SSL_DOMAIN || process.env.DOMAIN || 'localhost';
const FORCE_HTTPS = process.env.FORCE_HTTPS !== 'false'; // По умолчанию true, если USE_HTTPS включен

let httpsOptions = null;

// Функция для загрузки SSL сертификатов
function loadSSLCertificates() {
  if (!USE_HTTPS) {
    // Не выводим сообщение, т.к. это нормально при работе за nginx reverse proxy
    return null;
  }

  // Пути к сертификатам Let's Encrypt
  const certPath = path.join(SSL_CERT_PATH, SSL_DOMAIN, 'fullchain.pem');
  const keyPath = path.join(SSL_CERT_PATH, SSL_DOMAIN, 'privkey.pem');
  
  // Альтернативные пути (если указаны через переменные окружения)
  const customCertPath = process.env.SSL_CERT_FILE;
  const customKeyPath = process.env.SSL_KEY_FILE;

  let certFile, keyFile;

  if (customCertPath && customKeyPath) {
    certFile = customCertPath;
    keyFile = customKeyPath;
    console.log(`🔒 Используются кастомные SSL сертификаты`);
  } else {
    certFile = certPath;
    keyFile = keyPath;
    console.log(`🔒 Используются Let's Encrypt сертификаты для домена: ${SSL_DOMAIN}`);
  }

  try {
    if (!fs.existsSync(certFile)) {
      console.error(`❌ SSL сертификат не найден: ${certFile}`);
      console.error(`   Убедитесь, что сертификат установлен или установите USE_HTTPS=false для отключения HTTPS`);
      return null;
    }

    if (!fs.existsSync(keyFile)) {
      console.error(`❌ SSL приватный ключ не найден: ${keyFile}`);
      return null;
    }

    const options = {
      cert: fs.readFileSync(certFile, 'utf8'),
      key: fs.readFileSync(keyFile, 'utf8')
    };

    console.log(`✅ SSL сертификаты загружены успешно`);
    console.log(`   Сертификат: ${certFile}`);
    console.log(`   Ключ: ${keyFile}`);
    return options;
  } catch (error) {
    console.error(`❌ Ошибка загрузки SSL сертификатов:`, error.message);
    return null;
  }
}

// Загружаем SSL сертификаты
if (USE_HTTPS) {
  httpsOptions = loadSSLCertificates();
  if (!httpsOptions && USE_HTTPS) {
    console.warn('⚠️  HTTPS включен, но сертификаты не загружены. Приложение запустится без HTTPS.');
  }
}

// Validate critical environment variables
const SESSION_SECRET = process.env.SESSION_SECRET || 'beauty-studio-secret-key-change-in-production';
if (process.env.NODE_ENV === 'production') {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'beauty-studio-secret-key-change-in-production') {
    console.error('⚠️  WARNING: SESSION_SECRET is not set or using default value in production!');
    console.error('⚠️  This is a security risk. Please set SESSION_SECRET environment variable.');
    console.error('⚠️  Application will continue, but sessions may be insecure.');
  }
}

// Настройка MinIO
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost';
const MINIO_PORT = parseInt(process.env.MINIO_PORT || '9000', 10);
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin';

console.log(`🔧 Настройка MinIO: ${MINIO_ENDPOINT}:${MINIO_PORT}`);

const minioClient = new Minio.Client({
  endPoint: MINIO_ENDPOINT,
  port: MINIO_PORT,
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY
});

const BUCKET_NAME = 'master-photos';

// Глобальный токен Telegram бота (из переменных окружения или из БД для админа)
let TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || null;
let cachedBotToken = null;
let tokenCacheTime = 0;
const TOKEN_CACHE_TTL = 60000; // 1 минута

// Функция для получения токена бота (приоритет: БД админа > переменные окружения)
async function getTelegramBotToken() {
  const now = Date.now();
  // Используем кэш, если он еще актуален
  if (cachedBotToken !== null && (now - tokenCacheTime) < TOKEN_CACHE_TTL) {
    return cachedBotToken;
  }
  
  // Сбрасываем кэш
  cachedBotToken = null;
  
  // Сначала проверяем переменные окружения
  if (TELEGRAM_BOT_TOKEN) {
    cachedBotToken = TELEGRAM_BOT_TOKEN;
    tokenCacheTime = now;
  }
  
  try {
    // Ищем админа с сохраненным токеном
    const adminUsers = await dbUsers.getAll();
    const admin = adminUsers.find(u => (u.role === 'admin' || u.username === 'admin') && u.bot_token);
    if (admin && admin.bot_token && admin.bot_token.trim()) {
      // Токен из БД имеет приоритет
      cachedBotToken = admin.bot_token.trim();
      tokenCacheTime = now;
      return cachedBotToken;
    }
  } catch (error) {
    console.error('❌ Ошибка получения токена из БД:', error);
    // Если ошибка при обращении к БД, используем токен из env (если есть)
    if (TELEGRAM_BOT_TOKEN) {
      return TELEGRAM_BOT_TOKEN;
    }
    // Если БД недоступна и нет токена в env, пробрасываем ошибку
    throw new Error('База данных недоступна и токен не найден в переменных окружения');
  }
  
  // Возвращаем токен из переменных окружения или null
  return cachedBotToken;
}

// Функция для сброса кэша токена (вызывается при сохранении нового токена)
function clearBotTokenCache() {
  cachedBotToken = null;
  tokenCacheTime = 0;
}

if (!TELEGRAM_BOT_TOKEN && process.env.NODE_ENV === 'production') {
  console.warn('⚠️  WARNING: TELEGRAM_BOT_TOKEN is not set. Telegram notifications will be disabled.');
}

// Инициализация bucket в MinIO
(async () => {
  let retries = 5;
  let delay = 2000;
  
  while (retries > 0) {
    try {
      // Ждем немного, чтобы MinIO успел запуститься
      await new Promise(resolve => setTimeout(resolve, delay));
      
      const exists = await minioClient.bucketExists(BUCKET_NAME);
      if (!exists) {
        await minioClient.makeBucket(BUCKET_NAME, 'us-east-1');
        console.log(`✅ Bucket ${BUCKET_NAME} создан в MinIO`);
      } else {
        console.log(`✅ Bucket ${BUCKET_NAME} уже существует в MinIO`);
      }
      return; // Успешно инициализировано
    } catch (error) {
      retries--;
      if (retries > 0) {
        console.warn(`⚠️ Попытка подключения к MinIO (осталось ${retries} попыток):`, error.message);
        delay *= 2; // Увеличиваем задержку при каждой попытке
      } else {
        console.error('❌ Ошибка инициализации MinIO после всех попыток:', error.message);
        console.error(`Убедитесь, что MinIO запущен и доступен по адресу: ${MINIO_ENDPOINT}:${MINIO_PORT}`);
        console.error('Приложение продолжит работу, но загрузка фото будет недоступна');
      }
    }
  }
})();

// Настройка multer для загрузки файлов
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Недопустимый тип файла. Разрешены только изображения (JPEG, PNG, WebP)'));
    }
  }
});

// Настройка trust proxy для работы за reverse proxy (nginx, etc.)
// Это позволяет Express правильно определять req.secure на основе X-Forwarded-Proto
// Должно быть до других middleware, которые используют req.secure
// По умолчанию включен (для работы за nginx reverse proxy)
const TRUST_PROXY = process.env.TRUST_PROXY !== 'false';
if (TRUST_PROXY) {
  app.set('trust proxy', 1); // Доверять первому прокси
  console.log('✅ Trust proxy включен (для работы за nginx reverse proxy)');
}

// Определяем режим разработки (должно быть до использования)
const isDevelopment = process.env.NODE_ENV !== 'production';

// Определяем, используется ли HTTPS (для secure cookies и заголовков)
// Учитываем как прямой HTTPS, так и HTTPS через reverse proxy (X-Forwarded-Proto)
// Если USE_HTTPS=false, но приложение работает за nginx с HTTPS, автоматически определяем через X-Forwarded-Proto
const isHttpsDirect = USE_HTTPS && httpsOptions !== null;
// Автоматически определяем HTTPS за прокси, если не включен прямой HTTPS
// Это позволяет работать за nginx без дополнительных настроек
const isHttpsBehindProxy = TRUST_PROXY && (!USE_HTTPS || process.env.BEHIND_HTTPS_PROXY === 'true');
const isHttps = isHttpsDirect || isHttpsBehindProxy;

if (isHttpsBehindProxy && !USE_HTTPS) {
  console.log('✅ HTTPS определяется автоматически через reverse proxy (X-Forwarded-Proto заголовок от nginx)');
} else if (isHttpsBehindProxy && process.env.BEHIND_HTTPS_PROXY === 'true') {
  console.log('✅ HTTPS определяется через reverse proxy (BEHIND_HTTPS_PROXY=true)');
}

// Редирект HTTP на HTTPS (если включен HTTPS и FORCE_HTTPS)
// Примечание: если вы используете nginx как reverse proxy, редирект должен обрабатываться nginx
if (USE_HTTPS && httpsOptions && FORCE_HTTPS) {
  app.use((req, res, next) => {
    // Пропускаем редирект для healthcheck и локальных подключений
    if (req.path === '/health' || req.headers.host?.startsWith('localhost') || req.headers.host?.startsWith('127.0.0.1')) {
      return next();
    }
    
    // Редирект только если запрос не HTTPS (через прокси может быть заголовок X-Forwarded-Proto)
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    if (!isSecure) {
      const host = req.headers.host || req.hostname;
      return res.redirect(301, `https://${host}${req.originalUrl}`);
    }
    next();
  });
}

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // HSTS заголовок только для HTTPS (прямого или через прокси)
  // Проверяем через req.secure (работает с trust proxy) или заголовок X-Forwarded-Proto
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  if ((process.env.NODE_ENV === 'production' || isHttps) && isSecure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  
  next();
});

// Body parsing with limits
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public', { maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0 }));

// Настройка сессий
// ВАЖНО: secure: true только для HTTPS, иначе cookie не установится в браузере
const cookieSecure = isHttps; // secure: true только для HTTPS (определено выше)

app.use(session({
  secret: SESSION_SECRET,
  resave: true, // Сохранять сессию при каждом запросе
  saveUninitialized: false, // Не сохранять пустые сессии
  name: 'beauty.studio.sid', // Явное имя cookie
  cookie: { 
    secure: cookieSecure, // true только для HTTPS, иначе cookie не установится
    httpOnly: true, // Защита от XSS
    maxAge: 24 * 60 * 60 * 1000, // 24 часа
    sameSite: 'lax', // Защита от CSRF, но позволяет отправку cookies при переходе по ссылкам
    path: '/' // Cookie доступна для всех путей
  }
}));

// Логирование настроек сессии (только в режиме разработки)
if (isDevelopment) {
  console.log('🔐 Настройки сессии:', {
    secure: cookieSecure,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: '24 часа',
    name: 'beauty.studio.sid',
    isHttps: isHttps,
    NODE_ENV: process.env.NODE_ENV || 'development',
    HTTPS_ENABLED: process.env.HTTPS_ENABLED || 'не установлено'
  });
}
if (isDevelopment) {
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/login') || req.path.startsWith('/admin')) {
      console.log(`[${req.method} ${req.path}] Session ID: ${req.sessionID}, userId: ${req.session.userId}`);
    }
    next();
  });
}

// База данных инициализирована в database.js
// Импортируем функцию инициализации
const { initDatabase } = require('./database');

// Создаем демо-аккаунт при первом запуске (если нет пользователей или нет admin)
async function initDemoAccount() {
  try {
    console.log('Проверка наличия демо-аккаунта...');
    const allUsers = await dbUsers.getAll();
    console.log(`Найдено пользователей: ${allUsers.length}`);
    const hasAdmin = allUsers.find(u => u.username === 'admin');
    
    if (allUsers.length === 0 || !hasAdmin) {
      console.log('Создание демо-аккаунта...');
      
      const hashedPassword = await bcrypt.hash('admin123', 10);
      console.log('Пароль захеширован');
      
      const userId = await dbUsers.create({
        username: 'admin',
        email: 'admin@beautystudio.local',
        password: hashedPassword,
        role: 'admin',
        isActive: true,
        salonName: 'Beauty Studio',
        salonAddress: '',
        salonLat: null,
        salonLng: null
      });
      console.log(`Демо-аккаунт создан с ID: ${userId}`);

      // Добавляем услуги
      await services.setForUser(userId, [
        { name: "Стрижка простая", price: 180000, duration: 60 },
        { name: "Стрижка + укладка", price: 260000, duration: 120 },
        { name: "Маникюр классический", price: 160000, duration: 90 },
        { name: "Маникюр + покрытие гель-лак", price: 220000, duration: 120 },
        { name: "Педикюр", price: 250000, duration: 120 }
      ]);
      console.log('Услуги добавлены');

      // Добавляем мастеров
      await masters.setForUser(userId, [
        { name: "Алина", role: "маникюр, педикюр" },
        { name: "Диана", role: "маникюр, дизайн" },
        { name: "София", role: "парикмахер-стилист" }
      ]);
      console.log('Мастера добавлены');

      console.log('========================================');
      console.log('ДЕМО-АККАУНТ СОЗДАН!');
      console.log('Логин: admin');
      console.log('Пароль: admin123');
      console.log('========================================');
    } else {
      console.log('Демо-аккаунт уже существует');
      console.log(`ID админа: ${hasAdmin.id}, активен: ${hasAdmin.is_active}`);
    }
  } catch (error) {
    console.error('Ошибка инициализации демо-аккаунта:', error);
    console.error('Stack:', error.stack);
    throw error;
  }
}

// Middleware для проверки авторизации
async function requireAuth(req, res, next) {
  // Логирование для диагностики (только в режиме разработки)
  if (isDevelopment && req.path && req.path.startsWith('/api/')) {
    console.log(`[requireAuth] ${req.method} ${req.path}`, {
      sessionId: req.sessionID,
      userId: req.session.userId || 'не установлен',
      hasCookie: !!req.headers.cookie,
      cookieHeader: req.headers.cookie ? req.headers.cookie.substring(0, 50) + '...' : 'нет'
    });
  }
  
  if (req.session.userId) {
    try {
      const user = await dbUsers.getById(req.session.userId);
      if (!user) {
        if (isDevelopment) {
          console.log(`[requireAuth] Пользователь не найден: userId=${req.session.userId}`);
        }
        req.session.destroy();
        // Для API запросов всегда возвращаем JSON
        if (req.path && req.path.startsWith('/api/')) {
          return res.status(401).json({ success: false, message: 'Требуется авторизация' });
        }
        return res.redirect('/login');
      }
      if (user.is_active === false || user.is_active === 0) {
        if (isDevelopment) {
          console.log(`[requireAuth] Аккаунт деактивирован: userId=${req.session.userId}`);
        }
        req.session.destroy();
        // Для API запросов всегда возвращаем JSON
        if (req.path && req.path.startsWith('/api/')) {
          return res.status(401).json({ success: false, message: 'Аккаунт деактивирован' });
        }
        return res.redirect('/login');
      }
      next();
    } catch (error) {
      console.error('Ошибка проверки авторизации:', error);
      // Для API запросов всегда возвращаем JSON
      if (req.path && req.path.startsWith('/api/')) {
        return res.status(500).json({ success: false, message: 'Ошибка сервера' });
      }
      return res.redirect('/login');
    }
  } else {
    // Для API запросов всегда возвращаем JSON
    if (req.path && req.path.startsWith('/api/')) {
      if (isDevelopment) {
        console.log(`[requireAuth] Сессия не найдена для ${req.method} ${req.path}`);
      }
      return res.status(401).json({ success: false, message: 'Требуется авторизация' });
    }
    return res.redirect('/login');
  }
}

// Middleware для проверки прав администратора
async function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    // Для API запросов всегда возвращаем JSON
    if (req.path && req.path.startsWith('/api/')) {
      return res.status(401).json({ success: false, message: 'Требуется авторизация' });
    }
    // Если это HTML запрос, редиректим
    if (req.accepts && req.accepts('html')) {
      return res.redirect('/login');
    }
    return res.status(401).json({ success: false, message: 'Требуется авторизация' });
  }
  try {
    const user = await dbUsers.getById(req.session.userId);
    // Проверяем роль: admin или username === 'admin' (для обратной совместимости)
    const isAdmin = user && (user.role === 'admin' || user.username === 'admin');
    if (!isAdmin) {
      // Для API запросов всегда возвращаем JSON
      if (req.path && req.path.startsWith('/api/')) {
        return res.status(403).json({ success: false, message: 'Доступ запрещен. Требуются права администратора.' });
      }
      if (req.accepts && req.accepts('html')) {
        return res.status(403).send('Доступ запрещен. Требуются права администратора.');
      }
      return res.status(403).json({ success: false, message: 'Доступ запрещен. Требуются права администратора.' });
    }
    next();
  } catch (error) {
    console.error('Ошибка проверки прав администратора:', error);
    // Для API запросов всегда возвращаем JSON
    if (req.path && req.path.startsWith('/api/')) {
      return res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
    if (req.accepts && req.accepts('html')) {
      return res.status(500).send('Ошибка сервера');
    }
    return res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
}

// Middleware для проверки прав мастера
async function requireMaster(req, res, next) {
  if (!req.session.userId) {
    if (req.path && req.path.startsWith('/api/')) {
      return res.status(401).json({ success: false, message: 'Требуется авторизация' });
    }
    if (req.accepts && req.accepts('html')) {
      return res.redirect('/login');
    }
    return res.status(401).json({ success: false, message: 'Требуется авторизация' });
  }
  try {
    const user = await dbUsers.getById(req.session.userId);
    const isMaster = user && user.role === 'master';
    if (!isMaster) {
      if (req.path && req.path.startsWith('/api/')) {
        return res.status(403).json({ success: false, message: 'Доступ запрещен. Требуются права мастера.' });
      }
      if (req.accepts && req.accepts('html')) {
        return res.status(403).send('Доступ запрещен. Требуются права мастера.');
      }
      return res.status(403).json({ success: false, message: 'Доступ запрещен. Требуются права мастера.' });
    }
    next();
  } catch (error) {
    console.error('Ошибка проверки прав мастера:', error);
    if (req.path && req.path.startsWith('/api/')) {
      return res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
    if (req.accepts && req.accepts('html')) {
      return res.status(500).send('Ошибка сервера');
    }
    return res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
}

// Главная страница (лендинг)
app.get('/', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/admin');
  }
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Страница записи салона
app.get('/booking', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'booking.html'));
});

// Страница входа
app.get('/login', (req, res) => {
  if (req.session.userId) {
    // Проверяем роль и редиректим соответственно
    dbUsers.getById(req.session.userId).then(user => {
      if (user && user.role === 'master') {
        return res.redirect('/master');
      }
      return res.redirect('/admin');
    }).catch(() => {
      res.sendFile(path.join(__dirname, 'views', 'login.html'));
    });
    return;
  }
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// Страница регистрации
app.get('/register', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/admin');
  }
  res.sendFile(path.join(__dirname, 'views', 'register.html'));
});

// Страница регистрации мастера
app.get('/register/master', (req, res) => {
  if (req.session.userId) {
    const user = req.session.userId;
    // Проверяем роль и редиректим соответственно
    dbUsers.getById(user).then(u => {
      if (u && u.role === 'master') {
        return res.redirect('/master');
      }
      return res.redirect('/admin');
    }).catch(() => {
      res.sendFile(path.join(__dirname, 'views', 'register-master.html'));
    });
    return;
  }
  res.sendFile(path.join(__dirname, 'views', 'register-master.html'));
});

// Страница личного кабинета мастера
app.get('/master', requireMaster, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'master.html'));
});

// Страница календаря мастера (тот же файл, но другой маршрут для навигации)
app.get('/master/calendar', requireMaster, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'master.html'));
});

// Страница профиля мастера (тот же файл, но другой маршрут для навигации)
app.get('/master/profile', requireMaster, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'master.html'));
});

// Страница админки
app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// Страница календаря
app.get('/calendar', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'calendar.html'));
});

// Страница услуг и мастеров
app.get('/services', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'services.html'));
});

// Страница управления пользователями (только для админов)
app.get('/users', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'users.html'));
});

// Страница клиентов
app.get('/clients', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'clients.html'));
});

// API: Регистрация
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, email, phone } = req.body;
    
    // Валидация
    const usernameValidation = validateUsername(username);
    if (!usernameValidation.valid) {
      return res.status(400).json({ success: false, message: usernameValidation.message });
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({ success: false, message: passwordValidation.message });
    }

    // Валидация телефона (обязательное поле)
    const phoneValidation = validatePhone(phone);
    if (!phoneValidation.valid) {
      return res.status(400).json({ success: false, message: phoneValidation.message });
    }

    const existingUser = await dbUsers.getByUsername(usernameValidation.username);
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'Пользователь с таким именем уже существует' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = await dbUsers.create({
      username: usernameValidation.username,
      email: email ? email.trim() : '',
      password: hashedPassword,
      role: 'user',
      isActive: true,
      salonName: '',
      salonAddress: '',
      salonLat: null,
      salonLng: null,
      salonPhone: phone ? phone.trim() : null
    });

    // Добавляем услуги по умолчанию
    await services.setForUser(userId, [
      { name: "Стрижка простая", price: 180000, duration: 60 },
      { name: "Стрижка + укладка", price: 260000, duration: 120 },
      { name: "Маникюр классический", price: 160000, duration: 90 }
    ]);

    // Добавляем мастеров по умолчанию
    await masters.setForUser(userId, [
      { name: "Алина", role: "маникюр, педикюр" },
      { name: "Диана", role: "маникюр, дизайн" }
    ]);

    req.session.userId = userId;
    req.session.originalUserId = userId;
    res.status(201).json({ success: true, message: 'Регистрация успешна' });
  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера при регистрации' });
  }
});

// API: Регистрация мастера
app.post('/api/register/master', async (req, res) => {
  try {
    const { username, password, email, phone } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Заполните все обязательные поля' });
    }

    // Валидация
    const usernameValidation = validateUsername(username);
    if (!usernameValidation.valid) {
      return res.status(400).json({ success: false, message: usernameValidation.message });
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({ success: false, message: passwordValidation.message });
    }

    // Телефон опционален для мастера
    let phoneValidation = { valid: true };
    if (phone && phone.trim()) {
      phoneValidation = validatePhone(phone);
      if (!phoneValidation.valid) {
        return res.status(400).json({ success: false, message: phoneValidation.message });
      }
    }

    const existingUser = await dbUsers.getByUsername(usernameValidation.username);
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'Пользователь с таким именем уже существует' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = await dbUsers.create({
      username: usernameValidation.username,
      email: email ? email.trim() : '',
      password: hashedPassword,
      role: 'master',
      isActive: true,
      salonName: '',
      salonAddress: '',
      salonLat: null,
      salonLng: null,
      salonPhone: phone && phoneValidation.valid ? phone.trim() : null
    });

    req.session.userId = userId;
    req.session.originalUserId = userId;
    res.status(201).json({ success: true, message: 'Регистрация мастера успешна' });
  } catch (error) {
    console.error('Ошибка регистрации мастера:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера при регистрации' });
  }
});

// API: Вход
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Заполните все поля' });
    }

    const trimmedUsername = username.trim();
    const user = await dbUsers.getByUsername(trimmedUsername);
    
    if (!user) {
      return res.status(401).json({ success: false, message: 'Неверный логин или пароль' });
    }

    // Проверяем, не заблокирован ли пользователь
    if (user.is_active === false || user.is_active === 0) {
      return res.status(403).json({ success: false, message: 'Аккаунт заблокирован администратором' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Неверный логин или пароль' });
    }

    req.session.userId = user.id;
    req.session.originalUserId = req.session.originalUserId || user.id;
    
    // Явно сохраняем сессию перед отправкой ответа
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          console.error('Ошибка сохранения сессии:', err);
          return reject(err);
        }
        resolve();
      });
    });
    
    // Возвращаем роль для правильного редиректа на фронтенде
    res.json({ 
      success: true, 
      message: 'Вход выполнен',
      role: user.role
    });
  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера при входе' });
  }
});

// API: Выход
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// API: Получить данные пользователя
app.get('/api/user', requireAuth, async (req, res) => {
  try {
    const user = await dbUsers.getById(req.session.userId);
    if (!user) {
      return res.json({ success: false });
    }
    
    // Получаем данные в зависимости от роли
    let userServices = [];
    let userMasters = [];
    let masterSalons = [];
    
    if (user.role === 'master') {
      // Для мастера получаем список салонов, где он работает
      masterSalons = await salonMasters.getByMasterId(user.id);
    } else {
      // Для владельца получаем услуги и мастеров
      userServices = await services.getByUserId(user.id);
      userMasters = await masters.getByUserId(user.id);
    }
    
    // Получаем настройки дизайна
    let salonDesign = {};
    if (user.salon_design) {
      try {
        salonDesign = typeof user.salon_design === 'string' 
          ? JSON.parse(user.salon_design) 
          : user.salon_design;
      } catch (e) {
        console.error('Ошибка парсинга salon_design:', e);
      }
    }
    
    // Получаем время работы салона
    let workHours = { startHour: 10, endHour: 20 }; // Значения по умолчанию
    if (user.work_hours) {
      try {
        workHours = typeof user.work_hours === 'string' 
          ? JSON.parse(user.work_hours) 
          : user.work_hours;
        // Проверяем, что это валидный объект
        if (!workHours.startHour || !workHours.endHour) {
          workHours = { startHour: 10, endHour: 20 };
        }
      } catch (e) {
        console.error('Ошибка парсинга work_hours:', e);
      }
    }
    
    const userData = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      isActive: user.is_active === true || user.is_active === 1,
      salonName: user.salon_name || '',
      salonAddress: user.salon_address || '',
      salonLat: user.salon_lat,
      salonLng: user.salon_lng,
      salonPhone: user.salon_phone || '',
      salonDisplayPhone: user.salon_display_phone || '',
      salonDesign: salonDesign,
      workHours: workHours,
      services: userServices,
      masters: userMasters,
      masterSalons: masterSalons, // Список салонов для мастера
      createdAt: user.created_at
    };

    // Добавляем информацию о том, вошли ли мы под другим пользователем
    userData.isImpersonating = req.session.originalUserId && req.session.originalUserId !== req.session.userId;
    if (userData.isImpersonating) {
      const originalUser = await dbUsers.getById(req.session.originalUserId);
      if (originalUser) {
        userData.originalUsername = originalUser.username;
      }
    }
    res.json({ success: true, user: userData });
  } catch (error) {
    console.error('Ошибка получения данных пользователя:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Обновить услуги
app.post('/api/services', requireAuth, async (req, res) => {
  try {
    const { services: servicesList } = req.body;
    const user = await dbUsers.getById(req.session.userId);
    
    if (!user) {
      return res.json({ success: false, message: 'Пользователь не найден' });
    }

    await services.setForUser(req.session.userId, servicesList);
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка обновления услуг:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Обновить мастеров
app.post('/api/masters', requireAuth, async (req, res) => {
  try {
    const { masters: mastersList } = req.body;
    const user = await dbUsers.getById(req.session.userId);
    
    if (!user) {
      return res.json({ success: false, message: 'Пользователь не найден' });
    }

    await masters.setForUser(req.session.userId, mastersList);
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка обновления мастеров:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Обновить информацию о салоне
app.post('/api/salon', requireAuth, async (req, res) => {
  try {
    const { salonName, salonAddress, salonLat, salonLng, salonPhone, salonDisplayPhone, workHours } = req.body;
    const user = await dbUsers.getById(req.session.userId);
    
    if (!user) {
      return res.json({ success: false, message: 'Пользователь не найден' });
    }

    // Валидация телефона владельца (обязательное поле)
    const phoneValidation = validatePhone(salonPhone);
    if (!phoneValidation.valid) {
      return res.status(400).json({ success: false, message: phoneValidation.message });
    }

    // Нормализуем номер телефона владельца в формат E.164 для единообразия
    let normalizedPhone = undefined;
    if (salonPhone !== undefined) {
      if (salonPhone && salonPhone.trim()) {
        normalizedPhone = normalizeToE164(salonPhone.trim());
        console.log(`📞 Сохранение номера телефона владельца для userId=${req.session.userId}: ${normalizedPhone} (исходный: ${salonPhone})`);
      } else {
        normalizedPhone = '';
      }
    }

    // Нормализуем номер телефона салона (необязательное поле)
    let normalizedDisplayPhone = undefined;
    if (salonDisplayPhone !== undefined) {
      if (salonDisplayPhone && salonDisplayPhone.trim()) {
        // Валидация телефона салона (если указан)
        const displayPhoneValidation = validatePhone(salonDisplayPhone);
        if (!displayPhoneValidation.valid) {
          return res.status(400).json({ success: false, message: `Телефон салона: ${displayPhoneValidation.message}` });
        }
        normalizedDisplayPhone = normalizeToE164(salonDisplayPhone.trim());
        console.log(`📞 Сохранение номера телефона салона для userId=${req.session.userId}: ${normalizedDisplayPhone} (исходный: ${salonDisplayPhone})`);
      } else {
        normalizedDisplayPhone = null;
      }
    }
    
    // Валидация рабочего времени
    let workHoursData = undefined;
    if (workHours !== undefined) {
      const startHour = parseInt(workHours.startHour);
      const endHour = parseInt(workHours.endHour);
      
      if (isNaN(startHour) || isNaN(endHour)) {
        return res.status(400).json({ success: false, message: 'Некорректное время работы: часы должны быть числами' });
      }
      
      if (startHour < 0 || startHour > 23 || endHour < 0 || endHour > 23) {
        return res.status(400).json({ success: false, message: 'Часы работы должны быть в диапазоне от 0 до 23' });
      }
      
      if (startHour >= endHour) {
        return res.status(400).json({ success: false, message: 'Время начала работы должно быть меньше времени окончания' });
      }
      
      workHoursData = { startHour, endHour };
    }
    
    await dbUsers.update(req.session.userId, {
      salonName: salonName !== undefined ? sanitizeString(salonName, 255) : undefined,
      salonAddress: salonAddress !== undefined ? sanitizeString(salonAddress, 500) : undefined,
      salonLat: salonLat !== undefined ? (salonLat ? parseFloat(salonLat) : null) : undefined,
      salonLng: salonLng !== undefined ? (salonLng ? parseFloat(salonLng) : null) : undefined,
      salonPhone: normalizedPhone,
      salonDisplayPhone: normalizedDisplayPhone,
      workHours: workHoursData
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка обновления информации о салоне:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Сохранить настройки дизайна салона
app.post('/api/salon/design', requireAuth, async (req, res) => {
  try {
    const { design } = req.body;
    const user = await dbUsers.getById(req.session.userId);
    
    if (!user) {
      return res.json({ success: false, message: 'Пользователь не найден' });
    }

    // Убеждаемся, что design - это объект
    const designData = design && typeof design === 'object' ? design : {};
    
    await dbUsers.update(req.session.userId, {
      salonDesign: designData
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка сохранения настроек дизайна:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера: ' + error.message });
  }
});

// API: Получить настройки дизайна салона
app.get('/api/salon/design', requireAuth, async (req, res) => {
  try {
    const user = await dbUsers.getById(req.session.userId);
    
    if (!user) {
      return res.json({ success: false, design: {} });
    }

    let salonDesign = {};
    if (user.salon_design) {
      try {
        salonDesign = typeof user.salon_design === 'string' 
          ? JSON.parse(user.salon_design) 
          : user.salon_design;
      } catch (e) {
        console.error('Ошибка парсинга salon_design:', e);
      }
    }

    res.json({ success: true, design: salonDesign });
  } catch (error) {
    console.error('Ошибка получения настроек дизайна:', error);
    res.status(500).json({ success: false, design: {} });
  }
});

// API: Получить информацию о салоне (публичный доступ)
app.get('/api/salon/:userId', async (req, res) => {
  try {
    const idValidation = validateId(req.params.userId, 'ID пользователя');
    if (!idValidation.valid) {
      return res.status(400).json({ success: false, salon: null, message: idValidation.message });
    }
    const user = await dbUsers.getById(idValidation.id);
    if (!user) {
      return res.json({ success: false, salon: null });
    }
    
    let salonDesign = {};
    if (user.salon_design) {
      try {
        salonDesign = typeof user.salon_design === 'string' 
          ? JSON.parse(user.salon_design) 
          : user.salon_design;
      } catch (e) {
        console.error('Ошибка парсинга salon_design:', e);
      }
    }
    
      res.json({ 
      success: true, 
      salon: {
        name: user.salon_name || 'Beauty Studio',
        address: user.salon_address || '',
        lat: user.salon_lat,
        lng: user.salon_lng,
        phone: user.salon_display_phone || user.salon_phone || '', // Используем display_phone, если есть, иначе phone
        design: salonDesign
      }
    });
  } catch (error) {
    console.error('Ошибка получения информации о салоне:', error);
    res.status(500).json({ success: false, salon: null });
  }
});

// API: Получить услуги (публичный доступ)
app.get('/api/services/:userId', async (req, res) => {
  try {
    const idValidation = validateId(req.params.userId, 'ID пользователя');
    if (!idValidation.valid) {
      return res.status(400).json({ success: false, services: [], message: idValidation.message });
    }
    const user = await dbUsers.getById(idValidation.id);
    if (!user) {
      return res.json({ success: false, services: [] });
    }
    const userServices = await services.getByUserId(user.id);
    res.json({ success: true, services: userServices });
  } catch (error) {
    console.error('Ошибка получения услуг:', error);
    res.status(500).json({ success: false, services: [] });
  }
});

// API: Получить мастеров (публичный доступ)
app.get('/api/masters/:userId', async (req, res) => {
  try {
    const idValidation = validateId(req.params.userId, 'ID пользователя');
    if (!idValidation.valid) {
      return res.status(400).json({ success: false, masters: [], message: idValidation.message });
    }
    const user = await dbUsers.getById(idValidation.id);
    if (!user) {
      return res.json({ success: false, masters: [] });
    }
    const userMasters = await masters.getByUserId(user.id);
    
    console.log(`📋 Получение мастеров для пользователя ${user.id}, найдено мастеров: ${userMasters.length}`);
    
    // Проверяем наличие фото в MinIO для каждого мастера
    const mastersWithPhotoUrls = await Promise.all(userMasters.map(async (master) => {
      const rawPhotos = master.photos || [];
      console.log(`📸 Мастер ${master.id} (${master.name}): фото в БД: ${rawPhotos.length}`);
      
      const photos = rawPhotos.map(photo => {
        // Убеждаемся, что filename существует и формируем правильный URL
        const photoUrl = photo.filename 
          ? `/api/masters/photos/${master.id}/${photo.filename}`
          : (photo.url || '');
        return {
          ...photo,
          url: photoUrl,
          filename: photo.filename || photo.url?.split('/').pop() || ''
        };
      }).filter(photo => photo.filename); // Фильтруем фото без filename
      
      console.log(`   После фильтрации по filename: ${photos.length} фото`);
      
      // Проверяем, какие фото действительно существуют в MinIO
      if (photos.length > 0) {
        const existingPhotos = [];
        for (const photo of photos) {
          let photoExists = false;
          let actualPath = '';
          const objectName = `master-${master.id}/${photo.filename}`;
          
          // Сначала проверяем основной путь
          try {
            await minioClient.statObject(BUCKET_NAME, objectName);
            photoExists = true;
            actualPath = objectName;
            console.log(`   ✅ Фото найдено: ${objectName}`);
          } catch (error) {
            // Если не найдено, проверяем альтернативный путь (если masterId в имени файла отличается)
            const filenameParts = photo.filename.split('_');
            if (filenameParts.length > 0) {
              const fileMasterId = parseInt(filenameParts[0], 10);
              if (fileMasterId && fileMasterId !== master.id) {
                const alternativeObjectName = `master-${fileMasterId}/${photo.filename}`;
                try {
                  await minioClient.statObject(BUCKET_NAME, alternativeObjectName);
                  photoExists = true;
                  actualPath = alternativeObjectName;
                  // Обновляем URL на правильный путь
                  photo.url = `/api/masters/photos/${fileMasterId}/${photo.filename}`;
                  console.log(`   ✅ Фото найдено по альтернативному пути: ${alternativeObjectName}`);
                } catch (altError) {
                  console.warn(`   ⚠️ Фото не найдено в MinIO для мастера ${master.id}: ${photo.filename} (проверены оба пути)`);
                }
              } else {
                console.warn(`   ⚠️ Фото не найдено в MinIO для мастера ${master.id}: ${photo.filename}`);
              }
            } else {
              console.warn(`   ⚠️ Фото не найдено в MinIO для мастера ${master.id}: ${photo.filename} (неверный формат имени)`);
            }
          }
          
          if (photoExists) {
            existingPhotos.push(photo);
          }
        }
        console.log(`   📊 Итого фото для мастера ${master.id}: ${existingPhotos.length} из ${photos.length}`);
        // Возвращаем только фото, которые существуют в MinIO
        return {
          ...master,
          photos: existingPhotos
        };
      }
      
      return {
        ...master,
        photos: photos
      };
    }));
    
    res.json({ success: true, masters: mastersWithPhotoUrls });
  } catch (error) {
    console.error('Ошибка получения мастеров:', error);
    res.status(500).json({ success: false, masters: [] });
  }
});

// API: Проверка подключения к MinIO (для диагностики)
app.get('/api/minio/health', async (req, res) => {
  try {
    const bucketExists = await minioClient.bucketExists(BUCKET_NAME);
    const testObjectName = `test-${Date.now()}.txt`;
    
    // Пробуем загрузить тестовый объект
    let testUploadSuccess = false;
    try {
      await minioClient.putObject(BUCKET_NAME, testObjectName, Buffer.from('test'), 4, {
        'Content-Type': 'text/plain'
      });
      testUploadSuccess = true;
      
      // Удаляем тестовый объект
      await minioClient.removeObject(BUCKET_NAME, testObjectName);
    } catch (testError) {
      console.error('Ошибка тестовой загрузки:', testError.message);
    }
    
    res.json({
      success: true,
      minioEndpoint: `${MINIO_ENDPOINT}:${MINIO_PORT}`,
      bucketExists: bucketExists,
      bucketName: BUCKET_NAME,
      testUploadSuccess: testUploadSuccess,
      connectionStatus: testUploadSuccess ? 'OK' : 'FAILED'
    });
  } catch (error) {
    console.error('Ошибка проверки MinIO:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      minioEndpoint: `${MINIO_ENDPOINT}:${MINIO_PORT}`,
      bucketName: BUCKET_NAME
    });
  }
});

// API: Загрузить фото мастера
app.post('/api/masters/:masterId/photos', requireAuth, upload.array('photos', 10), async (req, res) => {
  try {
    const idValidation = validateId(req.params.masterId, 'ID мастера');
    if (!idValidation.valid) {
      return res.status(400).json({ success: false, message: idValidation.message });
    }
    const masterId = idValidation.id;
    const user = await dbUsers.getById(req.session.userId);
    
    if (!user) {
      return res.status(401).json({ success: false, message: 'Не авторизован' });
    }

    // Проверяем, что мастер принадлежит пользователю
    const userMasters = await masters.getByUserId(user.id);
    const master = userMasters.find(m => m.id === masterId);
    
    if (!master) {
      return res.status(404).json({ success: false, message: 'Мастер не найден' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'Файлы не загружены' });
    }

    // Проверяем подключение к MinIO перед загрузкой
    let minioAvailable = false;
    try {
      minioAvailable = await minioClient.bucketExists(BUCKET_NAME);
      if (!minioAvailable) {
        // Пробуем создать bucket
        try {
          await minioClient.makeBucket(BUCKET_NAME, 'us-east-1');
          minioAvailable = true;
          console.log(`✅ Bucket ${BUCKET_NAME} создан перед загрузкой фото`);
        } catch (makeBucketError) {
          console.error(`❌ Не удалось создать bucket ${BUCKET_NAME}:`, makeBucketError.message);
        }
      }
    } catch (minioError) {
      console.error(`❌ MinIO недоступен:`, minioError.message);
      return res.status(503).json({ 
        success: false, 
        message: 'Хранилище фото недоступно. Проверьте подключение к MinIO.',
        error: minioError.message
      });
    }

    if (!minioAvailable) {
      return res.status(503).json({ 
        success: false, 
        message: 'Bucket не существует и не может быть создан. Проверьте настройки MinIO.'
      });
    }

    console.log(`📤 Начало загрузки ${req.files.length} файлов для мастера ${masterId}`);

    const uploadedPhotos = [];
    const failedUploads = [];
    
    for (const file of req.files) {
      // Добавляем небольшую задержку между файлами, чтобы избежать конфликтов timestamp
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).substring(7);
      const extension = file.mimetype.split('/')[1] || 'jpeg';
      const filename = `${masterId}_${timestamp}_${randomStr}.${extension}`;
      const objectName = `master-${masterId}/${filename}`;
      
      try {
        console.log(`📤 Загрузка файла: ${file.originalname} (${file.size} байт) -> ${objectName}`);
        
        await minioClient.putObject(BUCKET_NAME, objectName, file.buffer, file.size, {
          'Content-Type': file.mimetype
        });
        
        // Проверяем, что файл действительно загружен
        try {
          const stat = await minioClient.statObject(BUCKET_NAME, objectName);
          console.log(`✅ Фото загружено в MinIO: ${objectName} (${stat.size} байт)`);
        } catch (verifyError) {
          console.error(`⚠️ Фото загружено, но не удалось проверить: ${verifyError.message}`);
        }
        
        uploadedPhotos.push({
          filename: filename,
          originalName: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
          uploadedAt: new Date().toISOString()
        });
      } catch (error) {
        console.error(`❌ Ошибка загрузки файла ${file.originalname} в MinIO:`);
        console.error(`   ObjectName: ${objectName}`);
        console.error(`   Bucket: ${BUCKET_NAME}`);
        console.error(`   Размер файла: ${file.size} байт`);
        console.error(`   MIME тип: ${file.mimetype}`);
        console.error(`   Ошибка: ${error.message}`);
        console.error(`   Stack: ${error.stack}`);
        
        failedUploads.push({
          originalName: file.originalname,
          error: error.message || 'Неизвестная ошибка',
          code: error.code,
          objectName: objectName
        });
      }
    }

    // Если ни один файл не был загружен успешно, возвращаем ошибку
    if (uploadedPhotos.length === 0) {
      const errorMessage = failedUploads.length > 0 
        ? `Не удалось загрузить файлы: ${failedUploads.map(f => f.originalName).join(', ')}`
        : 'Не удалось загрузить файлы';
      return res.status(500).json({ 
        success: false, 
        message: errorMessage,
        failedFiles: failedUploads
      });
    }

    // Обновляем список фото в БД только если есть успешно загруженные фото
    const currentPhotos = master.photos || [];
    const updatedPhotos = [...currentPhotos, ...uploadedPhotos];
    
    console.log(`💾 Сохранение фото в БД для мастера ${masterId}:`, {
      currentPhotosCount: currentPhotos.length,
      uploadedPhotosCount: uploadedPhotos.length,
      totalPhotosCount: updatedPhotos.length,
      filenames: uploadedPhotos.map(p => p.filename)
    });
    
    await masters.updatePhotos(masterId, updatedPhotos);
    console.log(`✅ Фото сохранены в БД для мастера ${masterId}`);

    // Возвращаем успех, но также информируем о неудачных загрузках, если они были
    const response = { 
      success: true, 
      photos: uploadedPhotos.map(photo => ({
        ...photo,
        url: `/api/masters/photos/${masterId}/${photo.filename}`
      }))
    };
    
    if (failedUploads.length > 0) {
      response.warning = `Загружено ${uploadedPhotos.length} из ${req.files.length} файлов. Некоторые файлы не удалось загрузить.`;
      response.failedFiles = failedUploads;
    }
    
    res.json(response);
  } catch (error) {
    console.error('Ошибка загрузки фото:', error);
    res.status(500).json({ success: false, message: 'Ошибка загрузки фото' });
  }
});

// API: Получить список фото мастера (для отладки)
app.get('/api/masters/:masterId/photos', requireAuth, async (req, res) => {
  try {
    const idValidation = validateId(req.params.masterId, 'ID мастера');
    if (!idValidation.valid) {
      return res.status(400).json({ success: false, message: idValidation.message });
    }
    const masterId = idValidation.id;
    const user = await dbUsers.getById(req.session.userId);
    
    if (!user) {
      return res.status(401).json({ success: false, message: 'Не авторизован' });
    }

    const userMasters = await masters.getByUserId(user.id);
    const master = userMasters.find(m => m.id === masterId);
    
    if (!master) {
      return res.status(404).json({ success: false, message: 'Мастер не найден' });
    }

    // Получаем список объектов из MinIO
    const objectsList = [];
    try {
      const bucketExists = await minioClient.bucketExists(BUCKET_NAME);
      if (bucketExists) {
        const stream = minioClient.listObjects(BUCKET_NAME, `master-${masterId}/`, true);
        stream.on('data', (obj) => objectsList.push(obj.name));
        await new Promise((resolve, reject) => {
          stream.on('end', resolve);
          stream.on('error', reject);
        });
      }
    } catch (error) {
      console.error('Ошибка получения списка объектов из MinIO:', error.message);
    }

    res.json({
      success: true,
      masterId: masterId,
      photosInDB: master.photos || [],
      photosInMinIO: objectsList,
      bucketExists: await minioClient.bucketExists(BUCKET_NAME).catch(() => false)
    });
  } catch (error) {
    console.error('Ошибка получения списка фото:', error);
    res.status(500).json({ success: false, message: 'Ошибка получения списка фото' });
  }
});

// API: Получить фото мастера
app.get('/api/masters/photos/:masterId/:filename', async (req, res) => {
  try {
    const idValidation = validateId(req.params.masterId, 'ID мастера');
    if (!idValidation.valid) {
      return res.status(400).json({ success: false, message: idValidation.message });
    }
    const masterId = idValidation.id;
    let filename = req.params.filename;
    
    if (!filename || !masterId || isNaN(masterId)) {
      return res.status(400).json({ success: false, message: 'Неверные параметры запроса' });
    }
    
    // Валидация filename: предотвращаем path traversal
    filename = filename.replace(/\.\./g, '').replace(/[\/\\]/g, '');
    if (!filename || filename.length === 0) {
      return res.status(400).json({ success: false, message: 'Некорректное имя файла' });
    }
    
    const objectName = `master-${masterId}/${filename}`;
    
    console.log(`🔍 Запрос фото: masterId=${masterId}, filename=${filename}, objectName=${objectName}`);
    
    try {
      // Проверяем существование bucket
      const bucketExists = await minioClient.bucketExists(BUCKET_NAME);
      if (!bucketExists) {
        console.error(`❌ Bucket ${BUCKET_NAME} не существует`);
        return res.status(500).json({ success: false, message: 'Хранилище фото недоступно' });
      }
      
      // Проверяем, может ли файл находиться в другой папке (если masterId в имени файла не совпадает)
      let actualObjectName = objectName;
      const filenameParts = filename.split('_');
      if (filenameParts.length > 0) {
        const fileMasterId = parseInt(filenameParts[0], 10);
        if (fileMasterId && fileMasterId !== masterId) {
          // Файл может находиться в папке другого мастера
          const alternativeObjectName = `master-${fileMasterId}/${filename}`;
          console.log(`⚠️ MasterId в URL (${masterId}) не совпадает с masterId в имени файла (${fileMasterId})`);
          console.log(`🔍 Пробуем альтернативный путь: ${alternativeObjectName}`);
          
          try {
            await minioClient.statObject(BUCKET_NAME, alternativeObjectName);
            actualObjectName = alternativeObjectName;
            console.log(`✅ Фото найдено по альтернативному пути: ${actualObjectName}`);
          } catch (altError) {
            console.log(`❌ Альтернативный путь не найден, используем оригинальный: ${objectName}`);
          }
        }
      }
      
      // Получаем метаданные объекта для определения Content-Type
      let contentType = 'image/jpeg'; // По умолчанию
      try {
        const stat = await minioClient.statObject(BUCKET_NAME, actualObjectName);
        console.log(`✅ Фото найдено в MinIO: ${actualObjectName}, размер: ${stat.size} байт`);
        if (stat.metaData && stat.metaData['content-type']) {
          contentType = stat.metaData['content-type'];
        } else {
          // Определяем тип по расширению файла
          const ext = filename.split('.').pop()?.toLowerCase();
          const mimeTypes = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'webp': 'image/webp'
          };
          contentType = mimeTypes[ext] || 'image/jpeg';
        }
      } catch (statError) {
        console.error(`❌ Фото не найдено в MinIO: ${objectName}`);
        console.error(`   Ошибка: ${statError.message}`);
        console.error(`   MasterId: ${masterId}, Filename: ${filename}`);
        
        // Пробуем найти все объекты в папке мастера для отладки
        const objectsList = [];
        try {
          const stream = minioClient.listObjects(BUCKET_NAME, `master-${masterId}/`, true);
          stream.on('data', (obj) => objectsList.push(obj.name));
          await new Promise((resolve, reject) => {
            stream.on('end', resolve);
            stream.on('error', reject);
          });
          
          console.log(`📁 Объекты в папке master-${masterId}/:`, objectsList);
          console.log(`🔍 Ищем: ${objectName}`);
          
          // Проверяем, может быть файл находится в другой папке (старый masterId)
          const filenameParts = filename.split('_');
          if (filenameParts.length > 0) {
            const possibleMasterId = parseInt(filenameParts[0], 10);
            if (possibleMasterId && possibleMasterId !== masterId) {
              console.warn(`⚠️ Возможно, файл принадлежит другому мастеру (ID: ${possibleMasterId})`);
              const alternativeObjectName = `master-${possibleMasterId}/${filename}`;
              try {
                await minioClient.statObject(BUCKET_NAME, alternativeObjectName);
                console.log(`✅ Фото найдено по альтернативному пути: ${alternativeObjectName}`);
                // Перенаправляем на правильный путь
                objectName = alternativeObjectName;
                const stat = await minioClient.statObject(BUCKET_NAME, objectName);
                // Продолжаем обработку с правильным objectName
              } catch (altError) {
                console.error(`❌ Альтернативный путь тоже не найден: ${altError.message}`);
              }
            }
          }
        } catch (listError) {
          console.error('Ошибка при получении списка объектов:', listError.message);
        }
        
        if (objectsList.length === 0) {
          return res.status(404).json({ 
            success: false, 
            message: 'Фото не найдено. В папке мастера нет файлов.',
            objectName: objectName,
            masterId: masterId,
            filename: filename,
            availableObjects: []
          });
        }
        
        return res.status(404).json({ 
          success: false, 
          message: 'Фото не найдено',
          objectName: objectName,
          masterId: masterId,
          filename: filename,
          availableObjects: objectsList,
          hint: objectsList.length > 0 ? 'Проверьте, возможно файл имеет другое имя' : 'Папка мастера пуста'
        });
      }
      
      // Получаем файл из MinIO
      const dataStream = await minioClient.getObject(BUCKET_NAME, actualObjectName);
      const chunks = [];
      
      dataStream.on('data', (chunk) => chunks.push(chunk));
      
      dataStream.on('end', () => {
        const buffer = Buffer.concat(chunks);
        console.log(`✅ Фото успешно получено из MinIO: ${actualObjectName}, размер: ${buffer.length} байт`);
        
        // Устанавливаем заголовки и отправляем изображение
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        // CORS only for image requests - restrict to specific origins in production
        const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['*'];
        const origin = req.headers.origin;
        if (allowedOrigins.includes('*') || (origin && allowedOrigins.includes(origin))) {
          res.setHeader('Access-Control-Allow-Origin', origin || '*');
        }
        res.send(buffer);
      });
      
      dataStream.on('error', (error) => {
        console.error(`❌ Ошибка получения файла из MinIO: ${actualObjectName}`, error.message);
        if (!res.headersSent) {
          res.status(500).json({ 
            success: false, 
            message: 'Ошибка получения фото', 
            error: error.message,
            objectName: actualObjectName
          });
        }
      });
    } catch (error) {
      console.error(`Ошибка получения файла из MinIO: ${objectName}`, error.message);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Ошибка получения фото' });
      }
    }
  } catch (error) {
    console.error('Ошибка получения фото:', error);
    res.status(500).json({ success: false, message: 'Ошибка получения фото' });
  }
});

// API: Удалить фото мастера
app.delete('/api/masters/:masterId/photos/:filename', requireAuth, async (req, res) => {
  try {
    const idValidation = validateId(req.params.masterId, 'ID мастера');
    if (!idValidation.valid) {
      return res.status(400).json({ success: false, message: idValidation.message });
    }
    const masterId = idValidation.id;
    const originalFilename = req.params.filename;
    
    if (!originalFilename || !masterId || isNaN(masterId)) {
      return res.status(400).json({ success: false, message: 'Неверные параметры запроса' });
    }
    
    // Базовая валидация: проверяем, что filename не пустой и не содержит только опасные символы
    if (originalFilename.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Некорректное имя файла' });
    }
    
    const user = await dbUsers.getById(req.session.userId);
    
    if (!user) {
      return res.status(401).json({ success: false, message: 'Не авторизован' });
    }

    // Проверяем, что мастер принадлежит пользователю
    const userMasters = await masters.getByUserId(user.id);
    const master = userMasters.find(m => m.id === masterId);
    
    if (!master) {
      return res.status(404).json({ success: false, message: 'Мастер не найден' });
    }

    // Ищем фото в базе данных по оригинальному имени
    const photoToDelete = (master.photos || []).find(p => p.filename === originalFilename);
    
    if (!photoToDelete) {
      return res.status(404).json({ success: false, message: 'Фото не найдено' });
    }

    // Санитизируем filename только для формирования objectName (безопасность для MinIO)
    // Но используем оригинальное имя для поиска в БД
    const sanitizedFilename = originalFilename.replace(/\.\./g, '').replace(/[\/\\]/g, '');
    const objectName = `master-${masterId}/${sanitizedFilename}`;
    
    try {
      // Пробуем удалить из MinIO (может не существовать, если уже удалено)
      try {
        await minioClient.removeObject(BUCKET_NAME, objectName);
      } catch (minioError) {
        // Игнорируем ошибку, если файл уже не существует в MinIO
        console.log(`Файл ${objectName} не найден в MinIO (возможно, уже удален):`, minioError.message);
      }
      
      // Обновляем список фото в БД, используя оригинальное имя для поиска
      const currentPhotos = (master.photos || []).filter(p => p.filename !== originalFilename);
      await masters.updatePhotos(masterId, currentPhotos);
      
      res.json({ success: true });
    } catch (error) {
      console.error('Ошибка удаления файла из MinIO:', error);
      res.status(500).json({ success: false, message: 'Ошибка удаления фото' });
    }
  } catch (error) {
    console.error('Ошибка удаления фото:', error);
    res.status(500).json({ success: false, message: 'Ошибка удаления фото' });
  }
});

// ========== API для управления мастерами в салоне ==========

// API: Поиск мастеров для добавления к салону
app.get('/api/masters/search', requireAuth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'Введите минимум 2 символа для поиска' });
    }

    const user = await dbUsers.getById(req.session.userId);
    if (!user || user.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    const searchTerm = q.trim();
    const searchQuery = `%${searchTerm.toLowerCase()}%`;
    
    // Нормализуем номер телефона для поиска (удаляем все нецифровые символы)
    const phoneDigits = searchTerm.replace(/\D/g, '');
    const phonePattern = phoneDigits.length >= 2 ? `%${phoneDigits}%` : null;
    
    // Формируем условия поиска
    let query = `
      SELECT id, username, email, salon_phone, created_at
      FROM users
      WHERE role = 'master'
        AND is_active = true
        AND (
          LOWER(username) LIKE $1 
          OR LOWER(COALESCE(email, '')) LIKE $1
    `;
    
    const queryParams = [searchQuery];
    let paramIndex = 2;
    
    // Добавляем поиск по телефону, если есть хотя бы 2 цифры
    if (phonePattern) {
      query += ` OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(salon_phone, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') LIKE $${paramIndex}`;
      queryParams.push(phonePattern);
      paramIndex++;
    }
    
    query += `
        )
      ORDER BY username
      LIMIT 20
    `;
    
    const result = await pool.query(query, queryParams);

    res.json({ success: true, masters: result.rows });
  } catch (error) {
    console.error('Ошибка поиска мастеров:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера', error: error.message });
  }
});

// API: Добавить мастера к салону
app.post('/api/salon/masters/:masterUserId', requireAuth, async (req, res) => {
  try {
    const idValidation = validateId(req.params.masterUserId, 'ID мастера');
    if (!idValidation.valid) {
      return res.status(400).json({ success: false, message: idValidation.message });
    }
    const masterUserId = idValidation.id;

    const user = await dbUsers.getById(req.session.userId);
    if (!user || user.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен. Только владелец салона может добавлять мастеров.' });
    }

    const masterUser = await dbUsers.getById(masterUserId);
    if (!masterUser || masterUser.role !== 'master') {
      return res.status(404).json({ success: false, message: 'Мастер не найден' });
    }

    // Проверяем, не добавлен ли уже этот мастер
    const alreadyAdded = await salonMasters.isMasterInSalon(user.id, masterUserId);
    if (alreadyAdded) {
      return res.status(409).json({ success: false, message: 'Мастер уже добавлен к вашему салону' });
    }

    // Ищем запись мастера с таким именем, если есть
    const userMasters = await masters.getByUserId(user.id);
    let masterRecord = userMasters.find(m => 
      m.name.toLowerCase() === masterUser.username.toLowerCase()
    );
    
    await salonMasters.add(user.id, masterUserId, masterRecord ? masterRecord.id : null);
    
    res.json({ success: true, message: 'Мастер успешно добавлен к салону' });
  } catch (error) {
    console.error('Ошибка добавления мастера:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Удалить мастера из салона
app.delete('/api/salon/masters/:masterUserId', requireAuth, async (req, res) => {
  try {
    const idValidation = validateId(req.params.masterUserId, 'ID мастера');
    if (!idValidation.valid) {
      return res.status(400).json({ success: false, message: idValidation.message });
    }
    const masterUserId = idValidation.id;

    const user = await dbUsers.getById(req.session.userId);
    if (!user || user.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    await salonMasters.remove(user.id, masterUserId);
    res.json({ success: true, message: 'Мастер удален из салона' });
  } catch (error) {
    console.error('Ошибка удаления мастера:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить список мастеров салона (для владельца)
app.get('/api/salon/masters', requireAuth, async (req, res) => {
  try {
    const user = await dbUsers.getById(req.session.userId);
    if (!user || user.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    const salonMastersList = await salonMasters.getBySalonId(user.id);
    res.json({ success: true, masters: salonMastersList });
  } catch (error) {
    console.error('Ошибка получения мастеров салона:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// ========== API для мастера ==========

// API: Получить список салонов мастера
app.get('/api/master/salons', requireMaster, async (req, res) => {
  try {
    const user = await dbUsers.getById(req.session.userId);
    const salons = await salonMasters.getByMasterId(user.id);
    res.json({ success: true, salons });
  } catch (error) {
    console.error('Ошибка получения салонов мастера:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить записи мастера
app.get('/api/master/bookings', requireMaster, async (req, res) => {
  try {
    const user = await dbUsers.getById(req.session.userId);
    const { date } = req.query;
    
    let masterBookings;
    if (date) {
      masterBookings = await bookings.getByMasterUserIdAndDate(user.id, date);
    } else {
      masterBookings = await bookings.getByMasterUserId(user.id);
    }

    res.json({ success: true, bookings: masterBookings });
  } catch (error) {
    console.error('Ошибка получения записей мастера:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Обновить профиль мастера
app.put('/api/master/profile', requireMaster, async (req, res) => {
  try {
    const { email, salonPhone } = req.body;
    const user = await dbUsers.getById(req.session.userId);
    
    const updateData = {};
    if (email !== undefined) {
      if (email && !validateEmail(email).valid) {
        return res.status(400).json({ success: false, message: 'Некорректный email' });
      }
      updateData.email = email ? email.trim() : '';
    }
    if (salonPhone !== undefined) {
      if (salonPhone) {
        const phoneValidation = validatePhone(salonPhone);
        if (!phoneValidation.valid) {
          return res.status(400).json({ success: false, message: phoneValidation.message });
        }
      }
      updateData.salonPhone = salonPhone ? salonPhone.trim() : null;
    }

    await dbUsers.update(user.id, updateData);
    res.json({ success: true, message: 'Профиль обновлен' });
  } catch (error) {
    console.error('Ошибка обновления профиля мастера:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Функция для проверки доступности времени (вынесена для переиспользования)
async function checkBookingAvailability(userId, date, time, endTime, master, excludeBookingId = null) {
  const existingBookings = await bookings.getByUserId(userId);
  const bookingsOnDate = existingBookings.filter(b => {
    if (b.date !== date) return false;
    if (excludeBookingId && b.id === excludeBookingId) return false;
    return true;
  });

  const requestedStart = timeToMinutes(time);
  const requestedEnd = endTime ? timeToMinutes(endTime) : (requestedStart + 60);

  if (requestedStart === null || requestedEnd === null) {
    return { available: false, message: 'Некорректный формат времени' };
  }

  for (const booking of bookingsOnDate) {
    const bookingStart = timeToMinutes(booking.time);
    const bookingEnd = booking.end_time ? timeToMinutes(booking.end_time) : (bookingStart + 60);
    
    if (bookingStart === null || bookingEnd === null) continue;

    // Если указан мастер, проверяем только записи этого мастера или без мастера
    if (master && master.trim() !== '') {
      if (booking.master && booking.master.trim() !== '' && booking.master !== master) {
        continue;
      }
    }

    if (checkTimeOverlap(requestedStart, requestedEnd, bookingStart, bookingEnd)) {
      return {
        available: false,
        message: 'Это время уже занято',
        conflictingBooking: {
          name: booking.name,
          time: booking.time,
          endTime: booking.end_time,
          master: booking.master
        }
      };
    }
  }

  return { available: true };
}

// API: Проверить доступность времени
app.post('/api/bookings/check-availability', async (req, res) => {
  try {
    const { userId, date, time, endTime, master } = req.body;
    
    if (!userId || !date || !time) {
      return res.status(400).json({ success: false, available: false, message: 'Не указаны обязательные параметры' });
    }

    const userIdInt = parseInt(userId, 10);
    const user = await dbUsers.getById(userIdInt);
    if (isNaN(userIdInt) || !user) {
      return res.status(400).json({ success: false, available: false, message: 'Некорректный ID пользователя' });
    }

    const availability = await checkBookingAvailability(userIdInt, date, time, endTime, master);
    
    if (availability.available) {
      return res.json({ success: true, available: true });
    } else {
      return res.json({ 
        success: true, 
        available: false, 
        message: availability.message,
        conflictingBooking: availability.conflictingBooking
      });
    }
  } catch (error) {
    console.error('Ошибка проверки доступности:', error);
    res.status(500).json({ success: false, available: false, message: 'Ошибка сервера при проверке доступности' });
  }
});

// API: Создать запись
app.post('/api/bookings', async (req, res) => {
  try {
    const { userId, name, phone, service, master, date, time, endTime, comment } = req.body;
    
    if (!userId || !name || !phone || !service || !date || !time) {
      return res.status(400).json({ success: false, message: 'Заполните все обязательные поля' });
    }

    // Валидация данных
    const phoneValidation = validatePhone(phone);
    if (!phoneValidation.valid) {
      return res.status(400).json({ success: false, message: phoneValidation.message });
    }

    // Проверка, что дата не в прошлом
    const bookingDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    bookingDate.setHours(0, 0, 0, 0);
    if (bookingDate < today) {
      return res.status(400).json({ success: false, message: 'Нельзя создать запись на прошедшую дату' });
    }

    const idValidation = validateId(userId, 'ID пользователя');
    if (!idValidation.valid) {
      return res.status(400).json({ success: false, message: idValidation.message });
    }
    const user = await dbUsers.getById(idValidation.id);
    if (!user) {
      return res.status(400).json({ success: false, message: 'Пользователь не найден' });
    }

    // Проверяем доступность времени перед созданием записи
    const availability = await checkBookingAvailability(idValidation.id, date, time, endTime, master);
    if (!availability.available) {
      return res.status(409).json({ 
        success: false, 
        message: availability.message + '. Пожалуйста, выберите другое время.',
        conflictingBooking: availability.conflictingBooking
      });
    }

    // ownerId - это ID владельца салона, которому принадлежит страница бронирования /booking?userId=<ownerId>
    const ownerId = idValidation.id;
    
    // Создаем запись, привязывая её к владельцу салона через user_id
    const bookingId = await bookings.create({
      userId: ownerId,
      name: sanitizeString(name, 255),
      phone: phone.trim(),
      service: sanitizeString(service, 255),
      master: master ? sanitizeString(master, 100) : '',
      date: date.trim(),
      time: time.trim(),
      endTime: endTime ? endTime.trim() : null,
      comment: comment ? sanitizeString(comment, 1000) : ''
    });

    // Отправляем уведомление ТОЛЬКО владельцу салона, которому принадлежит эта запись
    try {
      await sendTelegramNotificationToOwner(ownerId, {
        name: name.trim(),
        phone: phone.trim(),
        service: service.trim(),
        master: master ? master.trim() : '',
        date: date.trim(),
        time: time.trim(),
        endTime: endTime ? endTime.trim() : null,
        comment: comment ? comment.trim() : ''
      }, 'new');
    } catch (telegramError) {
      console.error('❌ Ошибка отправки уведомления в Telegram:', telegramError);
    }

    res.status(201).json({ success: true, booking: { id: bookingId } });
  } catch (error) {
    console.error('Ошибка создания записи:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера при создании записи' });
  }
});


// API: Получить записи пользователя (публичный доступ для конкретного пользователя)
app.get('/api/bookings/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const date = req.query.date; // Опциональный фильтр по дате
    
    if (isNaN(userId)) {
      return res.status(400).json({ success: false, bookings: [] });
    }

    const userBookings = await bookings.getByUserId(userId);
    
    // Фильтруем по дате, если указана
    let filteredBookings = userBookings;
    if (date) {
      filteredBookings = userBookings.filter(b => formatDate(b.date) === date);
    }
    
    // Преобразуем snake_case в camelCase для совместимости с фронтендом
    const formattedBookings = filteredBookings.map(formatBooking);
    
    res.json({ success: true, bookings: formattedBookings });
  } catch (error) {
    console.error('Ошибка получения записей:', error);
    res.status(500).json({ success: false, bookings: [] });
  }
});

// API: Получить записи пользователя (требует авторизации)
app.get('/api/bookings', requireAuth, async (req, res) => {
  try {
    const userBookings = await bookings.getByUserId(req.session.userId);
    // Преобразуем snake_case в camelCase для совместимости с фронтендом
    const formattedBookings = userBookings.map(formatBooking);
    res.json({ success: true, bookings: formattedBookings });
  } catch (error) {
    console.error('Ошибка получения записей:', error);
    res.status(500).json({ success: false, bookings: [] });
  }
});

// API: Обновить запись
app.put('/api/bookings/:id', requireAuth, async (req, res) => {
  try {
    const idValidation = validateId(req.params.id, 'ID записи');
    if (!idValidation.valid) {
      return res.status(400).json({ success: false, message: idValidation.message });
    }
    const bookingId = idValidation.id;
    const { name, phone, service, master, date, time, endTime, comment } = req.body;

    // Проверяем, что запись существует и принадлежит текущему пользователю
    const existingBooking = await bookings.getById(bookingId);
    if (!existingBooking) {
      return res.status(404).json({ success: false, message: 'Запись не найдена' });
    }

    if (existingBooking.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, message: 'Нет доступа к этой записи' });
    }

    // Проверка, что дата не в прошлом (если изменяется)
    if (date && date !== existingBooking.date) {
      const newBookingDate = new Date(date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      newBookingDate.setHours(0, 0, 0, 0);
      if (newBookingDate < today) {
        return res.status(400).json({ success: false, message: 'Нельзя изменить запись на прошедшую дату' });
      }
    }

    // Если изменяются дата или время, проверяем доступность
    if ((date && date !== existingBooking.date) || (time && time !== existingBooking.time)) {
      const checkDate = date || existingBooking.date;
      const checkTime = time || existingBooking.time;
      const checkEndTime = endTime || existingBooking.end_time;
      const checkMaster = master !== undefined ? master : existingBooking.master;

      const availability = await checkBookingAvailability(
        req.session.userId, 
        checkDate, 
        checkTime, 
        checkEndTime, 
        checkMaster,
        bookingId
      );
      
      if (!availability.available) {
        return res.status(409).json({
          success: false,
          message: availability.message + '. Пожалуйста, выберите другое время.'
        });
      }
    }

    // Валидация телефона, если он изменяется
    if (phone !== undefined) {
      const phoneValidation = validatePhone(phone);
      if (!phoneValidation.valid) {
        return res.status(400).json({ success: false, message: phoneValidation.message });
      }
    }

    // Обновляем запись с санитизацией
    const updateData = {};
    if (name !== undefined) updateData.name = sanitizeString(name, 255);
    if (phone !== undefined) updateData.phone = phone.trim();
    if (service !== undefined) updateData.service = sanitizeString(service, 255);
    if (master !== undefined) updateData.master = master ? sanitizeString(master, 100) : '';
    if (date !== undefined) updateData.date = date.trim();
    if (time !== undefined) updateData.time = time.trim();
    if (endTime !== undefined) updateData.endTime = endTime ? endTime.trim() : null;
    if (comment !== undefined) updateData.comment = comment ? sanitizeString(comment, 1000) : '';
    
    await bookings.update(bookingId, updateData);

    // Отправляем уведомление ТОЛЬКО владельцу салона, которому принадлежит эта запись
    // existingBooking.user_id - это ownerId владельца салона
    const ownerId = existingBooking.user_id;
    try {
      await sendTelegramNotificationToOwner(ownerId, {
        name: updateData.name || existingBooking.name,
        phone: updateData.phone || existingBooking.phone,
        service: updateData.service || existingBooking.service,
        master: updateData.master !== undefined ? updateData.master : existingBooking.master,
        date: updateData.date || existingBooking.date,
        time: updateData.time || existingBooking.time,
        endTime: updateData.endTime !== undefined ? updateData.endTime : existingBooking.end_time,
        comment: updateData.comment !== undefined ? updateData.comment : existingBooking.comment
      }, 'change');
    } catch (telegramError) {
      console.error('❌ Ошибка отправки уведомления об изменении:', telegramError);
    }

    res.json({ success: true, message: 'Запись обновлена' });
  } catch (error) {
    console.error('Ошибка обновления записи:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера при обновлении записи' });
  }
});

// API: Удалить запись
app.delete('/api/bookings/:id', requireAuth, async (req, res) => {
  try {
    const idValidation = validateId(req.params.id, 'ID записи');
    if (!idValidation.valid) {
      return res.status(400).json({ success: false, message: idValidation.message });
    }
    const bookingId = idValidation.id;

    // Проверяем, что запись существует и принадлежит текущему пользователю
    const existingBooking = await bookings.getById(bookingId);
    if (!existingBooking) {
      return res.status(404).json({ success: false, message: 'Запись не найдена' });
    }

    if (existingBooking.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, message: 'Нет доступа к этой записи' });
    }

    // existingBooking.user_id - это ownerId владельца салона
    const ownerId = existingBooking.user_id;

    await bookings.delete(bookingId);

    // Отправляем уведомление ТОЛЬКО владельцу салона, которому принадлежит эта запись
    try {
      await sendTelegramNotificationToOwner(ownerId, {
        name: existingBooking.name,
        phone: existingBooking.phone,
        service: existingBooking.service,
        master: existingBooking.master || '',
        date: existingBooking.date,
        time: existingBooking.time,
        endTime: existingBooking.end_time,
        comment: existingBooking.comment || ''
      }, 'cancellation');
    } catch (telegramError) {
      console.error('❌ Ошибка отправки уведомления об отмене:', telegramError);
    }

    res.json({ success: true, message: 'Запись удалена' });
  } catch (error) {
    console.error('Ошибка удаления записи:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера при удалении записи' });
  }
});

// API: Получить уведомления пользователя
app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const notificationsList = await notifications.getByUserId(userId, 100);
    res.json({ success: true, notifications: notificationsList });
  } catch (error) {
    console.error('Ошибка получения уведомлений:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера при получении уведомлений' });
  }
});

// API: Создать уведомление
app.post('/api/notifications', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { title, message, type = 'success', bookingId = null } = req.body;
    
    if (!title || !message) {
      return res.status(400).json({ success: false, message: 'Заголовок и сообщение обязательны' });
    }
    
    const result = await notifications.create({
      userId,
      title: sanitizeString(title, 255),
      message: sanitizeString(message, 1000),
      type: type || 'success',
      bookingId: bookingId ? parseInt(bookingId) : null
    });
    
    res.json({ success: true, notification: result });
  } catch (error) {
    console.error('Ошибка создания уведомления:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера при создании уведомления' });
  }
});

// API: Отметить уведомление как прочитанное
app.put('/api/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const idValidation = validateId(req.params.id, 'ID уведомления');
    if (!idValidation.valid) {
      return res.status(400).json({ success: false, message: idValidation.message });
    }
    
    await notifications.markAsRead(idValidation.id, userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка обновления уведомления:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера при обновлении уведомления' });
  }
});

// API: Отметить все уведомления как прочитанные
app.put('/api/notifications/read-all', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    await notifications.markAllAsRead(userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка обновления уведомлений:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера при обновлении уведомлений' });
  }
});

// API: Удалить уведомление
app.delete('/api/notifications/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const idValidation = validateId(req.params.id, 'ID уведомления');
    if (!idValidation.valid) {
      return res.status(400).json({ success: false, message: idValidation.message });
    }
    
    await notifications.remove(idValidation.id, userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка удаления уведомления:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера при удалении уведомления' });
  }
});

// API: Удалить все уведомления
app.delete('/api/notifications', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    await notifications.removeAll(userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка удаления уведомлений:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера при удалении уведомлений' });
  }
});

// API: Получить всех пользователей (только для админов)
app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const allUsers = await dbUsers.getAll();
    // Не возвращаем пароли и добавляем статистику
    const usersWithoutPasswords = await Promise.all(allUsers.map(async (u) => {
      const userServices = await services.getByUserId(u.id);
      const userMasters = await masters.getByUserId(u.id);
      return {
        id: u.id,
        username: u.username,
        email: u.email,
        role: u.role || 'user',
        isActive: u.is_active === true || u.is_active === 1,
        createdAt: u.created_at,
        servicesCount: userServices.length,
        mastersCount: userMasters.length
      };
    }));
    res.json({ success: true, users: usersWithoutPasswords });
  } catch (error) {
    console.error('Ошибка получения пользователей:', error);
    res.status(500).json({ success: false, users: [] });
  }
});

// API: Блокировать/разблокировать пользователя
app.post('/api/users/:userId/toggle', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const user = await dbUsers.getById(userId);
    
    if (!user) {
      return res.json({ success: false, message: 'Пользователь не найден' });
    }

    // Нельзя заблокировать самого себя
    if (userId === req.session.userId) {
      return res.json({ success: false, message: 'Нельзя заблокировать самого себя' });
    }

    // Нельзя заблокировать другого админа
    if (user.role === 'admin') {
      return res.json({ success: false, message: 'Нельзя заблокировать администратора' });
    }

    const currentIsActive = user.is_active === true || user.is_active === 1;
    const newIsActive = !currentIsActive;
    await dbUsers.update(userId, { isActive: newIsActive });
    res.json({ success: true, isActive: newIsActive });
  } catch (error) {
    console.error('Ошибка изменения статуса пользователя:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Войти под другим пользователем (impersonation)
app.post('/api/users/:userId/impersonate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const targetUser = await dbUsers.getById(userId);
    
    if (!targetUser) {
      return res.json({ success: false, message: 'Пользователь не найден' });
    }

    if (targetUser.is_active === false || targetUser.is_active === 0) {
      return res.json({ success: false, message: 'Пользователь заблокирован' });
    }

    // Сохраняем оригинального пользователя
    if (!req.session.originalUserId) {
      req.session.originalUserId = req.session.userId;
    }
    
    // Переключаемся на другого пользователя
    req.session.userId = userId;
    res.json({ success: true, message: `Вход выполнен под пользователем ${targetUser.username}` });
  } catch (error) {
    console.error('Ошибка impersonation:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Вернуться к своему аккаунту (из impersonation)
app.post('/api/users/restore', requireAuth, requireAdmin, (req, res) => {
  if (req.session.originalUserId && req.session.originalUserId !== req.session.userId) {
    req.session.userId = req.session.originalUserId;
    req.session.originalUserId = null;
    res.json({ success: true, message: 'Возврат к своему аккаунту выполнен' });
  } else {
    res.json({ success: false, message: 'Вы уже используете свой аккаунт' });
  }
});

// API: Удалить пользователя
app.delete('/api/users/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    
    // Нельзя удалить самого себя
    if (userId === req.session.userId) {
      return res.json({ success: false, message: 'Нельзя удалить самого себя' });
    }

    const user = await dbUsers.getById(userId);
    if (!user) {
      return res.json({ success: false, message: 'Пользователь не найден' });
    }

    // Нельзя удалить другого админа
    if (user.role === 'admin') {
      return res.json({ success: false, message: 'Нельзя удалить администратора' });
    }

    // Удаляем пользователя (каскадное удаление удалит услуги, мастеров и записи)
    await dbUsers.delete(userId);
    
    res.json({ success: true, message: 'Пользователь удален' });
  } catch (error) {
    console.error('Ошибка удаления пользователя:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить список клиентов
app.get('/api/clients', requireAuth, async (req, res) => {
  try {
    const userBookings = await bookings.getByUserId(req.session.userId);
    
    // Группируем записи по уникальной комбинации имя+телефон
    const clientsMap = new Map();
    
    userBookings.forEach(booking => {
      const key = `${booking.name.trim().toLowerCase()}_${booking.phone.trim()}`;
      
      if (!clientsMap.has(key)) {
        clientsMap.set(key, {
          name: booking.name.trim(),
          phone: booking.phone.trim(),
          bookings: [],
          totalBookings: 0,
          lastBooking: null
        });
      }
      
      const client = clientsMap.get(key);
      client.bookings.push(booking);
      client.totalBookings = client.bookings.length;
      
      // Находим последнюю запись (по дате и времени)
      if (!client.lastBooking) {
        client.lastBooking = booking;
      } else {
        const lastDate = new Date(client.lastBooking.date);
        const currentDate = new Date(booking.date);
        if (currentDate > lastDate || (currentDate.getTime() === lastDate.getTime() && booking.time > client.lastBooking.time)) {
          client.lastBooking = booking;
        }
      }
    });
    
    // Преобразуем Map в массив и форматируем
    const clients = Array.from(clientsMap.values()).map(client => ({
      name: client.name,
      phone: client.phone,
      totalBookings: client.totalBookings,
      lastBooking: client.lastBooking ? {
        date: formatDate(client.lastBooking.date),
        time: formatTime(client.lastBooking.time),
        service: client.lastBooking.service,
        master: client.lastBooking.master
      } : null
    }));
    
    // Сортируем по дате последней записи (сначала новые)
    clients.sort((a, b) => {
      if (!a.lastBooking && !b.lastBooking) return 0;
      if (!a.lastBooking) return 1;
      if (!b.lastBooking) return -1;
      const dateA = new Date(a.lastBooking.date);
      const dateB = new Date(b.lastBooking.date);
      if (dateA.getTime() !== dateB.getTime()) {
        return dateB - dateA;
      }
      return (b.lastBooking.time || '').localeCompare(a.lastBooking.time || '');
    });
    
    res.json({ success: true, clients });
  } catch (error) {
    console.error('Ошибка получения клиентов:', error);
    res.status(500).json({ success: false, clients: [] });
  }
});

// Функция для нормализации номера телефона (удаление пробелов, дефисов, скобок)
function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/[\s\-\(\)]/g, '').trim();
}

// Функция для проверки соответствия номеров телефонов
function phoneMatches(phone1, phone2) {
  if (!phone1 || !phone2) return false;
  const normalized1 = normalizePhone(phone1);
  const normalized2 = normalizePhone(phone2);
  return normalized1 === normalized2;
}

// Отправка уведомления в Telegram владельцу салона через микросервис
// salonOwnerId - ID владельца салона (ownerId), которому принадлежит запись
// Уведомление отправляется ТОЛЬКО на telegram_id этого владельца
// Изоляция гарантируется: каждый владелец получает уведомления только о своих записях
// booking.user_id всегда равен salonOwnerId, что гарантирует правильную привязку
async function sendTelegramNotificationToOwner(salonOwnerId, booking, eventType) {
  try {
    if (!salonOwnerId || typeof salonOwnerId !== 'number') {
      console.error('❌ Некорректный salonOwnerId:', salonOwnerId);
      return;
    }
    
    console.log(`🔔 Отправка Telegram уведомления владельцу салона: salonOwnerId=${salonOwnerId}, eventType=${eventType}, booking.user_id должен быть=${salonOwnerId}`);
    
    const salonOwner = await dbUsers.getById(salonOwnerId);
    if (!salonOwner) {
      console.log(`❌ Владелец салона не найден: salonOwnerId=${salonOwnerId}`);
      return;
    }

    console.log(`📋 Информация о владельце: userId=${salonOwner.id}, salon_phone=${salonOwner.salon_phone || 'не указан'}`);

    if (!salonOwner.salon_phone) {
      console.log(`ℹ️ У владельца салона не указан номер телефона: salonOwnerId=${salonOwnerId}. Номер телефона обязателен для отправки уведомлений.`);
      return;
    }

    // Загружаем настройки Telegram для проверки включенных уведомлений
    let telegramSettings = {};
    if (salonOwner.telegram_settings) {
      try {
        telegramSettings = typeof salonOwner.telegram_settings === 'string' 
          ? JSON.parse(salonOwner.telegram_settings) 
          : salonOwner.telegram_settings;
      } catch (e) {
        console.error('❌ Ошибка парсинга telegram_settings:', e);
        telegramSettings = {};
      }
    }

    // Проверяем, включены ли уведомления
    if (telegramSettings.enabled === false) {
      console.log('ℹ️ Уведомления Telegram отключены в настройках');
      return;
    }

    // Проверяем тип события
    if (eventType === 'new') {
      if (telegramSettings.notifyNewBookings === false) {
        console.log('ℹ️ Уведомления о новых записях отключены');
        return;
      }
    } else if (eventType === 'cancellation' && !telegramSettings.notifyCancellations) {
      console.log('ℹ️ Уведомления об отменах отключены');
      return;
    } else if (eventType === 'change' && !telegramSettings.notifyChanges) {
      console.log('ℹ️ Уведомления об изменениях отключены');
      return;
    }

    // Отправляем уведомление через микросервис Telegram бота
    console.log(`📤 Вызов микросервиса Telegram бота для отправки уведомления: salonOwnerId=${salonOwnerId}, eventType=${eventType}`);
    try {
      const telegramBotUrl = process.env.TELEGRAM_BOT_URL || 'http://telegram-bot:3001';
      
      // Определяем эндпоинт в зависимости от типа события
      let endpoint = '/api/notify/booking';
      if (eventType === 'cancellation') {
        endpoint = '/api/notify/cancellation';
      } else if (eventType === 'change') {
        // Для изменений используем тот же эндпоинт, что и для новых записей
        endpoint = '/api/notify/booking';
      }
      
      console.log(`🔗 URL микросервиса: ${telegramBotUrl}${endpoint}`);
      console.log(`📋 Данные для отправки: salon_phone=${salonOwner.salon_phone}, booking_data=${JSON.stringify(booking)}`);
      
      const response = await callTelegramBotApi(endpoint, {
        method: 'POST',
        body: {
          salon_phone: salonOwner.salon_phone,
          booking_data: {
            client_name: booking.name,
            name: booking.name,
            phone: booking.phone,
            client_phone: booking.phone,
            service: booking.service,
            master: booking.master || '',
            date: booking.date,
            time: booking.time,
            end_time: booking.endTime || null,
            comment: booking.comment || ''
          }
        }
      });

      console.log(`📥 Ответ микросервиса: status=${response.status}, success=${response.data.success}, message=${response.data.message || response.data.error || 'нет'}`);

      if (response.status !== 200 || !response.data.success) {
        const errorMsg = response.data.message || response.data.error || `HTTP ${response.status}`;
        console.error(`❌ Ошибка отправки уведомления: ${errorMsg}`);
        throw new Error(errorMsg);
      }
      
      console.log(`✅ Микросервис успешно обработал запрос на отправку уведомления`);
    } catch (error) {
      // Логируем ошибку, но не пробрасываем дальше, чтобы не прерывать основной процесс
      console.error('❌ Ошибка вызова микросервиса Telegram бота:', error.message);
      console.error('  Stack:', error.stack);
      throw error; // Пробрасываем для логирования в catch блоке выше
    }

    console.log(`✅ Уведомление отправлено владельцу салона: salonOwnerId=${salonOwnerId}, salon_phone=${salonOwner.salon_phone}, salonUrl=/booking?userId=${salonOwnerId}`);
  } catch (error) {
    console.error('❌ Ошибка отправки уведомления владельцу салона:', error);
    console.error('  Stack:', error.stack);
  }
}

// Функция для отправки сообщения в Telegram
function sendTelegramMessage(botToken, chatId, message) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://api.telegram.org/bot${botToken}/sendMessage`);
    const postData = JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML'
    });
    
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          
          if (res.statusCode !== 200 || !jsonData.ok) {
            reject(new Error(jsonData.description || 'Ошибка отправки сообщения в Telegram'));
            return;
          }
          
          resolve({ success: true, data: jsonData });
        } catch (error) {
          reject(new Error('Ошибка парсинга ответа от Telegram API'));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.write(postData);
    req.end();
  });
}

// API: Получить настройки Telegram (только для админов)
app.get('/api/telegram/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const user = await dbUsers.getById(req.session.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }
    
    let telegramSettings = {};
    if (user.telegram_settings) {
      try {
        telegramSettings = typeof user.telegram_settings === 'string' 
          ? JSON.parse(user.telegram_settings) 
          : user.telegram_settings;
      } catch (e) {
        console.error('Ошибка парсинга telegram_settings:', e);
        telegramSettings = {};
      }
    }
    
    // Получаем токен бота (из БД админа или из env)
    let botToken = null;
    let hasBotToken = false;
    try {
      botToken = await getTelegramBotToken();
      hasBotToken = !!botToken;
    } catch (error) {
      console.error('Ошибка получения токена бота:', error);
    }
    
    // Проверяем, есть ли токен в БД у текущего пользователя (если он админ)
    let botTokenInDb = false;
    let botTokenLength = 0;
    if (user.bot_token && user.bot_token.trim()) {
      botTokenInDb = true;
      botTokenLength = user.bot_token.trim().length;
    }
    
    // Возвращаем токен только для админа (для отображения в UI)
    // В целях безопасности возвращаем только если он есть в БД
    let botTokenForUI = null;
    if (user.bot_token && user.bot_token.trim()) {
      // Возвращаем токен для отображения в поле (только для админа)
      botTokenForUI = user.bot_token.trim();
    }
    
    // Проверяем статус подключения: если есть номер телефона, пытаемся синхронизировать с ботом
    let telegramId = user.telegram_id;
    if (!telegramId && user.salon_phone) {
      try {
        // Нормализуем телефон для сравнения (убираем все нецифровые символы)
        const normalizePhoneForCompare = (phone) => (phone || '').replace(/\D/g, '').replace(/^8/, '7').replace(/^\+/, '');
        const userPhoneNormalized = normalizePhoneForCompare(user.salon_phone);
        
        // Пытаемся получить список владельцев из бота
        const ownersResponse = await callTelegramBotApi('/api/owners', {
          method: 'GET'
        });
        
        if (ownersResponse.status === 200 && ownersResponse.data?.success && Array.isArray(ownersResponse.data.owners)) {
          // Ищем владельца по нормализованному телефону
          const ownerInBot = ownersResponse.data.owners.find(o => {
            const botPhoneNormalized = normalizePhoneForCompare(o.phone || '');
            return botPhoneNormalized && userPhoneNormalized && botPhoneNormalized === userPhoneNormalized;
          });
          
          if (ownerInBot && ownerInBot.telegram_id) {
            // Синхронизируем telegram_id с основной базой
            await dbUsers.update(user.id, { telegramId: ownerInBot.telegram_id });
            telegramId = ownerInBot.telegram_id;
            console.log(`✅ Синхронизирован telegram_id из бота: userId=${user.id}, telegramId=${telegramId}, phone=${user.salon_phone}`);
          }
        }
      } catch (syncError) {
        // Игнорируем ошибки синхронизации - это не критично
        console.log('ℹ️ Не удалось синхронизировать статус с ботом:', syncError.message);
      }
    }
    
    console.log('📋 Получение настроек Telegram:', {
      userId: req.session.userId,
      botTokenInDb: botTokenInDb,
      botTokenLength: botTokenLength,
      hasBotTokenFromFunction: hasBotToken,
      botTokenForUI: botTokenForUI ? `[${botTokenForUI.length} символов]` : 'не указан',
      telegramId: telegramId || 'не установлен',
      salonPhone: user.salon_phone || 'не указан'
    });
    
    res.json({ 
      success: true, 
      settings: {
        enabled: telegramSettings.enabled !== false,
        notifyNewBookings: telegramSettings.notifyNewBookings !== false,
        notifyCancellations: telegramSettings.notifyCancellations === true,
        notifyChanges: telegramSettings.notifyChanges === true
      },
      telegramId: telegramId || null,
      hasBotToken: hasBotToken,
      botTokenConfigured: botTokenInDb || hasBotToken,
      botTokenInDb: botTokenInDb,
      botTokenLength: botTokenLength,
      botToken: botTokenForUI // Возвращаем токен для заполнения поля
    });
  } catch (error) {
    console.error('Ошибка получения настроек Telegram:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить владельца по телефону (для Telegram бота)
app.get('/api/owners/by-phone/:phone', async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    
    console.log(`🔍 Поиск владельца по телефону: "${phone}"`);
    
    if (!phone || !phone.trim()) {
      return res.status(400).json({ 
        success: false, 
        error: 'Номер телефона не указан' 
      });
    }

    const user = await dbUsers.getByPhone(phone);
    
    if (!user) {
      console.log(`❌ Владелец с телефоном "${phone}" не найден в базе данных`);
      
      // Для диагностики: проверим, есть ли вообще пользователи с телефонами
      const allUsers = await dbUsers.getAll();
      const usersWithPhones = allUsers.filter(u => u.salon_phone).map(u => ({
        id: u.id,
        username: u.username,
        phone: u.salon_phone
      }));
      console.log(`ℹ️ Всего пользователей с телефонами: ${usersWithPhones.length}`);
      if (usersWithPhones.length > 0 && usersWithPhones.length <= 10) {
        console.log(`   Телефоны в БД: ${JSON.stringify(usersWithPhones)}`);
      }
      
      return res.status(404).json({ 
        success: false, 
        error: 'Владелец с таким номером телефона не найден' 
      });
    }

    console.log(`✅ Владелец найден: id=${user.id}, username=${user.username}, phone=${user.salon_phone}`);
    
    res.json({
      success: true,
      owner: {
        id: user.id,
        username: user.username,
        name: user.username, // Для обратной совместимости
        salon_name: user.salon_name || 'Салон',
        salon_phone: user.salon_phone
      }
    });
  } catch (error) {
    console.error('❌ Ошибка поиска владельца по телефону:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Внутренняя ошибка сервера' 
    });
  }
});

// API: Получить токен бота для внутреннего использования (только для микросервиса бота)
app.get('/api/telegram/bot-token', async (req, res) => {
  try {
    // Простая проверка через заголовок для безопасности
    // Если заголовок передан, проверяем его; если нет - разрешаем (внутренняя сеть Docker)
    const internalSecret = req.headers['x-internal-secret'];
    const expectedSecret = process.env.TELEGRAM_BOT_INTERNAL_SECRET || 'default-internal-secret-change-in-production';
    if (internalSecret && internalSecret !== expectedSecret) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const token = await getTelegramBotToken();
    if (!token) {
      return res.status(404).json({ success: false, error: 'Bot token not found' });
    }

    res.json({ success: true, token });
  } catch (error) {
    console.error('Ошибка получения токена бота:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// API: Сохранить настройки Telegram (только для админов)
app.post('/api/telegram/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled, notifyNewBookings, notifyCancellations, notifyChanges, botToken } = req.body;
    
    const user = await dbUsers.getById(req.session.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }
    
    // Загружаем существующие настройки, чтобы сохранить только флаги уведомлений
    let existingSettings = {};
    if (user.telegram_settings) {
      try {
        existingSettings = typeof user.telegram_settings === 'string' 
          ? JSON.parse(user.telegram_settings) 
          : user.telegram_settings;
      } catch (e) {
        console.error('Ошибка парсинга telegram_settings:', e);
      }
    }
    
    const settings = {
      enabled: enabled === true,
      notifyNewBookings: notifyNewBookings !== false,
      notifyCancellations: notifyCancellations === true,
      notifyChanges: notifyChanges === true
    };
    
    console.log('💾 Сохранение настроек Telegram:', {
      userId: req.session.userId,
      enabled: settings.enabled,
      notifyNewBookings: settings.notifyNewBookings,
      notifyCancellations: settings.notifyCancellations,
      notifyChanges: settings.notifyChanges,
      botTokenProvided: botToken !== undefined,
      botTokenValue: botToken ? `[${botToken.length} символов]` : 'не указан'
    });
    
    // Сохраняем настройки в БД через метод users.update
    const DB_TYPE = process.env.DB_TYPE || 'sqlite';
    
    if (DB_TYPE === 'postgres') {
      try {
        const updateData = { telegramSettings: settings };
        
        // Сохраняем bot token только если он передан (только для админа)
        if (botToken !== undefined) {
          if (botToken && botToken.trim()) {
            const trimmedToken = botToken.trim();
            updateData.botToken = trimmedToken;
            console.log('💾 Сохранение bot token для админа (длина:', trimmedToken.length, 'символов)');
          } else {
            // Если передан пустой токен, удаляем его
            updateData.botToken = null;
            console.log('💾 Удаление bot token');
          }
        } else {
          console.log('ℹ️ botToken не передан в запросе, оставляем текущее значение');
        }
        
        await dbUsers.update(req.session.userId, updateData);
        
        // Сбрасываем кэш токена при сохранении нового токена
        if (botToken !== undefined) {
          clearBotTokenCache();
          console.log('🔄 Кэш токена бота сброшен');
        }
        
        console.log('✅ Настройки Telegram сохранены для пользователя', req.session.userId);
      } catch (updateError) {
        console.error('❌ Ошибка сохранения настроек Telegram:', updateError);
        console.error('  Stack:', updateError.stack);
        return res.status(500).json({ success: false, message: 'Ошибка сохранения настроек в базе данных: ' + updateError.message });
      }
    } else {
      // Для SQLite (если используется)
      return res.status(500).json({ success: false, message: 'Telegram интеграция доступна только с PostgreSQL' });
    }
    
    res.json({ success: true, message: 'Настройки сохранены' });
  } catch (error) {
    console.error('Ошибка сохранения настроек Telegram:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Функция для вызова API микросервиса Telegram бота
async function callTelegramBotApi(endpoint, options = {}) {
  // Используем имя сервиса из docker-compose, а не имя контейнера
  const telegramBotUrl = process.env.TELEGRAM_BOT_URL || 'http://telegram-bot:3001';
  const url = `${telegramBotUrl}${endpoint}`;
  
  return new Promise((resolve, reject) => {
    try {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? https : http;
      
      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        timeout: 10000
      };
      
      const req = httpModule.request(requestOptions, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          // Проверяем Content-Type
          const contentType = res.headers['content-type'] || '';
          
          if (!contentType.includes('application/json')) {
            // Если получен не JSON (например, HTML страница с ошибкой)
            console.error(`❌ Микросервис вернул не JSON (Content-Type: ${contentType})`);
            console.error(`   URL: ${url}, Status: ${res.statusCode}`);
            console.error(`   Ответ: ${data.substring(0, 500)}`);
            
            return resolve({ 
              status: res.statusCode, 
              data: { 
                success: false, 
                message: `Микросервис Telegram бота недоступен или вернул некорректный ответ. Убедитесь, что контейнер telegram-bot запущен.` 
              } 
            });
          }
          
          try {
            const jsonData = JSON.parse(data);
            resolve({ status: res.statusCode, data: jsonData });
          } catch (error) {
            // Если не удалось распарсить JSON, возвращаем сырой ответ
            console.error(`❌ Ошибка парсинга JSON ответа от микросервиса: ${error.message}`);
            console.error(`   Ответ: ${data.substring(0, 500)}`);
            resolve({ 
              status: res.statusCode, 
              data: { 
                success: false, 
                message: `Ошибка парсинга ответа от микросервиса: ${data.substring(0, 200)}` 
              } 
            });
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('❌ Ошибка соединения с микросервисом Telegram бота:', error.message);
        console.error(`   URL: ${url}`);
        reject(new Error(`Микросервис Telegram бота недоступен: ${error.message}. Убедитесь, что контейнер telegram-bot запущен.`));
      });
      
      req.on('timeout', () => {
        req.destroy();
        console.error(`❌ Таймаут при обращении к микросервису Telegram бота: ${url}`);
        reject(new Error('Таймаут при обращении к микросервису Telegram бота. Проверьте, что контейнер telegram-bot запущен и доступен.'));
      });
      
      req.setTimeout(10000);
      
      if (options.body) {
        try {
          req.write(JSON.stringify(options.body));
        } catch (error) {
          req.destroy();
          reject(new Error(`Ошибка сериализации тела запроса: ${error.message}`));
          return;
        }
      }
      
      req.end();
    } catch (error) {
      reject(new Error(`Ошибка создания запроса: ${error.message}`));
    }
  });
}

// Функция для отправки сообщения ботом с кнопкой request_contact
async function sendTelegramMessageWithContactButton(chatId, message) {
  const botToken = await getTelegramBotToken();
  if (!botToken) {
    throw new Error('Токен Telegram бота не настроен');
  }
  
  return new Promise((resolve, reject) => {
    const url = new URL(`https://api.telegram.org/bot${botToken}/sendMessage`);
    const postData = JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      reply_markup: {
        keyboard: [[{
          text: '📱 Отправить контакт',
          request_contact: true
        }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          
          if (res.statusCode !== 200 || !jsonData.ok) {
            reject(new Error(jsonData.description || 'Ошибка отправки сообщения в Telegram'));
            return;
          }
          
          resolve({ success: true, data: jsonData });
        } catch (error) {
          reject(new Error('Ошибка парсинга ответа от Telegram API'));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.write(postData);
    req.end();
  });
}

// Функция для получения информации о боте
async function getBotInfo() {
  const botToken = await getTelegramBotToken();
  if (!botToken) {
    throw new Error('Токен бота не найден');
  }
  
  return new Promise((resolve, reject) => {
    const url = new URL(`https://api.telegram.org/bot${botToken}/getMe`);
    
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'GET',
      timeout: 10000
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          
          if (res.statusCode !== 200 || !jsonData.ok) {
            const errorMsg = jsonData.description || 'Ошибка получения информации о боте';
            reject(new Error(errorMsg));
            return;
          }
          
          resolve(jsonData.result);
        } catch (error) {
          reject(new Error('Ошибка парсинга ответа от Telegram API: ' + error.message));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(new Error('Ошибка соединения с Telegram API: ' + error.message));
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Таймаут при обращении к Telegram API'));
    });
    
    req.setTimeout(10000);
    req.end();
  });
}

// API: Получить ссылку на бота для подключения
app.get('/api/telegram/connect-link', requireAuth, async (req, res) => {
  try {
    const response = await callTelegramBotApi('/api/bot/info');
    
    if (response.status !== 200 || !response.data.success) {
      const errorMessage = response.data.message || 'Не удалось получить информацию о боте. Проверьте правильность токена.';
      console.error('❌ Ошибка получения информации о боте:', errorMessage);
      return res.status(response.status >= 500 ? 503 : 400).json({ 
        success: false, 
        message: errorMessage
      });
    }
    
    const botInfo = response.data.botInfo;
    if (!botInfo || !botInfo.username) {
      return res.status(400).json({ 
        success: false, 
        message: 'Не удалось получить информацию о боте. Проверьте правильность токена.' 
      });
    }
    
    res.json({ 
      success: true, 
      botUsername: botInfo.username,
      botName: botInfo.first_name
    });
  } catch (error) {
    console.error('❌ Неожиданная ошибка в /api/telegram/connect-link:', error.message);
    
    // Проверяем, не связано ли это с недоступностью микросервиса
    if (error.message.includes('недоступен') || error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
      return res.status(503).json({ 
        success: false, 
        message: 'Микросервис Telegram бота недоступен. Убедитесь, что контейнер telegram-bot запущен: docker-compose ps telegram-bot'
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Внутренняя ошибка сервера: ' + error.message
    });
  }
});

// Тестовый эндпоинт для проверки доступности webhook
app.get('/api/telegram/webhook', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Webhook endpoint доступен',
    timestamp: new Date().toISOString()
  });
});

// Вебхук для обработки сообщений от Telegram бота (проксирование в микросервис)
app.post('/api/telegram/webhook', express.json(), async (req, res) => {
  try {
    console.log('📨 Получен webhook запрос от Telegram на основном сервере');
    console.log('   Headers:', JSON.stringify(req.headers, null, 2));
    console.log('   Body:', JSON.stringify(req.body, null, 2));
    
    const response = await callTelegramBotApi('/api/bot/webhook', {
      method: 'POST',
      body: req.body
    });
    
    console.log(`✅ Webhook проксирован в микросервис: status=${response.status}`);
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error('❌ Ошибка проксирования вебхука в микросервис Telegram бота:', error);
    console.error('   Stack:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Привязать Telegram аккаунт (для Telegram бота) - DEPRECATED, используется вебхук
app.post('/api/telegram/link', async (req, res) => {
  try {
    const { telegramId, phone, contactUserId } = req.body;
    
    if (!telegramId || !phone) {
      return res.status(400).json({ success: false, message: 'telegramId и phone обязательны' });
    }

    const telegramIdNum = parseInt(telegramId, 10);
    if (isNaN(telegramIdNum) || telegramIdNum <= 0) {
      return res.status(400).json({ success: false, message: 'Некорректный telegramId' });
    }

    // Валидация: contactUserId должен совпадать с telegramId (защита от подмены)
    if (contactUserId) {
      const contactUserIdNum = parseInt(contactUserId, 10);
      if (contactUserIdNum !== telegramIdNum) {
        return res.status(403).json({ success: false, message: 'Несоответствие идентификаторов Telegram' });
      }
    }

    // Нормализуем номер телефона в E.164
    const normalizedPhone = normalizeToE164(phone);
    
    // Ищем пользователя по номеру телефона
    const user = await dbUsers.getByPhone(normalizedPhone);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Пользователь с таким номером телефона не найден' });
    }

    // Проверяем, что telegram_id еще не занят другим пользователем
    const existingUser = await dbUsers.getByTelegramId(telegramIdNum);
    if (existingUser && existingUser.id !== user.id) {
      return res.status(409).json({ success: false, message: 'Этот Telegram аккаунт уже привязан к другому пользователю' });
    }

    // Обновляем telegram_id
    await dbUsers.update(user.id, { telegramId: telegramIdNum });
    
    console.log(`✅ Telegram аккаунт привязан: userId=${user.id}, telegramId=${telegramIdNum}, phone=${normalizedPhone}`);
    
    res.json({ 
      success: true, 
      message: 'Telegram аккаунт успешно привязан',
      userId: user.id,
      username: user.username
    });
  } catch (error) {
    console.error('Ошибка привязки Telegram аккаунта:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера при привязке аккаунта' });
  }
});

// API: Отвязать Telegram аккаунт
app.post('/api/telegram/unlink', requireAuth, async (req, res) => {
  try {
    await dbUsers.update(req.session.userId, { telegramId: null });
    console.log(`✅ Telegram аккаунт отвязан: userId=${req.session.userId}`);
    res.json({ success: true, message: 'Telegram аккаунт отвязан' });
  } catch (error) {
    console.error('Ошибка отвязки Telegram аккаунта:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('Ошибка:', err);
  // Проверяем, является ли это API запросом
  if (req.path && req.path.startsWith('/api/')) {
    res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
  } else {
    res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
  }
});

// 404 обработчик
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Страница не найдена' });
});

// Инициализация БД, миграция и демо-аккаунта, затем запуск сервера
(async () => {
  try {
    // Инициализируем БД (создание таблиц)
    await initDatabase();
    console.log('База данных инициализирована');
    
    // Миграция данных из JSON (если нужно)
    await migrateFromJSON();
    
    // Создаем демо-аккаунт
    await initDemoAccount();
    
    // Запускаем сервер
    if (USE_HTTPS && httpsOptions) {
      // Запускаем HTTPS сервер
      const httpsServer = https.createServer(httpsOptions, app);
      httpsServer.listen(HTTPS_PORT, () => {
        console.log(`🔒 HTTPS сервер запущен на https://localhost:${HTTPS_PORT}`);
        console.log(`Окружение: ${process.env.NODE_ENV || 'development'}`);
        console.log(`База данных: ${process.env.DB_TYPE || 'SQLite'}`);
        console.log('');
        console.log('Доступные страницы (HTTPS):');
        console.log(`  Главная: https://localhost:${HTTPS_PORT}/`);
        console.log(`  Вход: https://localhost:${HTTPS_PORT}/login`);
        console.log(`  Регистрация: https://localhost:${HTTPS_PORT}/register`);
        console.log('');
        console.log('Демо-аккаунт:');
        console.log('  Логин: admin');
        console.log('  Пароль: admin123');
        console.log('');
        
        // Если включен FORCE_HTTPS, запускаем HTTP сервер только для редиректа
        if (FORCE_HTTPS) {
          const httpServer = http.createServer((req, res) => {
            const host = req.headers.host || 'localhost';
            const httpsUrl = `https://${host.replace(/:\d+$/, '')}:${HTTPS_PORT}${req.url}`;
            res.writeHead(301, { 'Location': httpsUrl });
            res.end();
          });
          httpServer.listen(PORT, () => {
            console.log(`↪️  HTTP редирект запущен на http://localhost:${PORT} (редирект на HTTPS)`);
          });
        }
      });
    } else {
      // Запускаем обычный HTTP сервер
      app.listen(PORT, () => {
        console.log(`Сервер запущен на http://localhost:${PORT}`);
        if (USE_HTTPS) {
          console.log('⚠️  HTTPS включен, но сертификаты не найдены. Используется HTTP.');
        }
        console.log(`Окружение: ${process.env.NODE_ENV || 'development'}`);
        console.log(`База данных: ${process.env.DB_TYPE || 'SQLite'}`);
        console.log('');
        console.log('Доступные страницы:');
        console.log(`  Главная: http://localhost:${PORT}/`);
        console.log(`  Вход: http://localhost:${PORT}/login`);
        console.log(`  Регистрация: http://localhost:${PORT}/register`);
        console.log('');
        console.log('Демо-аккаунт:');
        console.log('  Логин: admin');
        console.log('  Пароль: admin123');
        console.log('');
      });
    }
  } catch (error) {
    console.error('Ошибка инициализации:', error);
    process.exit(1);
  }
})();