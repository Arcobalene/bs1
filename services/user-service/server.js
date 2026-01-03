const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');

// Импортируем общие модули
const { users: dbUsers, services, masters, salonMasters, initDatabase } = require('./shared/database');

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Trust proxy для работы за gateway/nginx
app.set('trust proxy', 1);

// Настройка сессий (важно: имя cookie должно совпадать с gateway и auth-service)
const isHttps = process.env.NODE_ENV === 'production' || process.env.BEHIND_HTTPS_PROXY === 'true';
const cookieSecure = isHttps;

app.use(session({
  secret: process.env.SESSION_SECRET || 'beauty-studio-secret-key-change-in-production',
  resave: true,
  saveUninitialized: false,
  name: 'beauty.studio.sid', // Имя cookie должно совпадать с gateway и auth-service
  cookie: {
    secure: cookieSecure,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 часа
    sameSite: 'lax',
    path: '/'
  }
}));

// Middleware для проверки аутентификации
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, message: 'Требуется авторизация' });
  }
  next();
}

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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'user-service', timestamp: new Date().toISOString() });
});

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
