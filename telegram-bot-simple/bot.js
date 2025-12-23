require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Инициализация бота
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('❌ Ошибка: BOT_TOKEN не установлен в .env файле');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Инициализация базы данных SQLite
const dbPath = path.join(__dirname, 'bot.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Ошибка подключения к БД:', err.message);
    process.exit(1);
  }
  console.log('✅ Подключение к SQLite БД установлено');
  initDatabase();
});

// Инициализация таблиц
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

    console.log('✅ Таблицы БД инициализированы');
  });
}

// ============================================================================
// ФУНКЦИИ НОРМАЛИЗАЦИИ И ПРОВЕРКИ ТЕЛЕФОНА
// ============================================================================

/**
 * Нормализует номер телефона (Узбекистан форматы)
 * @param {string} phone - Номер телефона в любом формате
 * @returns {string} - Нормализованный номер (только цифры)
 */
function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/\D/g, '')
    .replace(/^8/, '7')
    .replace(/^\+/, '');
}

/**
 * Проверяет номер телефона в базе данных сайта
 * TODO: ЗАМЕНИТЬ НА РЕАЛЬНУЮ ПРОВЕРКУ С САЙТА clientix.uz
 * 
 * Варианты интеграции:
 * 1. Прямое подключение к PostgreSQL БД сайта (если есть доступ)
 * 2. REST API запрос к сайту clientix.uz/api/check-phone
 * 3. Вебхук для проверки
 * 
 * @param {string} phone - Нормализованный номер телефона
 * @param {function} callback - callback(owner | null, error)
 */
function checkPhoneInDatabase(phone, callback) {
  // ЗАГЛУШКА: Моковые данные для тестирования
  const mockOwners = [
    { phone: '998903175511', name: 'Фери', salon_name: 'Салон Фери' },
    { phone: '998901234567', name: 'Иван', salon_name: 'Салон Ивана' }
  ];

  const normalized = normalizePhone(phone);
  
  // Проверяем в моковых данных
  const owner = mockOwners.find(o => normalizePhone(o.phone) === normalized);
  
  if (owner) {
    return callback(owner, null);
  }

  // TODO: Здесь должна быть реальная проверка
  // Пример для PostgreSQL:
  // const { Pool } = require('pg');
  // const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // pool.query('SELECT * FROM users WHERE salon_phone = $1', [normalized])
  //   .then(result => callback(result.rows[0] || null, null))
  //   .catch(err => callback(null, err));

  // Пример для REST API:
  // const axios = require('axios');
  // axios.post('https://clientix.uz/api/check-phone', { phone: normalized })
  //   .then(res => callback(res.data.owner || null, null))
  //   .catch(err => callback(null, err));

  callback(null, null);
}

// ============================================================================
// ФУНКЦИИ РАБОТЫ С БАЗОЙ ДАННЫХ
// ============================================================================

/**
 * Сохраняет владельца в БД
 */
function saveOwner(ownerData, callback) {
  const { phone, name, salon_name, telegram_id } = ownerData;
  db.run(
    'INSERT OR REPLACE INTO owners (phone, name, salon_name, telegram_id) VALUES (?, ?, ?, ?)',
    [phone, name, salon_name, telegram_id],
    function(err) {
      if (err) {
        console.error('Ошибка сохранения владельца:', err);
        return callback(err);
      }
      callback(null, this.lastID);
    }
  );
}

/**
 * Получает владельца по Telegram ID
 */
function getOwnerByTelegramId(telegramId, callback) {
  db.get(
    'SELECT * FROM owners WHERE telegram_id = ?',
    [telegramId],
    callback
  );
}

/**
 * Получает владельца по ID
 */
function getOwnerById(ownerId, callback) {
  db.get(
    'SELECT * FROM owners WHERE id = ?',
    [ownerId],
    callback
  );
}

/**
 * Добавляет групповой чат для владельца
 */
function addGroupChat(ownerId, chatId, chatTitle, callback) {
  db.run(
    'INSERT OR REPLACE INTO group_chats (owner_id, chat_id, chat_title, is_active) VALUES (?, ?, ?, 1)',
    [ownerId, chatId, chatTitle],
    function(err) {
      if (err) {
        console.error('Ошибка добавления группы:', err);
        return callback(err);
      }
      callback(null, this.lastID);
    }
  );
}

/**
 * Получает все активные чаты владельца (ЛС + группы)
 */
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
        console.error('Ошибка получения чатов:', err);
        return callback(err, null);
      }
      callback(null, rows.map(row => row.chat_id));
    }
  );
}

/**
 * Получает все активные чаты владельца (Promise версия)
 */
function getOwnerChatsPromise(ownerId) {
  return new Promise((resolve, reject) => {
    getOwnerChats(ownerId, (err, chatIds) => {
      if (err) reject(err);
      else resolve(chatIds);
    });
  });
}

/**
 * Получает владельца по ID (Promise версия)
 */
function getOwnerByIdPromise(ownerId) {
  return new Promise((resolve, reject) => {
    getOwnerById(ownerId, (err, owner) => {
      if (err) reject(err);
      else resolve(owner);
    });
  });
}

/**
 * Сохраняет запись об уведомлении
 */
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

/**
 * Отправляет уведомление владельцу во все его чаты (ЛС + группы)
 */
async function sendNotificationToOwner(ownerId, type, data) {
  try {
    // Получаем все чаты владельца
    const chatIds = await getOwnerChatsPromise(ownerId);

    if (!chatIds || chatIds.length === 0) {
      console.log(`Владелец ${ownerId} не имеет активных чатов`);
      return;
    }

    let message = '';
    let options = { parse_mode: 'HTML' };

    // Формируем сообщение в зависимости от типа уведомления
    switch (type) {
      case 'booking':
        message = `🎉 <b>Новая запись!</b>\n\n` +
          `👤 <b>Клиент:</b> ${data.client_name || 'Не указан'}\n` +
          `💇 <b>Услуга:</b> ${data.service || 'Не указана'}\n` +
          `📅 <b>Дата:</b> ${data.date || 'Не указана'}\n` +
          `⏰ <b>Время:</b> ${data.time || 'Не указано'}\n`;
        
        if (data.client_phone) {
          message += `📞 <b>Телефон:</b> <code>${data.client_phone}</code>\n`;
        }
        
        if (data.master) {
          message += `👨‍💼 <b>Мастер:</b> ${data.master}\n`;
        }
        
        if (data.comment) {
          message += `💬 <b>Комментарий:</b> ${data.comment}\n`;
        }

        // Получаем название салона для подписи
        try {
          const owner = await getOwnerByIdPromise(ownerId);
          if (owner && owner.salon_name) {
            message += `\n🏪 <i>${owner.salon_name}</i>`;
          }
        } catch (err) {
          console.error('Ошибка получения названия салона:', err);
        }
        break;

      case 'cancel':
        message = `❌ <b>Отмена записи</b>\n\n` +
          `👤 <b>Клиент:</b> ${data.client_name || 'Не указан'}\n` +
          `💇 <b>Услуга:</b> ${data.service || 'Не указана'}\n` +
          `📅 <b>Дата:</b> ${data.date || 'Не указана'}\n` +
          `⏰ <b>Время:</b> ${data.time || 'Не указано'}\n`;
        
        if (data.reason) {
          message += `📝 <b>Причина:</b> ${data.reason}\n`;
        }
        break;

      case 'reminder':
        message = `⏰ <b>Напоминание о записи</b>\n\n` +
          `👤 <b>Клиент:</b> ${data.client_name || 'Не указан'}\n` +
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

    // Отправляем во все чаты владельца
    const sendPromises = chatIds.map(chatId => {
      return bot.telegram.sendMessage(chatId, message, options).catch(err => {
        console.error(`Ошибка отправки в чат ${chatId}:`, err.message);
      });
    });

    await Promise.all(sendPromises);
    console.log(`✅ Уведомление ${type} отправлено владельцу ${ownerId} в ${chatIds.length} чат(ов)`);
    
    // Логируем уведомление
    logNotification(ownerId, type, data, () => {});
  } catch (error) {
    console.error('Ошибка отправки уведомлений:', error);
  }
}

// ============================================================================
// ОБРАБОТЧИКИ КОМАНД БОТА
// ============================================================================

// Команда /start - регистрация
bot.command('start', async (ctx) => {
  const userId = ctx.from.id;
  
  // Проверяем, зарегистрирован ли пользователь
  getOwnerByTelegramId(userId, (err, owner) => {
    if (err) {
      console.error('Ошибка проверки регистрации:', err);
      return ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
    }

    if (owner) {
      // Пользователь уже зарегистрирован
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

    // Приветственное сообщение и запрос номера
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

// Обработка контакта (номера телефона)
bot.on('contact', async (ctx) => {
  const userId = ctx.from.id;
  const phone = ctx.message.contact.phone_number;

  // Проверяем, не зарегистрирован ли уже
  getOwnerByTelegramId(userId, (err, existingOwner) => {
    if (err) {
      console.error('Ошибка проверки:', err);
      return ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
    }

    if (existingOwner) {
      return ctx.reply('✅ Вы уже зарегистрированы! Используйте /myinfo для просмотра информации.');
    }

    // Нормализуем номер
    const normalizedPhone = normalizePhone(phone);
    
    // Проверяем номер в базе данных сайта
    checkPhoneInDatabase(normalizedPhone, (owner, error) => {
      if (error) {
        console.error('Ошибка проверки номера:', error);
        return ctx.reply('❌ Произошла ошибка при проверке номера. Попробуйте позже.');
      }

      if (!owner) {
        return ctx.reply(
          `❌ Номер телефона не найден в базе данных.\n\n` +
          `Убедитесь, что вы зарегистрированы на сайте clientix.uz и ваш номер телефона указан корректно.`
        );
      }

      // Сохраняем владельца в БД бота
      saveOwner({
        phone: normalizedPhone,
        name: owner.name,
        salon_name: owner.salon_name,
        telegram_id: userId
      }, (err, ownerId) => {
        if (err) {
          console.error('Ошибка сохранения:', err);
          return ctx.reply('❌ Произошла ошибка при сохранении данных. Попробуйте позже.');
        }

        // Успешная регистрация
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

        console.log(`✅ Новый владелец зарегистрирован: ${owner.name} (${normalizedPhone})`);
      });
    });
  });
});

// Команда /setup_group - подключение группы
bot.command('setup_group', async (ctx) => {
  // Проверяем, что команда вызвана в группе
  if (ctx.chat.type === 'private') {
    return ctx.reply('❌ Эта команда работает только в группах!\n\nДобавьте меня в группу и используйте команду там.');
  }

  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const chatTitle = ctx.chat.title || 'Группа без названия';

  // Проверяем, что пользователь является администратором группы
  try {
    const member = await ctx.getChatMember(userId);
    if (member.status !== 'administrator' && member.status !== 'creator') {
      return ctx.reply('❌ Только администраторы группы могут настроить уведомления.');
    }
  } catch (error) {
    console.error('Ошибка проверки прав:', error);
    return ctx.reply('❌ Не удалось проверить права администратора.');
  }

  // Проверяем, зарегистрирован ли пользователь
  getOwnerByTelegramId(userId, (err, owner) => {
    if (err) {
      console.error('Ошибка проверки владельца:', err);
      return ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
    }

    if (!owner) {
      return ctx.reply(
        `❌ Вы не зарегистрированы!\n\n` +
        `Сначала зарегистрируйтесь через личные сообщения боту: /start`
      );
    }

    // Добавляем группу
    addGroupChat(owner.id, chatId, chatTitle, (err, groupId) => {
      if (err) {
        console.error('Ошибка добавления группы:', err);
        return ctx.reply('❌ Произошла ошибка при добавлении группы. Попробуйте позже.');
      }

      ctx.reply(
        `✅ Группа "${chatTitle}" успешно подключена!\n\n` +
        `Теперь уведомления о записях в салон "${owner.salon_name}" будут приходить в эту группу.`
      );

      console.log(`✅ Группа ${chatId} подключена к владельцу ${owner.id}`);
    });
  });
});

// Команда /myinfo - информация о профиле
bot.command('myinfo', async (ctx) => {
  const userId = ctx.from.id;

  getOwnerByTelegramId(userId, (err, owner) => {
    if (err) {
      console.error('Ошибка получения данных:', err);
      return ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
    }

    if (!owner) {
      return ctx.reply(
        `❌ Вы не зарегистрированы!\n\n` +
        `Используйте /start для регистрации.`
      );
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

// Команда /chats - список подключенных чатов
bot.command('chats', async (ctx) => {
  const userId = ctx.from.id;

  getOwnerByTelegramId(userId, (err, owner) => {
    if (err) {
      console.error('Ошибка получения данных:', err);
      return ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
    }

    if (!owner) {
      return ctx.reply(
        `❌ Вы не зарегистрированы!\n\n` +
        `Используйте /start для регистрации.`
      );
    }

    // Получаем все группы владельца
    db.all(
      'SELECT chat_id, chat_title FROM group_chats WHERE owner_id = ? AND is_active = 1',
      [owner.id],
      (err, groups) => {
        if (err) {
          console.error('Ошибка получения групп:', err);
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

// Команда /test - тестовое уведомление
bot.command('test', async (ctx) => {
  const userId = ctx.from.id;

  getOwnerByTelegramId(userId, (err, owner) => {
    if (err) {
      console.error('Ошибка получения данных:', err);
      return ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
    }

    if (!owner) {
      return ctx.reply(
        `❌ Вы не зарегистрированы!\n\n` +
        `Используйте /start для регистрации.`
      );
    }

    // Отправляем тестовое уведомление
    sendNotificationToOwner(owner.id, 'test', {});
    ctx.reply('✅ Тестовое уведомление отправлено во все ваши чаты!');
  });
});

// Команда /help - справка
bot.command('help', (ctx) => {
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
    `⏰ Напоминаниях о записях\n\n` +
    `Сайт: clientix.uz`;

  ctx.reply(helpText, { parse_mode: 'HTML' });
});

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error('Ошибка бота:', err);
  ctx.reply('❌ Произошла ошибка. Попробуйте позже или обратитесь к администратору.');
});

// ============================================================================
// ЗАПУСК БОТА
// ============================================================================

// Запуск бота
bot.launch()
  .then(() => {
    console.log('✅ Telegram бот запущен успешно!');
    console.log(`📱 Бот: @${bot.botInfo.username}`);
  })
  .catch((err) => {
    console.error('❌ Ошибка запуска бота:', err);
    process.exit(1);
  });

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('\n⏹️  Остановка бота...');
  bot.stop('SIGINT');
  db.close((err) => {
    if (err) {
      console.error('Ошибка закрытия БД:', err);
    } else {
      console.log('✅ БД закрыта');
    }
    process.exit(0);
  });
});

process.once('SIGTERM', () => {
  console.log('\n⏹️  Остановка бота...');
  bot.stop('SIGTERM');
  db.close((err) => {
    if (err) {
      console.error('Ошибка закрытия БД:', err);
    } else {
      console.log('✅ БД закрыта');
    }
    process.exit(0);
  });
});

// Экспортируем функции для использования в server.js
module.exports = {
  sendNotificationToOwner,
  getOwnerByPhone: (phone, callback) => {
    const normalized = normalizePhone(phone);
    db.get('SELECT * FROM owners WHERE phone = ?', [normalized], callback);
  },
  db
};

