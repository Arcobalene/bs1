/**
 * Shared middleware for Beauty Studio microservices
 * Централизованные middleware для всех сервисов
 */

/**
 * Middleware для проверки авторизации
 * Читает userId из session или из заголовков (от gateway)
 */
function requireAuth(req, res, next) {
  // Проверяем заголовки от gateway
  const userIdFromHeader = req.headers['x-user-id'];

  if (userIdFromHeader) {
    if (!req.session) {
      req.session = {};
    }
    if (!req.session.userId) {
      req.session.userId = parseInt(userIdFromHeader);
    }
    if (req.headers['x-original-user-id'] && !req.session.originalUserId) {
      req.session.originalUserId = parseInt(req.headers['x-original-user-id']);
    }
  }

  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, message: 'Требуется авторизация' });
  }
  next();
}

/**
 * Централизованный error handler для всех сервисов
 */
function errorHandler(err, req, res, next) {
  // Игнорируем прерванные запросы
  if (err.message && (err.message.includes('request aborted') || err.message.includes('aborted'))) {
    return;
  }

  // JSON parsing errors
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    if (!res.headersSent) {
      return res.status(400).json({ success: false, message: 'Неверный формат JSON' });
    }
    return;
  }

  console.error('Ошибка:', err.message);
  if (!res.headersSent) {
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
}

/**
 * Настройка стандартного middleware для Express app
 */
function setupStandardMiddleware(app) {
  const express = require('express');
  const cookieParser = require('cookie-parser');

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());
  app.set('trust proxy', 1);
}

module.exports = {
  requireAuth,
  errorHandler,
  setupStandardMiddleware
};
