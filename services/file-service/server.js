const express = require('express');
const multer = require('multer');
const Minio = require('minio');
const crypto = require('crypto');

// Импортируем общие модули
const { masters, users: dbUsers, initDatabase } = require('../../shared/database');
const { setupStandardMiddleware, requireAuth, errorHandler } = require('../../shared/middleware');

const app = express();
const PORT = process.env.PORT || 3005;

// Настройка стандартного middleware
setupStandardMiddleware(app);

// Session управляется централизованно в gateway
// Сервис получает userId через заголовок X-User-ID от gateway

// Настройка MinIO
const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'minio',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin'
});

const BUCKET_NAME = 'master-photos';

// Инициализация bucket
async function initMinIO() {
  try {
    const exists = await minioClient.bucketExists(BUCKET_NAME);
    if (!exists) {
      await minioClient.makeBucket(BUCKET_NAME);
      console.log(`✅ Bucket ${BUCKET_NAME} создан`);
    }
  } catch (error) {
    console.error('❌ Ошибка инициализации MinIO:', error);
  }
}

// Настройка multer для загрузки файлов
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Только изображения разрешены'), false);
    }
  }
});

// API: Загрузить фото мастера (для владельца салона)
app.post('/api/masters/:masterId/photos', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    const { masterId } = req.params;
    const user = await dbUsers.getById(req.session.userId);
    
    if (!user || user.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Файл не загружен' });
    }

    // Получаем мастера для проверки владельца
    const salonMasters = await masters.getByUserId(user.id);
    const master = salonMasters.find(m => m.id === parseInt(masterId));
    if (!master) {
      return res.status(404).json({ success: false, message: 'Мастер не найден' });
    }

    const fileExtension = req.file.originalname.split('.').pop();
    const uniqueId = crypto.randomBytes(16).toString('hex');
    const fileName = `${masterId}/${uniqueId}.${fileExtension}`;
    
    await minioClient.putObject(BUCKET_NAME, fileName, req.file.buffer, req.file.size, {
      'Content-Type': req.file.mimetype
    });

    // Получаем текущие фото мастера
    const currentPhotos = master.photos || [];
    const photoUrl = `/api/masters/photos/${masterId}/${fileName.split('/').pop()}`;
    const updatedPhotos = [...currentPhotos, photoUrl];

    await masters.updatePhotos(parseInt(masterId), updatedPhotos);

    res.json({ success: true, photoUrl, message: 'Фото загружено' });
  } catch (error) {
    console.error('Ошибка загрузки фото:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить список фото мастера
app.get('/api/masters/:masterId/photos', async (req, res) => {
  try {
    const { masterId } = req.params;
    const salonMasters = await masters.getByUserId(parseInt(req.query.userId || 0));
    const master = salonMasters.find(m => m.id === parseInt(masterId));
    
    if (!master) {
      return res.json({ success: true, photos: [] });
    }

    const photos = master.photos || [];
    res.json({ success: true, photos });
  } catch (error) {
    console.error('Ошибка получения фото:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить фото (stream)
app.get('/api/masters/photos/:masterId/:filename', async (req, res) => {
  try {
    const { masterId, filename } = req.params;
    const objectName = `${masterId}/${filename}`;
    
    const stat = await minioClient.statObject(BUCKET_NAME, objectName);
    const stream = await minioClient.getObject(BUCKET_NAME, objectName);
    
    res.setHeader('Content-Type', stat.metaData['content-type'] || 'image/jpeg');
    res.setHeader('Content-Length', stat.size);
    stream.pipe(res);
    
    // Обработка ошибок потока
    stream.on('error', (streamError) => {
      if (!res.headersSent) {
        console.error('Ошибка потока при получении фото:', streamError);
        res.status(500).json({ success: false, message: 'Ошибка получения фото' });
      }
    });
  } catch (error) {
    if (error.code === 'NoSuchKey' || error.code === 'NotFound') {
      if (!res.headersSent) {
        return res.status(404).json({ success: false, message: 'Фото не найдено' });
      }
      return;
    }
    console.error('Ошибка получения фото:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
  }
});

// API: Удалить фото мастера
app.delete('/api/masters/:masterId/photos/:filename', requireAuth, async (req, res) => {
  try {
    const { masterId, filename } = req.params;
    const user = await dbUsers.getById(req.session.userId);
    
    if (!user || user.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    // Получаем мастера
    const salonMasters = await masters.getByUserId(user.id);
    const master = salonMasters.find(m => m.id === parseInt(masterId));
    if (!master) {
      return res.status(404).json({ success: false, message: 'Мастер не найден' });
    }

    const objectName = `${masterId}/${filename}`;
    await minioClient.removeObject(BUCKET_NAME, objectName);

    // Обновляем список фото
    const currentPhotos = master.photos || [];
    const photoUrl = `/api/masters/photos/${masterId}/${filename}`;
    const updatedPhotos = currentPhotos.filter(p => p !== photoUrl);

    await masters.updatePhotos(parseInt(masterId), updatedPhotos);

    res.json({ success: true, message: 'Фото удалено' });
  } catch (error) {
    console.error('Ошибка удаления фото:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Загрузить фото (для мастера)
app.post('/api/master/photos', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    const user = await dbUsers.getById(req.session.userId);
    
    if (!user || user.role !== 'master') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Файл не загружен' });
    }

    // Получаем записи мастера
    const masterRecords = await masters.getByMasterUserId(user.id);
    if (masterRecords.length === 0) {
      return res.status(404).json({ success: false, message: 'Запись мастера не найдена' });
    }

    const master = masterRecords[0];
    const masterId = master.id;
    const fileExtension = req.file.originalname.split('.').pop();
    const uniqueId = crypto.randomBytes(16).toString('hex');
    const fileName = `${masterId}/${uniqueId}.${fileExtension}`;
    
    await minioClient.putObject(BUCKET_NAME, fileName, req.file.buffer, req.file.size, {
      'Content-Type': req.file.mimetype
    });

    const currentPhotos = master.photos || [];
    const photoUrl = `/api/masters/photos/${masterId}/${fileName.split('/').pop()}`;
    const updatedPhotos = [...currentPhotos, photoUrl];

    await masters.updatePhotos(masterId, updatedPhotos);

    res.json({ success: true, photoUrl, message: 'Фото загружено' });
  } catch (error) {
    console.error('Ошибка загрузки фото:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Получить фото (для мастера)
app.get('/api/master/photos', requireAuth, async (req, res) => {
  try {
    const user = await dbUsers.getById(req.session.userId);
    
    if (!user || user.role !== 'master') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    const masterRecords = await masters.getByMasterUserId(user.id);
    if (masterRecords.length === 0) {
      return res.json({ success: true, photos: [] });
    }

    const master = masterRecords[0];
    const photos = master.photos || [];
    res.json({ success: true, photos });
  } catch (error) {
    console.error('Ошибка получения фото:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Удалить фото (для мастера)
app.delete('/api/master/photos/:filename', requireAuth, async (req, res) => {
  try {
    const { filename } = req.params;
    const user = await dbUsers.getById(req.session.userId);
    
    if (!user || user.role !== 'master') {
      return res.status(403).json({ success: false, message: 'Доступ запрещен' });
    }

    const masterRecords = await masters.getByMasterUserId(user.id);
    if (masterRecords.length === 0) {
      return res.status(404).json({ success: false, message: 'Запись мастера не найдена' });
    }

    const master = masterRecords[0];
    const masterId = master.id;
    const objectName = `${masterId}/${filename}`;
    
    await minioClient.removeObject(BUCKET_NAME, objectName);

    const currentPhotos = master.photos || [];
    const photoUrl = `/api/masters/photos/${masterId}/${filename}`;
    const updatedPhotos = currentPhotos.filter(p => p !== photoUrl);

    await masters.updatePhotos(masterId, updatedPhotos);

    res.json({ success: true, message: 'Фото удалено' });
  } catch (error) {
    console.error('Ошибка удаления фото:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// API: Проверка MinIO
app.get('/api/minio/health', async (req, res) => {
  try {
    const exists = await minioClient.bucketExists(BUCKET_NAME);
    res.json({ success: true, status: exists ? 'ok' : 'bucket_not_found' });
  } catch (error) {
    console.error('Ошибка проверки MinIO:', error);
    res.status(500).json({ success: false, message: 'MinIO недоступен' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'file-service', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

// Запуск сервера
(async () => {
  try {
    await initDatabase();
    console.log('✅ База данных инициализирована');
    
    await initMinIO();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`📁 File Service запущен на порту ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Ошибка инициализации:', error);
    process.exit(1);
  }
})();
