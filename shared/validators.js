/**
 * Общие валидаторы для всех сервисов
 */

/**
 * Валидация положительного целого числа
 * @param {any} value - значение для валидации
 * @param {string} name - имя параметра (для сообщения об ошибке)
 * @returns {{valid: boolean, value?: number, message?: string}}
 */
function validatePositiveInt(value, name = 'ID') {
  if (value === undefined || value === null || value === '') {
    return { valid: false, message: `${name} обязателен` };
  }

  const num = parseInt(value, 10);
  if (isNaN(num)) {
    return { valid: false, message: `${name} должен быть числом` };
  }

  if (num <= 0) {
    return { valid: false, message: `${name} должен быть положительным числом` };
  }

  return { valid: true, value: num };
}

/**
 * Валидация имени файла (защита от path traversal)
 * @param {string} filename - имя файла
 * @returns {{valid: boolean, message?: string}}
 */
function validateFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return { valid: false, message: 'Имя файла обязательно' };
  }

  // Проверка на path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return { valid: false, message: 'Недопустимые символы в имени файла' };
  }

  // Проверка на запрещённые символы Windows/Linux
  if (/[<>:"|?*\x00-\x1f]/.test(filename)) {
    return { valid: false, message: 'Недопустимые символы в имени файла' };
  }

  // Проверка на слишком длинное имя
  if (filename.length > 255) {
    return { valid: false, message: 'Имя файла слишком длинное' };
  }

  return { valid: true };
}

/**
 * Валидация даты в формате YYYY-MM-DD
 * @param {string} dateStr - строка даты
 * @returns {{valid: boolean, value?: Date, message?: string}}
 */
function validateDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') {
    return { valid: false, message: 'Дата обязательна' };
  }

  // Проверка формата
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { valid: false, message: 'Дата должна быть в формате YYYY-MM-DD' };
  }

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return { valid: false, message: 'Некорректная дата' };
  }

  return { valid: true, value: date };
}

/**
 * Валидация времени в формате HH:MM
 * @param {string} timeStr - строка времени
 * @returns {{valid: boolean, message?: string}}
 */
function validateTime(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') {
    return { valid: false, message: 'Время обязательно' };
  }

  // Проверка формата HH:MM
  if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(timeStr)) {
    return { valid: false, message: 'Время должно быть в формате HH:MM' };
  }

  return { valid: true };
}

/**
 * Middleware для валидации параметров запроса
 * @param {Object} schema - схема валидации {paramName: validatorFn}
 * @param {string} source - источник параметров ('params', 'query', 'body')
 */
function validateRequest(schema, source = 'params') {
  return (req, res, next) => {
    const data = req[source];
    const errors = [];
    req.validated = req.validated || {};

    for (const [param, validator] of Object.entries(schema)) {
      const result = validator(data[param], param);
      if (!result.valid) {
        errors.push(result.message);
      } else if (result.value !== undefined) {
        req.validated[param] = result.value;
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: errors.join('; ')
      });
    }

    next();
  };
}

/**
 * Валидация лимита для пагинации
 * @param {any} value - значение лимита
 * @param {number} maxLimit - максимальный допустимый лимит
 * @returns {{valid: boolean, value?: number, message?: string}}
 */
function validateLimit(value, maxLimit = 100) {
  if (value === undefined || value === null || value === '') {
    return { valid: true, value: 20 }; // дефолт
  }

  const num = parseInt(value, 10);
  if (isNaN(num) || num < 1) {
    return { valid: false, message: 'limit должен быть положительным числом' };
  }

  if (num > maxLimit) {
    return { valid: true, value: maxLimit }; // ограничиваем максимум
  }

  return { valid: true, value: num };
}

/**
 * Валидация offset для пагинации
 * @param {any} value - значение offset
 * @returns {{valid: boolean, value?: number, message?: string}}
 */
function validateOffset(value) {
  if (value === undefined || value === null || value === '') {
    return { valid: true, value: 0 }; // дефолт
  }

  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0) {
    return { valid: false, message: 'offset должен быть неотрицательным числом' };
  }

  return { valid: true, value: num };
}

module.exports = {
  validatePositiveInt,
  validateFilename,
  validateDate,
  validateTime,
  validateRequest,
  validateLimit,
  validateOffset
};
