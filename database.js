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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
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
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
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
      CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id);
      CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
    `);

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

  getByUsername: async (username) => {
    requirePool();
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    return result.rows[0] || null;
  },

  create: async (userData) => {
    requirePool();
    const { username, email, password, role, isActive, salonName, salonAddress, salonLat, salonLng, salonDesign } = userData;
    
    // Валидация
    if (!username || !password) {
      throw new Error('Username и password обязательны');
    }
    if (username.length < 3 || username.length > 30) {
      throw new Error('Username должен быть от 3 до 30 символов');
    }
    
    const result = await pool.query(`
      INSERT INTO users (username, email, password, role, is_active, salon_name, salon_address, salon_lat, salon_lng, salon_design)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
    if (userData.salonDesign !== undefined) {
      updates.push(`salon_design = $${paramIndex++}::jsonb`);
      // PostgreSQL JSONB принимает объект напрямую или JSON строку
      const designValue = typeof userData.salonDesign === 'string' 
        ? userData.salonDesign 
        : JSON.stringify(userData.salonDesign);
      values.push(designValue);
    }

    if (updates.length === 0) return;

    values.push(id);
    const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`;
    await pool.query(sql, values);
  },

  delete: async (id) => {
    requirePool();
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
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
    const result = await pool.query('SELECT * FROM masters WHERE user_id = $1 ORDER BY id', [userId]);
    return result.rows;
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
        await client.query(
          'INSERT INTO masters (user_id, name, role) VALUES ($1, $2, $3)',
          [userId, master.name.trim(), master.role ? master.role.trim() : '']
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

// Экспортируем функцию инициализации
module.exports = {
  pool,
  users,
  services,
  masters,
  bookings,
  migrateFromJSON,
  initDatabase
};