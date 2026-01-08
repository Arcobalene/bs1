const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy для работы за nginx (важно для правильной работы cookies и HTTPS)
app.set('trust proxy', 1);

// Middleware
// Парсим JSON только для не-API запросов, чтобы body мог быть передан через прокси
app.use((req, res, next) => {
  // Для API запросов не парсим body здесь - прокси сделает это
  if (req.path.startsWith('/api/')) {
    return next();
  }
  express.json({ limit: '10mb' })(req, res, next);
});

app.use((req, res, next) => {
  // Для API запросов не парсим urlencoded здесь
  if (req.path.startsWith('/api/')) {
    return next();
  }
  express.urlencoded({ extended: true, limit: '10mb' })(req, res, next);
});

// Используем cookie-parser БЕЗ секрета, так как express-session не использует подписанные cookies
// Express-session сам управляет cookies и не требует подписи от cookie-parser
app.use(cookieParser());

// Логирование всех входящих запросов для отладки
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[Gateway] Входящий запрос: ${req.method} ${req.path}`);
    // Логируем информацию о сессии для отладки
    if (req.session && req.session.userId) {
      console.log(`[Gateway] Сессия gateway: userId=${req.session.userId}`);
    }
  }
  next();
});

// Настройка сессий (важно: имя cookie должно совпадать с оригинальным)
const isHttps = process.env.NODE_ENV === 'production' || process.env.BEHIND_HTTPS_PROXY === 'true';
const cookieSecure = isHttps;

// Настройка Redis для хранения сессий
let sessionStore = null;
let redisClient = null;

// Инициализируем Redis и ждем подключения перед запуском сервера
async function initRedis() {
  try {
    console.log('[Gateway] Инициализация Redis для хранения сессий...');
    redisClient = createClient({
      socket: {
        host: process.env.REDIS_HOST || 'redis',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        reconnectStrategy: (retries) => {
          // Стратегия переподключения: ждем до 3 секунд между попытками
          if (retries > 10) {
            console.log('[Gateway] Превышено количество попыток подключения к Redis, используем MemoryStore');
            return false; // Прекращаем попытки
          }
          return Math.min(retries * 100, 3000);
        }
      },
      password: process.env.REDIS_PASSWORD || undefined,
    });

    redisClient.on('error', (err) => {
      console.error('[Gateway] Ошибка Redis:', err.message);
    });

    redisClient.on('connect', () => {
      console.log('[Gateway] Redis подключен');
    });

    redisClient.on('ready', () => {
      console.log('[Gateway] Redis готов к работе');
    });

    // Пытаемся подключиться с таймаутом 5 секунд
    await Promise.race([
      redisClient.connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis connection timeout')), 5000)
      )
    ]);

    // Создаем store после успешного подключения
    sessionStore = new RedisStore({
      client: redisClient,
      prefix: 'beauty-studio:session:',
    });
    console.log('[Gateway] Redis session store инициализирован');
    return true;
  } catch (error) {
    console.error('[Gateway] Ошибка подключения к Redis:', error.message);
    console.log('[Gateway] Использование MemoryStore для сессий (не рекомендуется для production)');
    sessionStore = null;
    return false;
  }
}

// Инициализируем приложение после подключения к Redis
async function initApp() {
  // Инициализируем Redis
  const redisAvailable = await initRedis();
  
  // Настраиваем express-session с правильным store
  app.use(session({
    store: sessionStore || undefined, // Используем Redis store, если доступен
  secret: process.env.SESSION_SECRET || 'beauty-studio-secret-key-change-in-production',
  resave: false, // Не сохранять сессию, если она не была изменена
  saveUninitialized: false,
  name: 'beauty.studio.sid', // Имя cookie должно совпадать с оригинальным
  rolling: false, // Не обновлять cookie при каждом запросе (только при изменении)
  cookie: {
    secure: cookieSecure,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 часа
    sameSite: 'lax',
    path: '/',
    // Не устанавливаем domain, чтобы cookie работал на всех поддоменах
    // domain: undefined
  }
}));

// Middleware для логирования состояния сессии
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    // Логируем состояние сессии перед обработкой запроса
    if (req.session) {
      // Проверяем как обычный cookie, так и подписанный
      const regularCookie = req.cookies && req.cookies['beauty.studio.sid'] ? req.cookies['beauty.studio.sid'] : null;
      const signedCookie = req.signedCookies && req.signedCookies['beauty.studio.sid'] ? req.signedCookies['beauty.studio.sid'] : null;
      const cookieValue = regularCookie || signedCookie || 'нет';
      const cookieType = regularCookie ? 'regular' : (signedCookie ? 'signed' : 'none');
      console.log(`[Gateway] Сессия перед запросом ${req.path}: userId=${req.session.userId || 'нет'}, sessionID=${req.sessionID || 'нет'}, cookie=${cookieValue.substring(0, 20)}... (${cookieType})`);
    } else {
      console.log(`[Gateway] Нет сессии для запроса ${req.path}`);
    }
  }
  next();
});

// Middleware для автоматического сохранения сессии при изменении
app.use((req, res, next) => {
  // Сохраняем сессию после отправки ответа, если она была изменена
  const originalEnd = res.end.bind(res);
  res.end = function(...args) {
    // Сохраняем сессию только если она была изменена или содержит userId
    if (req.session) {
      // Если есть userId, обновляем время жизни и сохраняем
      if (req.session.userId) {
        req.session.touch();
        req.session.save((err) => {
          if (err) {
            console.error(`[Gateway] Ошибка сохранения сессии после запроса ${req.path}:`, err.message);
          } else {
            // Логируем только для API запросов, чтобы не засорять логи
            if (req.path.startsWith('/api/')) {
              console.log(`[Gateway] Сессия сохранена для userId=${req.session.userId} после запроса ${req.path}, sessionID=${req.sessionID}`);
            }
          }
        });
      } else if (req.session._modified) {
        // Если сессия была изменена, но нет userId, все равно сохраняем
        req.session.save((err) => {
          if (err) {
            console.error(`[Gateway] Ошибка сохранения измененной сессии после запроса ${req.path}:`, err.message);
          }
        });
      }
    }
    return originalEnd(...args);
  };
  next();
});

// Middleware для синхронизации сессии gateway с user-service
// Если есть cookie сессии, но нет userId в сессии gateway, запрашиваем /api/user у user-service
app.use(async (req, res, next) => {
  // Если есть cookie сессии, но нет userId в сессии gateway, синхронизируем
  if (req.cookies && req.cookies['beauty.studio.sid'] && !req.session.userId && req.path.startsWith('/api/')) {
    // Пропускаем запросы логина/регистрации, чтобы избежать циклических запросов
    if (!req.path.includes('/login') && !req.path.includes('/register')) {
      console.log(`[Gateway] Попытка синхронизации сессии для ${req.path}`);
      try {
        const http = require('http');
        const url = require('url');
        const userServiceUrl = url.parse(services.user);
        const cookieHeader = req.headers.cookie || '';
        
        const options = {
          hostname: userServiceUrl.hostname,
          port: userServiceUrl.port || 3002,
          path: '/api/user',
          method: 'GET',
          headers: {
            'Cookie': cookieHeader
          },
          timeout: 5000 // Увеличенный таймаут для надежности синхронизации
        };
        
        await new Promise((resolve) => {
          const userReq = http.request(options, (userRes) => {
            let data = '';
            userRes.on('data', (chunk) => { data += chunk; });
            userRes.on('end', async () => {
              try {
                // Проверяем статус ответа
                if (userRes.statusCode !== 200) {
                  console.log(`[Gateway] Неверный статус при синхронизации: ${userRes.statusCode}`);
                  console.log(`[Gateway] Тело ответа: ${data.substring(0, 200)}`);
                  resolve();
                  return;
                }
                
                // Проверяем Content-Type перед парсингом
                const contentType = userRes.headers['content-type'] || '';
                if (!contentType.includes('application/json')) {
                  console.log(`[Gateway] Неверный Content-Type при синхронизации: ${contentType}, данные: ${data.substring(0, 200)}`);
                  resolve();
                  return;
                }
                
                const result = JSON.parse(data);
                if (result.success && result.user && result.user.id) {
                  // Синхронизируем сессию gateway
                  req.session.userId = result.user.id;
                  req.session.originalUserId = result.user.id;
                  req.session.touch(); // Обновляем время жизни сессии
                  
                  // Сохраняем сессию с ожиданием завершения
                  await new Promise((saveResolve) => {
                    req.session.save((err) => {
                      if (err) {
                        console.error(`[Gateway] Ошибка сохранения сессии при синхронизации: ${err.message}`);
                      } else {
                        console.log(`[Gateway] Сессия синхронизирована: userId=${result.user.id}`);
                      }
                      saveResolve();
                    });
                  });
                } else {
                  console.log(`[Gateway] Не удалось синхронизировать сессию: success=${result.success}, user=${result.user ? 'есть' : 'нет'}`);
                  if (result.message) {
                    console.log(`[Gateway] Сообщение об ошибке: ${result.message}`);
                  }
                  console.log(`[Gateway] Полный ответ: ${JSON.stringify(result).substring(0, 300)}`);
                }
              } catch (e) {
                console.log(`[Gateway] Ошибка парсинга ответа при синхронизации: ${e.message}`);
                console.log(`[Gateway] Ответ сервера: ${data.substring(0, 200)}`);
              }
              resolve();
            });
          });
          
          userReq.on('error', (err) => {
            console.log(`[Gateway] Ошибка запроса при синхронизации: ${err.message}`);
            resolve(); // Продолжаем даже при ошибке
          });
          
          userReq.on('timeout', () => {
            console.log(`[Gateway] Таймаут при синхронизации сессии`);
            userReq.destroy();
            resolve(); // Продолжаем даже при таймауте
          });
          
          userReq.end();
        });
      } catch (e) {
        console.log(`[Gateway] Исключение при синхронизации: ${e.message}`);
        // Игнорируем ошибки и продолжаем
      }
    }
  }
  
  next();
});

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
    console.log(`[Gateway] Сессия gateway: userId=${req.session?.userId || 'нет'}, cookies=${req.cookies ? Object.keys(req.cookies).join(', ') : 'нет'}`);
    
    // Передаем cookies от клиента к сервису
    if (req.headers.cookie) {
      proxyReq.setHeader('Cookie', req.headers.cookie);
    }
    
    // Передаем userId из сессии gateway в заголовках для синхронизации сессий между сервисами
    if (req.session && req.session.userId) {
      proxyReq.setHeader('X-User-ID', req.session.userId.toString());
      if (req.session.originalUserId) {
        proxyReq.setHeader('X-Original-User-ID', req.session.originalUserId.toString());
      }
      console.log(`[Gateway] Передан заголовок X-User-ID: ${req.session.userId}`);
      
      // Обновляем время жизни сессии при каждом запросе (touch session)
      req.session.touch();
    } else {
      console.log(`[Gateway] Нет userId в сессии для ${req.path}`);
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
    console.log(`[Gateway] Получен ответ от сервиса: ${req.method} ${req.path} -> ${proxyRes.statusCode}`);
    
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
  selfHandleResponse: true, // Полностью контролируем ответ
  onProxyReq: (proxyReq, req, res) => {
    console.log(`[Gateway] Проксирование LOGIN ${req.method} ${req.path} -> ${services.auth}${req.path}`);
    console.log(`[Gateway] Content-Type:`, req.headers['content-type']);
    console.log(`[Gateway] Content-Length:`, req.headers['content-length']);
    
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
    
    // С selfHandleResponse: true мы должны полностью обработать ответ
    // Читаем тело ответа полностью перед отправкой
    const chunks = [];
    
    proxyRes.on('data', (chunk) => {
      chunks.push(chunk);
    });
    
    proxyRes.on('end', async () => {
      try {
        const body = Buffer.concat(chunks).toString();
        const result = JSON.parse(body);
        
        // Если логин успешен (200), синхронизируем сессию gateway
        if (proxyRes.statusCode === 200 && result.success && result.userId) {
          console.log(`[Gateway] Логин успешен, синхронизация сессии для userId=${result.userId}, текущий sessionID=${req.sessionID}`);
          
          // Синхронизируем сессию gateway с userId из ответа
          req.session.userId = result.userId;
          req.session.originalUserId = result.userId;
          req.session.touch(); // Обновляем время жизни сессии
          
          // Ждем сохранения сессии перед отправкой ответа
          try {
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                console.error(`[Gateway] Таймаут сохранения сессии после логина`);
                reject(new Error('Session save timeout'));
              }, 5000); // Увеличен таймаут до 5 секунд
              
              req.session.save((err) => {
                clearTimeout(timeout);
                if (err) {
                  console.error(`[Gateway] Ошибка сохранения сессии после логина: ${err.message}`);
                  reject(err);
                } else {
                  // После сохранения сессии, express-session должен установить cookie
                  // Но при selfHandleResponse: true express-session не устанавливает cookie автоматически
                  // Нужно установить cookie вручную, используя правильный формат express-session
                  // Express-session использует подписанные cookies с префиксом 's:'
                  const cookieName = 'beauty.studio.sid';
                  
                  // При selfHandleResponse: true express-session не устанавливает cookie автоматически
                  // Нужно установить cookie вручную, используя правильные параметры из req.session.cookie
                  // Express-session НЕ использует подписанные cookies - он использует обычные cookies
                  const cookieOptions = {
                    httpOnly: req.session.cookie.httpOnly !== false,
                    secure: req.session.cookie.secure !== false,
                    maxAge: req.session.cookie.maxAge || 24 * 60 * 60 * 1000,
                    sameSite: req.session.cookie.sameSite || 'lax',
                    path: req.session.cookie.path || '/'
                  };
                  
                  // Устанавливаем cookie с sessionID (express-session использует обычные cookies, не подписанные)
                  res.cookie(cookieName, req.sessionID, cookieOptions);
                  console.log(`[Gateway] Cookie установлен вручную: ${cookieName}=${req.sessionID.substring(0, 20)}..., options=${JSON.stringify(cookieOptions)}`);
                  console.log(`[Gateway] Сессия синхронизирована после логина: userId=${result.userId}, sessionID=${req.sessionID}`);
                  resolve();
                }
              });
            });
          } catch (saveError) {
            console.error(`[Gateway] Критическая ошибка сохранения сессии: ${saveError.message}`);
            // Продолжаем отправку ответа даже при ошибке сохранения сессии
          }
        }
      } catch (e) {
        console.log(`[Gateway] Ошибка обработки ответа логина: ${e.message}`);
      }
      
      // Отправляем ответ клиенту после обработки
      if (!res.headersSent) {
        res.status(proxyRes.statusCode);
        
        // Копируем заголовки от сервиса, но НЕ перезаписываем Set-Cookie
        Object.keys(proxyRes.headers).forEach(key => {
          // Пропускаем заголовки, которые будут установлены автоматически
          const lowerKey = key.toLowerCase();
          if (lowerKey !== 'content-length' && lowerKey !== 'transfer-encoding' && lowerKey !== 'connection' && lowerKey !== 'set-cookie') {
            res.setHeader(key, proxyRes.headers[key]);
          }
        });
        
        // Важно: express-session должен установить cookie автоматически при сохранении сессии
        // Проверяем, установлен ли cookie в заголовках
        const setCookieHeaders = res.getHeader('Set-Cookie');
        if (setCookieHeaders) {
          const cookieStr = Array.isArray(setCookieHeaders) ? setCookieHeaders[0] : setCookieHeaders;
          console.log(`[Gateway] Cookie установлен в ответе логина: ${cookieStr.substring(0, 100)}...`);
          // Проверяем формат cookie - должен быть 's:sessionID.signature'
          if (cookieStr.includes('s:')) {
            console.log(`[Gateway] Cookie имеет правильный формат с подписью`);
          } else {
            console.log(`[Gateway] ВНИМАНИЕ: Cookie не имеет формата с подписью!`);
          }
        } else {
          console.log(`[Gateway] ВНИМАНИЕ: Cookie не установлен в ответе логина! sessionID=${req.sessionID}`);
        }
        
        // Устанавливаем Content-Length
        res.setHeader('Content-Length', Buffer.byteLength(Buffer.concat(chunks)));
        res.end(Buffer.concat(chunks));
      } else if (!res.finished) {
        res.end();
      }
    });
    
    proxyRes.on('error', (err) => {
      console.error(`[Gateway] Ошибка чтения ответа от auth-service: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
      } else if (!res.finished) {
        res.end();
      }
    });
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

// Инициализируем приложение и запускаем сервер
initApp().then(() => {
  console.log(`[Gateway] Session store: ${sessionStore ? 'Redis' : 'MemoryStore (fallback)'}`);
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚪 API Gateway запущен на порту ${PORT}`);
  }).on('error', (err) => {
    console.error(`[Gateway] Ошибка запуска сервера на порту ${PORT}:`, err.message);
    if (err.code === 'EADDRINUSE') {
      console.error(`[Gateway] Порт ${PORT} уже занят. Остановите другой процесс или измените PORT.`);
    }
    process.exit(1);
  });
}).catch((error) => {
  console.error('[Gateway] Критическая ошибка инициализации:', error);
  // Все равно запускаем сервер с MemoryStore
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚪 API Gateway запущен на порту ${PORT} (с MemoryStore)`);
  });
});
