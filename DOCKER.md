# Инструкция по Docker

## Быстрый старт

### Windows 11

1. **Установите Docker Desktop:**
   - Скачайте с https://www.docker.com/products/docker-desktop
   - Установите и перезапустите компьютер
   - Убедитесь, что Docker Desktop запущен

2. **Запустите приложение:**
   - Дважды кликните на `docker-start.bat`
   - Дождитесь сборки и запуска контейнера
   - Откройте браузер: `http://localhost:3000`

3. **Остановите приложение:**
   - Дважды кликните на `docker-stop.bat`
   - Или используйте команды ниже

### Через командную строку

#### Сборка и запуск:
```bash
docker-compose up -d --build
```

#### Просмотр логов:
```bash
docker-compose logs -f
```

#### Остановка:
```bash
docker-compose down
```

#### Перезапуск:
```bash
docker-compose restart
```

#### Остановка и удаление контейнера:
```bash
docker-compose down
```

#### Остановка и удаление контейнера + образов:
```bash
docker-compose down --rmi all
```

## Структура Docker

- **Dockerfile** — описание образа приложения
- **docker-compose.yml** — конфигурация контейнера
- **.dockerignore** — файлы, исключенные из образа

## База данных в Docker

Система использует SQLite, которая хранится в именованном Docker томе `beauty-studio-data`. Это обеспечивает:

- ✅ **Персистентность данных** - данные сохраняются даже после удаления контейнера
- ✅ **Автоматическое резервное копирование** - можно легко создать бэкап тома
- ✅ **Изоляция данных** - данные не зависят от файловой системы хоста

### Работа с данными

**Просмотр данных:**
```bash
docker exec -it beauty-studio-bs-1 ls -la /app/data
```

**Резервное копирование:**
```bash
# Создать бэкап
docker run --rm -v beauty-studio-bs_beauty-studio-data:/data -v $(pwd):/backup alpine tar czf /backup/beauty-studio-backup.tar.gz /data

# Восстановить из бэкапа
docker run --rm -v beauty-studio-bs_beauty-studio-data:/data -v $(pwd):/backup alpine tar xzf /backup/beauty-studio-backup.tar.gz -C /
```

**Очистка данных:**
```bash
# Удалить том (все данные будут потеряны!)
docker-compose down -v
```

### Альтернатива: PostgreSQL

Если нужна более мощная БД, можно использовать PostgreSQL:

```bash
docker-compose -f docker-compose.postgres.yml up -d
```

Это запустит отдельный контейнер PostgreSQL. Требуется обновление кода для работы с PostgreSQL.

## Преимущества Docker

✅ Не нужно устанавливать Node.js локально  
✅ Изолированная среда  
✅ Легко переносить на другой компьютер  
✅ Автоматический перезапуск при сбоях  
✅ Данные сохраняются в папке `data/` на хосте  

## Полезные команды

```bash
# Просмотр запущенных контейнеров
docker ps

# Просмотр всех контейнеров (включая остановленные)
docker ps -a

# Просмотр логов
docker-compose logs -f beauty-studio

# Вход в контейнер
docker exec -it beauty-studio sh

# Просмотр использования ресурсов
docker stats beauty-studio

# Очистка неиспользуемых образов
docker system prune -a
```

## Решение проблем

### Ошибка: "Docker не запущен"

**Решение:**
1. Запустите Docker Desktop
2. Дождитесь полной загрузки (иконка в трее должна быть зеленая)
3. Попробуйте снова

### Ошибка: "Порт 3000 уже занят"

**Решение:**
1. Измените порт в `docker-compose.yml`:
```yaml
ports:
  - "3001:3000"  # Внешний порт:внутренний порт
```

2. Перезапустите контейнер:
```bash
docker-compose down
docker-compose up -d
```

### Ошибка при сборке образа

**Решение:**
1. Очистите кэш Docker:
```bash
docker system prune -a
```

2. Пересоберите образ:
```bash
docker-compose build --no-cache
docker-compose up -d
```

### Данные не сохраняются

**Решение:**
Убедитесь, что в `docker-compose.yml` есть volume:
```yaml
volumes:
  - ./data:/app/data
```

### Контейнер не запускается

**Решение:**
1. Проверьте логи:
```bash
docker-compose logs
```

2. Проверьте статус:
```bash
docker ps -a
```

3. Пересоздайте контейнер:
```bash
docker-compose down
docker-compose up -d --build
```

## Обновление приложения

1. Остановите контейнер:
```bash
docker-compose down
```

2. Обновите код

3. Пересоберите и запустите:
```bash
docker-compose up -d --build
```

## Резервное копирование

Данные хранятся в папке `data/` на хосте. Для резервного копирования просто скопируйте эту папку.

```bash
# Создание резервной копии
cp -r data data-backup-$(date +%Y%m%d)

# Восстановление
cp -r data-backup-YYYYMMDD data
```

## Продакшн

Для продакшн-версии рекомендуется:

1. Использовать переменные окружения для секретов
2. Настроить HTTPS
3. Использовать обратный прокси (nginx)
4. Настроить мониторинг
5. Использовать внешнюю БД вместо JSON файлов

Пример `.env` файла:
```env
NODE_ENV=production
SESSION_SECRET=your-secret-key-here
PORT=3000
```

