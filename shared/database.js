const { Pool } = require('pg');

// Конфигурация подключения к БД
const DB_TYPE = process.env.DB_TYPE || 'sqlite';
let pool = null;

// Helper функция для проверки инициализации pool
function requirePool() {
  if (DB_TYPE !== 'postgres') {
    throw new Error('PostgreSQL не настроен. Установите DB_TYPE=postgres');
  }
  if (!pool) {
    throw new Error('Pool PostgreSQL не инициализирован');
  }
}

// Инициализация подключения к PostgreSQL
if (DB_TYPE === 'postgres') {
  console.log('Инициализация подключения к PostgreSQL...');
  console.log(`DB_HOST: ${process.env.DB_HOST || 'localhost'}`);
  console.log(`DB_PORT: ${process.env.DB_PORT || '5432'}`);
  console.log(`DB_NAME: ${process.env.DB_NAME || 'beauty_studio'}`);
  console.log(`DB_USER: ${process.env.DB_USER || 'beauty_user'}`);
  
  pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'beauty_studio',
    user: process.env.DB_USER || 'beauty_user',
    password: process.env.DB_PASSWORD || 'beauty_password',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000, // Увеличено до 10 секунд
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
  });
  
  // Проверка подключения будет выполнена в initDatabase()
}

// Инициализация БД (создание таблиц)
async function initDatabase() {
  if (DB_TYPE !== 'postgres') {
    console.log('Используется SQLite. Для PostgreSQL установите DB_TYPE=postgres');
    return;
  }

  if (!pool) {
    throw new Error('Pool PostgreSQL не инициализирован');
  }

  console.log('Подключение к базе данных для инициализации...');
  const client = await pool.connect();
  try {
    console.log('Подключение установлено, создание таблиц...');
    // Таблица пользователей
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(30) UNIQUE NOT NULL,
        email VARCHAR(255),
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user',
        is_active BOOLEAN DEFAULT true,
        salon_name VARCHAR(255),
        salon_address TEXT,
        salon_lat REAL,
        salon_lng REAL,
        telegram_settings JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Добавляем колонку telegram_settings, если её нет (для существующих БД)
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'telegram_settings'
        ) THEN
          ALTER TABLE users ADD COLUMN telegram_settings JSONB;
        END IF;
      END $$;
    `);

    // Таблица услуг
    await client.query(`
      CREATE TABLE IF NOT EXISTS services (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        price INTEGER NOT NULL,
        duration INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Таблица мастеров
    await client.query(`
      CREATE TABLE IF NOT EXISTS masters (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name VARCHAR(100) NOT NULL,
        role VARCHAR(255),
        photos JSONB DEFAULT '[]'::jsonb,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    
    // Добавляем колонку photos, если её нет (для существующих БД)
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'masters' AND column_name = 'photos'
        ) THEN
          ALTER TABLE masters ADD COLUMN photos JSONB DEFAULT '[]'::jsonb;
        END IF;
      END $$;
    `);

    // Добавляем колонку master_user_id для связи с пользователем-мастером
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'masters' AND column_name = 'master_user_id'
        ) THEN
          ALTER TABLE masters ADD COLUMN master_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // Таблица связей салон-мастер
    await client.query(`
      CREATE TABLE IF NOT EXISTS salon_masters (
        id SERIAL PRIMARY KEY,
        salon_user_id INTEGER NOT NULL,
        master_user_id INTEGER NOT NULL,
        master_record_id INTEGER,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (salon_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (master_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (master_record_id) REFERENCES masters(id) ON DELETE SET NULL,
        UNIQUE(salon_user_id, master_user_id)
      )
    `);

    // Индексы для таблицы salon_masters
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_salon_masters_salon_user_id ON salon_masters(salon_user_id);
      CREATE INDEX IF NOT EXISTS idx_salon_masters_master_user_id ON salon_masters(master_user_id);
      CREATE INDEX IF NOT EXISTS idx_salon_masters_is_active ON salon_masters(is_active);
    `);

    // Таблица записей
    await client.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        service VARCHAR(255) NOT NULL,
        master VARCHAR(100),
        date DATE NOT NULL,
        time TIME NOT NULL,
        end_time TIME,
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Индексы для ускорения запросов
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_services_user_id ON services(user_id);
      CREATE INDEX IF NOT EXISTS idx_masters_user_id ON masters(user_id);
      CREATE INDEX IF NOT EXISTS idx_masters_master_user_id ON masters(master_user_id) WHERE master_user_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id);
      CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
      CREATE INDEX IF NOT EXISTS idx_bookings_master ON bookings(master) WHERE master IS NOT NULL AND master != '';
      CREATE INDEX IF NOT EXISTS idx_bookings_user_date ON bookings(user_id, date);
      CREATE INDEX IF NOT EXISTS idx_bookings_date_time ON bookings(date, time);
      CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
      CREATE INDEX IF NOT EXISTS idx_notifications_booking_id ON notifications(booking_id) WHERE booking_id IS NOT NULL;
    `);

    // Миграция: добавление поля salon_phone, если его нет (номер владельца для Telegram)
    try {
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS salon_phone VARCHAR(50)
      `);
      console.log('Миграция salon_phone выполнена');
    } catch (error) {
      console.log('Поле salon_phone уже существует или ошибка миграции:', error.message);
    }

    // Миграция: добавление поля salon_display_phone, если его нет (номер салона для публичного отображения)
    try {
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS salon_display_phone VARCHAR(50)
      `);
      console.log('Миграция salon_display_phone выполнена');
    } catch (error) {
      console.log('Поле salon_display_phone уже существует или ошибка миграции:', error.message);
    }

    // Миграция: добавление поля salon_design, если его нет
    try {
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS salon_design JSONB DEFAULT '{}'::jsonb
      `);
      console.log('Миграция salon_design выполнена');
    } catch (error) {
      console.log('Поле salon_design уже существует или ошибка миграции:', error.message);
    }

    // Миграция: добавление поля telegram_id для связи с Telegram пользователем
    try {
      await client.query(`
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'telegram_id'
          ) THEN
            ALTER TABLE users ADD COLUMN telegram_id BIGINT UNIQUE;
            CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id) WHERE telegram_id IS NOT NULL;
          END IF;
        END $$;
      `);
      console.log('Миграция telegram_id выполнена');
    } catch (error) {
      console.log('Поле telegram_id уже существует или ошибка миграции:', error.message);
    }

    // Миграция: добавление поля bot_token для хранения токена Telegram бота (только для админа)
    try {
      await client.query(`
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'bot_token'
          ) THEN
            ALTER TABLE users ADD COLUMN bot_token VARCHAR(255);
          END IF;
        END $$;
      `);
      console.log('Миграция bot_token выполнена');
    } catch (error) {
      console.log('Поле bot_token уже существует или ошибка миграции:', error.message);
    }

    // Миграция: добавление поля work_hours для хранения времени работы салона
    try {
      await client.query(`
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'work_hours'
          ) THEN
            ALTER TABLE users ADD COLUMN work_hours JSONB DEFAULT '{"startHour": 10, "endHour": 20}'::jsonb;
          END IF;
        END $$;
      `);
      console.log('Миграция work_hours выполнена');
    } catch (error) {
      console.log('Поле work_hours уже существует или ошибка миграции:', error.message);
    }

    // Таблица уведомлений
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        type VARCHAR(20) DEFAULT 'success',
        booking_id INTEGER,
        read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
      )
    `);

    // Индекс для ускорения запросов уведомлений
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(user_id, read);
    `);

    // Таблица клиентов
    await client.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        password VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Индексы для таблицы clients
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_phone_unique ON clients(phone);
    `);

    console.log('База данных PostgreSQL инициализирована');
  } catch (error) {
    console.error('Ошибка инициализации БД:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Функции для работы с пользователями
const users = {
  getAll: async () => {
    requirePool();
    const result = await pool.query('SELECT * FROM users');
    return result.rows;
  },

  getById: async (id) => {
    requirePool();
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  getByTelegramId: async (telegramId) => {
    requirePool();
    const result = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
    return result.rows[0] || null;
  },

  getByPhone: async (phone) => {
    requirePool();
    if (!phone) return null;
    
    // Нормализуем номер: удаляем все нецифровые символы, кроме +
    const normalizedPhone = phone.replace(/[^\d+]/g, '');
    const phoneDigits = normalizedPhone.replace(/\D/g, '');
    
    // Ищем точное совпадение или совпадение без префикса +7/7/8
    const patterns = [
      phoneDigits,
      phoneDigits.substring(phoneDigits.length - 10), // последние 10 цифр
      phoneDigits.startsWith('7') ? phoneDigits.substring(1) : null,
      phoneDigits.startsWith('8') ? phoneDigits.substring(1) : null
    ].filter(p => p && p.length >= 9);
    
    const conditions = patterns.map((_, i) => 
      `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(salon_phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') = $${i + 1}`
    ).join(' OR ');
    
    if (!conditions) return null;
    
    const result = await pool.query(
      `SELECT * FROM users WHERE ${conditions} LIMIT 1`,
      patterns
    );
    return result.rows[0] || null;
  },

  getByUsername: async (username) => {
    requirePool();
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    return result.rows[0] || null;
  },

  create: async (userData) => {
    requirePool();
    const { username, email, password, role, isActive, salonName, salonAddress, salonLat, salonLng, salonPhone, salonDisplayPhone, salonDesign } = userData;
    
    // Валидация
    if (!username || !password) {
      throw new Error('Username и password обязательны');
    }
    if (username.length < 3 || username.length > 30) {
      throw new Error('Username должен быть от 3 до 30 символов');
    }
    
    const result = await pool.query(`
      INSERT INTO users (username, email, password, role, is_active, salon_name, salon_address, salon_lat, salon_lng, salon_phone, salon_display_phone, salon_design)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id
    `, [
      username.trim(),
      email ? email.trim() : '',
      password,
      role || 'user',
      isActive !== undefined ? isActive : true,
      salonName ? salonName.trim() : '',
      salonAddress ? salonAddress.trim() : '',
      salonLat || null,
      salonLng || null,
      salonPhone ? salonPhone.trim() : null,
      salonDisplayPhone ? salonDisplayPhone.trim() : null,
      salonDesign ? JSON.stringify(salonDesign) : '{}'
    ]);
    return result.rows[0].id;
  },

  update: async (id, userData) => {
    requirePool();
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (userData.email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      values.push(userData.email);
    }
    if (userData.role !== undefined) {
      updates.push(`role = $${paramIndex++}`);
      values.push(userData.role);
    }
    if (userData.isActive !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(userData.isActive);
    }
    if (userData.salonName !== undefined) {
      updates.push(`salon_name = $${paramIndex++}`);
      values.push(userData.salonName);
    }
    if (userData.salonAddress !== undefined) {
      updates.push(`salon_address = $${paramIndex++}`);
      values.push(userData.salonAddress);
    }
    if (userData.salonLat !== undefined) {
      updates.push(`salon_lat = $${paramIndex++}`);
      values.push(userData.salonLat);
    }
    if (userData.salonLng !== undefined) {
      updates.push(`salon_lng = $${paramIndex++}`);
      values.push(userData.salonLng);
    }
    if (userData.salonPhone !== undefined) {
      updates.push(`salon_phone = $${paramIndex++}`);
      values.push(userData.salonPhone ? userData.salonPhone.trim() : null);
    }
    if (userData.salonDisplayPhone !== undefined) {
      updates.push(`salon_display_phone = $${paramIndex++}`);
      values.push(userData.salonDisplayPhone ? userData.salonDisplayPhone.trim() : null);
    }
    if (userData.salonDesign !== undefined) {
      updates.push(`salon_design = $${paramIndex++}::jsonb`);
      // PostgreSQL JSONB принимает объект напрямую или JSON строку
      const designValue = typeof userData.salonDesign === 'string' 
        ? userData.salonDesign 
        : JSON.stringify(userData.salonDesign);
      values.push(designValue);
    }
    if (userData.telegramSettings !== undefined) {
      updates.push(`telegram_settings = $${paramIndex++}::jsonb`);
      // PostgreSQL JSONB принимает объект напрямую или JSON строку
      const telegramValue = typeof userData.telegramSettings === 'string' 
        ? userData.telegramSettings 
        : JSON.stringify(userData.telegramSettings);
      values.push(telegramValue);
    }
    if (userData.telegramId !== undefined) {
      // Валидация telegramId: должен быть положительным целым числом или null
      if (userData.telegramId !== null) {
        const telegramId = typeof userData.telegramId === 'string' 
          ? parseInt(userData.telegramId, 10) 
          : userData.telegramId;
        
        if (!Number.isInteger(telegramId) || telegramId <= 0) {
          throw new Error('telegramId должен быть положительным целым числом или null');
        }
        
        updates.push(`telegram_id = $${paramIndex++}`);
        values.push(telegramId);
      } else {
        updates.push(`telegram_id = $${paramIndex++}`);
        values.push(null);
      }
    }
    if (userData.botToken !== undefined) {
      updates.push(`bot_token = $${paramIndex++}`);
      values.push(userData.botToken);
    }
    if (userData.workHours !== undefined) {
      updates.push(`work_hours = $${paramIndex++}::jsonb`);
      const workHoursValue = typeof userData.workHours === 'string' 
        ? userData.workHours 
        : JSON.stringify(userData.workHours);
      values.push(workHoursValue);
    }

    if (updates.length === 0) return;

    values.push(id);
    const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`;
    await pool.query(sql, values);
  },

  delete: async (id) => {
    requirePool();
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
  },

  // Получить все салоны (пользователи с role='user' или без роли)
  getAllSalons: async () => {
    requirePool();
    const result = await pool.query(`
      SELECT id, username, salon_name, salon_address, salon_display_phone, salon_phone, salon_lat, salon_lng
      FROM users
      WHERE (role = 'user' OR role IS NULL)
        AND is_active = true
        AND (salon_name IS NOT NULL OR salon_name != '')
      ORDER BY salon_name, username
    `);
    return result.rows;
  }
};

// Функции для работы с услугами
const services = {
  getByUserId: async (userId) => {
    requirePool();
    const result = await pool.query('SELECT * FROM services WHERE user_id = $1 ORDER BY id', [userId]);
    return result.rows;
  },

  setForUser: async (userId, servicesList) => {
    requirePool();
    if (!Array.isArray(servicesList)) {
      throw new Error('servicesList должен быть массивом');
    }
    
    // Валидация данных
    for (const service of servicesList) {
      if (!service.name || service.name.trim() === '') {
        throw new Error('Название услуги обязательно');
      }
      if (typeof service.price !== 'number' || service.price <= 0) {
        throw new Error('Цена должна быть положительным числом');
      }
      if (typeof service.duration !== 'number' || service.duration <= 0) {
        throw new Error('Длительность должна быть положительным числом');
      }
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      await client.query('DELETE FROM services WHERE user_id = $1', [userId]);
      
      for (const service of servicesList) {
        await client.query(
          'INSERT INTO services (user_id, name, price, duration) VALUES ($1, $2, $3, $4)',
          [userId, service.name.trim(), service.price, service.duration]
        );
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
};

// Функции для работы с мастерами
const masters = {
  getByUserId: async (userId) => {
    requirePool();
    const result = await pool.query('SELECT *, COALESCE(photos, \'[]\'::jsonb) as photos FROM masters WHERE user_id = $1 ORDER BY id', [userId]);
    return result.rows.map(row => ({
      ...row,
      photos: row.photos && typeof row.photos === 'object' ? row.photos : (Array.isArray(row.photos) ? row.photos : [])
    }));
  },
  
  updatePhotos: async (masterId, photos) => {
    requirePool();
    const photosJson = Array.isArray(photos) ? JSON.stringify(photos) : '[]';
    await pool.query('UPDATE masters SET photos = $1::jsonb WHERE id = $2', [photosJson, masterId]);
  },

  setForUser: async (userId, mastersList) => {
    requirePool();
    if (!Array.isArray(mastersList)) {
      throw new Error('mastersList должен быть массивом');
    }
    
    // Валидация данных
    for (const master of mastersList) {
      if (!master.name || master.name.trim() === '') {
        throw new Error('Имя мастера обязательно');
      }
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      await client.query('DELETE FROM masters WHERE user_id = $1', [userId]);
      
      for (const master of mastersList) {
        const photos = master.photos && Array.isArray(master.photos) ? JSON.stringify(master.photos) : '[]';
        await client.query(
          'INSERT INTO masters (user_id, name, role, photos) VALUES ($1, $2, $3, $4::jsonb)',
          [userId, master.name.trim(), master.role ? master.role.trim() : '', photos]
        );
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  getByMasterUserId: async (masterUserId) => {
    requirePool();
    const result = await pool.query(
      'SELECT * FROM masters WHERE master_user_id = $1 ORDER BY id',
      [masterUserId]
    );
    return result.rows.map(row => ({
      ...row,
      photos: row.photos && typeof row.photos === 'object' ? row.photos : (Array.isArray(row.photos) ? row.photos : [])
    }));
  },

  // Получить или создать запись мастера для пользователя-мастера
  getOrCreateMasterRecord: async (masterUserId, masterUsername) => {
    requirePool();
    // Ищем первую запись мастера для этого пользователя
    const existingMasters = await masters.getByMasterUserId(masterUserId);
    if (existingMasters.length > 0) {
      return existingMasters[0]; // Возвращаем первую запись
    }
    
    // Если записи нет, создаем временную запись (без привязки к салону)
    // Используем user_id = masterUserId для удобства (можно изменить логику)
    const client = await pool.connect();
    try {
      const result = await pool.query(
        'INSERT INTO masters (user_id, master_user_id, name, role, photos) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *',
        [masterUserId, masterUserId, masterUsername || 'Мастер', '', '[]']
      );
      const newMaster = result.rows[0];
      return {
        ...newMaster,
        photos: newMaster.photos && typeof newMaster.photos === 'object' ? newMaster.photos : (Array.isArray(newMaster.photos) ? newMaster.photos : [])
      };
    } finally {
      client.release();
    }
  }
};

// Функции для работы с связями салон-мастер
const salonMasters = {
  // Добавить мастера к салону
  add: async (salonUserId, masterUserId, masterRecordId = null) => {
    requirePool();
    const result = await pool.query(`
      INSERT INTO salon_masters (salon_user_id, master_user_id, master_record_id, is_active)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (salon_user_id, master_user_id) 
      DO UPDATE SET is_active = true, master_record_id = COALESCE(EXCLUDED.master_record_id, salon_masters.master_record_id)
      RETURNING id
    `, [salonUserId, masterUserId, masterRecordId]);
    return result.rows[0].id;
  },

  // Удалить мастера из салона
  remove: async (salonUserId, masterUserId) => {
    requirePool();
    await pool.query(
      'DELETE FROM salon_masters WHERE salon_user_id = $1 AND master_user_id = $2',
      [salonUserId, masterUserId]
    );
  },

  // Получить всех мастеров салона
  getBySalonId: async (salonUserId) => {
    requirePool();
    const result = await pool.query(`
      SELECT sm.*, u.username, u.email, u.salon_phone, u.created_at as user_created_at
      FROM salon_masters sm
      JOIN users u ON sm.master_user_id = u.id
      WHERE sm.salon_user_id = $1 AND sm.is_active = true
      ORDER BY sm.created_at DESC
    `, [salonUserId]);
    return result.rows;
  },

  // Получить все салоны мастера
  getByMasterId: async (masterUserId) => {
    requirePool();
    const result = await pool.query(`
      SELECT sm.*, u.id as salon_id, u.username as salon_username, u.salon_name, u.salon_address, u.created_at as salon_created_at
      FROM salon_masters sm
      JOIN users u ON sm.salon_user_id = u.id
      WHERE sm.master_user_id = $1 AND sm.is_active = true
      ORDER BY sm.created_at DESC
    `, [masterUserId]);
    return result.rows;
  },

  // Проверить, является ли мастер привязанным к салону
  isMasterInSalon: async (salonUserId, masterUserId) => {
    requirePool();
    const result = await pool.query(
      'SELECT id FROM salon_masters WHERE salon_user_id = $1 AND master_user_id = $2 AND is_active = true LIMIT 1',
      [salonUserId, masterUserId]
    );
    return result.rows.length > 0;
  },

  // Деактивировать связь (не удалять)
  deactivate: async (salonUserId, masterUserId) => {
    requirePool();
    await pool.query(
      'UPDATE salon_masters SET is_active = false WHERE salon_user_id = $1 AND master_user_id = $2',
      [salonUserId, masterUserId]
    );
  }
};

// Функции для работы с записями
const bookings = {
  getAll: async () => {
    requirePool();
    const result = await pool.query('SELECT * FROM bookings ORDER BY created_at DESC');
    return result.rows;
  },

  getByUserId: async (userId) => {
    requirePool();
    const result = await pool.query('SELECT * FROM bookings WHERE user_id = $1 ORDER BY date, time', [userId]);
    return result.rows;
  },

  // Получить записи мастера во всех салонах, где он работает
  getByMasterUserId: async (masterUserId) => {
    requirePool();
    const result = await pool.query(`
      SELECT b.*, u.salon_name, u.salon_address
      FROM bookings b
      JOIN salon_masters sm ON b.user_id = sm.salon_user_id
      JOIN users u ON b.user_id = u.id
      WHERE sm.master_user_id = $1 
        AND sm.is_active = true
        AND (b.master IS NOT NULL AND b.master != '')
        AND (
          -- Поиск по имени мастера в записи
          LOWER(TRIM(b.master)) IN (
            SELECT LOWER(TRIM(m.name)) 
            FROM masters m
            WHERE m.master_user_id = $1
          )
          -- Или по имени пользователя мастера
          OR LOWER(TRIM(b.master)) = (
            SELECT LOWER(TRIM(u2.username))
            FROM users u2
            WHERE u2.id = $1
          )
        )
      ORDER BY b.date, b.time
    `, [masterUserId]);
    return result.rows;
  },

  // Получить записи мастера по дате
  getByMasterUserIdAndDate: async (masterUserId, date) => {
    requirePool();
    const result = await pool.query(`
      SELECT b.*, u.salon_name, u.salon_address
      FROM bookings b
      JOIN salon_masters sm ON b.user_id = sm.salon_user_id
      JOIN users u ON b.user_id = u.id
      WHERE sm.master_user_id = $1 
        AND sm.is_active = true
        AND b.date = $2
        AND (b.master IS NOT NULL AND b.master != '')
        AND (
          LOWER(TRIM(b.master)) IN (
            SELECT LOWER(TRIM(m.name)) 
            FROM masters m
            WHERE m.master_user_id = $1
          )
          OR LOWER(TRIM(b.master)) = (
            SELECT LOWER(TRIM(u2.username))
            FROM users u2
            WHERE u2.id = $1
          )
        )
      ORDER BY b.time
    `, [masterUserId, date]);
    return result.rows;
  },

  getByUserIdAndDate: async (userId, date) => {
    requirePool();
    const result = await pool.query('SELECT * FROM bookings WHERE user_id = $1 AND date = $2 ORDER BY time', [userId, date]);
    return result.rows;
  },

  create: async (bookingData) => {
    requirePool();
    const { userId, name, phone, service, master, date, time, endTime, comment } = bookingData;
    const result = await pool.query(`
      INSERT INTO bookings (user_id, name, phone, service, master, date, time, end_time, comment)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `, [
      userId,
      name,
      phone,
      service,
      master || '',
      date,
      time,
      endTime || null,
      comment || ''
    ]);
    return result.rows[0].id;
  },

  getById: async (id) => {
    requirePool();
    const result = await pool.query('SELECT * FROM bookings WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  update: async (id, bookingData) => {
    requirePool();
    const { name, phone, service, master, date, time, endTime, comment } = bookingData;
    
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name.trim());
    }
    if (phone !== undefined) {
      updates.push(`phone = $${paramIndex++}`);
      values.push(phone.trim());
    }
    if (service !== undefined) {
      updates.push(`service = $${paramIndex++}`);
      values.push(service.trim());
    }
    if (master !== undefined) {
      updates.push(`master = $${paramIndex++}`);
      values.push(master ? master.trim() : '');
    }
    if (date !== undefined) {
      updates.push(`date = $${paramIndex++}`);
      values.push(date.trim());
    }
    if (time !== undefined) {
      updates.push(`time = $${paramIndex++}`);
      values.push(time.trim());
    }
    if (endTime !== undefined) {
      updates.push(`end_time = $${paramIndex++}`);
      values.push(endTime ? endTime.trim() : null);
    }
    if (comment !== undefined) {
      updates.push(`comment = $${paramIndex++}`);
      values.push(comment ? comment.trim() : '');
    }

    if (updates.length === 0) {
      return; // Нет изменений
    }

    values.push(id);
    const sql = `UPDATE bookings SET ${updates.join(', ')} WHERE id = $${paramIndex}`;
    await pool.query(sql, values);
  },

  delete: async (id) => {
    requirePool();
    await pool.query('DELETE FROM bookings WHERE id = $1', [id]);
  },

  deleteByUserId: async (userId) => {
    requirePool();
    await pool.query('DELETE FROM bookings WHERE user_id = $1', [userId]);
  },

  // Получить записи клиента по телефону
  getByPhone: async (phone) => {
    requirePool();
    if (!phone) return [];
    
    // Нормализуем номер: удаляем все нецифровые символы
    const phoneDigits = phone.replace(/\D/g, '');
    
    if (phoneDigits.length < 9) {
      return [];
    }
    
    // Ищем записи, где телефон совпадает (с учетом различных форматов)
    // Используем несколько вариантов поиска для лучшего совпадения
    const last10Digits = phoneDigits.length >= 10 ? phoneDigits.substring(phoneDigits.length - 10) : phoneDigits;
    const last9Digits = phoneDigits.length >= 9 ? phoneDigits.substring(phoneDigits.length - 9) : phoneDigits;
    
    const result = await pool.query(`
      SELECT DISTINCT b.*, u.salon_name, u.salon_address
      FROM bookings b
      JOIN users u ON b.user_id = u.id
      WHERE 
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(b.phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') LIKE $1
        OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(b.phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') LIKE $2
        OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(b.phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') LIKE $3
      ORDER BY b.date DESC, b.time DESC
    `, [`%${phoneDigits}%`, `%${last10Digits}%`, `%${last9Digits}%`]);
    
    return result.rows;
  }
};

// Миграция данных из JSON в БД (если нужно)
async function migrateFromJSON() {
  if (DB_TYPE !== 'postgres') {
    console.log('Миграция из JSON доступна только для SQLite');
    return;
  }
  
  const path = require('path');
  const fs = require('fs');
  const DB_DIR = path.join(__dirname, 'data');
  const usersFile = path.join(DB_DIR, 'users.json');
  const bookingsFile = path.join(DB_DIR, 'bookings.json');

  // Проверяем, есть ли уже данные в БД
  const result = await pool.query('SELECT COUNT(*) as count FROM users');
  if (parseInt(result.rows[0].count) > 0) {
    console.log('База данных уже содержит данные. Миграция не требуется.');
    return;
  }

  // Мигрируем пользователей
  if (fs.existsSync(usersFile)) {
    try {
      const usersData = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
      console.log(`Миграция ${usersData.length} пользователей...`);
      
      for (const user of usersData) {
        const userId = await users.create({
          username: user.username,
          email: user.email || '',
          password: user.password,
          role: user.role || 'user',
          isActive: user.isActive !== undefined ? user.isActive : true,
          salonName: user.salonName || '',
          salonAddress: user.salonAddress || '',
          salonLat: user.salonLat || null,
          salonLng: user.salonLng || null
        });

        // Мигрируем услуги
        if (user.services && user.services.length > 0) {
          await services.setForUser(userId, user.services);
        }

        // Мигрируем мастеров
        if (user.masters && user.masters.length > 0) {
          await masters.setForUser(userId, user.masters);
        }
      }
      console.log('Миграция пользователей завершена.');
    } catch (error) {
      console.error('Ошибка миграции пользователей:', error);
    }
  }

  // Мигрируем записи
  if (fs.existsSync(bookingsFile)) {
    try {
      const bookingsData = JSON.parse(fs.readFileSync(bookingsFile, 'utf8'));
      console.log(`Миграция ${bookingsData.length} записей...`);
      
      for (const booking of bookingsData) {
        await bookings.create({
          userId: booking.userId,
          name: booking.name,
          phone: booking.phone,
          service: booking.service,
          master: booking.master || '',
          date: booking.date,
          time: booking.time,
          endTime: booking.endTime || null,
          comment: booking.comment || ''
        });
      }
      console.log('Миграция записей завершена.');
    } catch (error) {
      console.error('Ошибка миграции записей:', error);
    }
  }
}

// Функции для работы с уведомлениями
const notifications = {
  getByUserId: async (userId, limit = 100) => {
    requirePool();
    const result = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    return result.rows.map(row => ({
      id: row.id,
      title: row.title,
      message: row.message,
      type: row.type,
      bookingId: row.booking_id,
      read: row.read,
      time: row.created_at.toISOString()
    }));
  },

  create: async (notificationData) => {
    requirePool();
    const { userId, title, message, type = 'success', bookingId = null } = notificationData;
    
    const result = await pool.query(`
      INSERT INTO notifications (user_id, title, message, type, booking_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, created_at
    `, [
      userId,
      title,
      message,
      type,
      bookingId || null
    ]);
    
    return {
      id: result.rows[0].id,
      time: result.rows[0].created_at.toISOString()
    };
  },

  markAsRead: async (id, userId) => {
    requirePool();
    await pool.query(
      'UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
  },

  markAllAsRead: async (userId) => {
    requirePool();
    await pool.query(
      'UPDATE notifications SET read = true WHERE user_id = $1 AND read = false',
      [userId]
    );
  },

  remove: async (id, userId) => {
    requirePool();
    await pool.query(
      'DELETE FROM notifications WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
  },

  removeAll: async (userId) => {
    requirePool();
    await pool.query(
      'DELETE FROM notifications WHERE user_id = $1',
      [userId]
    );
  },

  getUnreadCount: async (userId) => {
    requirePool();
    const result = await pool.query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read = false',
      [userId]
    );
    return parseInt(result.rows[0].count);
  }
};

// Функции для работы с клиентами
const clients = {
  getByPhone: async (phone) => {
    requirePool();
    if (!phone) return null;
    
    // Нормализуем номер: удаляем все нецифровые символы
    const phoneDigits = phone.replace(/\D/g, '');
    
    if (phoneDigits.length < 9) {
      return null;
    }
    
    // Ищем клиента по телефону (с учетом различных форматов)
    const last10Digits = phoneDigits.length >= 10 ? phoneDigits.substring(phoneDigits.length - 10) : phoneDigits;
    const last9Digits = phoneDigits.length >= 9 ? phoneDigits.substring(phoneDigits.length - 9) : phoneDigits;
    
    const result = await pool.query(`
      SELECT * FROM clients
      WHERE 
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') = $1
        OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') = $2
        OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') = $3
      LIMIT 1
    `, [phoneDigits, last10Digits, last9Digits]);
    
    return result.rows[0] || null;
  },

  getById: async (id) => {
    requirePool();
    const result = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  create: async (clientData) => {
    requirePool();
    const { phone, name, email, password } = clientData;
    
    // Валидация
    if (!phone || !name) {
      throw new Error('Телефон и имя обязательны');
    }
    
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 9) {
      throw new Error('Некорректный номер телефона');
    }
    
    // Проверяем, не существует ли уже клиент с таким телефоном
    const existing = await clients.getByPhone(phone);
    if (existing) {
      throw new Error('Клиент с таким номером телефона уже зарегистрирован');
    }
    
    const result = await pool.query(`
      INSERT INTO clients (phone, name, email, password)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, [
      phone.trim(),
      name.trim(),
      email ? email.trim() : null,
      password || null
    ]);
    
    return result.rows[0].id;
  },

  update: async (id, clientData) => {
    requirePool();
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (clientData.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(clientData.name.trim());
    }
    if (clientData.email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      values.push(clientData.email ? clientData.email.trim() : null);
    }
    if (clientData.password !== undefined) {
      updates.push(`password = $${paramIndex++}`);
      values.push(clientData.password);
    }

    if (updates.length === 0) return;

    values.push(id);
    const sql = `UPDATE clients SET ${updates.join(', ')} WHERE id = $${paramIndex}`;
    await pool.query(sql, values);
  }
};

// Экспортируем функцию инициализации
module.exports = {
  pool,
  users,
  services,
  masters,
  salonMasters,
  bookings,
  notifications,
  clients,
  migrateFromJSON,
  initDatabase
};