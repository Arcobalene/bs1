const express = require('express');

const app = express();
const PORT = process.env.PORT || 3006;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'notification-service', timestamp: new Date().toISOString() });
});

// TODO: Реализовать endpoints для уведомлений
app.get('/api/notifications', (req, res) => {
  res.status(501).json({ success: false, message: 'Not implemented yet' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🔔 Notification Service запущен на порту ${PORT}`);
});

