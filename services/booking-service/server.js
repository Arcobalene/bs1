const express = require('express');

const app = express();
const PORT = process.env.PORT || 3003;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'booking-service', timestamp: new Date().toISOString() });
});

// TODO: Реализовать endpoints для управления записями
app.get('/api/bookings', (req, res) => {
  res.status(501).json({ success: false, message: 'Not implemented yet' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`📅 Booking Service запущен на порту ${PORT}`);
});

