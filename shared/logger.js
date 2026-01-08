/**
 * Структурированное логирование
 * Использует простой формат JSON для совместимости с Docker и системами сбора логов
 */

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

const LOG_LEVEL_NAMES = ['ERROR', 'WARN', 'INFO', 'DEBUG'];

class Logger {
  constructor(serviceName, logLevel = 'INFO') {
    this.serviceName = serviceName;
    this.logLevel = LOG_LEVELS[logLevel.toUpperCase()] || LOG_LEVELS.INFO;
    this.isDevelopment = process.env.NODE_ENV === 'development';
  }

  _log(level, message, meta = {}) {
    if (LOG_LEVELS[level] > this.logLevel) {
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      message,
      ...meta
    };

    // В development выводим красиво, в production - JSON
    if (this.isDevelopment) {
      const colorMap = {
        ERROR: '\x1b[31m', // Red
        WARN: '\x1b[33m',  // Yellow
        INFO: '\x1b[36m',  // Cyan
        DEBUG: '\x1b[90m'  // Gray
      };
      const reset = '\x1b[0m';
      const color = colorMap[level] || '';
      console.log(`${color}[${level}]${reset} [${this.serviceName}] ${message}`, meta && Object.keys(meta).length > 0 ? meta : '');
    } else {
      console.log(JSON.stringify(logEntry));
    }
  }

  error(message, meta = {}) {
    this._log('ERROR', message, meta);
  }

  warn(message, meta = {}) {
    this._log('WARN', message, meta);
  }

  info(message, meta = {}) {
    this._log('INFO', message, meta);
  }

  debug(message, meta = {}) {
    this._log('DEBUG', message, meta);
  }
}

// Создаем логгеры для каждого сервиса
function createLogger(serviceName) {
  const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'DEBUG' : 'INFO');
  return new Logger(serviceName, logLevel);
}

module.exports = {
  Logger,
  createLogger
};

