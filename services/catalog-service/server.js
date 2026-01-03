const express = require('express');

const app = express();
const PORT = process.env.PORT || 3004;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'catalog-service', timestamp: new Date().toISOString() });
});

// TODO: Реализовать endpoints для услуг и мастеров
app.get('/api/services/:userId', (req, res) => {
  res.status(501).json({ success: false, message: 'Not implemented yet' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`📋 Catalog Service запущен на порту ${PORT}`);
});

