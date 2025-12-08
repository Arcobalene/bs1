const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const { users: dbUsers, services, masters, bookings, migrateFromJSON } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'beauty-studio-secret-key-change-in-production';

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// Настройка сессий
app.use(session({
  secret: SESSION_SECRET,
  resave: true, // Сохранять сессию при каждом запросе
  saveUninitialized: false, // Не сохранять пустые сессии
  name: 'beauty.studio.sid', // Явное имя cookie
  cookie: { 
    secure: false, // В Docker без HTTPS должно быть false
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 часа
    sameSite: 'lax', // Защита от CSRF
    path: '/' // Cookie доступна для всех путей
  }
}));

// Логирование сессий для отладки
app.use((req, res, next) => {
  if (req.path.startsWith('/api/login') || req.path.startsWith('/admin')) {
    console.log(`[${req.method} ${req.path}] Session ID: ${req.sessionID}, userId: ${req.session.userId}`);
    console.log(`Cookie заголовок в запросе: ${req.headers.cookie || 'нет'}`);
  }
  next();
});

// Middleware для логирования Set-Cookie после сохранения сессии
app.use((req, res, next) => {
  const originalEnd = res.end;
  res.end = function(...args) {
    if (req.path.startsWith('/api/login') && res.statusCode === 200) {
      const setCookieHeader = res.getHeader('Set-Cookie');
      console.log(`Set-Cookie заголовок в ответе: ${setCookieHeader ? (Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader) : 'не установлен'}`);
    }
    originalEnd.apply(res, args);
  };
  next();
});

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
  console.log(`requireAuth: session.userId = ${req.session.userId}`);
  if (req.session.userId) {
    try {
      // Проверяем, не заблокирован ли пользователь
      const user = await dbUsers.getById(req.session.userId);
      console.log(`requireAuth: пользователь найден:`, user ? user.username : 'не найден');
      if (!user) {
        console.log('requireAuth: пользователь не найден в БД, удаляем сессию');
        req.session.destroy();
        return res.redirect('/login');
      }
      if (user.is_active === false || user.is_active === 0) {
        console.log('requireAuth: пользователь заблокирован');
        req.session.destroy();
        return res.redirect('/login');
      }
      console.log('requireAuth: авторизация успешна');
      next();
    } catch (error) {
      console.error('Ошибка проверки авторизации:', error);
      console.error('Stack:', error.stack);
      res.redirect('/login');
    }
  } else {
    console.log('requireAuth: нет session.userId, редирект на /login');
    res.redirect('/login');
  }
}

// Middleware для проверки прав администратора
async function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    // Если это HTML запрос, редиректим, иначе возвращаем JSON
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
      if (req.accepts && req.accepts('html')) {
        return res.status(403).send('Доступ запрещен. Требуются права администратора.');
      }
      return res.status(403).json({ success: false, message: 'Доступ запрещен. Требуются права администратора.' });
    }
    next();
  } catch (error) {
    console.error('Ошибка проверки прав администратора:', error);
    if (req.accepts && req.accepts('html')) {
      return res.status(500).send('Ошибка сервера');
    }
    return res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
}

// Главная страница (форма записи)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Страница входа
app.get('/login', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/admin');
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

// Страница админки
app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// Страница календаря
app.get('/calendar', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'calendar.html'));
});

// Страница управления пользователями (только для админов)
app.get('/users', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'users.html'));
});

// API: Регистрация
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Заполните все поля' });
    }

    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ success: false, message: 'Логин должен быть от 3 до 30 символов' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Пароль должен содержать минимум 6 символов' });
    }

    const existingUser = await dbUsers.getByUsername(username);
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'Пользователь с таким именем уже существует' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = await dbUsers.create({
      username: username.trim(),
      email: email ? email.trim() : '',
      password: hashedPassword,
      role: 'user',
      isActive: true,
      salonName: '',
      salonAddress: '',
      salonLat: null,
      salonLng: null
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

// API: Вход
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Заполните все поля' });
    }

    const trimmedUsername = username.trim();
    console.log(`Попытка входа: ${trimmedUsername}`);
    
    const user = await dbUsers.getByUsername(trimmedUsername);
    
    if (!user) {
      console.log(`Пользователь ${trimmedUsername} не найден`);
      return res.status(401).json({ success: false, message: 'Неверный логин или пароль' });
    }

    console.log(`Пользователь найден: ${user.username}, активен: ${user.is_active}`);

    // Проверяем, не заблокирован ли пользователь
    if (user.is_active === false || user.is_active === 0) {
      return res.status(403).json({ success: false, message: 'Аккаунт заблокирован администратором' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      console.log(`Неверный пароль для пользователя ${trimmedUsername}`);
      return res.status(401).json({ success: false, message: 'Неверный логин или пароль' });
    }

    console.log(`Успешный вход: ${trimmedUsername}, ID: ${user.id}`);
    req.session.userId = user.id;
    req.session.originalUserId = req.session.originalUserId || user.id; // Для impersonation
    console.log(`Сессия установлена: userId=${req.session.userId}, originalUserId=${req.session.originalUserId}, Session ID: ${req.sessionID}`);
    
    // Явно сохраняем сессию перед отправкой ответа
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          console.error('Ошибка сохранения сессии:', err);
          return reject(err);
        }
        console.log(`Сессия сохранена успешно. Session ID: ${req.sessionID}`);
        resolve();
      });
    });
    
    res.json({ success: true, message: 'Вход выполнен' });
  } catch (error) {
    console.error('Ошибка входа:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при входе: ' + error.message });
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
    
    // Получаем услуги и мастеров
    const userServices = await services.getByUserId(user.id);
    const userMasters = await masters.getByUserId(user.id);
    
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
      services: userServices,
      masters: userMasters,
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
    const { salonName, salonAddress, salonLat, salonLng } = req.body;
    const user = await dbUsers.getById(req.session.userId);
    
    if (!user) {
      return res.json({ success: false, message: 'Пользователь не найден' });
    }

    await dbUsers.update(req.session.userId, {
      salonName: salonName !== undefined ? (salonName || '') : undefined,
      salonAddress: salonAddress !== undefined ? (salonAddress || '') : undefined,
      salonLat: salonLat !== undefined ? (salonLat ? parseFloat(salonLat) : null) : undefined,
      salonLng: salonLng !== undefined ? (salonLng ? parseFloat(salonLng) : null) : undefined
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка обновления информации о салоне:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить информацию о салоне (публичный доступ)
app.get('/api/salon/:userId', async (req, res) => {
  try {
    const user = await dbUsers.getById(parseInt(req.params.userId));
    if (!user) {
      return res.json({ success: false, salon: null });
    }
    res.json({ 
      success: true, 
      salon: {
        name: user.salon_name || 'Beauty Studio',
        address: user.salon_address || '',
        lat: user.salon_lat,
        lng: user.salon_lng
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
    const user = await dbUsers.getById(parseInt(req.params.userId));
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
    const user = await dbUsers.getById(parseInt(req.params.userId));
    if (!user) {
      return res.json({ success: false, masters: [] });
    }
    const userMasters = await masters.getByUserId(user.id);
    res.json({ success: true, masters: userMasters });
  } catch (error) {
    console.error('Ошибка получения мастеров:', error);
    res.status(500).json({ success: false, masters: [] });
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
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 9) {
      return res.status(400).json({ success: false, message: 'Некорректный номер телефона' });
    }

    const userIdInt = parseInt(userId);
    const user = await dbUsers.getById(userIdInt);
    if (isNaN(userIdInt) || !user) {
      return res.status(400).json({ success: false, message: 'Некорректный ID пользователя' });
    }

    const bookingId = await bookings.create({
      userId: userIdInt,
      name: name.trim(),
      phone: phone.trim(),
      service: service.trim(),
      master: master ? master.trim() : '',
      date: date.trim(),
      time: time.trim(),
      endTime: endTime ? endTime.trim() : null,
      comment: comment ? comment.trim() : ''
    });

    res.status(201).json({ success: true, booking: { id: bookingId } });
  } catch (error) {
    console.error('Ошибка создания записи:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера при создании записи' });
  }
});

// API: Получить записи пользователя
app.get('/api/bookings', requireAuth, async (req, res) => {
  try {
    const userBookings = await bookings.getByUserId(req.session.userId);
    // Преобразуем snake_case в camelCase для совместимости с фронтендом
    const formattedBookings = userBookings.map(booking => {
      // Преобразуем время из формата "HH:MM:SS" в "HH:MM" если нужно
      const formatTime = (timeStr) => {
        if (!timeStr) return null;
        // Если время в формате "HH:MM:SS", обрезаем до "HH:MM"
        if (timeStr.length > 5) {
          return timeStr.substring(0, 5);
        }
        return timeStr;
      };
      
      // Преобразуем дату в формат YYYY-MM-DD
      const formatDate = (dateValue) => {
        if (!dateValue) return null;
        // Если это Date объект
        if (dateValue instanceof Date) {
          const y = dateValue.getFullYear();
          const m = String(dateValue.getMonth() + 1).padStart(2, '0');
          const d = String(dateValue.getDate()).padStart(2, '0');
          return `${y}-${m}-${d}`;
        }
        // Если это строка, проверяем формат
        if (typeof dateValue === 'string') {
          // Если формат уже YYYY-MM-DD, возвращаем как есть
          if (/^\d{4}-\d{2}-\d{2}/.test(dateValue)) {
            return dateValue.substring(0, 10);
          }
        }
        return dateValue;
      };
      
      return {
        id: booking.id,
        userId: booking.user_id,
        name: booking.name,
        phone: booking.phone,
        service: booking.service,
        master: booking.master,
        date: formatDate(booking.date),
        time: formatTime(booking.time),
        endTime: formatTime(booking.end_time), // Преобразуем end_time в endTime
        comment: booking.comment,
        createdAt: booking.created_at
      };
    });
    res.json({ success: true, bookings: formattedBookings });
  } catch (error) {
    console.error('Ошибка получения записей:', error);
    res.status(500).json({ success: false, bookings: [] });
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
    const userId = parseInt(req.params.userId);
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
    const userId = parseInt(req.params.userId);
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
    const userId = parseInt(req.params.userId);
    
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

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('Ошибка:', err);
  res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
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
    app.listen(PORT, () => {
      console.log(`Сервер запущен на http://localhost:${PORT}`);
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
  } catch (error) {
    console.error('Ошибка инициализации:', error);
    process.exit(1);
  }
})();