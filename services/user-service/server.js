const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');

// Импортируем общие модули
const { users: dbUsers, services, masters, salonMasters, clients, bookings, initDatabase } = require('../../shared/database');
const { validateUsername, validatePassword, validateEmail, validatePhone, normalizeToE164 } = require('../../shared/utils');
const { setupStandardMiddleware, requireAuth, errorHandler } = require('../../shared/middleware');

const app = express();
const PORT = process.env.PORT || 3002;

// Настройка стандартного middleware
setupStandardMiddleware(app);

// Настройка сессий (важно: имя cookie должно совпадать с gateway и auth-service)
app.use(session({
  secret: process.env.SESSION_SECRET || 'beauty-studio-secret-key-change-in-production',
  resave: true,
  saveUninitialized: false,
  name: 'beauty.studio.sid', // Имя cookie должно совпадать с gateway и auth-service
  cookie: {
    secure: process.env.NODE_ENV === 'production' || process.env.BEHIND_HTTPS_PROXY === 'true',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 часа
    sameSite: 'lax',
    path: '/'
  }
}));

// API: Получить данные текущего пользователя
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

// API: Регистрация клиента
app.post('/api/register-client', async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;
    
    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'Имя и телефон обязательны' });
    }

    const phoneValidation = validatePhone(phone);
    if (!phoneValidation.valid) {
      return res.status(400).json({ success: false, message: phoneValidation.message });
    }

    if (email) {
      const emailValidation = validateEmail(email);
      if (!emailValidation.valid) {
        return res.status(400).json({ success: false, message: emailValidation.message });
      }
    }

    if (password) {
      const passwordValidation = validatePassword(password);
      if (!passwordValidation.valid) {
        return res.status(400).json({ success: false, message: passwordValidation.message });
      }
    }

    const existingClient = await clients.getByPhone(phone);
    if (existingClient) {
      return res.status(409).json({ success: false, message: 'Клиент с таким номером телефона уже зарегистрирован' });
    }

    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;
    const clientId = await clients.create({
      name: name.trim(),
      phone: normalizeToE164(phone),
      email: email ? email.trim() : null,
      password: hashedPassword
    });

    req.session.clientId = clientId;
    req.session.clientPhone = normalizeToE164(phone);
    
    res.status(201).json({ success: true, message: 'Регистрация успешна' });
  } catch (error) {
    console.error('Ошибка регистрации клиента:', error);
    res.status(500).json({ success: false, message: error.message || 'Ошибка сервера при регистрации' });
  }
});

// API: Вход клиента
app.post('/api/login-client', async (req, res) => {
  try {
    const { phone, password } = req.body;
    
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Телефон обязателен' });
    }

    const client = await clients.getByPhone(phone);
    if (!client) {
      return res.status(401).json({ success: false, message: 'Клиент не найден' });
    }

    // Если пароль указан, проверяем его
    if (password && client.password) {
      const match = await bcrypt.compare(password, client.password);
      if (!match) {
        return res.status(401).json({ success: false, message: 'Неверный пароль' });
      }
    } else if (password && !client.password) {
      return res.status(401).json({ success: false, message: 'Пароль не установлен для этого аккаунта' });
    }

    req.session.clientId = client.id;
    req.session.clientPhone = client.phone;
    
    res.json({ 
      success: true, 
      message: 'Вход выполнен',
      client: {
        id: client.id,
        name: client.name,
        phone: client.phone,
        email: client.email
      }
    });
  } catch (error) {
    console.error('Ошибка входа клиента:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера при входе' });
  }
});

// API: Выход клиента
app.post('/api/logout-client', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// API: Получить данные клиента
app.get('/api/client', async (req, res) => {
  try {
    if (!req.session.clientId && !req.session.clientPhone) {
      return res.json({ success: false });
    }

    let client = null;
    if (req.session.clientId) {
      client = await clients.getById(req.session.clientId);
    } else if (req.session.clientPhone) {
      client = await clients.getByPhone(req.session.clientPhone);
    }

    if (!client) {
      return res.json({ success: false });
    }

    res.json({ 
      success: true, 
      client: {
        id: client.id,
        name: client.name,
        phone: client.phone,
        email: client.email
      }
    });
  } catch (error) {
    console.error('Ошибка получения данных клиента:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить дизайн салона
app.get('/api/salon/design', requireAuth, async (req, res) => {
  try {
    console.log(`[User Service] GET /api/salon/design, userId: ${req.session.userId}`);
    
    if (!req.session.userId) {
      console.error('[User Service] Нет userId в сессии');
      return res.status(401).json({ success: false, message: 'Требуется авторизация' });
    }
    
    const user = await dbUsers.getById(req.session.userId);
    console.log(`[User Service] Пользователь найден: ${user ? 'да' : 'нет'}`);
    
    if (!user) {
      console.error(`[User Service] Пользователь с id ${req.session.userId} не найден`);
      return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }
    
    if (user.role !== 'user') {
      console.error(`[User Service] Неверная роль пользователя: ${user.role}`);
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    let salonDesign = {};
    if (user.salon_design) {
      try {
        // PostgreSQL JSONB возвращается как объект, но может быть строкой
        if (typeof user.salon_design === 'string') {
          salonDesign = JSON.parse(user.salon_design);
        } else if (typeof user.salon_design === 'object' && user.salon_design !== null) {
          salonDesign = user.salon_design;
        } else {
          salonDesign = {};
        }
        console.log(`[User Service] Дизайн салона загружен, тип: ${typeof salonDesign}`);
      } catch (e) {
        console.error('[User Service] Ошибка парсинга salon_design:', e);
        console.error('[User Service] Значение salon_design:', user.salon_design);
        // Продолжаем с пустым объектом
        salonDesign = {};
      }
    } else {
      console.log('[User Service] salon_design отсутствует, возвращаем пустой объект');
    }

    res.json({ success: true, design: salonDesign });
  } catch (error) {
    console.error('[User Service] Ошибка получения дизайна салона:', error);
    console.error('[User Service] Стек ошибки:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Ошибка сервера',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// API: Получить мастеров салона
app.get('/api/salon/masters', requireAuth, async (req, res) => {
  try {
    const user = await dbUsers.getById(req.session.userId);
    if (!user || user.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    const salonMastersList = await masters.getByUserId(user.id);
    res.json({ success: true, masters: salonMastersList });
  } catch (error) {
    console.error('Ошибка получения мастеров салона:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить данные салона (публично)
app.get('/api/salon/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`[User Service] GET /api/salon/${userId}`);
    
    // Валидация userId
    const parsedUserId = parseInt(userId);
    if (isNaN(parsedUserId) || parsedUserId <= 0) {
      console.error(`[User Service] Неверный userId: ${userId}`);
      return res.status(400).json({ success: false, message: 'Неверный ID салона' });
    }
    
    const user = await dbUsers.getById(parsedUserId);
    console.log(`[User Service] Пользователь найден: ${user ? 'да' : 'нет'}`);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'Салон не найден' });
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

    let workHours = { startHour: 10, endHour: 20 };
    if (user.work_hours) {
      try {
        workHours = typeof user.work_hours === 'string' 
          ? JSON.parse(user.work_hours) 
          : user.work_hours;
        if (!workHours.startHour || !workHours.endHour) {
          workHours = { startHour: 10, endHour: 20 };
        }
      } catch (e) {
        console.error('Ошибка парсинга work_hours:', e);
      }
    }

    res.json({
      success: true,
      salon: {
        id: user.id,
        salonName: user.salon_name || '',
        salonAddress: user.salon_address || '',
        salonLat: user.salon_lat,
        salonLng: user.salon_lng,
        salonPhone: user.salon_phone || '',
        salonDisplayPhone: user.salon_display_phone || '',
        salonDesign: salonDesign,
        workHours: workHours
      }
    });
  } catch (error) {
    console.error('[User Service] Ошибка получения данных салона:', error);
    console.error('[User Service] Стек ошибки:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Ошибка сервера',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// API: Получить список салонов (публично)
app.get('/api/salons', async (req, res) => {
  try {
    const allSalons = await dbUsers.getAllSalons();
    const salons = allSalons.map(user => ({
      id: user.id,
      salonName: user.salon_name || '',
      salonAddress: user.salon_address || '',
      salonPhone: user.salon_display_phone || user.salon_phone || ''
    }));
    res.json({ success: true, salons });
  } catch (error) {
    console.error('Ошибка получения списка салонов:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить список пользователей (для админа)
app.get('/api/users', requireAuth, async (req, res) => {
  try {
    const currentUser = await dbUsers.getById(req.session.userId);
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    const allUsers = await dbUsers.getAll();
    const usersList = allUsers.map(user => ({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      isActive: user.is_active === true || user.is_active === 1,
      salonName: user.salon_name || '',
      createdAt: user.created_at
    }));

    res.json({ success: true, users: usersList });
  } catch (error) {
    console.error('Ошибка получения списка пользователей:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Восстановить аккаунт после impersonation
app.post('/api/users/restore', requireAuth, async (req, res) => {
  try {
    if (!req.session.originalUserId) {
      return res.status(400).json({ success: false, message: 'Нет активной сессии для восстановления' });
    }

    req.session.userId = req.session.originalUserId;
    req.session.originalUserId = null;
    
    res.json({ success: true, message: 'Аккаунт восстановлен' });
  } catch (error) {
    console.error('Ошибка восстановления аккаунта:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Переключить активность пользователя
app.put('/api/users/:userId/toggle', requireAuth, async (req, res) => {
  try {
    const currentUser = await dbUsers.getById(req.session.userId);
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    const { userId } = req.params;
    const targetUser = await dbUsers.getById(parseInt(userId));
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    const newStatus = !(targetUser.is_active === true || targetUser.is_active === 1);
    await dbUsers.update(parseInt(userId), { isActive: newStatus });

    res.json({ success: true, message: `Пользователь ${newStatus ? 'активирован' : 'деактивирован'}` });
  } catch (error) {
    console.error('Ошибка переключения активности пользователя:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Войти под другим пользователем (impersonation)
app.post('/api/users/:userId/impersonate', requireAuth, async (req, res) => {
  try {
    const currentUser = await dbUsers.getById(req.session.userId);
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    const { userId } = req.params;
    const targetUser = await dbUsers.getById(parseInt(userId));
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    if (!req.session.originalUserId) {
      req.session.originalUserId = req.session.userId;
    }
    req.session.userId = parseInt(userId);

    res.json({ success: true, message: 'Вход выполнен' });
  } catch (error) {
    console.error('Ошибка impersonation:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Удалить пользователя
app.delete('/api/users/:userId', requireAuth, async (req, res) => {
  try {
    const currentUser = await dbUsers.getById(req.session.userId);
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    const { userId } = req.params;
    const targetUser = await dbUsers.getById(parseInt(userId));
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    await dbUsers.delete(parseInt(userId));
    res.json({ success: true, message: 'Пользователь удален' });
  } catch (error) {
    console.error('Ошибка удаления пользователя:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Обновить данные салона
app.put('/api/salon', requireAuth, async (req, res) => {
  try {
    const user = await dbUsers.getById(req.session.userId);
    if (!user || user.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    const updateData = {};
    if (req.body.salonName !== undefined) updateData.salonName = req.body.salonName;
    if (req.body.salonAddress !== undefined) updateData.salonAddress = req.body.salonAddress;
    if (req.body.salonLat !== undefined) updateData.salonLat = req.body.salonLat;
    if (req.body.salonLng !== undefined) updateData.salonLng = req.body.salonLng;
    if (req.body.salonPhone !== undefined) updateData.salonPhone = req.body.salonPhone ? normalizeToE164(req.body.salonPhone) : null;
    if (req.body.salonDisplayPhone !== undefined) updateData.salonDisplayPhone = req.body.salonDisplayPhone;
    if (req.body.workHours !== undefined) updateData.workHours = req.body.workHours;

    await dbUsers.update(user.id, updateData);
    res.json({ success: true, message: 'Данные салона обновлены' });
  } catch (error) {
    console.error('Ошибка обновления данных салона:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить мастера салона по masterUserId
app.get('/api/salon/masters/:masterUserId', requireAuth, async (req, res) => {
  try {
    const user = await dbUsers.getById(req.session.userId);
    if (!user || user.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    const { masterUserId } = req.params;
    console.log(`[User Service] GET /api/salon/masters/${masterUserId}`);
    
    // Валидация masterUserId
    const parsedMasterUserId = parseInt(masterUserId);
    if (isNaN(parsedMasterUserId) || parsedMasterUserId <= 0) {
      console.error(`[User Service] Неверный masterUserId: ${masterUserId}`);
      return res.status(400).json({ success: false, message: 'Неверный ID мастера' });
    }
    
    const masterRecords = await masters.getByMasterUserId(parsedMasterUserId);
    const master = masterRecords.find(m => m.user_id === user.id);

    if (!master) {
      return res.status(404).json({ success: false, message: 'Мастер не найден' });
    }

    res.json({ success: true, master });
  } catch (error) {
    console.error('[User Service] Ошибка получения мастера салона:', error);
    console.error('[User Service] Стек ошибки:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Ошибка сервера',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// API: Удалить мастера из салона
app.delete('/api/salon/masters/:masterUserId', requireAuth, async (req, res) => {
  try {
    const user = await dbUsers.getById(req.session.userId);
    if (!user || user.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    const { masterUserId } = req.params;
    console.log(`[User Service] DELETE /api/salon/masters/${masterUserId}`);
    
    // Валидация masterUserId
    const parsedMasterUserId = parseInt(masterUserId);
    if (isNaN(parsedMasterUserId) || parsedMasterUserId <= 0) {
      console.error(`[User Service] Неверный masterUserId: ${masterUserId}`);
      return res.status(400).json({ success: false, message: 'Неверный ID мастера' });
    }
    
    await salonMasters.remove(user.id, parsedMasterUserId);

    res.json({ success: true, message: 'Мастер удален из салона' });
  } catch (error) {
    console.error('[User Service] Ошибка удаления мастера из салона:', error);
    console.error('[User Service] Стек ошибки:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Ошибка сервера',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// API: Получить список клиентов салона
app.get('/api/clients', requireAuth, async (req, res) => {
  try {
    const user = await dbUsers.getById(req.session.userId);
    if (!user || user.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    // Получаем все записи салона
    const userBookings = await bookings.getByUserId(user.id);
    
    // Собираем уникальных клиентов
    const clientsMap = new Map();
    for (const booking of userBookings) {
      const phone = booking.phone;
      if (!clientsMap.has(phone)) {
        const client = await clients.getByPhone(phone);
        if (client) {
          // Находим последнюю запись этого клиента
          const clientBookings = userBookings.filter(b => b.phone === phone);
          const lastBooking = clientBookings.sort((a, b) => {
            const dateA = new Date(a.date + ' ' + a.time);
            const dateB = new Date(b.date + ' ' + b.time);
            return dateB - dateA;
          })[0];

          clientsMap.set(phone, {
            ...client,
            lastBooking: lastBooking
          });
        }
      }
    }

    const clientsList = Array.from(clientsMap.values());
    res.json({ success: true, clients: clientsList });
  } catch (error) {
    console.error('Ошибка получения списка клиентов:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить список салонов мастера
app.get('/api/master/salons', requireAuth, async (req, res) => {
  try {
    const user = await dbUsers.getById(req.session.userId);
    if (!user || user.role !== 'master') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    const masterSalons = await salonMasters.getByMasterId(user.id);
    const salonsData = await Promise.all(
      masterSalons.map(async (salonMaster) => {
        const salonUser = await dbUsers.getById(salonMaster.user_id);
        return {
          id: salonUser.id,
          salonName: salonUser.salon_name || '',
          salonAddress: salonUser.salon_address || '',
          salonPhone: salonUser.salon_display_phone || salonUser.salon_phone || ''
        };
      })
    );

    res.json({ success: true, salons: salonsData });
  } catch (error) {
    console.error('Ошибка получения списка салонов мастера:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить профиль мастера
app.get('/api/master/profile', requireAuth, async (req, res) => {
  try {
    const user = await dbUsers.getById(req.session.userId);
    if (!user || user.role !== 'master') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    const masterRecords = await masters.getByMasterUserId(user.id);
    const master = masterRecords.length > 0 ? masterRecords[0] : null;

    res.json({ 
      success: true, 
      profile: {
        id: user.id,
        username: user.username,
        email: user.email,
        master: master
      }
    });
  } catch (error) {
    console.error('Ошибка получения профиля мастера:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Обновить профиль мастера
app.put('/api/master/profile', requireAuth, async (req, res) => {
  try {
    const user = await dbUsers.getById(req.session.userId);
    if (!user || user.role !== 'master') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    const updateData = {};
    if (req.body.email !== undefined) updateData.email = req.body.email;

    await dbUsers.update(user.id, updateData);
    res.json({ success: true, message: 'Профиль обновлен' });
  } catch (error) {
    console.error('Ошибка обновления профиля мастера:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'user-service', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

// Запуск сервера
(async () => {
  try {
    // Инициализируем БД
    await initDatabase();
    console.log('✅ База данных инициализирована');
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`👥 User Service запущен на порту ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Ошибка инициализации:', error);
    process.exit(1);
  }
})();
