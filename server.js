const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const path = require('path');
const { users: dbUsers, services, masters, bookings, migrateFromJSON } = require('./database');

const app = express();
const PORT = 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

// Настройка сессий
app.use(session({
  secret: 'beauty-studio-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 часа
}));

// База данных инициализирована в database.js
// Миграция данных из JSON (если нужно) - выполняется автоматически при первом запуске
migrateFromJSON();

// Создаем демо-аккаунт при первом запуске (если нет пользователей или нет admin)
async function initDemoAccount() {
  const allUsers = dbUsers.getAll();
  const hasAdmin = allUsers.find(u => u.username === 'admin');
  
  if (allUsers.length === 0 || !hasAdmin) {
    console.log('Создание демо-аккаунта...');
    
    const hashedPassword = await bcrypt.hash('admin123', 10);
    const userId = dbUsers.create({
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

    // Добавляем услуги
    services.setForUser(userId, [
      { name: "Стрижка простая", price: 180000, duration: 60 },
      { name: "Стрижка + укладка", price: 260000, duration: 120 },
      { name: "Маникюр классический", price: 160000, duration: 90 },
      { name: "Маникюр + покрытие гель-лак", price: 220000, duration: 120 },
      { name: "Педикюр", price: 250000, duration: 120 }
    ]);

    // Добавляем мастеров
    masters.setForUser(userId, [
      { name: "Алина", role: "маникюр, педикюр" },
      { name: "Диана", role: "маникюр, дизайн" },
      { name: "София", role: "парикмахер-стилист" }
    ]);

    console.log('========================================');
    console.log('ДЕМО-АККАУНТ СОЗДАН!');
    console.log('Логин: admin');
    console.log('Пароль: admin123');
    console.log('========================================');
  } else {
    console.log('Демо-аккаунт уже существует');
  }
}

// Middleware для проверки авторизации
function requireAuth(req, res, next) {
  if (req.session.userId) {
    // Проверяем, не заблокирован ли пользователь
    const user = dbUsers.getById(req.session.userId);
    if (user && user.is_active === 0) {
      req.session.destroy();
      return res.redirect('/login');
    }
    next();
  } else {
    res.redirect('/login');
  }
}

// Middleware для проверки прав администратора
function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    // Если это HTML запрос, редиректим, иначе возвращаем JSON
    if (req.accepts && req.accepts('html')) {
      return res.redirect('/login');
    }
    return res.status(401).json({ success: false, message: 'Требуется авторизация' });
  }
  const user = dbUsers.getById(req.session.userId);
  // Проверяем роль: admin или username === 'admin' (для обратной совместимости)
  const isAdmin = user && (user.role === 'admin' || user.username === 'admin');
  if (!isAdmin) {
    if (req.accepts && req.accepts('html')) {
      return res.status(403).send('Доступ запрещен. Требуются права администратора.');
    }
    return res.status(403).json({ success: false, message: 'Доступ запрещен. Требуются права администратора.' });
  }
  next();
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
  const { username, password, email } = req.body;
  
  if (!username || !password) {
    return res.json({ success: false, message: 'Заполните все поля' });
  }

  if (dbUsers.getByUsername(username)) {
    return res.json({ success: false, message: 'Пользователь с таким именем уже существует' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
    const userId = dbUsers.create({
    username,
    email: email || '',
    password: hashedPassword,
    role: 'user',
    isActive: true,
    salonName: '',
    salonAddress: '',
    salonLat: null,
    salonLng: null
  });

  // Добавляем услуги по умолчанию
  services.setForUser(userId, [
    { name: "Стрижка простая", price: 180000, duration: 60 },
    { name: "Стрижка + укладка", price: 260000, duration: 120 },
    { name: "Маникюр классический", price: 160000, duration: 90 }
  ]);

  // Добавляем мастеров по умолчанию
  masters.setForUser(userId, [
    { name: "Алина", role: "маникюр, педикюр" },
    { name: "Диана", role: "маникюр, дизайн" }
  ]);

  req.session.userId = userId;
  req.session.originalUserId = userId;
  res.json({ success: true, message: 'Регистрация успешна' });
});

// API: Вход
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.json({ success: false, message: 'Заполните все поля' });
  }

  const user = dbUsers.getByUsername(username);
  
  if (!user) {
    return res.json({ success: false, message: 'Неверный логин или пароль' });
  }

  // Проверяем, не заблокирован ли пользователь
  if (user.is_active === 0) {
    return res.json({ success: false, message: 'Аккаунт заблокирован администратором' });
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return res.json({ success: false, message: 'Неверный логин или пароль' });
  }

  req.session.userId = user.id;
  req.session.originalUserId = req.session.originalUserId || user.id; // Для impersonation
  res.json({ success: true, message: 'Вход выполнен' });
});

// API: Выход
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// API: Получить данные пользователя
app.get('/api/user', requireAuth, (req, res) => {
  const user = dbUsers.getById(req.session.userId);
  if (!user) {
    return res.json({ success: false });
  }
  
  // Получаем услуги и мастеров
  const userServices = services.getByUserId(user.id);
  const userMasters = masters.getByUserId(user.id);
  
  const userData = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    isActive: user.is_active === 1,
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
    const originalUser = dbUsers.getById(req.session.originalUserId);
    if (originalUser) {
      userData.originalUsername = originalUser.username;
    }
  }
  res.json({ success: true, user: userData });
});

// API: Обновить услуги
app.post('/api/services', requireAuth, (req, res) => {
  const { services: servicesList } = req.body;
  const user = dbUsers.getById(req.session.userId);
  
  if (!user) {
    return res.json({ success: false, message: 'Пользователь не найден' });
  }

  services.setForUser(req.session.userId, servicesList);
  res.json({ success: true });
});

// API: Обновить мастеров
app.post('/api/masters', requireAuth, (req, res) => {
  const { masters: mastersList } = req.body;
  const user = dbUsers.getById(req.session.userId);
  
  if (!user) {
    return res.json({ success: false, message: 'Пользователь не найден' });
  }

  masters.setForUser(req.session.userId, mastersList);
  res.json({ success: true });
});

// API: Обновить информацию о салоне
app.post('/api/salon', requireAuth, (req, res) => {
  const { salonName, salonAddress, salonLat, salonLng } = req.body;
  const user = dbUsers.getById(req.session.userId);
  
  if (!user) {
    return res.json({ success: false, message: 'Пользователь не найден' });
  }

  dbUsers.update(req.session.userId, {
    salonName: salonName !== undefined ? (salonName || '') : undefined,
    salonAddress: salonAddress !== undefined ? (salonAddress || '') : undefined,
    salonLat: salonLat !== undefined ? (salonLat ? parseFloat(salonLat) : null) : undefined,
    salonLng: salonLng !== undefined ? (salonLng ? parseFloat(salonLng) : null) : undefined
  });

  res.json({ success: true });
});

// API: Получить информацию о салоне (публичный доступ)
app.get('/api/salon/:userId', (req, res) => {
  const user = dbUsers.getById(parseInt(req.params.userId));
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
});

// API: Получить услуги (публичный доступ)
app.get('/api/services/:userId', (req, res) => {
  const user = dbUsers.getById(parseInt(req.params.userId));
  if (!user) {
    return res.json({ success: false, services: [] });
  }
  const userServices = services.getByUserId(user.id);
  res.json({ success: true, services: userServices });
});

// API: Получить мастеров (публичный доступ)
app.get('/api/masters/:userId', (req, res) => {
  const user = dbUsers.getById(parseInt(req.params.userId));
  if (!user) {
    return res.json({ success: false, masters: [] });
  }
  const userMasters = masters.getByUserId(user.id);
  res.json({ success: true, masters: userMasters });
});

// API: Создать запись
app.post('/api/bookings', (req, res) => {
  const { userId, name, phone, service, master, date, time, endTime, comment } = req.body;
  
  if (!userId || !name || !phone || !service || !date || !time) {
    return res.json({ success: false, message: 'Заполните все обязательные поля' });
  }

  const bookingId = bookings.create({
    userId: parseInt(userId),
    name,
    phone,
    service,
    master: master || '',
    date,
    time,
    endTime: endTime || null,
    comment: comment || ''
  });

  res.json({ success: true, booking: { id: bookingId } });
});

// API: Получить записи пользователя
app.get('/api/bookings', requireAuth, (req, res) => {
  const userBookings = bookings.getByUserId(req.session.userId);
  res.json({ success: true, bookings: userBookings });
});

// API: Получить всех пользователей (только для админов)
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  const allUsers = dbUsers.getAll();
  // Не возвращаем пароли и добавляем статистику
  const usersWithoutPasswords = allUsers.map(u => {
    const userServices = services.getByUserId(u.id);
    const userMasters = masters.getByUserId(u.id);
    return {
      id: u.id,
      username: u.username,
      email: u.email,
      role: u.role || 'user',
      isActive: u.is_active === 1,
      createdAt: u.created_at,
      servicesCount: userServices.length,
      mastersCount: userMasters.length
    };
  });
  res.json({ success: true, users: usersWithoutPasswords });
});

// API: Блокировать/разблокировать пользователя
app.post('/api/users/:userId/toggle', requireAuth, requireAdmin, (req, res) => {
  const userId = parseInt(req.params.userId);
  const user = dbUsers.getById(userId);
  
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

  const newIsActive = user.is_active === 1 ? 0 : 1;
  dbUsers.update(userId, { isActive: newIsActive === 1 });
  res.json({ success: true, isActive: newIsActive === 1 });
});

// API: Войти под другим пользователем (impersonation)
app.post('/api/users/:userId/impersonate', requireAuth, requireAdmin, (req, res) => {
  const userId = parseInt(req.params.userId);
  const targetUser = dbUsers.getById(userId);
  
  if (!targetUser) {
    return res.json({ success: false, message: 'Пользователь не найден' });
  }

  if (targetUser.is_active === 0) {
    return res.json({ success: false, message: 'Пользователь заблокирован' });
  }

  // Сохраняем оригинального пользователя
  if (!req.session.originalUserId) {
    req.session.originalUserId = req.session.userId;
  }
  
  // Переключаемся на другого пользователя
  req.session.userId = userId;
  res.json({ success: true, message: `Вход выполнен под пользователем ${targetUser.username}` });
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
app.delete('/api/users/:userId', requireAuth, requireAdmin, (req, res) => {
  const userId = parseInt(req.params.userId);
  
  // Нельзя удалить самого себя
  if (userId === req.session.userId) {
    return res.json({ success: false, message: 'Нельзя удалить самого себя' });
  }

  const user = dbUsers.getById(userId);
  if (!user) {
    return res.json({ success: false, message: 'Пользователь не найден' });
  }

  // Нельзя удалить другого админа
  if (user.role === 'admin') {
    return res.json({ success: false, message: 'Нельзя удалить администратора' });
  }

  // Удаляем пользователя (каскадное удаление удалит услуги, мастеров и записи)
  dbUsers.delete(userId);
  
  res.json({ success: true, message: 'Пользователь удален' });
});

// Инициализация демо-аккаунта и запуск сервера
initDemoAccount().then(() => {
  app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    console.log('');
    console.log('Доступные страницы:');
    console.log(`  Главная: http://localhost:${PORT}/`);
    console.log(`  Вход: http://localhost:${PORT}/login`);
    console.log(`  Регистрация: http://localhost:${PORT}/register`);
    console.log('');
  });
});

