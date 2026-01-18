const express = require('express');

// Импортируем общие модули
const { services, masters, users: dbUsers, initDatabase } = require('../../shared/database');
const { setupStandardMiddleware, requireAuth, errorHandler } = require('../../shared/middleware');

const app = express();
const PORT = process.env.PORT || 3004;

// Настройка стандартного middleware
setupStandardMiddleware(app);

// Session управляется централизованно в gateway
// Сервис получает userId через заголовок X-User-ID от gateway

// API: Обновить услуги
app.post('/api/services', requireAuth, async (req, res) => {
  try {
    const { services: servicesList } = req.body;
    const user = await dbUsers.getById(req.session.userId);
    
    if (!user || user.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    if (!Array.isArray(servicesList)) {
      return res.status(400).json({ success: false, message: 'services должен быть массивом' });
    }

    await services.setForUser(user.id, servicesList);
    res.json({ success: true, message: 'Услуги обновлены' });
  } catch (error) {
    console.error('Ошибка обновления услуг:', error);
    res.status(500).json({ success: false, message: error.message || 'Ошибка сервера' });
  }
});

// API: Получить услуги салона (публично)
app.get('/api/services/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`[Catalog Service] GET /api/services/${userId}`);
    const salonServices = await services.getByUserId(parseInt(userId));
    console.log(`[Catalog Service] Услуги найдены: ${salonServices ? salonServices.length : 0}`);
    res.json({ success: true, services: salonServices });
  } catch (error) {
    console.error('[Catalog Service] Ошибка получения услуг:', error);
    console.error('[Catalog Service] Стек ошибки:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Ошибка сервера',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// API: Обновить мастеров
app.post('/api/masters', requireAuth, async (req, res) => {
  try {
    const { masters: mastersList } = req.body;
    const user = await dbUsers.getById(req.session.userId);
    
    if (!user || user.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    if (!Array.isArray(mastersList)) {
      return res.status(400).json({ success: false, message: 'masters должен быть массивом' });
    }

    await masters.setForUser(user.id, mastersList);
    res.json({ success: true, message: 'Мастера обновлены' });
  } catch (error) {
    console.error('Ошибка обновления мастеров:', error);
    res.status(500).json({ success: false, message: error.message || 'Ошибка сервера' });
  }
});

// API: Получить мастеров салона (публично)
app.get('/api/masters/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(`[Catalog Service] GET /api/masters/${userId}`);
    const salonMasters = await masters.getByUserId(parseInt(userId));
    console.log(`[Catalog Service] Мастера найдены: ${salonMasters ? salonMasters.length : 0}`);
    res.json({ success: true, masters: salonMasters });
  } catch (error) {
    console.error('[Catalog Service] Ошибка получения мастеров:', error);
    console.error('[Catalog Service] Стек ошибки:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Ошибка сервера',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// API: Поиск мастеров
app.get('/api/masters/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || query.trim().length < 2) {
      return res.json({ success: true, masters: [] });
    }

    // Получаем всех мастеров (в реальном приложении можно добавить полнотекстовый поиск)
    // Здесь упрощенная версия - возвращаем пустой массив
    // Для полноценного поиска нужен более сложный SQL запрос
    res.json({ success: true, masters: [] });
  } catch (error) {
    console.error('Ошибка поиска мастеров:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'catalog-service', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

// Запуск сервера
(async () => {
  try {
    await initDatabase();
    console.log('✅ База данных инициализирована');
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`📋 Catalog Service запущен на порту ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Ошибка инициализации:', error);
    process.exit(1);
  }
})();
