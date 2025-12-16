const express = require('express');
const https = require('https');
const { users: dbUsers } = require('./database');
const { normalizeToE164 } = require('./utils');

const app = express();

// Безопасность: ограничение размера тела запроса
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.TELEGRAM_BOT_PORT || 3001;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || null;

// Кэш для токена бота (TTL: 1 минута)
let cachedBotToken = null;
let tokenCacheTime = 0;
const TOKEN_CACHE_TTL = 60000; // 1 минута

// Константы для Telegram API
const TELEGRAM_API_URL = 'https://api.telegram.org';
const MAX_MESSAGE_LENGTH = 4096; // Лимит Telegram API
const MAX_PHONE_LENGTH = 20;

// Валидация telegramId (должен быть положительным числом)
function validateTelegramId(telegramId) {
  if (telegramId === null || telegramId === undefined) {
    return { valid: false, message: 'telegramId обязателен' };
  }
  const id = typeof telegramId === 'string' ? parseInt(telegramId, 10) : telegramId;
  if (!Number.isInteger(id) || id <= 0) {
    return { valid: false, message: 'telegramId должен быть положительным целым числом' };
  }
  return { valid: true, id };
}

// Валидация сообщения
function validateMessage(message) {
  if (!message || typeof message !== 'string') {
    return { valid: false, message: 'Сообщение должно быть непустой строкой' };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { valid: false, message: `Сообщение слишком длинное (максимум ${MAX_MESSAGE_LENGTH} символов)` };
  }
  return { valid: true };
}

// Валидация номера телефона
function validatePhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return { valid: false, message: 'Номер телефона обязателен' };
  }
  if (phone.length > MAX_PHONE_LENGTH) {
    return { valid: false, message: 'Номер телефона слишком длинный' };
  }
  const phoneDigits = phone.replace(/\D/g, '');
  if (phoneDigits.length < 9) {
    return { valid: false, message: 'Номер телефона должен содержать минимум 9 цифр' };
  }
  return { valid: true };
}

// Функция для получения токена бота из БД (оптимизированная)
async function getBotTokenFromDb() {
  try {
    // Используем кэш, если он еще актуален
    const now = Date.now();
    if (cachedBotToken && (now - tokenCacheTime) < TOKEN_CACHE_TTL) {
      return cachedBotToken;
    }

    // Оптимизация: ищем только админов с токеном через SQL запрос
    // Вместо загрузки всех пользователей
    const { Pool } = require('pg');
    const pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'beauty_studio',
      user: process.env.DB_USER || 'beauty_user',
      password: process.env.DB_PASSWORD || 'beauty_password',
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });

    const result = await pool.query(
      'SELECT bot_token FROM users WHERE (role = $1 OR username = $2) AND bot_token IS NOT NULL AND bot_token != \'\' LIMIT 1',
      ['admin', 'admin']
    );
    
    await pool.end();

    if (result.rows.length > 0 && result.rows[0].bot_token) {
      const token = result.rows[0].bot_token.trim();
      // Кэшируем токен
      cachedBotToken = token;
      tokenCacheTime = now;
      return token;
    }
  } catch (error) {
    console.error('Ошибка получения токена из БД:', error.message);
    // Не пробрасываем ошибку, возвращаем null для fallback
  }
  return null;
}

// Функция для получения токена бота
async function getTelegramBotToken() {
  // Сначала проверяем переменные окружения
  if (TELEGRAM_BOT_TOKEN) {
    return TELEGRAM_BOT_TOKEN;
  }
  // Затем проверяем БД
  return await getBotTokenFromDb();
}

// Универсальная функция для HTTP запросов к Telegram API
function makeTelegramRequest(botToken, method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!botToken || typeof botToken !== 'string') {
      reject(new Error('Некорректный токен бота'));
      return;
    }

    const url = new URL(`${TELEGRAM_API_URL}/bot${botToken}/${method}`);
    const postData = JSON.stringify(params);
    
    console.log(`🌐 Запрос к Telegram API: ${method}`);
    console.log(`   URL: ${url.hostname}${url.pathname}`);
    console.log(`   Размер данных: ${Buffer.byteLength(postData)} байт`);
    
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 10000
    };
    
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          
          console.log(`📥 Ответ от Telegram API (${method}):`, {
            statusCode: res.statusCode,
            ok: jsonData.ok,
            description: jsonData.description || 'нет',
            error_code: jsonData.error_code || 'нет'
          });
          
          if (res.statusCode !== 200) {
            const errorMsg = `HTTP ${res.statusCode}: ${jsonData.description || 'Ошибка Telegram API'}`;
            console.error(`❌ Ошибка Telegram API: ${errorMsg}`);
            reject(new Error(errorMsg));
            return;
          }
          
          if (!jsonData.ok) {
            const errorMsg = jsonData.description || 'Ошибка Telegram API';
            console.error(`❌ Telegram API вернул ошибку: ${errorMsg} (код: ${jsonData.error_code || 'неизвестен'})`);
            reject(new Error(errorMsg));
            return;
          }
          
          console.log(`✅ Telegram API успешно обработал запрос ${method}`);
          resolve(jsonData.result);
        } catch (error) {
          console.error(`❌ Ошибка парсинга ответа от Telegram API:`, error.message);
          console.error(`   Ответ сервера:`, data.substring(0, 500));
          reject(new Error('Ошибка парсинга ответа от Telegram API: ' + error.message));
        }
      });
    });
    
    req.on('error', (error) => {
      console.error(`❌ Ошибка соединения с Telegram API:`, error.message);
      reject(new Error('Ошибка соединения с Telegram API: ' + error.message));
    });
    
    req.on('timeout', () => {
      console.error(`❌ Таймаут при обращении к Telegram API`);
      req.destroy();
      reject(new Error('Таймаут при обращении к Telegram API'));
    });
    
    req.setTimeout(10000);
    req.write(postData);
    req.end();
  });
}

// Функция для отправки сообщения в Telegram
async function sendTelegramMessage(botToken, chatId, message) {
  // Валидация chatId
  const chatIdValidation = validateTelegramId(chatId);
  if (!chatIdValidation.valid) {
    throw new Error(chatIdValidation.message);
  }

  // Валидация сообщения
  const messageValidation = validateMessage(message);
  if (!messageValidation.valid) {
    throw new Error(messageValidation.message);
  }

  return await makeTelegramRequest(botToken, 'sendMessage', {
    chat_id: chatIdValidation.id,
    text: message,
    parse_mode: 'HTML'
  });
}

// Функция для отправки сообщения с кнопкой запроса контакта
async function sendTelegramMessageWithContactButton(chatId, message) {
  console.log(`📤 Отправка сообщения с кнопкой контакта: chatId=${chatId}`);
  
  const botToken = await getTelegramBotToken();
  if (!botToken) {
    console.error('❌ Токен Telegram бота не настроен');
    throw new Error('Токен Telegram бота не настроен');
  }

  console.log(`✅ Токен бота получен (длина: ${botToken.length} символов)`);

  // Валидация chatId
  const chatIdValidation = validateTelegramId(chatId);
  if (!chatIdValidation.valid) {
    console.error(`❌ Некорректный chatId: ${chatId}`);
    throw new Error(chatIdValidation.message);
  }

  // Валидация сообщения
  const messageValidation = validateMessage(message);
  if (!messageValidation.valid) {
    console.error(`❌ Некорректное сообщение: ${messageValidation.message}`);
    throw new Error(messageValidation.message);
  }

  const requestData = {
    chat_id: chatIdValidation.id,
    text: message,
    parse_mode: 'HTML',
    reply_markup: {
      keyboard: [[{
        text: '📱 Отправить контакт',
        request_contact: true
      }]],
      one_time_keyboard: true,
      resize_keyboard: true
    }
  };

  console.log(`📋 Данные запроса к Telegram API:`, JSON.stringify({
    chat_id: requestData.chat_id,
    text_length: requestData.text.length,
    has_reply_markup: !!requestData.reply_markup,
    reply_markup_type: requestData.reply_markup ? 'keyboard' : 'нет'
  }, null, 2));

  try {
    const result = await makeTelegramRequest(botToken, 'sendMessage', requestData);
    console.log(`✅ Сообщение с кнопкой контакта успешно отправлено`);
    return result;
  } catch (error) {
    console.error(`❌ Ошибка при отправке сообщения с кнопкой контакта:`, error.message);
    console.error(`  Stack:`, error.stack);
    throw error;
  }
}

// Функция для получения информации о боте
async function getBotInfo() {
  const botToken = await getTelegramBotToken();
  if (!botToken) {
    throw new Error('Токен бота не найден');
  }

  return await makeTelegramRequest(botToken, 'getMe');
}

// Функция для установки webhook
async function setWebhook(webhookUrl) {
  const botToken = await getTelegramBotToken();
  if (!botToken) {
    throw new Error('Токен бота не найден');
  }

  console.log(`🔗 Установка webhook: ${webhookUrl}`);
  
  try {
    // makeTelegramRequest возвращает result, если ok=true, иначе выбрасывает ошибку
    // Поэтому если функция не выбросила ошибку, значит webhook установлен успешно
    const result = await makeTelegramRequest(botToken, 'setWebhook', {
      url: webhookUrl
    });
    
    // Если дошли сюда, значит запрос успешен (makeTelegramRequest выбрасывает ошибку при ok=false)
    console.log(`✅ Webhook успешно установлен: ${webhookUrl}`);
    return { success: true, message: 'Webhook установлен' };
  } catch (error) {
    console.error(`❌ Ошибка при установке webhook:`, error.message);
    return { success: false, message: error.message };
  }
}

// Функция для получения информации о текущем webhook
async function getWebhookInfo() {
  const botToken = await getTelegramBotToken();
  if (!botToken) {
    throw new Error('Токен бота не найден');
  }

  try {
    const result = await makeTelegramRequest(botToken, 'getWebhookInfo');
    return result;
  } catch (error) {
    console.error(`❌ Ошибка при получении информации о webhook:`, error.message);
    throw error;
  }
}

// API: Получить информацию о боте
app.get('/api/bot/info', async (req, res) => {
  try {
    const botInfo = await getBotInfo();
    res.json({ success: true, botInfo });
  } catch (error) {
    console.error('Ошибка получения информации о боте:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// API: Отправить уведомление
app.post('/api/bot/send-notification', async (req, res) => {
  try {
    const { telegramId, message } = req.body;
    
    console.log(`📨 Получен запрос на отправку уведомления: telegramId=${telegramId}, message length=${message ? message.length : 0}`);
    
    // Валидация входных данных
    if (telegramId === undefined || message === undefined) {
      console.error('❌ Отсутствуют обязательные поля: telegramId или message');
      return res.status(400).json({ success: false, message: 'telegramId и message обязательны' });
    }

    const telegramIdValidation = validateTelegramId(telegramId);
    if (!telegramIdValidation.valid) {
      console.error('❌ Некорректный telegramId:', telegramId);
      return res.status(400).json({ success: false, message: telegramIdValidation.message });
    }

    const messageValidation = validateMessage(message);
    if (!messageValidation.valid) {
      console.error('❌ Некорректное сообщение:', messageValidation.message);
      return res.status(400).json({ success: false, message: messageValidation.message });
    }
    
    console.log(`🔑 Получение токена бота...`);
    const botToken = await getTelegramBotToken();
    if (!botToken) {
      console.error('❌ Токен бота не настроен. Проверьте переменную окружения TELEGRAM_BOT_TOKEN или настройте токен в БД для админа.');
      return res.status(503).json({ success: false, message: 'Токен бота не настроен' });
    }
    
    console.log(`✅ Токен бота получен (длина: ${botToken.length} символов), отправка сообщения на telegramId=${telegramIdValidation.id}...`);
    await sendTelegramMessage(botToken, telegramIdValidation.id, message);
    console.log(`✅ Уведомление успешно отправлено на telegramId=${telegramIdValidation.id}`);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка отправки уведомления:', error.message);
    console.error('  Stack:', error.stack);
    // Не раскрываем детали ошибки клиенту для безопасности
    const errorMessage = error.message.includes('HTTP') ? 'Ошибка при отправке сообщения' : error.message;
    res.status(500).json({ success: false, message: errorMessage });
  }
});

// Валидация структуры update от Telegram
function validateTelegramUpdate(update) {
  if (!update || typeof update !== 'object') {
    return { valid: false, message: 'Некорректный формат update' };
  }
  
  if (update.message) {
    if (!update.message.from || !update.message.from.id) {
      return { valid: false, message: 'Отсутствует from.id в сообщении' };
    }
    
    const fromIdValidation = validateTelegramId(update.message.from.id);
    if (!fromIdValidation.valid) {
      return { valid: false, message: 'Некорректный from.id' };
    }
  }
  
  return { valid: true };
}

// Вебхук для обработки сообщений от Telegram бота
app.post('/api/bot/webhook', async (req, res) => {
  // Устанавливаем таймаут для ответа (Telegram ожидает ответ в течение 60 секунд)
  res.setTimeout(50000, () => {
    console.error('❌ Таймаут ответа webhook');
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Таймаут обработки' });
    }
  });

  try {
    console.log('📨 Получен webhook запрос от Telegram');
    console.log('   Headers:', JSON.stringify(req.headers, null, 2));
    
    const botToken = await getTelegramBotToken();
    if (!botToken) {
      console.error('❌ Токен бота не найден');
      return res.status(503).json({ success: false, message: 'Telegram бот не настроен' });
    }

    console.log(`✅ Токен бота получен (длина: ${botToken.length} символов)`);

    const update = req.body;
    console.log('📋 Update от Telegram:', JSON.stringify(update, null, 2));
    
    // Валидация структуры update
    const updateValidation = validateTelegramUpdate(update);
    if (!updateValidation.valid) {
      console.error('❌ Некорректный update:', updateValidation.message);
      return res.status(400).json({ success: false, message: updateValidation.message });
    }
    
    // Обрабатываем команду /start connect
    if (update.message && update.message.text && update.message.text.startsWith('/start')) {
      const from = update.message.from;
      const telegramId = from.id;
      const text = update.message.text;
      
      console.log(`📝 Обработка команды /start: telegramId=${telegramId}, text="${text}"`);
      
      // Валидация telegramId
      const telegramIdValidation = validateTelegramId(telegramId);
      if (!telegramIdValidation.valid) {
        console.error('❌ Некорректный telegramId в команде /start:', telegramId);
        try {
          await sendTelegramMessage(botToken, telegramId, '❌ Ошибка: Некорректный Telegram ID.');
        } catch (error) {
          console.error('Ошибка отправки сообщения об ошибке:', error.message);
        }
        return res.status(400).json({ success: false, message: 'Некорректный идентификатор пользователя' });
      }
      
      // Если команда /start connect, отправляем сообщение с кнопкой запроса контакта
      if (text.includes('connect')) {
        console.log(`🔗 Обработка команды /start connect для telegramId=${telegramIdValidation.id}`);
        try {
          const result = await sendTelegramMessageWithContactButton(telegramIdValidation.id, 
            '👋 Привет! Для подключения уведомлений о записях в салоне, пожалуйста, отправьте ваш контакт.\n\n' +
            '📱 Нажмите кнопку ниже, чтобы отправить ваш номер телефона.\n\n' +
            '⚠️ Важно: номер телефона должен совпадать с номером, указанным в настройках вашего салона.');
          console.log(`✅ Запрос контакта отправлен на telegramId=${telegramIdValidation.id}, message_id=${result.message_id || 'неизвестен'}`);
          // Отправляем ответ webhook'у ДО завершения обработки
          res.json({ success: true, message: 'Запрос контакта отправлен' });
          return;
        } catch (error) {
          console.error('❌ Ошибка отправки сообщения с кнопкой контакта:', error.message);
          console.error('  Stack:', error.stack);
          // Отправляем ответ об ошибке
          res.status(500).json({ success: false, message: 'Ошибка отправки сообщения: ' + error.message });
          return;
        }
      }
      
      // Обычная команда /start
      console.log(`👋 Обработка обычной команды /start для telegramId=${telegramIdValidation.id}`);
      try {
        await sendTelegramMessage(botToken, telegramIdValidation.id, 
          '👋 Привет! Я бот для уведомлений о записях в салоне.\n\n' +
          'Для подключения уведомлений перейдите в настройки салона и нажмите "Подключить Telegram".');
        console.log(`✅ Приветствие отправлено на telegramId=${telegramIdValidation.id}`);
        return res.json({ success: true, message: 'Приветствие отправлено' });
      } catch (error) {
        console.error('❌ Ошибка отправки приветствия:', error.message);
        console.error('  Stack:', error.stack);
        return res.status(500).json({ success: false, message: 'Ошибка отправки сообщения' });
      }
    }
    
    // Обрабатываем сообщения с контактом
    if (update.message && update.message.contact) {
      const message = update.message;
      const contact = message.contact;
      const from = message.from;

      // Валидация структуры контакта
      if (!contact || !from) {
        console.error('Некорректная структура контакта');
        return res.status(400).json({ success: false, message: 'Некорректная структура контакта' });
      }

      // Валидация: contact.user_id должен совпадать с message.from.id
      const fromIdValidation = validateTelegramId(from.id);
      const contactUserIdValidation = validateTelegramId(contact.user_id);
      
      if (!fromIdValidation.valid || !contactUserIdValidation.valid) {
        console.error('Некорректные ID в контакте');
        return res.status(400).json({ success: false, message: 'Некорректные идентификаторы' });
      }

      if (contactUserIdValidation.id !== fromIdValidation.id) {
        console.error(`❌ Несоответствие ID: contact.user_id=${contact.user_id}, message.from.id=${from.id}`);
        try {
          await sendTelegramMessage(botToken, fromIdValidation.id, 
            '❌ Ошибка: ID контакта не совпадает с вашим Telegram ID. Попробуйте еще раз.');
        } catch (error) {
          console.error('Ошибка отправки сообщения об ошибке:', error.message);
        }
        return res.json({ success: false, message: 'Несоответствие идентификаторов' });
      }

      const telegramId = fromIdValidation.id;
      const phone = contact.phone_number;

      // Валидация номера телефона
      const phoneValidation = validatePhone(phone);
      if (!phoneValidation.valid) {
        try {
          await sendTelegramMessage(botToken, telegramId, 
            '❌ Ошибка: ' + phoneValidation.message);
        } catch (error) {
          console.error('Ошибка отправки сообщения об ошибке:', error.message);
        }
        return res.status(400).json({ success: false, message: phoneValidation.message });
      }

      // Нормализуем номер телефона в E.164
      const normalizedPhone = normalizeToE164(phone);
      console.log(`🔍 Поиск владельца по номеру телефона: ${normalizedPhone} (исходный: ${phone})`);
      
      // Ищем владельца салона по номеру телефона
      let owner;
      try {
        owner = await dbUsers.getByPhone(normalizedPhone);
        if (owner) {
          console.log(`✅ Владелец найден: userId=${owner.id}, salon_name="${owner.salon_name}", salon_phone="${owner.salon_phone}"`);
        } else {
          console.log(`❌ Владелец не найден для номера: ${normalizedPhone}`);
        }
      } catch (error) {
        console.error('Ошибка поиска владельца по телефону:', error.message);
        console.error('Stack:', error.stack);
        try {
          await sendTelegramMessage(botToken, telegramId, 
            '❌ Ошибка сервера при поиске вашего аккаунта. Попробуйте позже.');
        } catch (sendError) {
          console.error('Ошибка отправки сообщения об ошибке:', sendError.message);
        }
        return res.status(500).json({ success: false, message: 'Ошибка поиска владельца' });
      }
      
      if (!owner) {
        try {
          await sendTelegramMessage(botToken, telegramId, 
            `❌ Владелец салона с номером ${normalizedPhone} не найден.\n\n` +
            'Убедитесь, что номер телефона указан в настройках салона (вкладка "Информация о салоне").');
        } catch (error) {
          console.error('Ошибка отправки сообщения об ошибке:', error.message);
        }
        return res.json({ success: false, message: 'Владелец салона не найден' });
      }

      // Проверяем, что telegram_id еще не занят другим владельцем
      let existingOwner;
      try {
        existingOwner = await dbUsers.getByTelegramId(telegramId);
      } catch (error) {
        console.error('Ошибка проверки существующего владельца:', error.message);
        try {
          await sendTelegramMessage(botToken, telegramId, 
            '❌ Ошибка сервера. Попробуйте позже.');
        } catch (sendError) {
          console.error('Ошибка отправки сообщения об ошибке:', sendError.message);
        }
        return res.status(500).json({ success: false, message: 'Ошибка проверки владельца' });
      }

      if (existingOwner && existingOwner.id !== owner.id) {
        try {
          await sendTelegramMessage(botToken, telegramId, 
            '❌ Этот Telegram аккаунт уже привязан к другому владельцу салона.');
        } catch (error) {
          console.error('Ошибка отправки сообщения об ошибке:', error.message);
        }
        return res.json({ success: false, message: 'Telegram аккаунт уже привязан' });
      }

      // Сохраняем telegram_id на запись владельца салона
      console.log(`💾 Сохранение telegram_id для владельца: userId=${owner.id}, telegramId=${telegramId}`);
      try {
        await dbUsers.update(owner.id, { telegramId: telegramId });
        console.log(`✅ Telegram аккаунт успешно привязан: ownerId=${owner.id}, telegramId=${telegramId}, phone=${normalizedPhone}, salonUrl=${process.env.SALON_BASE_URL || 'http://155.212.184.10'}/booking?userId=${owner.id}`);
      } catch (error) {
        console.error('Ошибка сохранения telegram_id:', error.message);
        console.error('Stack:', error.stack);
        // Проверяем, не связана ли ошибка с уникальностью
        if (error.message && (error.message.includes('unique') || error.message.includes('duplicate'))) {
          try {
            await sendTelegramMessage(botToken, telegramId, 
              '❌ Этот Telegram аккаунт уже привязан к другому пользователю.');
          } catch (sendError) {
            console.error('Ошибка отправки сообщения об ошибке:', sendError.message);
          }
          return res.status(409).json({ success: false, message: 'Telegram аккаунт уже привязан' });
        }
        try {
          await sendTelegramMessage(botToken, telegramId, 
            '❌ Ошибка сервера при сохранении. Попробуйте позже.');
        } catch (sendError) {
          console.error('Ошибка отправки сообщения об ошибке:', sendError.message);
        }
        return res.status(500).json({ success: false, message: 'Ошибка сохранения' });
      }
      
      // Отправляем подтверждение владельцу
      const salonUrl = process.env.SALON_BASE_URL || 'http://155.212.184.10';
      try {
        await sendTelegramMessage(botToken, telegramId, 
          `✅ Telegram успешно подключен!\n\n` +
          `Вы будете получать уведомления о записях в салоне "${owner.salon_name || 'Beauty Studio'}".\n\n` +
          `📱 Страница вашего салона: ${salonUrl}/booking?userId=${owner.id}\n\n` +
          `Уведомления будут приходить только для записей на этой странице.\n\n` +
          `Вы можете настроить типы уведомлений в панели администратора.`);
      } catch (error) {
        console.error('Ошибка отправки подтверждения:', error.message);
        // Не возвращаем ошибку, так как привязка уже выполнена
      }
      
      return res.json({ success: true, message: 'Telegram аккаунт привязан' });
    }
    
    // Игнорируем другие типы сообщений
    console.log('ℹ️  Сообщение не обработано (неизвестный тип), возвращаем успешный ответ');
    return res.json({ success: true, message: 'Игнорируется' });
  } catch (error) {
    console.error('❌ Ошибка обработки вебхука Telegram:', error.message);
    console.error('  Stack:', error.stack);
    // Всегда возвращаем ответ, даже при ошибке
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Ошибка сервера: ' + error.message });
    } else {
      console.error('⚠️  Ответ уже отправлен, невозможно отправить ошибку');
    }
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'telegram-bot', timestamp: new Date().toISOString() });
});

// Обработка ошибок для несуществующих маршрутов
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Маршрут не найден' });
});

// Глобальная обработка ошибок
app.use((err, req, res, next) => {
  console.error('Необработанная ошибка:', err.message);
  console.error('Stack:', err.stack);
  res.status(500).json({ success: false, message: 'Внутренняя ошибка сервера' });
});

// Инициализация webhook при запуске
async function initializeWebhook() {
  try {
    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
    if (!webhookUrl) {
      console.warn('⚠️  TELEGRAM_WEBHOOK_URL не установлен. Webhook не будет установлен автоматически.');
      console.warn('   Установите переменную окружения TELEGRAM_WEBHOOK_URL для автоматической установки webhook.');
      console.warn('   Пример: https://yourdomain.com/api/telegram/webhook');
      
      // Показываем текущий статус webhook
      try {
        const webhookInfo = await getWebhookInfo();
        if (webhookInfo.url) {
          console.log(`ℹ️  Текущий webhook: ${webhookInfo.url}`);
        } else {
          console.log('ℹ️  Webhook не установлен. Используйте setWebhook для установки.');
        }
      } catch (error) {
        console.error('❌ Не удалось получить информацию о webhook:', error.message);
      }
      return;
    }

    console.log(`🔗 Попытка установки webhook: ${webhookUrl}`);
    const result = await setWebhook(webhookUrl);
    if (result.success) {
      console.log('✅ Webhook успешно установлен');
    } else {
      console.error(`❌ Не удалось установить webhook: ${result.message}`);
    }
  } catch (error) {
    console.error('❌ Ошибка инициализации webhook:', error.message);
    console.error('   Убедитесь, что токен бота настроен и URL webhook доступен извне.');
  }
}

// Запуск сервера
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🤖 Telegram Bot Service запущен на порту ${PORT}`);
  console.log(`📡 Ожидание webhook запросов от Telegram...`);
  
  // Инициализируем webhook после запуска сервера
  // Даем серверу немного времени на запуск
  setTimeout(async () => {
    await initializeWebhook();
  }, 2000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Получен сигнал SIGTERM, завершение работы...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Получен сигнал SIGINT, завершение работы...');
  process.exit(0);
});
