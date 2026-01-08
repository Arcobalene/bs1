/**
 * Централизованная обработка ошибок
 * Стандартизированные классы ошибок и обработчик для Express
 */

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, field = null) {
    super(message, 400, 'VALIDATION_ERROR', true);
    this.field = field;
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Требуется авторизация') {
    super(message, 401, 'AUTHENTICATION_ERROR', true);
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Недостаточно прав') {
    super(message, 403, 'AUTHORIZATION_ERROR', true);
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Ресурс') {
    super(`${resource} не найден`, 404, 'NOT_FOUND', true);
  }
}

class ConflictError extends AppError {
  constructor(message = 'Конфликт данных') {
    super(message, 409, 'CONFLICT_ERROR', true);
  }
}

/**
 * Middleware для обработки ошибок в Express
 */
function errorHandler(err, req, res, next) {
  // Если заголовки уже отправлены, передаем ошибку стандартному обработчику
  if (res.headersSent) {
    return next(err);
  }

  // Логируем ошибку
  const logger = req.app.locals.logger || console;
  const logData = {
    error: err.message,
    code: err.code || 'INTERNAL_ERROR',
    statusCode: err.statusCode || 500,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method,
    ip: req.ip
  };

  if (err.statusCode >= 500) {
    logger.error('Server error', logData);
  } else {
    logger.warn('Client error', logData);
  }

  // Отправляем ответ клиенту
  const statusCode = err.statusCode || 500;
  const response = {
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'Внутренняя ошибка сервера'
    }
  };

  // В development добавляем stack trace
  if (process.env.NODE_ENV === 'development' && err.stack) {
    response.error.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

/**
 * Async handler wrapper для автоматической обработки ошибок в async функциях
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  errorHandler,
  asyncHandler
};

