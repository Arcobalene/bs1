const express = require('express');
const https = require('https');
const { users: dbUsers } = require('./database');
const { normalizeToE164 } = require('./utils');

const app = express();
app.use(express.json());

const PORT = process.env.TELEGRAM_BOT_PORT || 3001;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || null;

// Функция для получения токена бота из БД
async function getBotTokenFromDb() {
  try {
    const allUsers = await dbUsers.getAll();
    const admin = allUsers.find(u => (u.role === 'admin' || u.username === 'admin') && u.bot_token);
    if (admin && admin.bot_token) {
      return admin.bot_token.trim();
    }
  } catch (error) {
    console.error('Ошибка получения токена из БД:', error);
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

// Функция для отправки сообщения в Telegram
function sendTelegramMessage(botToken, chatId, message) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://api.telegram.org/bot${botToken}/sendMessage`);
    const postData = JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML'
    });
    
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
          
          if (res.statusCode !== 200 || !jsonData.ok) {
            reject(new Error(jsonData.description || 'Ошибка отправки сообщения в Telegram'));
            return;
          }
          
          resolve({ success: true, data: jsonData });
        } catch (error) {
          reject(new Error('Ошибка парсинга ответа от Telegram API'));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Таймаут при обращении к Telegram API'));
    });
    
    req.setTimeout(10000);
    req.write(postData);
    req.end();
  });
}

// Функция для отправки сообщения с кнопкой запроса контакта
async function sendTelegramMessageWithContactButton(chatId, message) {
  const botToken = await getTelegramBotToken();
  if (!botToken) {
    throw new Error('Токен Telegram бота не настроен');
  }
  
  return new Promise((resolve, reject) => {
    const url = new URL(`https://api.telegram.org/bot${botToken}/sendMessage`);
    const postData = JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      reply_markup: {
        keyboard: [[{
          text: '📱 Отправить контакт',
          request_contact: true
        }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    
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
          
          if (res.statusCode !== 200 || !jsonData.ok) {
            reject(new Error(jsonData.description || 'Ошибка отправки сообщения в Telegram'));
            return;
          }
          
          resolve({ success: true, data: jsonData });
        } catch (error) {
          reject(new Error('Ошибка парсинга ответа от Telegram API'));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Таймаут при обращении к Telegram API'));
    });
    
    req.setTimeout(10000);
    req.write(postData);
    req.end();
  });
}

// Функция для получения информации о боте
async function getBotInfo() {
  const botToken = await getTelegramBotToken();
  if (!botToken) {
    throw new Error('Токен бота не найден');
  }
  
  return new Promise((resolve, reject) => {
    const url = new URL(`https://api.telegram.org/bot${botToken}/getMe`);
    
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'GET',
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
          
          if (res.statusCode !== 200 || !jsonData.ok) {
            const errorMsg = jsonData.description || 'Ошибка получения информации о боте';
            reject(new Error(errorMsg));
            return;
          }
          
          resolve(jsonData.result);
        } catch (error) {
          reject(new Error('Ошибка парсинга ответа от Telegram API: ' + error.message));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(new Error('Ошибка соединения с Telegram API: ' + error.message));
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Таймаут при обращении к Telegram API'));
    });
    
    req.setTimeout(10000);
    req.end();
  });
}

// API: Получить информацию о боте
app.get('/api/bot/info', async (req, res) => {
  try {
    const botInfo = await getBotInfo();
    res.json({ success: true, botInfo });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API: Отправить уведомление
app.post('/api/bot/send-notification', async (req, res) => {
  try {
    const { telegramId, message } = req.body;
    
    if (!telegramId || !message) {
      return res.status(400).json({ success: false, message: 'telegramId и message обязательны' });
    }
    
    const botToken = await getTelegramBotToken();
    if (!botToken) {
      return res.status(503).json({ success: false, message: 'Токен бота не настроен' });
    }
    
    await sendTelegramMessage(botToken, telegramId, message);
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка отправки уведомления:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Вебхук для обработки сообщений от Telegram бота
app.post('/api/bot/webhook', async (req, res) => {
  try {
    const botToken = await getTelegramBotToken();
    if (!botToken) {
      return res.status(503).json({ success: false, message: 'Telegram бот не настроен' });
    }

    const update = req.body;
    
    // Обрабатываем команду /start connect
    if (update.message && update.message.text && update.message.text.startsWith('/start')) {
      const from = update.message.from;
      const telegramId = from.id;
      const text = update.message.text;
      
      // Если команда /start connect, отправляем сообщение с кнопкой запроса контакта
      if (text.includes('connect')) {
        await sendTelegramMessageWithContactButton(telegramId, 
          '👋 Привет! Для подключения уведомлений о записях в салоне, пожалуйста, отправьте ваш контакт.\n\n' +
          '📱 Нажмите кнопку ниже, чтобы отправить ваш номер телефона.\n\n' +
          '⚠️ Важно: номер телефона должен совпадать с номером, указанным в настройках вашего салона.');
        return res.json({ success: true, message: 'Запрос контакта отправлен' });
      }
      
      // Обычная команда /start
      await sendTelegramMessage(botToken, telegramId, 
        '👋 Привет! Я бот для уведомлений о записях в салоне.\n\n' +
        'Для подключения уведомлений перейдите в настройки салона и нажмите "Подключить Telegram".');
      return res.json({ success: true, message: 'Приветствие отправлено' });
    }
    
    // Обрабатываем сообщения с контактом
    if (update.message && update.message.contact) {
      const botToken = await getTelegramBotToken();
      const message = update.message;
      const contact = message.contact;
      const from = message.from;

      // Валидация: contact.user_id должен совпадать с message.from.id
      if (contact.user_id !== from.id) {
        console.error(`❌ Несоответствие ID: contact.user_id=${contact.user_id}, message.from.id=${from.id}`);
        await sendTelegramMessage(botToken, from.id, 
          '❌ Ошибка: ID контакта не совпадает с вашим Telegram ID. Попробуйте еще раз.');
        return res.json({ success: false, message: 'Несоответствие идентификаторов' });
      }

      const telegramId = from.id;
      const phone = contact.phone_number;

      if (!phone) {
        await sendTelegramMessage(botToken, telegramId, 
          '❌ Ошибка: номер телефона не найден в контакте.');
        return res.json({ success: false, message: 'Номер телефона отсутствует' });
      }

      // Нормализуем номер телефона в E.164
      const normalizedPhone = normalizeToE164(phone);
      
      // Ищем владельца салона по номеру телефона
      const owner = await dbUsers.getByPhone(normalizedPhone);
      
      if (!owner) {
        await sendTelegramMessage(botToken, telegramId, 
          `❌ Владелец салона с номером ${normalizedPhone} не найден.\n\n` +
          'Убедитесь, что номер телефона указан в настройках салона (вкладка "Информация о салоне").');
        return res.json({ success: false, message: 'Владелец салона не найден' });
      }

      // Проверяем, что telegram_id еще не занят другим владельцем
      const existingOwner = await dbUsers.getByTelegramId(telegramId);
      if (existingOwner && existingOwner.id !== owner.id) {
        await sendTelegramMessage(botToken, telegramId, 
          '❌ Этот Telegram аккаунт уже привязан к другому владельцу салона.');
        return res.json({ success: false, message: 'Telegram аккаунт уже привязан' });
      }

      // Сохраняем telegram_id на запись владельца салона
      await dbUsers.update(owner.id, { telegramId: telegramId });
      
      console.log(`✅ Telegram аккаунт привязан к владельцу салона: ownerId=${owner.id}, telegramId=${telegramId}, phone=${normalizedPhone}`);
      
      // Отправляем подтверждение владельцу
      await sendTelegramMessage(botToken, telegramId, 
        `✅ Telegram успешно подключен!\n\n` +
        `Вы будете получать уведомления о записях в салоне "${owner.salon_name || 'Beauty Studio'}".\n\n` +
        `Уведомления будут приходить только для записей на странице: /booking?userId=${owner.id}\n\n` +
        `Вы можете настроить типы уведомлений в панели администратора.`);
      
      return res.json({ success: true, message: 'Telegram аккаунт привязан' });
    }
    
    // Игнорируем другие типы сообщений
    return res.json({ success: true, message: 'Игнорируется' });
  } catch (error) {
    console.error('Ошибка обработки вебхука Telegram:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'telegram-bot' });
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🤖 Telegram Bot Service запущен на порту ${PORT}`);
});

