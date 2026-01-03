const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Импортируем общие модули
const { users: dbUsers, initDatabase } = require('./shared/database');
const { validateUsername, validatePassword, validateEmail, validatePhone, normalizeToE164 } = require('./shared/utils');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Trust proxy для работы за gateway/nginx
app.set('trust proxy', 1);

// Настройка сессий (важно: имя cookie должно совпадать с gateway)
const isHttps = process.env.NODE_ENV === 'production' || process.env.BEHIND_HTTPS_PROXY === 'true';
const cookieSecure = isHttps;

app.use(session({
  secret: process.env.SESSION_SECRET || 'beauty-studio-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  name: 'beauty.studio.sid', // Имя cookie должно совпадать с gateway
  cookie: {
    secure: cookieSecure,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 часа
    sameSite: 'lax',
    path: '/'
  }
}));

// Rate limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Слишком много попыток входа, попробуйте позже' }
});

// API: Регистрация салона
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, email, phone } = req.body;
    
    const usernameValidation = validateUsername(username);
    if (!usernameValidation.valid) {
      return res.status(400).json({ success: false, message: usernameValidation.message });
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({ success: false, message: passwordValidation.message });
    }

    if (email) {
      const emailValidation = validateEmail(email);
      if (!emailValidation.valid) {
        return res.status(400).json({ success: false, message: emailValidation.message });
      }
    }

    const existingUser = await dbUsers.getByUsername(usernameValidation.username);
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'Пользователь с таким логином уже существует' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = await dbUsers.create({
      username: usernameValidation.username,
      email: email || '',
      password: hashedPassword,
      role: 'user',
      isActive: true,
      salonName: '',
      salonAddress: '',
      salonPhone: phone ? normalizeToE164(phone) : null
    });

    req.session.userId = userId;
    req.session.originalUserId = userId;
    
    // Сохраняем сессию перед отправкой ответа
    req.session.save((err) => {
      if (err) {
        console.error('Ошибка сохранения сессии:', err);
        return res.status(500).json({ success: false, message: 'Ошибка сервера при регистрации' });
      }
      res.status(201).json({ success: true, message: 'Регистрация успешна' });
    });
  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера при регистрации' });
  }
});

// API: Регистрация мастера
app.post('/api/register/master', async (req, res) => {
  try {
    const { username, password, email, phone } = req.body;
    
    const usernameValidation = validateUsername(username);
    if (!usernameValidation.valid) {
      return res.status(400).json({ success: false, message: usernameValidation.message });
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({ success: false, message: passwordValidation.message });
    }

    const existingUser = await dbUsers.getByUsername(usernameValidation.username);
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'Пользователь с таким логином уже существует' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = await dbUsers.create({
      username: usernameValidation.username,
      email: email || '',
      password: hashedPassword,
      role: 'master',
      isActive: true,
      salonPhone: phone ? normalizeToE164(phone) : null
    });

    req.session.userId = userId;
    req.session.originalUserId = userId;
    
    // Сохраняем сессию перед отправкой ответа
    req.session.save((err) => {
      if (err) {
        console.error('Ошибка сохранения сессии:', err);
        return res.status(500).json({ success: false, message: 'Ошибка сервера при регистрации' });
      }
      res.status(201).json({ success: true, message: 'Регистрация успешна' });
    });
  } catch (error) {
    console.error('Ошибка регистрации мастера:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера при регистрации' });
  }
});

// API: Вход
app.post('/api/login', loginLimiter, async (req, res) => {
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

    if (user.is_active === false || user.is_active === 0) {
      return res.status(403).json({ success: false, message: 'Аккаунт заблокирован администратором' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Неверный логин или пароль' });
    }

    req.session.userId = user.id;
    req.session.originalUserId = req.session.originalUserId || user.id;
    
    // Сохраняем сессию перед отправкой ответа
    req.session.save((err) => {
      if (err) {
        console.error('Ошибка сохранения сессии:', err);
        return res.status(500).json({ success: false, message: 'Ошибка сервера при входе' });
      }
      res.json({ 
        success: true, 
        message: 'Вход выполнен',
        role: user.role
      });
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'auth-service', timestamp: new Date().toISOString() });
});

// Обработчик ошибок (должен быть после всех маршрутов)
app.use((err, req, res, next) => {
  // Игнорируем ошибки "request aborted" - это нормально, когда клиент закрывает соединение
  if (err.message && (err.message.includes('request aborted') || err.message.includes('aborted'))) {
    return; // Клиент уже закрыл соединение, ответ не нужен
  }
  
  // Обработка ошибок body parser
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    if (!res.headersSent) {
      return res.status(400).json({ success: false, message: 'Неверный формат JSON' });
    }
    return;
  }
  
  if (err.type === 'entity.parse.failed') {
    if (!res.headersSent) {
      return res.status(400).json({ success: false, message: 'Неверный формат данных' });
    }
    return;
  }
  
  // Остальные ошибки
  console.error('Ошибка:', err.message);
  if (!res.headersSent) {
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Обработчик ошибок на уровне процесса для игнорирования "request aborted"
process.on('uncaughtException', (err) => {
  if (err.message && (err.message.includes('request aborted') || err.message.includes('aborted'))) {
    // Игнорируем ошибки "request aborted" - это нормально
    return;
  }
  console.error('Необработанное исключение:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  if (reason && reason.message && (reason.message.includes('request aborted') || reason.message.includes('aborted'))) {
    // Игнорируем ошибки "request aborted" - это нормально
    return;
  }
  console.error('Необработанный rejection:', reason);
});

// Запуск сервера
(async () => {
  try {
    // Инициализируем БД
    await initDatabase();
    console.log('✅ База данных инициализирована');
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🔐 Auth Service запущен на порту ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Ошибка инициализации:', error);
    process.exit(1);
  }
})();

