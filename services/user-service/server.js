const express = require('express');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'user-service', timestamp: new Date().toISOString() });
});

// TODO: Реализовать endpoints для управления пользователями
app.get('/api/user', (req, res) => {
  res.status(501).json({ success: false, message: 'Not implemented yet' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`👥 User Service запущен на порту ${PORT}`);
});

