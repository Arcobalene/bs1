const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Статические файлы
app.use(express.static(path.join(__dirname, '../public')));

// Проксирование к микросервисам
const services = {
  auth: process.env.AUTH_SERVICE_URL || 'http://auth-service:3001',
  user: process.env.USER_SERVICE_URL || 'http://user-service:3002',
  booking: process.env.BOOKING_SERVICE_URL || 'http://booking-service:3003',
  catalog: process.env.CATALOG_SERVICE_URL || 'http://catalog-service:3004',
  file: process.env.FILE_SERVICE_URL || 'http://file-service:3005',
  notification: process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3006',
  telegram: process.env.TELEGRAM_SERVICE_URL || 'http://telegram-service:3007'
};

// Проксирование API запросов
app.use('/api/register', createProxyMiddleware({ target: services.auth, changeOrigin: true }));
app.use('/api/login', createProxyMiddleware({ target: services.auth, changeOrigin: true }));
app.use('/api/logout', createProxyMiddleware({ target: services.auth, changeOrigin: true }));

app.use('/api/user', createProxyMiddleware({ target: services.user, changeOrigin: true }));
app.use('/api/users', createProxyMiddleware({ target: services.user, changeOrigin: true }));
app.use('/api/salon', createProxyMiddleware({ target: services.user, changeOrigin: true }));
app.use('/api/clients', createProxyMiddleware({ target: services.user, changeOrigin: true }));

app.use('/api/bookings', createProxyMiddleware({ target: services.booking, changeOrigin: true }));

app.use('/api/services', createProxyMiddleware({ target: services.catalog, changeOrigin: true }));
app.use('/api/masters', createProxyMiddleware({ target: services.catalog, changeOrigin: true }));

app.use('/api/minio', createProxyMiddleware({ target: services.file, changeOrigin: true }));

app.use('/api/notifications', createProxyMiddleware({ target: services.notification, changeOrigin: true }));

app.use('/api/telegram', createProxyMiddleware({ target: services.telegram, changeOrigin: true }));
app.use('/api/bot', createProxyMiddleware({ target: services.telegram, changeOrigin: true }));

// HTML страницы
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/index.html'));
});

app.get('/booking', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/booking.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/login.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gateway', timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚪 API Gateway запущен на порту ${PORT}`);
});

