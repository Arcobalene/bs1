const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const multer = require('multer');
const Minio = require('minio');
const https = require('https');
const { users: dbUsers, services, masters, bookings, migrateFromJSON } = require('./database');
const { 
  timeToMinutes, 
  formatTime, 
  formatDate, 
  checkTimeOverlap, 
  validatePhone, 
  validateUsername, 
  validatePassword,
  formatBooking 
} = require('./utils');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'beauty-studio-secret-key-change-in-production';

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

// Логирование только в режиме разработки
const isDevelopment = process.env.NODE_ENV !== 'production';
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
  if (req.session.userId) {
    try {
      const user = await dbUsers.getById(req.session.userId);
      if (!user) {
        req.session.destroy();
        // Для API запросов всегда возвращаем JSON
        if (req.path && req.path.startsWith('/api/')) {
          return res.status(401).json({ success: false, message: 'Требуется авторизация' });
        }
        return res.redirect('/login');
      }
      if (user.is_active === false || user.is_active === 0) {
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
    const { username, password, email } = req.body;
    
    // Валидация
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
    
    res.json({ success: true, message: 'Вход выполнен' });
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
    
    // Получаем услуги и мастеров
    const userServices = await services.getByUserId(user.id);
    const userMasters = await masters.getByUserId(user.id);
    
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
      salonDesign: salonDesign,
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
    const { salonName, salonAddress, salonLat, salonLng, salonPhone } = req.body;
    const user = await dbUsers.getById(req.session.userId);
    
    if (!user) {
      return res.json({ success: false, message: 'Пользователь не найден' });
    }

    await dbUsers.update(req.session.userId, {
      salonName: salonName !== undefined ? (salonName || '') : undefined,
      salonAddress: salonAddress !== undefined ? (salonAddress || '') : undefined,
      salonLat: salonLat !== undefined ? (salonLat ? parseFloat(salonLat) : null) : undefined,
      salonLng: salonLng !== undefined ? (salonLng ? parseFloat(salonLng) : null) : undefined,
      salonPhone: salonPhone !== undefined ? (salonPhone || '') : undefined
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
    const user = await dbUsers.getById(parseInt(req.params.userId, 10));
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
        phone: user.salon_phone || '',
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
    const user = await dbUsers.getById(parseInt(req.params.userId, 10));
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
    const user = await dbUsers.getById(parseInt(req.params.userId, 10));
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
    const masterId = parseInt(req.params.masterId, 10);
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
    const masterId = parseInt(req.params.masterId, 10);
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
    const masterId = parseInt(req.params.masterId, 10);
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
        res.setHeader('Access-Control-Allow-Origin', '*'); // Для CORS
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
    const masterId = parseInt(req.params.masterId, 10);
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

    const userIdInt = parseInt(userId, 10);
    const user = await dbUsers.getById(userIdInt);
    if (isNaN(userIdInt) || !user) {
      return res.status(400).json({ success: false, message: 'Некорректный ID пользователя' });
    }

    // Проверяем доступность времени перед созданием записи
    const availability = await checkBookingAvailability(userIdInt, date, time, endTime, master);
    if (!availability.available) {
      return res.status(409).json({ 
        success: false, 
        message: availability.message + '. Пожалуйста, выберите другое время.',
        conflictingBooking: availability.conflictingBooking
      });
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

    // Отправляем уведомление в Telegram, если настроено
    try {
      console.log(`📨 Попытка отправить Telegram уведомление для записи: ${name.trim()}, телефон: ${phone.trim()}`);
      await sendTelegramNotificationIfEnabled(userIdInt, {
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
      // Не прерываем создание записи, если ошибка отправки в Telegram
      console.error('❌ Ошибка отправки уведомления в Telegram:', telegramError);
      console.error('  Stack:', telegramError.stack);
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
    const bookingId = parseInt(req.params.id, 10);
    const { name, phone, service, master, date, time, endTime, comment } = req.body;

    if (isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Некорректный ID записи' });
    }

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

    // Обновляем запись
    await bookings.update(bookingId, {
      name,
      phone,
      service,
      master,
      date,
      time,
      endTime,
      comment
    });

    res.json({ success: true, message: 'Запись обновлена' });
  } catch (error) {
    console.error('Ошибка обновления записи:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера при обновлении записи' });
  }
});

// API: Удалить запись
app.delete('/api/bookings/:id', requireAuth, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id, 10);

    if (isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Некорректный ID записи' });
    }

    // Проверяем, что запись существует и принадлежит текущему пользователю
    const existingBooking = await bookings.getById(bookingId);
    if (!existingBooking) {
      return res.status(404).json({ success: false, message: 'Запись не найдена' });
    }

    if (existingBooking.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, message: 'Нет доступа к этой записи' });
    }

    await bookings.delete(bookingId);
    res.json({ success: true, message: 'Запись удалена' });
  } catch (error) {
    console.error('Ошибка удаления записи:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера при удалении записи' });
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

// Функция для отправки уведомления в Telegram при создании/изменении записи
async function sendTelegramNotificationIfEnabled(userId, booking, eventType) {
  try {
    console.log(`🔔 Проверка отправки Telegram уведомления: userId=${userId}, eventType=${eventType}`);
    const user = await dbUsers.getById(userId);
    if (!user) {
      console.log('❌ Пользователь не найден');
      return;
    }
    if (!user.telegram_settings) {
      console.log('❌ Настройки Telegram не найдены');
      return;
    }

    let telegramSettings = null;
    try {
      telegramSettings = typeof user.telegram_settings === 'string' 
        ? JSON.parse(user.telegram_settings) 
        : user.telegram_settings;
      console.log('✅ Настройки Telegram загружены:', { enabled: telegramSettings.enabled, hasToken: !!telegramSettings.botToken, hasChatId: !!telegramSettings.chatId });
    } catch (e) {
      console.error('❌ Ошибка парсинга telegram_settings:', e);
      return;
    }

    // Проверяем, включены ли уведомления
    if (!telegramSettings.enabled) {
      console.log('❌ Уведомления Telegram отключены');
      return;
    }

    // Проверяем тип события
    // Для новых записей: по умолчанию true, если явно не установлено false
    if (eventType === 'new') {
      if (telegramSettings.notifyNewBookings === false) {
        console.log('❌ Уведомления о новых записях отключены');
        return;
      }
      // Если undefined/null, считаем что включено (по умолчанию)
    }
    // Для отмен: по умолчанию false, нужно явно включить
    if (eventType === 'cancellation' && !telegramSettings.notifyCancellations) {
      console.log('❌ Уведомления об отменах отключены');
      return;
    }
    // Для изменений: по умолчанию false, нужно явно включить
    if (eventType === 'change' && !telegramSettings.notifyChanges) {
      console.log('❌ Уведомления об изменениях отключены');
      return;
    }

    // Проверяем номер телефона, если он указан в настройках
    if (telegramSettings.phone && telegramSettings.phone.trim()) {
      const settingsPhone = normalizePhone(telegramSettings.phone);
      const bookingPhone = normalizePhone(booking.phone);
      
      console.log(`📞 Проверка номера телефона: настройки="${settingsPhone}", запись="${bookingPhone}"`);
      
      if (settingsPhone && bookingPhone && settingsPhone !== bookingPhone) {
        // Номер не совпадает - не отправляем уведомление
        console.log(`❌ Номер телефона не совпадает. Настройки: ${settingsPhone}, Запись: ${bookingPhone}`);
        return;
      }
      console.log('✅ Номер телефона совпадает');
    } else {
      console.log('ℹ️ Номер телефона не указан в настройках - отправляем для всех записей');
    }

    // Формируем сообщение
    let message = '';
    if (eventType === 'new') {
      message = `📅 <b>Новая запись</b>\n\n`;
    } else if (eventType === 'cancellation') {
      message = `❌ <b>Отмена записи</b>\n\n`;
    } else if (eventType === 'change') {
      message = `✏️ <b>Изменение записи</b>\n\n`;
    }

    message += `👤 <b>Клиент:</b> ${booking.name}\n`;
    message += `📞 <b>Телефон:</b> ${booking.phone}\n`;
    message += `💼 <b>Услуга:</b> ${booking.service}\n`;
    if (booking.master) {
      message += `👨‍💼 <b>Мастер:</b> ${booking.master}\n`;
    }
    message += `📆 <b>Дата:</b> ${booking.date}\n`;
    message += `🕐 <b>Время:</b> ${booking.time}`;
    if (booking.endTime) {
      message += ` - ${booking.endTime}`;
    }
    if (booking.comment) {
      message += `\n💬 <b>Комментарий:</b> ${booking.comment}`;
    }

    // Отправляем сообщение
    if (telegramSettings.botToken && telegramSettings.chatId) {
      console.log(`📤 Отправка сообщения в Telegram...`);
      await sendTelegramMessage(telegramSettings.botToken, telegramSettings.chatId, message);
      console.log(`✅ Уведомление в Telegram отправлено для записи ${booking.name}`);
    } else {
      console.log('❌ Токен бота или Chat ID не указаны');
      if (!telegramSettings.botToken) console.log('  - Токен бота отсутствует');
      if (!telegramSettings.chatId) console.log('  - Chat ID отсутствует');
    }
  } catch (error) {
    console.error('❌ Ошибка отправки уведомления в Telegram:', error);
    console.error('  Stack:', error.stack);
    // Не пробрасываем ошибку, чтобы не прерывать основной процесс
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
    
    let telegramSettings = null;
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
    
    res.json({ 
      success: true, 
      settings: telegramSettings || {
        botToken: '',
        chatId: '',
        phone: '',
        enabled: false,
        notifyNewBookings: true,
        notifyCancellations: false,
        notifyChanges: false
      }
    });
  } catch (error) {
    console.error('Ошибка получения настроек Telegram:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Сохранить настройки Telegram (только для админов)
app.post('/api/telegram/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { botToken, chatId, enabled, notifyNewBookings, notifyCancellations, notifyChanges } = req.body;
    
    const user = await dbUsers.getById(req.session.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }
    
    const settings = {
      botToken: botToken || '',
      chatId: chatId || '',
      phone: req.body.phone || '',
      enabled: enabled === true,
      notifyNewBookings: notifyNewBookings !== false,
      notifyCancellations: notifyCancellations === true,
      notifyChanges: notifyChanges === true
    };
    
    // Сохраняем настройки в БД
    const DB_TYPE = process.env.DB_TYPE || 'sqlite';
    
    if (DB_TYPE === 'postgres') {
      const { pool: dbPool } = require('./database');
      if (!dbPool) {
        return res.status(500).json({ success: false, message: 'База данных не инициализирована' });
      }
      const client = await dbPool.connect();
      try {
        await client.query(
          'UPDATE users SET telegram_settings = $1 WHERE id = $2',
          [JSON.stringify(settings), req.session.userId]
        );
      } finally {
        client.release();
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

// API: Тестовая отправка сообщения в Telegram (только для админов)
app.post('/api/telegram/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { botToken, chatId } = req.body;
    
    if (!botToken || !chatId) {
      return res.status(400).json({ success: false, message: 'Токен бота и Chat ID обязательны' });
    }
    
    const testMessage = `✅ <b>Тестовое сообщение</b>\n\nИнтеграция с Telegram ботом работает корректно!`;
    
    await sendTelegramMessage(botToken, chatId, testMessage);
    
    res.json({ success: true, message: 'Тестовое сообщение успешно отправлено' });
  } catch (error) {
    console.error('Ошибка тестовой отправки Telegram:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Ошибка отправки сообщения. Проверьте токен бота и Chat ID.' 
    });
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