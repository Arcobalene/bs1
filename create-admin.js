const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

async function createAdmin() {
  // Создаем папку data если её нет
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
  }

  let users = [];
  if (fs.existsSync(USERS_FILE)) {
    try {
      users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch (e) {
      console.log('Ошибка чтения файла, создаем новый');
    }
  }

  // Проверяем, есть ли уже пользователь admin
  const existingAdmin = users.find(u => u.username === 'admin');
  
  if (existingAdmin) {
    console.log('Пользователь admin уже существует');
    console.log('Удаляем старый аккаунт...');
    users = users.filter(u => u.username !== 'admin');
  }

  // Создаем новый демо-аккаунт
  console.log('Создание демо-аккаунта...');
  const hashedPassword = await bcrypt.hash('admin123', 10);
  const demoUser = {
    id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1,
    username: 'admin',
    email: 'admin@beautystudio.local',
    password: hashedPassword,
    role: 'admin',
    isActive: true,
    services: [
      { id: 1, name: "Стрижка простая", price: 180000, duration: 60 },
      { id: 2, name: "Стрижка + укладка", price: 260000, duration: 120 },
      { id: 3, name: "Маникюр классический", price: 160000, duration: 90 },
      { id: 4, name: "Маникюр + покрытие гель-лак", price: 220000, duration: 120 },
      { id: 5, name: "Педикюр", price: 250000, duration: 120 }
    ],
      masters: [
        { id: 1, name: "Алина", role: "маникюр, педикюр" },
        { id: 2, name: "Диана", role: "маникюр, дизайн" },
        { id: 3, name: "София", role: "парикмахер-стилист" }
      ],
      salonName: 'Beauty Studio',
      salonAddress: '',
      salonLat: null,
      salonLng: null,
      createdAt: new Date().toISOString()
    };

  users.push(demoUser);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

  console.log('');
  console.log('========================================');
  console.log('ДЕМО-АККАУНТ СОЗДАН УСПЕШНО!');
  console.log('========================================');
  console.log('Логин: admin');
  console.log('Пароль: admin123');
  console.log('========================================');
  console.log('');
}

createAdmin().catch(err => {
  console.error('Ошибка:', err);
  process.exit(1);
});

