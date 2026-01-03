const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));

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

// HTML страницы (должны быть ДО API проксирования)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/index.html'));
});

app.get('/booking', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/booking.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/register.html'));
});

app.get('/register/master', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/register-master.html'));
});

app.get('/master', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/master.html'));
});

app.get('/master/calendar', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/master.html'));
});

app.get('/master/profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/master.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/admin.html'));
});

app.get('/calendar', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/calendar.html'));
});

app.get('/services', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/services.html'));
});

app.get('/users', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/users.html'));
});

app.get('/clients', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/clients.html'));
});

app.get('/client-cabinet', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/client-cabinet.html'));
});

app.get('/register-client', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/register-client.html'));
});

app.get('/login-client', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/login-client.html'));
});

app.get('/landing', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/landing.html'));
});

// Health check (перед API проксированием)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gateway', timestamp: new Date().toISOString() });
});

// Проксирование API запросов (после HTML страниц)
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚪 API Gateway запущен на порту ${PORT}`);
});

