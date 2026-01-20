const express = require('express');

// Импортируем общие модули
const { notifications, users: dbUsers, initDatabase } = require('../../shared/database');
const { setupStandardMiddleware, requireAuth, errorHandler } = require('../../shared/middleware');
const { createLogger } = require('../../shared/logger');

const app = express();
const PORT = process.env.PORT || 3006;
const logger = createLogger('notification-service');

// Настройка стандартного middleware
setupStandardMiddleware(app);

// Session управляется централизованно в gateway
// Сервис получает userId через заголовок X-User-ID от gateway

// API: Получить уведомления
app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const userNotifications = await notifications.getByUserId(req.session.userId, limit);
    res.json({ success: true, notifications: userNotifications });
  } catch (error) {
    logger.error('Ошибка получения уведомлений', { error: error.message });
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Создать уведомление
app.post('/api/notifications', requireAuth, async (req, res) => {
  try {
    const { title, message, type, bookingId } = req.body;
    
    if (!title || !message) {
      return res.status(400).json({ success: false, message: 'Заполните все обязательные поля' });
    }

    const notification = await notifications.create({
      userId: req.session.userId,
      title: title.trim(),
      message: message.trim(),
      type: type || 'success',
      bookingId: bookingId || null
    });

    res.status(201).json({ success: true, notification, message: 'Уведомление создано' });
  } catch (error) {
    logger.error('Ошибка создания уведомления', { error: error.message });
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Отметить как прочитанное
app.put('/api/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await notifications.markAsRead(parseInt(id), req.session.userId);
    res.json({ success: true, message: 'Уведомление отмечено как прочитанное' });
  } catch (error) {
    logger.error('Ошибка обновления уведомления', { error: error.message });
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Отметить все как прочитанные
app.put('/api/notifications/read-all', requireAuth, async (req, res) => {
  try {
    await notifications.markAllAsRead(req.session.userId);
    res.json({ success: true, message: 'Все уведомления отмечены как прочитанные' });
  } catch (error) {
    logger.error('Ошибка обновления уведомлений', { error: error.message });
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Удалить уведомление
app.delete('/api/notifications/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await notifications.remove(parseInt(id), req.session.userId);
    res.json({ success: true, message: 'Уведомление удалено' });
  } catch (error) {
    logger.error('Ошибка удаления уведомления', { error: error.message });
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Удалить все уведомления
app.delete('/api/notifications', requireAuth, async (req, res) => {
  try {
    await notifications.removeAll(req.session.userId);
    res.json({ success: true, message: 'Все уведомления удалены' });
  } catch (error) {
    logger.error('Ошибка удаления уведомлений', { error: error.message });
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'notification-service', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

// Запуск сервера
(async () => {
  try {
    await initDatabase();
    logger.info('База данных инициализирована');

    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Notification Service запущен на порту ${PORT}`);
    });
  } catch (error) {
    logger.error('Ошибка инициализации', { error: error.message });
    process.exit(1);
  }
})();
