const express = require('express');

const app = express();
const PORT = process.env.PORT || 3007;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'telegram-service', timestamp: new Date().toISOString() });
});

// TODO: Реализовать endpoints для Telegram
app.post('/api/bot/webhook', (req, res) => {
  res.status(501).json({ success: false, message: 'Not implemented yet' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`📱 Telegram Service запущен на порту ${PORT}`);
});

