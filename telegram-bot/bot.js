require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

// ============================================================================
// КОНФИГУРАЦИЯ ДЛЯ DOCKER
// ============================================================================

const PORT = process.env.TELEGRAM_BOT_PORT || 3001;
const SQLITE_PATH = process.env.SQLITE_PATH || '/app/data/bot_database.sqlite';
const MAIN_APP_URL = process.env.MAIN_APP_URL || 'http://beauty-studio:3000';
const INTERNAL_SECRET = process.env.TELEGRAM_BOT_INTERNAL_SECRET || 'default-internal-secret-change-in-production';

// Переменная для хранения текущего токена бота
let BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || null;

/**
 * Получает токен бота из основного приложения через API
 */
async function getBotTokenFromMainApp() {
  try {
    const response = await axios.get(`${MAIN_APP_URL}/api/telegram/bot-token`, {
      headers: {
        'X-Internal-Secret': INTERNAL_SECRET
      },
      timeout: 5000
    });

    if (response.data && response.data.success && response.data.token) {
      return response.data.token;
    }
    return null;
  } catch (error) {
    console.error(JSON.stringify({
      level: 'ERROR',
      msg: 'Ошибка получения токена из основного приложения',
      error: error.message
    }));
    return null;
  }
}

/**
 * Инициализирует токен бота (из .env или из основного приложения)
 */
async function initBotToken() {
  // Сначала пробуем получить из переменной окружения
  const envToken = process.env.TELEGRAM_BOT_TOKEN;
  if (envToken && envToken.trim()) {
    console.log(JSON.stringify({ level: 'INFO', msg: 'Токен бота загружен из переменной окружения' }));
    return envToken.trim();
  }

  // Если нет в .env, пытаемся получить из основного приложения
  console.log(JSON.stringify({ level: 'INFO', msg: 'Токен не найден в .env, запрашиваем из основного приложения' }));
  const tokenFromApp = await getBotTokenFromMainApp();

  if (tokenFromApp) {
    console.log(JSON.stringify({ level: 'INFO', msg: 'Токен бота получен из основного приложения' }));
    return tokenFromApp;
  }

  console.error(JSON.stringify({
    level: 'ERROR',
    msg: 'Токен бота не найден ни в .env, ни в основном приложении'
  }));
  return null;
}

// Создаем директорию для данных если не существует
const dataDir = path.dirname(SQLITE_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`✅ Создана директория для данных: ${dataDir}`);
}

// Инициализация бота (будет инициализирован после получения токена)
let bot = null;

async function initBot() {
  const token = await initBotToken();
  if (!token) {
    console.error(JSON.stringify({
      level: 'ERROR',
      msg: 'Не удалось получить токен бота. Проверьте .env или настройки в админке.'
    }));
    process.exit(1);
  }

  BOT_TOKEN = token;
  bot = new Telegraf(BOT_TOKEN);
  
  // Регистрируем обработчики команд
  registerBotHandlers(bot);
  
  return bot;
}

// Инициализация базы данных SQLite
const db = new sqlite3.Database(SQLITE_PATH, (err) => {
  if (err) {
    console.error('❌ Ошибка подключения к БД:', err.message);
    process.exit(1);
  }
  console.log(`✅ Подключение к SQLite БД установлено: ${SQLITE_PATH}`);
  initDatabase();
});

// Инициализация Express для вебхуков
const app = express();
app.use(express.json());

// Логирование запросов (структурированное для Docker)
app.use((req, res, next) => {
  console.log(JSON.stringify({
    level: 'INFO',
    msg: 'HTTP Request',
    method: req.method,
    path: req.path,
    timestamp: new Date().toISOString()
  }));
  next();
});

// ============================================================================
// ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ
// ============================================================================

function initDatabase() {
  db.serialize(() => {
    // Таблица владельцев салонов
    db.run(`CREATE TABLE IF NOT EXISTS owners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE NOT NULL,
      name TEXT,
      salon_name TEXT,
      telegram_id INTEGER UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Таблица групповых чатов
    db.run(`CREATE TABLE IF NOT EXISTS group_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      chat_title TEXT,
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(owner_id, chat_id),
      FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE
    )`);

    // Таблица уведомлений (для логирования)
    db.run(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      data TEXT,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE
    )`);

    console.log(JSON.stringify({ level: 'INFO', msg: 'Таблицы БД инициализированы' }));
  });
}

// Экспорт для healthcheck
function healthCheck() {
  return new Promise((resolve) => {
    db.get('SELECT 1', (err) => {
      if (err) {
        resolve({ db: 'disconnected', bot: bot ? 'connected' : 'disconnected' });
      } else {
        resolve({ db: 'connected', bot: bot ? 'connected' : 'disconnected' });
      }
    });
  });
}

// ============================================================================
// ФУНКЦИИ НОРМАЛИЗАЦИИ И ПРОВЕРКИ ТЕЛЕФОНА
// ============================================================================

/**
 * Нормализует номер телефона (Узбекистан форматы)
 */
function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/\D/g, '')
    .replace(/^8/, '7')
    .replace(/^\+/, '');
}

/**
 * Получает телефон владельца по salon_id из основного приложения
 */
async function getPhoneBySalonId(salonId) {
  try {
    const response = await axios.get(`${MAIN_APP_URL}/api/users/${salonId}`, {
      timeout: 5000
    });
    return response.data?.salon_phone || null;
  } catch (error) {
    console.error(JSON.stringify({
      level: 'ERROR',
      msg: 'Ошибка получения данных владельца',
      error: error.message
    }));
    return null;
  }
}

/**
 * Проверяет номер телефона в базе данных основного приложения
 * Интеграция с основным приложением через REST API
 */
async function checkPhoneInDatabase(phone, callback) {
  const normalized = normalizePhone(phone);
  
  try {
    const response = await axios.get(`${MAIN_APP_URL}/api/owners/by-phone/${encodeURIComponent(normalized)}`, {
      timeout: 5000,
      validateStatus: (status) => status < 500
    });

    if (response.status === 200 && response.data?.success) {
      const ownerData = response.data.owner || response.data;
      return callback({
        phone: normalized,
        name: ownerData.username || ownerData.name || 'Владелец',
        salon_name: ownerData.salon_name || 'Салон'
      }, null);
    }

    callback(null, null);
  } catch (error) {
    console.error(JSON.stringify({
      level: 'ERROR',
      msg: 'Ошибка проверки номера в основном приложении',
      error: error.message,
      phone: normalized
    }));
    callback(null, null);
  }
}

// ============================================================================
// ФУНКЦИИ РАБОТЫ С БАЗОЙ ДАННЫХ
// ============================================================================

function saveOwner(ownerData, callback) {
  const { phone, name, salon_name, telegram_id } = ownerData;
  db.run(
    'INSERT OR REPLACE INTO owners (phone, name, salon_name, telegram_id) VALUES (?, ?, ?, ?)',
    [phone, name, salon_name, telegram_id],
    function(err) {
      if (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'Ошибка сохранения владельца', error: err.message }));
        return callback(err);
      }
      callback(null, this.lastID);
    }
  );
}

function getOwnerByTelegramId(telegramId, callback) {
  db.get(
    'SELECT * FROM owners WHERE telegram_id = ?',
    [telegramId],
    callback
  );
}

function getOwnerById(ownerId, callback) {
  db.get(
    'SELECT * FROM owners WHERE id = ?',
    [ownerId],
    callback
  );
}

function getOwnerByPhone(phone, callback) {
  const normalized = normalizePhone(phone);
  db.get('SELECT * FROM owners WHERE phone = ?', [normalized], callback);
}

function addGroupChat(ownerId, chatId, chatTitle, callback) {
  db.run(
    'INSERT OR REPLACE INTO group_chats (owner_id, chat_id, chat_title, is_active) VALUES (?, ?, ?, 1)',
    [ownerId, chatId, chatTitle],
    function(err) {
      if (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'Ошибка добавления группы', error: err.message }));
        return callback(err);
      }
      callback(null, this.lastID);
    }
  );
}

function getOwnerChats(ownerId, callback) {
  db.all(
    `SELECT chat_id FROM (
      SELECT telegram_id as chat_id FROM owners WHERE id = ?
      UNION
      SELECT chat_id FROM group_chats WHERE owner_id = ? AND is_active = 1
    )`,
    [ownerId, ownerId],
    (err, rows) => {
      if (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'Ошибка получения чатов', error: err.message }));
        return callback(err, null);
      }
      callback(null, rows.map(row => row.chat_id));
    }
  );
}

function getOwnerChatsPromise(ownerId) {
  return new Promise((resolve, reject) => {
    getOwnerChats(ownerId, (err, chatIds) => {
      if (err) reject(err);
      else resolve(chatIds);
    });
  });
}

function getOwnerByIdPromise(ownerId) {
  return new Promise((resolve, reject) => {
    getOwnerById(ownerId, (err, owner) => {
      if (err) reject(err);
      else resolve(owner);
    });
  });
}

function logNotification(ownerId, type, data, callback) {
  db.run(
    'INSERT INTO notifications (owner_id, type, data) VALUES (?, ?, ?)',
    [ownerId, type, JSON.stringify(data)],
    callback
  );
}

// ============================================================================
// ФУНКЦИИ ОТПРАВКИ УВЕДОМЛЕНИЙ
// ============================================================================

async function sendNotificationToOwner(ownerId, type, data) {
  try {
    const chatIds = await getOwnerChatsPromise(ownerId);

    if (!chatIds || chatIds.length === 0) {
      console.log(JSON.stringify({ level: 'INFO', msg: 'Владелец не имеет активных чатов', owner_id: ownerId }));
      return;
    }

    let message = '';
    let options = { parse_mode: 'HTML' };

    switch (type) {
      case 'booking':
        message = `🎉 <b>Новая запись!</b>\n\n` +
          `👤 <b>Клиент:</b> ${data.client_name || data.name || 'Не указан'}\n` +
          `💇 <b>Услуга:</b> ${data.service || 'Не указана'}\n` +
          `📅 <b>Дата:</b> ${data.date || 'Не указана'}\n` +
          `⏰ <b>Время:</b> ${data.time || 'Не указано'}\n`;
        
        if (data.client_phone || data.phone) {
          message += `📞 <b>Телефон:</b> <code>${data.client_phone || data.phone}</code>\n`;
        }
        
        if (data.master) {
          message += `👨‍💼 <b>Мастер:</b> ${data.master}\n`;
        }
        
        if (data.comment) {
          message += `💬 <b>Комментарий:</b> ${data.comment}\n`;
        }

        try {
          const owner = await getOwnerByIdPromise(ownerId);
          if (owner && owner.salon_name) {
            message += `\n🏪 <i>${owner.salon_name}</i>`;
          }
        } catch (err) {
          console.error(JSON.stringify({ level: 'ERROR', msg: 'Ошибка получения названия салона', error: err.message }));
        }
        break;

      case 'cancel':
      case 'cancellation':
        message = `❌ <b>Отмена записи</b>\n\n` +
          `👤 <b>Клиент:</b> ${data.client_name || data.name || 'Не указан'}\n` +
          `💇 <b>Услуга:</b> ${data.service || 'Не указана'}\n` +
          `📅 <b>Дата:</b> ${data.date || 'Не указана'}\n` +
          `⏰ <b>Время:</b> ${data.time || 'Не указано'}\n`;
        
        if (data.reason) {
          message += `📝 <b>Причина:</b> ${data.reason}\n`;
        }
        break;

      case 'reminder':
        message = `⏰ <b>Напоминание о записи</b>\n\n` +
          `👤 <b>Клиент:</b> ${data.client_name || data.name || 'Не указан'}\n` +
          `💇 <b>Услуга:</b> ${data.service || 'Не указана'}\n` +
          `📅 <b>Дата:</b> ${data.date || 'Не указана'}\n` +
          `⏰ <b>Время:</b> ${data.time || 'Не указано'}\n`;
        break;

      case 'test':
        message = `✅ <b>Тестовое уведомление</b>\n\n` +
          `Это тестовое сообщение для проверки работы бота.\n` +
          `Если вы видите это сообщение, значит бот работает корректно! 🎉`;
        break;

      default:
        message = `🔔 <b>Уведомление</b>\n\n${JSON.stringify(data, null, 2)}`;
    }

    if (!bot) {
      console.error(JSON.stringify({
        level: 'ERROR',
        msg: 'Бот не инициализирован'
      }));
      return;
    }

    const sendPromises = chatIds.map(chatId => {
      return bot.telegram.sendMessage(chatId, message, options).catch(err => {
        console.error(JSON.stringify({
          level: 'ERROR',
          msg: 'Ошибка отправки в чат',
          chat_id: chatId,
          error: err.message
        }));
      });
    });

    await Promise.all(sendPromises);
    console.log(JSON.stringify({
      level: 'INFO',
      msg: 'Уведомление отправлено',
      type: type,
      owner_id: ownerId,
      chats_count: chatIds.length
    }));
    
    logNotification(ownerId, type, data, () => {});
  } catch (error) {
    console.error(JSON.stringify({
      level: 'ERROR',
      msg: 'Ошибка отправки уведомлений',
      error: error.message
    }));
  }
}

// ============================================================================
// РЕГИСТРАЦИЯ ОБРАБОТЧИКОВ КОМАНД БОТА
// ============================================================================

function registerBotHandlers(botInstance) {
  botInstance.command('start', async (ctx) => {
  const userId = ctx.from.id;
  
  getOwnerByTelegramId(userId, (err, owner) => {
    if (err) {
      console.error(JSON.stringify({ level: 'ERROR', msg: 'Ошибка проверки регистрации', error: err.message }));
      return ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
    }

    if (owner) {
      return ctx.reply(
        `✅ Вы уже зарегистрированы!\n\n` +
        `👤 Имя: ${owner.name || 'Не указано'}\n` +
        `🏪 Салон: ${owner.salon_name || 'Не указан'}\n` +
        `📱 Телефон: ${owner.phone}\n\n` +
        `Используйте /help для списка команд.`,
        Markup.keyboard([
          ['/myinfo', '/chats'],
          ['/test', '/help']
        ]).resize()
      );
    }

    ctx.reply(
      `👋 Добро пожаловать!\n\n` +
      `Я буду отправлять уведомления о:\n` +
      `✅ Новых записях в ваш салон\n` +
      `❌ Отменах записей\n` +
      `⏰ Напоминаниях о записях\n\n` +
      `Для регистрации отправьте ваш номер телефона:`,
      Markup.keyboard([
        Markup.button.contactRequest('📱 Отправить номер телефона')
      ]).resize()
    );
  });
  });

  botInstance.on('contact', async (ctx) => {
  const userId = ctx.from.id;
  const phone = ctx.message.contact.phone_number;

  getOwnerByTelegramId(userId, (err, existingOwner) => {
    if (err) {
      console.error(JSON.stringify({ level: 'ERROR', msg: 'Ошибка проверки', error: err.message }));
      return ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
    }

    if (existingOwner) {
      return ctx.reply('✅ Вы уже зарегистрированы! Используйте /myinfo для просмотра информации.');
    }

    const normalizedPhone = normalizePhone(phone);
    
    checkPhoneInDatabase(normalizedPhone, (owner, error) => {
      if (error) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'Ошибка проверки номера', error: error.message }));
        return ctx.reply('❌ Произошла ошибка при проверке номера. Попробуйте позже.');
      }

      if (!owner) {
        return ctx.reply(
          `❌ Номер телефона не найден в базе данных.\n\n` +
          `Убедитесь, что вы зарегистрированы на сайте и ваш номер телефона указан корректно.`
        );
      }

      saveOwner({
        phone: normalizedPhone,
        name: owner.name,
        salon_name: owner.salon_name,
        telegram_id: userId
      }, (err, ownerId) => {
        if (err) {
          console.error(JSON.stringify({ level: 'ERROR', msg: 'Ошибка сохранения', error: err.message }));
          return ctx.reply('❌ Произошла ошибка при сохранении данных. Попробуйте позже.');
        }

        ctx.reply(
          `✅ Регистрация успешна!\n\n` +
          `Приветствуем, ${owner.name}!\n` +
          `Салон: ${owner.salon_name}\n\n` +
          `Теперь вы будете получать уведомления в этом чате.\n\n` +
          `Чтобы добавить группу:\n` +
          `1. Добавьте меня в группу\n` +
          `2. Напишите команду /setup_group\n` +
          `3. Подтвердите привязку`,
          Markup.keyboard([
            ['/myinfo', '/chats'],
            ['/test', '/help']
          ]).resize()
        );

        console.log(JSON.stringify({
          level: 'INFO',
          msg: 'Новый владелец зарегистрирован',
          name: owner.name,
          phone: normalizedPhone
        }));
      });
    });
  });
  });

  botInstance.command('setup_group', async (ctx) => {
  if (ctx.chat.type === 'private') {
    return ctx.reply('❌ Эта команда работает только в группах!\n\nДобавьте меня в группу и используйте команду там.');
  }

  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const chatTitle = ctx.chat.title || 'Группа без названия';

  try {
    const member = await ctx.getChatMember(userId);
    if (member.status !== 'administrator' && member.status !== 'creator') {
      return ctx.reply('❌ Только администраторы группы могут настроить уведомления.');
    }
  } catch (error) {
    console.error(JSON.stringify({ level: 'ERROR', msg: 'Ошибка проверки прав', error: error.message }));
    return ctx.reply('❌ Не удалось проверить права администратора.');
  }

  getOwnerByTelegramId(userId, (err, owner) => {
    if (err) {
      console.error(JSON.stringify({ level: 'ERROR', msg: 'Ошибка проверки владельца', error: err.message }));
      return ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
    }

    if (!owner) {
      return ctx.reply(
        `❌ Вы не зарегистрированы!\n\n` +
        `Сначала зарегистрируйтесь через личные сообщения боту: /start`
      );
    }

    addGroupChat(owner.id, chatId, chatTitle, (err, groupId) => {
      if (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'Ошибка добавления группы', error: err.message }));
        return ctx.reply('❌ Произошла ошибка при добавлении группы. Попробуйте позже.');
      }

      ctx.reply(
        `✅ Группа "${chatTitle}" успешно подключена!\n\n` +
        `Теперь уведомления о записях в салон "${owner.salon_name}" будут приходить в эту группу.`
      );

      console.log(JSON.stringify({
        level: 'INFO',
        msg: 'Группа подключена',
        chat_id: chatId,
        owner_id: owner.id
      }));
    });
  });
  });

  botInstance.command('myinfo', async (ctx) => {
  const userId = ctx.from.id;

  getOwnerByTelegramId(userId, (err, owner) => {
    if (err) {
      console.error(JSON.stringify({ level: 'ERROR', msg: 'Ошибка получения данных', error: err.message }));
      return ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
    }

    if (!owner) {
      return ctx.reply(`❌ Вы не зарегистрированы!\n\nИспользуйте /start для регистрации.`);
    }

    ctx.reply(
      `👤 <b>Ваш профиль</b>\n\n` +
      `Имя: ${owner.name || 'Не указано'}\n` +
      `Салон: ${owner.salon_name || 'Не указан'}\n` +
      `Телефон: ${owner.phone}\n` +
      `Telegram ID: <code>${owner.telegram_id}</code>\n` +
      `Дата регистрации: ${new Date(owner.created_at).toLocaleString('ru-RU')}`,
      { parse_mode: 'HTML' }
    );
  });
  });

  botInstance.command('chats', async (ctx) => {
  const userId = ctx.from.id;

  getOwnerByTelegramId(userId, (err, owner) => {
    if (err) {
      console.error(JSON.stringify({ level: 'ERROR', msg: 'Ошибка получения данных', error: err.message }));
      return ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
    }

    if (!owner) {
      return ctx.reply(`❌ Вы не зарегистрированы!\n\nИспользуйте /start для регистрации.`);
    }

    db.all(
      'SELECT chat_id, chat_title FROM group_chats WHERE owner_id = ? AND is_active = 1',
      [owner.id],
      (err, groups) => {
        if (err) {
          console.error(JSON.stringify({ level: 'ERROR', msg: 'Ошибка получения групп', error: err.message }));
          return ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
        }

        let message = `💬 <b>Ваши чаты</b>\n\n`;
        message += `📱 Личные сообщения: ✅ Активен\n`;

        if (groups && groups.length > 0) {
          message += `\n👥 Группы:\n`;
          groups.forEach((group, index) => {
            message += `${index + 1}. ${group.chat_title || 'Группа без названия'}\n`;
          });
        } else {
          message += `\n👥 Группы: Нет подключенных групп\n`;
          message += `Используйте /setup_group в группе для подключения.`;
        }

        ctx.reply(message, { parse_mode: 'HTML' });
      }
    );
  });
  });

  botInstance.command('test', async (ctx) => {
  const userId = ctx.from.id;

  getOwnerByTelegramId(userId, (err, owner) => {
    if (err) {
      console.error(JSON.stringify({ level: 'ERROR', msg: 'Ошибка получения данных', error: err.message }));
      return ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
    }

    if (!owner) {
      return ctx.reply(`❌ Вы не зарегистрированы!\n\nИспользуйте /start для регистрации.`);
    }

    sendNotificationToOwner(owner.id, 'test', {});
    ctx.reply('✅ Тестовое уведомление отправлено во все ваши чаты!');
  });
  });

  botInstance.command('help', (ctx) => {
  const helpText = `📖 <b>Справка по командам</b>\n\n` +
    `<b>Личные сообщения:</b>\n` +
    `/start - Регистрация по номеру телефона\n` +
    `/myinfo - Информация о вашем профиле\n` +
    `/chats - Список подключенных чатов\n` +
    `/test - Отправить тестовое уведомление\n` +
    `/help - Эта справка\n\n` +
    `<b>В группах:</b>\n` +
    `/setup_group - Подключить группу к уведомлениям\n\n` +
    `<b>Уведомления:</b>\n` +
    `Бот автоматически отправляет уведомления о:\n` +
    `✅ Новых записях\n` +
    `❌ Отменах записей\n` +
    `⏰ Напоминаниях о записях`;

  ctx.reply(helpText, { parse_mode: 'HTML' });
  });

  botInstance.catch((err, ctx) => {
    console.error(JSON.stringify({ level: 'ERROR', msg: 'Ошибка бота', error: err.message }));
    ctx.reply('❌ Произошла ошибка. Попробуйте позже или обратитесь к администратору.');
  });
}

// ============================================================================
// API ЭНДПОЙНТЫ ДЛЯ ВНУТРЕННЕГО ИСПОЛЬЗОВАНИЯ (ОСНОВНОЕ ПРИЛОЖЕНИЕ)
// ============================================================================

// Healthcheck для Docker
app.get('/health', async (req, res) => {
  try {
    const health = await healthCheck();
    res.json({
      status: 'healthy',
      service: 'telegram-bot',
      timestamp: new Date().toISOString(),
      database: health.db,
      telegram: health.bot
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'telegram-bot',
      error: error.message
    });
  }
});

// Общая функция для обработки уведомлений
async function handleNotification(req, res, notificationType) {
  try {
    const { salon_phone, salon_id, booking_data } = req.body;

    if (!salon_phone && !salon_id) {
      return res.status(400).json({
        success: false,
        error: 'salon_phone или salon_id обязательны'
      });
    }

    let phone = salon_phone;
    if (!phone && salon_id) {
      phone = await getPhoneBySalonId(salon_id);
    }
    
    if (!phone) {
      return res.status(400).json({
        success: false,
        error: 'Не удалось определить телефон владельца'
      });
    }

    const normalizedPhone = normalizePhone(phone);
    
    getOwnerByPhone(normalizedPhone, async (err, owner) => {
      if (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'Ошибка поиска владельца', error: err.message }));
        return res.status(500).json({ success: false, error: 'Ошибка поиска владельца' });
      }

      if (!owner) {
        return res.status(404).json({ success: false, error: 'Владелец не найден в базе бота' });
      }

      await sendNotificationToOwner(owner.id, notificationType, booking_data || req.body);
      res.json({ success: true, message: 'Уведомление отправлено', owner_id: owner.id });
    });

  } catch (error) {
    console.error(JSON.stringify({ level: 'ERROR', msg: `Ошибка обработки уведомления ${notificationType}`, error: error.message }));
    res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
  }
}

// API: Уведомление о новой записи
app.post('/api/notify/booking', async (req, res) => {
  await handleNotification(req, res, 'booking');
});

// API: Уведомление об отмене
app.post('/api/notify/cancellation', async (req, res) => {
  await handleNotification(req, res, 'cancel');
});

// API: Напоминание о записи
app.post('/api/notify/reminder', async (req, res) => {
  await handleNotification(req, res, 'reminder');
});

// API: Список зарегистрированных владельцев
app.get('/api/owners', (req, res) => {
  db.all('SELECT id, phone, name, salon_name, telegram_id, created_at FROM owners', (err, owners) => {
    if (err) {
      console.error(JSON.stringify({ level: 'ERROR', msg: 'Ошибка получения списка владельцев', error: err.message }));
      return res.status(500).json({ success: false, error: 'Ошибка получения списка' });
    }
    res.json({ success: true, owners });
  });
});

// Старые эндпоинты для обратной совместимости (перенаправляют на новые)
app.post('/webhook/booking', async (req, res) => {
  req.body.booking_data = req.body.booking_data || req.body;
  await handleNotification(req, res, 'booking');
});

app.post('/webhook/cancel', async (req, res) => {
  req.body.booking_data = req.body.booking_data || req.body;
  await handleNotification(req, res, 'cancel');
});

app.post('/webhook/reminder', async (req, res) => {
  req.body.booking_data = req.body.booking_data || req.body;
  await handleNotification(req, res, 'reminder');
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint не найден' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(JSON.stringify({ level: 'ERROR', msg: 'Ошибка сервера', error: err.message }));
  res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
});

// ============================================================================
// ЗАПУСК БОТА И СЕРВЕРА
// ============================================================================

// Запуск Express сервера
app.listen(PORT, '0.0.0.0', () => {
  console.log(JSON.stringify({
    level: 'INFO',
    msg: 'Веб-сервер запущен',
    port: PORT
  }));
});

// Асинхронный запуск бота
(async () => {
  try {
    await initBot();
    
    // Запуск бота
    await bot.launch();
    
    console.log(JSON.stringify({
      level: 'INFO',
      msg: 'Telegram бот запущен успешно',
      username: bot.botInfo.username
    }));
  } catch (err) {
    console.error(JSON.stringify({
      level: 'ERROR',
      msg: 'Ошибка запуска бота',
      error: err.message
    }));
    process.exit(1);
  }
})();

// Graceful shutdown для Docker
process.once('SIGTERM', () => {
  console.log(JSON.stringify({ level: 'INFO', msg: 'Получен SIGTERM, останавливаем бота' }));
  if (bot) {
    bot.stop('SIGTERM');
  }
  db.close((err) => {
    if (err) {
      console.error(JSON.stringify({ level: 'ERROR', msg: 'Ошибка закрытия БД', error: err.message }));
    } else {
      console.log(JSON.stringify({ level: 'INFO', msg: 'БД закрыта' }));
    }
    process.exit(0);
  });
});

process.once('SIGINT', () => {
  console.log(JSON.stringify({ level: 'INFO', msg: 'Получен SIGINT, останавливаем бота' }));
  if (bot) {
    bot.stop('SIGINT');
  }
  db.close((err) => {
    if (err) {
      console.error(JSON.stringify({ level: 'ERROR', msg: 'Ошибка закрытия БД', error: err.message }));
    } else {
      console.log(JSON.stringify({ level: 'INFO', msg: 'БД закрыта' }));
    }
    process.exit(0);
  });
});

// Экспортируем функции для использования
module.exports = {
  sendNotificationToOwner,
  getOwnerByPhone,
  healthCheck,
  db,
  bot
};

