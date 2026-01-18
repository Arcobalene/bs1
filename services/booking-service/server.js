const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');

// Импортируем общие модули
const { bookings, users: dbUsers, initDatabase } = require('./shared/database');
const { timeToMinutes, checkTimeOverlap, formatDate } = require('./shared/utils');

const app = express();
const PORT = process.env.PORT || 3003;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Trust proxy для работы за gateway/nginx
app.set('trust proxy', 1);

// Настройка сессий
const isHttps = process.env.NODE_ENV === 'production' || process.env.BEHIND_HTTPS_PROXY === 'true';
const cookieSecure = isHttps;

app.use(session({
  secret: process.env.SESSION_SECRET || 'beauty-studio-secret-key-change-in-production',
  resave: true,
  saveUninitialized: false,
  name: 'beauty.studio.sid',
  cookie: {
    secure: cookieSecure,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    path: '/'
  }
}));

// Middleware для проверки аутентификации
function requireAuth(req, res, next) {
  // Проверяем сессию или заголовок X-User-ID от gateway (для синхронизации сессий)
  const userIdFromHeader = req.headers['x-user-id'];
  
  if (userIdFromHeader) {
    // Если userId передан через заголовок от gateway, синхронизируем сессию
    if (!req.session.userId) {
      req.session.userId = parseInt(userIdFromHeader);
    }
    if (req.headers['x-original-user-id'] && !req.session.originalUserId) {
      req.session.originalUserId = parseInt(req.headers['x-original-user-id']);
    }
  }
  
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, message: 'Требуется авторизация' });
  }
  next();
}

// API: Проверить доступность
app.post('/api/bookings/check-availability', async (req, res) => {
  try {
    const { userId, date, time, duration, master } = req.body;
    
    if (!userId || !date || !time || !duration) {
      return res.status(400).json({ success: false, message: 'Не указаны обязательные параметры' });
    }

    const startMinutes = timeToMinutes(time);
    if (!startMinutes) {
      return res.status(400).json({ success: false, message: 'Неверный формат времени' });
    }

    const durationMinutes = parseInt(duration, 10);
    if (isNaN(durationMinutes) || durationMinutes <= 0) {
      return res.status(400).json({ success: false, message: 'Неверная длительность' });
    }

    const endMinutes = startMinutes + durationMinutes;

    // Получаем существующие записи на эту дату
    const existingBookings = await bookings.getByUserIdAndDate(userId, formatDate(date));
    
    // Проверяем пересечения
    const conflicts = existingBookings.filter(booking => {
      if (master && booking.master && booking.master.trim() !== '' && booking.master !== master) {
        return false; // Разные мастера - нет конфликта
      }
      
      const bookingStart = timeToMinutes(booking.time);
      if (!bookingStart) {
        return false; // Пропускаем записи с некорректным временем
      }
      
      const bookingEnd = timeToMinutes(booking.end_time || booking.time);
      if (!bookingEnd || bookingEnd <= bookingStart) {
        // Если нет времени окончания, предполагаем минимальную длительность 30 минут
        const bookingEndTime = bookingStart + 30;
        return checkTimeOverlap(startMinutes, endMinutes, bookingStart, bookingEndTime);
      }
      
      return checkTimeOverlap(startMinutes, endMinutes, bookingStart, bookingEnd);
    });

    if (conflicts.length > 0) {
      return res.json({ success: false, available: false, message: 'Время занято' });
    }

    res.json({ success: true, available: true });
  } catch (error) {
    console.error('Ошибка проверки доступности:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Создать запись
app.post('/api/bookings', async (req, res) => {
  try {
    const { userId, name, phone, service, master, date, time, endTime, comment } = req.body;
    
    if (!userId || !name || !phone || !service || !date || !time) {
      return res.status(400).json({ success: false, message: 'Заполните все обязательные поля' });
    }

    const bookingId = await bookings.create({
      userId: parseInt(userId),
      name: name.trim(),
      phone: phone.trim(),
      service: service.trim(),
      master: master || '',
      date: formatDate(date),
      time: time.trim(),
      endTime: endTime || null,
      comment: comment || ''
    });

    res.status(201).json({ success: true, id: bookingId, message: 'Запись создана' });
  } catch (error) {
    console.error('Ошибка создания записи:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить записи салона (по userId из параметра)
app.get('/api/bookings/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const userBookings = await bookings.getByUserId(parseInt(userId));
    res.json({ success: true, bookings: userBookings });
  } catch (error) {
    console.error('Ошибка получения записей:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить записи для авторизованного пользователя
app.get('/api/bookings', requireAuth, async (req, res) => {
  try {
    const user = await dbUsers.getById(req.session.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    let userBookings = [];
    if (user.role === 'user') {
      // Для владельца салона
      userBookings = await bookings.getByUserId(user.id);
    } else if (user.role === 'master') {
      // Для мастера
      userBookings = await bookings.getByMasterUserId(user.id);
    }

    res.json({ success: true, bookings: userBookings });
  } catch (error) {
    console.error('Ошибка получения записей:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить записи мастера
app.get('/api/master/bookings', requireAuth, async (req, res) => {
  try {
    const user = await dbUsers.getById(req.session.userId);
    if (!user || user.role !== 'master') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    const masterBookings = await bookings.getByMasterUserId(user.id);
    res.json({ success: true, bookings: masterBookings });
  } catch (error) {
    console.error('Ошибка получения записей мастера:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить записи клиента
app.get('/api/client/bookings', async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Не указан телефон' });
    }

    const clientBookings = await bookings.getByPhone(phone);
    res.json({ success: true, bookings: clientBookings });
  } catch (error) {
    console.error('Ошибка получения записей клиента:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Обновить запись
app.put('/api/bookings/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await bookings.getById(parseInt(id));
    
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Запись не найдена' });
    }

    // Проверяем права (только владелец салона)
    const user = await dbUsers.getById(req.session.userId);
    if (user.role !== 'user' || booking.user_id !== user.id) {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    await bookings.update(parseInt(id), req.body);
    res.json({ success: true, message: 'Запись обновлена' });
  } catch (error) {
    console.error('Ошибка обновления записи:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Удалить запись
app.delete('/api/bookings/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await bookings.getById(parseInt(id));
    
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Запись не найдена' });
    }

    // Проверяем права (только владелец салона)
    const user = await dbUsers.getById(req.session.userId);
    if (user.role !== 'user' || booking.user_id !== user.id) {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    await bookings.delete(parseInt(id));
    res.json({ success: true, message: 'Запись удалена' });
  } catch (error) {
    console.error('Ошибка удаления записи:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'booking-service', timestamp: new Date().toISOString() });
});

// Обработчик ошибок
app.use((err, req, res, next) => {
  if (err.message && (err.message.includes('request aborted') || err.message.includes('aborted'))) {
    return;
  }
  
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    if (!res.headersSent) {
      return res.status(400).json({ success: false, message: 'Неверный формат JSON' });
    }
    return;
  }
  
  console.error('Ошибка:', err.message);
  if (!res.headersSent) {
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Запуск сервера
(async () => {
  try {
    await initDatabase();
    console.log('✅ База данных инициализирована');
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`📅 Booking Service запущен на порту ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Ошибка инициализации:', error);
    process.exit(1);
  }
})();
