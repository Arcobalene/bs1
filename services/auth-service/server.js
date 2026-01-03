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

// Настройка сессий (Redis рекомендуется для production)
app.use(session({
  secret: process.env.SESSION_SECRET || 'auth-service-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 часа
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
    
    res.status(201).json({ success: true, message: 'Регистрация успешна' });
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'auth-service', timestamp: new Date().toISOString() });
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

