const bcrypt = require('bcrypt');
const { users: dbUsers, services, masters } = require('./database');

async function createAdmin() {
  try {
    // Проверяем, есть ли уже пользователь admin
    const existingAdmin = await dbUsers.getByUsername('admin');
    
    if (existingAdmin) {
      console.log('Пользователь admin уже существует');
      console.log('Удаляем старый аккаунт...');
      await dbUsers.delete(existingAdmin.id);
    }

    // Создаем новый демо-аккаунт
    console.log('Создание демо-аккаунта...');
    const hashedPassword = await bcrypt.hash('admin123', 10);
    const userId = await dbUsers.create({
      username: 'admin',
      email: 'admin@beautystudio.local',
      password: hashedPassword,
      role: 'admin',
      isActive: true,
      salonName: 'Beauty Studio',
      salonAddress: '',
      salonLat: null,
      salonLng: null
    });

    // Добавляем услуги
    await services.setForUser(userId, [
      { name: "Стрижка простая", price: 180000, duration: 60 },
      { name: "Стрижка + укладка", price: 260000, duration: 120 },
      { name: "Маникюр классический", price: 160000, duration: 90 },
      { name: "Маникюр + покрытие гель-лак", price: 220000, duration: 120 },
      { name: "Педикюр", price: 250000, duration: 120 }
    ]);

    // Добавляем мастеров
    await masters.setForUser(userId, [
      { name: "Алина", role: "маникюр, педикюр" },
      { name: "Диана", role: "маникюр, дизайн" },
      { name: "София", role: "парикмахер-стилист" }
    ]);

    console.log('');
    console.log('========================================');
    console.log('ДЕМО-АККАУНТ СОЗДАН УСПЕШНО!');
    console.log('========================================');
    console.log('Логин: admin');
    console.log('Пароль: admin123');
    console.log('========================================');
    console.log('');
  } catch (error) {
    console.error('Ошибка создания админа:', error);
    throw error;
  }
}

createAdmin().catch(err => {
  console.error('Ошибка:', err);
  process.exit(1);
});

