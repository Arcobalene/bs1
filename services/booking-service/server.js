const express = require('express');

// Импортируем общие модули
const { bookings, users: dbUsers, initDatabase } = require('../../shared/database');
const { timeToMinutes, checkTimeOverlap, formatDate } = require('../../shared/utils');
const { setupStandardMiddleware, requireAuth, errorHandler } = require('../../shared/middleware');
const { createLogger } = require('../../shared/logger');
const { validatePositiveInt, validateDate, validateTime } = require('../../shared/validators');

const app = express();
const PORT = process.env.PORT || 3003;
const logger = createLogger('booking-service');

// Настройка стандартного middleware
setupStandardMiddleware(app);

// Session управляется централизованно в gateway
// Сервис получает userId через заголовок X-User-ID от gateway

// API: Проверить доступность
app.post('/api/bookings/check-availability', async (req, res) => {
  try {
    const { userId, date, time, duration, master } = req.body;

    // Валидация userId
    const userIdValidation = validatePositiveInt(userId, 'userId');
    if (!userIdValidation.valid) {
      return res.status(400).json({ success: false, message: userIdValidation.message });
    }

    // Валидация даты
    const dateValidation = validateDate(date);
    if (!dateValidation.valid) {
      return res.status(400).json({ success: false, message: dateValidation.message });
    }

    // Валидация времени
    const timeValidation = validateTime(time);
    if (!timeValidation.valid) {
      return res.status(400).json({ success: false, message: timeValidation.message });
    }

    const startMinutes = timeToMinutes(time);
    if (!startMinutes && startMinutes !== 0) {
      return res.status(400).json({ success: false, message: 'Неверный формат времени' });
    }

    const durationMinutes = parseInt(duration, 10);
    if (isNaN(durationMinutes) || durationMinutes <= 0 || durationMinutes > 480) {
      return res.status(400).json({ success: false, message: 'Неверная длительность (макс. 8 часов)' });
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
    logger.error('Ошибка проверки доступности', { error: error.message });
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
    logger.error('Ошибка создания записи', { error: error.message });
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить записи салона (по userId из параметра)
app.get('/api/bookings/:userId', requireAuth, async (req, res) => {
  try {
    const userIdValidation = validatePositiveInt(req.params.userId, 'userId');
    if (!userIdValidation.valid) {
      return res.status(400).json({ success: false, message: userIdValidation.message });
    }

    const userBookings = await bookings.getByUserId(userIdValidation.value);
    res.json({ success: true, bookings: userBookings });
  } catch (error) {
    logger.error('Ошибка получения записей', { error: error.message, userId: req.params.userId });
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
    logger.error('Ошибка получения записей', { error: error.message });
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
    logger.error('Ошибка получения записей мастера', { error: error.message });
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
    logger.error('Ошибка получения записей клиента', { error: error.message });
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Обновить запись
app.put('/api/bookings/:id', requireAuth, async (req, res) => {
  try {
    const idValidation = validatePositiveInt(req.params.id, 'id');
    if (!idValidation.valid) {
      return res.status(400).json({ success: false, message: idValidation.message });
    }

    const booking = await bookings.getById(idValidation.value);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Запись не найдена' });
    }

    // Проверяем права (только владелец салона)
    const user = await dbUsers.getById(req.session.userId);
    if (user.role !== 'user' || booking.user_id !== user.id) {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    await bookings.update(idValidation.value, req.body);
    res.json({ success: true, message: 'Запись обновлена' });
  } catch (error) {
    logger.error('Ошибка обновления записи', { error: error.message, bookingId: req.params.id });
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Удалить запись
app.delete('/api/bookings/:id', requireAuth, async (req, res) => {
  try {
    const idValidation = validatePositiveInt(req.params.id, 'id');
    if (!idValidation.valid) {
      return res.status(400).json({ success: false, message: idValidation.message });
    }

    const booking = await bookings.getById(idValidation.value);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Запись не найдена' });
    }

    // Проверяем права (только владелец салона)
    const user = await dbUsers.getById(req.session.userId);
    if (user.role !== 'user' || booking.user_id !== user.id) {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    await bookings.delete(idValidation.value);
    res.json({ success: true, message: 'Запись удалена' });
  } catch (error) {
    logger.error('Ошибка удаления записи', { error: error.message, bookingId: req.params.id });
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'booking-service', timestamp: new Date().toISOString() });
});

// Обработчик ошибок
app.use(errorHandler);

// Запуск сервера
(async () => {
  try {
    await initDatabase();
    logger.info('База данных инициализирована');

    app.listen(PORT, '0.0.0.0', () => {
      logger.info('Booking Service запущен', { port: PORT });
    });
  } catch (error) {
    logger.error('Ошибка инициализации', { error: error.message, stack: error.stack });
    process.exit(1);
  }
})();
