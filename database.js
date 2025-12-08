const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'beauty_studio.db');

// Создаем папку data если её нет
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Подключаемся к БД
const db = new Database(DB_FILE);

// Включаем внешние ключи
db.pragma('foreign_keys = ON');

// Инициализация БД (создание таблиц)
function initDatabase() {
  // Таблица пользователей
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      is_active INTEGER DEFAULT 1,
      salon_name TEXT,
      salon_address TEXT,
      salon_lat REAL,
      salon_lng REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Таблица услуг
  db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      duration INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Таблица мастеров
  db.exec(`
    CREATE TABLE IF NOT EXISTS masters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      role TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Таблица записей
  db.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      service TEXT NOT NULL,
      master TEXT,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      end_time TEXT,
      comment TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Индексы для ускорения запросов
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_services_user_id ON services(user_id);
    CREATE INDEX IF NOT EXISTS idx_masters_user_id ON masters(user_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
  `);
}

// Функции для работы с пользователями
const users = {
  getAll: () => {
    return db.prepare('SELECT * FROM users').all();
  },

  getById: (id) => {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  },

  getByUsername: (username) => {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  },

  create: (userData) => {
    const { username, email, password, role, isActive, salonName, salonAddress, salonLat, salonLng } = userData;
    const stmt = db.prepare(`
      INSERT INTO users (username, email, password, role, is_active, salon_name, salon_address, salon_lat, salon_lng)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      username,
      email || '',
      password,
      role || 'user',
      isActive !== undefined ? (isActive ? 1 : 0) : 1,
      salonName || '',
      salonAddress || '',
      salonLat || null,
      salonLng || null
    );
    return result.lastInsertRowid;
  },

  update: (id, userData) => {
    const updates = [];
    const values = [];

    if (userData.email !== undefined) {
      updates.push('email = ?');
      values.push(userData.email);
    }
    if (userData.role !== undefined) {
      updates.push('role = ?');
      values.push(userData.role);
    }
    if (userData.isActive !== undefined) {
      updates.push('is_active = ?');
      values.push(userData.isActive ? 1 : 0);
    }
    if (userData.salonName !== undefined) {
      updates.push('salon_name = ?');
      values.push(userData.salonName);
    }
    if (userData.salonAddress !== undefined) {
      updates.push('salon_address = ?');
      values.push(userData.salonAddress);
    }
    if (userData.salonLat !== undefined) {
      updates.push('salon_lat = ?');
      values.push(userData.salonLat);
    }
    if (userData.salonLng !== undefined) {
      updates.push('salon_lng = ?');
      values.push(userData.salonLng);
    }

    if (updates.length === 0) return;

    values.push(id);
    const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...values);
  },

  delete: (id) => {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
};

// Функции для работы с услугами
const services = {
  getByUserId: (userId) => {
    return db.prepare('SELECT * FROM services WHERE user_id = ? ORDER BY id').all(userId);
  },

  setForUser: (userId, servicesList) => {
    const deleteStmt = db.prepare('DELETE FROM services WHERE user_id = ?');
    const insertStmt = db.prepare(`
      INSERT INTO services (user_id, name, price, duration)
      VALUES (?, ?, ?, ?)
    `);

    const transaction = db.transaction(() => {
      deleteStmt.run(userId);
      for (const service of servicesList) {
        insertStmt.run(userId, service.name, service.price, service.duration);
      }
    });

    transaction();
  }
};

// Функции для работы с мастерами
const masters = {
  getByUserId: (userId) => {
    return db.prepare('SELECT * FROM masters WHERE user_id = ? ORDER BY id').all(userId);
  },

  setForUser: (userId, mastersList) => {
    const deleteStmt = db.prepare('DELETE FROM masters WHERE user_id = ?');
    const insertStmt = db.prepare(`
      INSERT INTO masters (user_id, name, role)
      VALUES (?, ?, ?)
    `);

    const transaction = db.transaction(() => {
      deleteStmt.run(userId);
      for (const master of mastersList) {
        insertStmt.run(userId, master.name, master.role || '');
      }
    });

    transaction();
  }
};

// Функции для работы с записями
const bookings = {
  getAll: () => {
    return db.prepare('SELECT * FROM bookings ORDER BY created_at DESC').all();
  },

  getByUserId: (userId) => {
    return db.prepare('SELECT * FROM bookings WHERE user_id = ? ORDER BY date, time').all(userId);
  },

  create: (bookingData) => {
    const { userId, name, phone, service, master, date, time, endTime, comment } = bookingData;
    const stmt = db.prepare(`
      INSERT INTO bookings (user_id, name, phone, service, master, date, time, end_time, comment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      userId,
      name,
      phone,
      service,
      master || '',
      date,
      time,
      endTime || null,
      comment || ''
    );
    return result.lastInsertRowid;
  },

  deleteByUserId: (userId) => {
    db.prepare('DELETE FROM bookings WHERE user_id = ?').run(userId);
  }
};

// Миграция данных из JSON в БД (если нужно)
function migrateFromJSON() {
  const usersFile = path.join(DB_DIR, 'users.json');
  const bookingsFile = path.join(DB_DIR, 'bookings.json');

  // Проверяем, есть ли уже данные в БД
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCount.count > 0) {
    console.log('База данных уже содержит данные. Миграция не требуется.');
    return;
  }

  // Мигрируем пользователей
  if (fs.existsSync(usersFile)) {
    try {
      const usersData = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
      console.log(`Миграция ${usersData.length} пользователей...`);
      
      for (const user of usersData) {
        const userId = users.create({
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
          services.setForUser(userId, user.services);
        }

        // Мигрируем мастеров
        if (user.masters && user.masters.length > 0) {
          masters.setForUser(userId, user.masters);
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
        bookings.create({
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

// Инициализация
initDatabase();

module.exports = {
  db,
  users,
  services,
  masters,
  bookings,
  migrateFromJSON
};

