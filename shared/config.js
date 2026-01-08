/**
 * Валидация и загрузка переменных окружения
 * Использует envalid для строгой валидации
 */

// Для совместимости, если envalid не установлен, используем базовую валидацию
let envalid;
try {
  envalid = require('envalid');
} catch (e) {
  // Fallback если envalid не установлен
  envalid = null;
}

function validateEnv() {
  if (envalid) {
    return envalid.cleanEnv(process.env, {
      // База данных
      DB_TYPE: envalid.str({ choices: ['postgres', 'sqlite'], default: 'postgres' }),
      DB_HOST: envalid.host({ default: 'localhost' }),
      DB_PORT: envalid.port({ default: 5432 }),
      DB_NAME: envalid.str({ default: 'beauty_studio' }),
      DB_USER: envalid.str({ default: 'beauty_user' }),
      DB_PASSWORD: envalid.str({ default: 'beauty_password' }),

      // Redis
      REDIS_HOST: envalid.host({ default: 'redis' }),
      REDIS_PORT: envalid.port({ default: 6379 }),
      REDIS_PASSWORD: envalid.str({ default: '', devDefault: '' }),

      // Сессии
      SESSION_SECRET: envalid.str({
        desc: 'Секретный ключ для подписи сессий',
        default: 'beauty-studio-secret-key-change-in-production'
      }),

      // Окружение
      NODE_ENV: envalid.str({ choices: ['development', 'production', 'test'], default: 'production' }),
      PORT: envalid.port({ default: 3000 }),
      BEHIND_HTTPS_PROXY: envalid.bool({ default: false }),

      // Микросервисы (опционально)
      AUTH_SERVICE_URL: envalid.url({ default: 'http://auth-service:3001' }),
      USER_SERVICE_URL: envalid.url({ default: 'http://user-service:3002' }),
      BOOKING_SERVICE_URL: envalid.url({ default: 'http://booking-service:3003' }),
      CATALOG_SERVICE_URL: envalid.url({ default: 'http://catalog-service:3004' }),
      FILE_SERVICE_URL: envalid.url({ default: 'http://file-service:3005' }),
      NOTIFICATION_SERVICE_URL: envalid.url({ default: 'http://notification-service:3006' }),
      TELEGRAM_SERVICE_URL: envalid.url({ default: 'http://telegram-service:3007' })
    });
  } else {
    // Базовая валидация без envalid
    const config = {
      DB_TYPE: process.env.DB_TYPE || 'postgres',
      DB_HOST: process.env.DB_HOST || 'localhost',
      DB_PORT: parseInt(process.env.DB_PORT || '5432', 10),
      DB_NAME: process.env.DB_NAME || 'beauty_studio',
      DB_USER: process.env.DB_USER || 'beauty_user',
      DB_PASSWORD: process.env.DB_PASSWORD || 'beauty_password',
      REDIS_HOST: process.env.REDIS_HOST || 'redis',
      REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379', 10),
      REDIS_PASSWORD: process.env.REDIS_PASSWORD || '',
      SESSION_SECRET: process.env.SESSION_SECRET || 'beauty-studio-secret-key-change-in-production',
      NODE_ENV: process.env.NODE_ENV || 'production',
      PORT: parseInt(process.env.PORT || '3000', 10),
      BEHIND_HTTPS_PROXY: process.env.BEHIND_HTTPS_PROXY === 'true',
      AUTH_SERVICE_URL: process.env.AUTH_SERVICE_URL || 'http://auth-service:3001',
      USER_SERVICE_URL: process.env.USER_SERVICE_URL || 'http://user-service:3002',
      BOOKING_SERVICE_URL: process.env.BOOKING_SERVICE_URL || 'http://booking-service:3003',
      CATALOG_SERVICE_URL: process.env.CATALOG_SERVICE_URL || 'http://catalog-service:3004',
      FILE_SERVICE_URL: process.env.FILE_SERVICE_URL || 'http://file-service:3005',
      NOTIFICATION_SERVICE_URL: process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3006',
      TELEGRAM_SERVICE_URL: process.env.TELEGRAM_SERVICE_URL || 'http://telegram-service:3007'
    };

    // Предупреждение если используется дефолтный секрет
    if (config.SESSION_SECRET === 'beauty-studio-secret-key-change-in-production' && config.NODE_ENV === 'production') {
      console.warn('⚠️  ВНИМАНИЕ: Используется дефолтный SESSION_SECRET! Измените его в production!');
    }

    return config;
  }
}

module.exports = {
  validateEnv
};

