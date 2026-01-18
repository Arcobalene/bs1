/**
 * Валидация и загрузка переменных окружения
 * Базовая валидация без внешних зависимостей
 */

function validateEnv() {
  // Валидация базы данных
  const dbType = process.env.DB_TYPE || 'postgres';
  if (!['postgres', 'sqlite'].includes(dbType)) {
    throw new Error('DB_TYPE должен быть postgres или sqlite');
  }

  const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
  if (isNaN(dbPort) || dbPort <= 0 || dbPort > 65535) {
    throw new Error('DB_PORT должен быть валидным портом (1-65535)');
  }

  const dbHost = process.env.DB_HOST || 'localhost';
  if (!dbHost || typeof dbHost !== 'string') {
    throw new Error('DB_HOST должен быть строкой');
  }

  const dbName = process.env.DB_NAME || 'beauty_studio';
  if (!dbName || typeof dbName !== 'string') {
    throw new Error('DB_NAME должен быть строкой');
  }

  const dbUser = process.env.DB_USER || 'beauty_user';
  if (!dbUser || typeof dbUser !== 'string') {
    throw new Error('DB_USER должен быть строкой');
  }

  const dbPassword = process.env.DB_PASSWORD || 'beauty_password';
  if (typeof dbPassword !== 'string') {
    throw new Error('DB_PASSWORD должен быть строкой');
  }

  // Валидация Redis
  const redisHost = process.env.REDIS_HOST || 'redis';
  if (!redisHost || typeof redisHost !== 'string') {
    throw new Error('REDIS_HOST должен быть строкой');
  }

  const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
  if (isNaN(redisPort) || redisPort <= 0 || redisPort > 65535) {
    throw new Error('REDIS_PORT должен быть валидным портом (1-65535)');
  }

  const redisPassword = process.env.REDIS_PASSWORD || '';
  if (typeof redisPassword !== 'string') {
    throw new Error('REDIS_PASSWORD должен быть строкой');
  }

  // Валидация сессий
  const sessionSecret = process.env.SESSION_SECRET || 'beauty-studio-secret-key-change-in-production';
  if (!sessionSecret || typeof sessionSecret !== 'string' || sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET должен быть строкой длиной минимум 32 символа');
  }

  // Валидация окружения
  const nodeEnv = process.env.NODE_ENV || 'production';
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    throw new Error('NODE_ENV должен быть development, production или test');
  }

  const port = parseInt(process.env.PORT || '3000', 10);
  if (isNaN(port) || port <= 0 || port > 65535) {
    throw new Error('PORT должен быть валидным портом (1-65535)');
  }

  const behindHttpsProxy = process.env.BEHIND_HTTPS_PROXY === 'true';

  // Валидация URL микросервисов
  function validateUrl(url, defaultUrl, serviceName) {
    if (!url) {
      return defaultUrl;
    }
    try {
      new URL(url);
      return url;
    } catch (e) {
      console.warn(`⚠️  Некорректный URL для ${serviceName}: ${url}, используется дефолтный: ${defaultUrl}`);
      return defaultUrl;
    }
  }

  const config = {
    // База данных
    DB_TYPE: dbType,
    DB_HOST: dbHost,
    DB_PORT: dbPort,
    DB_NAME: dbName,
    DB_USER: dbUser,
    DB_PASSWORD: dbPassword,

    // Redis
    REDIS_HOST: redisHost,
    REDIS_PORT: redisPort,
    REDIS_PASSWORD: redisPassword,

    // Сессии
    SESSION_SECRET: sessionSecret,

    // Окружение
    NODE_ENV: nodeEnv,
    PORT: port,
    BEHIND_HTTPS_PROXY: behindHttpsProxy,

    // Микросервисы
    AUTH_SERVICE_URL: validateUrl(process.env.AUTH_SERVICE_URL, 'http://auth-service:3001', 'AUTH_SERVICE_URL'),
    USER_SERVICE_URL: validateUrl(process.env.USER_SERVICE_URL, 'http://user-service:3002', 'USER_SERVICE_URL'),
    BOOKING_SERVICE_URL: validateUrl(process.env.BOOKING_SERVICE_URL, 'http://booking-service:3003', 'BOOKING_SERVICE_URL'),
    CATALOG_SERVICE_URL: validateUrl(process.env.CATALOG_SERVICE_URL, 'http://catalog-service:3004', 'CATALOG_SERVICE_URL'),
    FILE_SERVICE_URL: validateUrl(process.env.FILE_SERVICE_URL, 'http://file-service:3005', 'FILE_SERVICE_URL'),
    NOTIFICATION_SERVICE_URL: validateUrl(process.env.NOTIFICATION_SERVICE_URL, 'http://notification-service:3006', 'NOTIFICATION_SERVICE_URL'),
    TELEGRAM_SERVICE_URL: validateUrl(process.env.TELEGRAM_SERVICE_URL, 'http://telegram-service:3007', 'TELEGRAM_SERVICE_URL'),

    // MinIO
    MINIO_ENDPOINT: process.env.MINIO_ENDPOINT || 'minio',
    MINIO_PORT: parseInt(process.env.MINIO_PORT || '9000', 10),
    MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY || 'minioadmin',
    MINIO_USE_SSL: process.env.MINIO_USE_SSL === 'true',

    // Telegram
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_WEBHOOK_URL: process.env.TELEGRAM_WEBHOOK_URL || ''
  };

  // Предупреждение если используется дефолтный секрет в production
  if (config.SESSION_SECRET === 'beauty-studio-secret-key-change-in-production' && config.NODE_ENV === 'production') {
    console.warn('⚠️  ВНИМАНИЕ: Используется дефолтный SESSION_SECRET! Измените его в production!');
  }

  return config;
}

module.exports = {
  validateEnv
};

