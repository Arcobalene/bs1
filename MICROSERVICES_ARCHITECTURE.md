# Архитектура микросервисов

## Обзор

Проект перестроен на микросервисную архитектуру для улучшения масштабируемости, поддержки и разделения ответственности.

## Структура микросервисов

### 1. Auth Service (Порт 3001)
**Назначение:** Управление аутентификацией и авторизацией
- Регистрация пользователей (салоны, мастера, клиенты)
- Вход/выход
- Управление сессиями
- Проверка прав доступа

**API Endpoints:**
- `POST /api/register` - Регистрация салона
- `POST /api/register/master` - Регистрация мастера
- `POST /api/register-client` - Регистрация клиента
- `POST /api/login` - Вход
- `POST /api/logout` - Выход
- `POST /api/login-client` - Вход клиента
- `POST /api/logout-client` - Выход клиента

### 2. User Service (Порт 3002)
**Назначение:** Управление пользователями и профилями
- Управление пользователями (CRUD)
- Профили салонов
- Профили мастеров
- Профили клиентов
- Связи салон-мастер
- Администрирование пользователей

**API Endpoints:**
- `GET /api/user` - Получить данные пользователя
- `POST /api/salon` - Обновить данные салона
- `GET /api/salon/:userId` - Получить данные салона (публично)
- `GET /api/salon/masters` - Получить мастеров салона
- `POST /api/salon/masters/:masterUserId` - Добавить мастера в салон
- `DELETE /api/salon/masters/:masterUserId` - Удалить мастера из салона
- `GET /api/master/salons` - Получить салоны мастера
- `PUT /api/master/profile` - Обновить профиль мастера
- `GET /api/users` - Список пользователей (админ)
- `POST /api/users/:userId/toggle` - Активировать/деактивировать пользователя
- `POST /api/users/:userId/impersonate` - Войти под другим пользователем
- `DELETE /api/users/:userId` - Удалить пользователя
- `GET /api/clients` - Список клиентов
- `GET /api/client` - Данные клиента
- `GET /api/salons` - Список всех салонов (публично)

### 3. Booking Service (Порт 3003)
**Назначение:** Управление записями
- Создание записей
- Проверка доступности
- Получение записей
- Обновление записей
- Удаление записей
- Записи клиента

**API Endpoints:**
- `POST /api/bookings/check-availability` - Проверить доступность
- `POST /api/bookings` - Создать запись
- `GET /api/bookings/:userId` - Получить записи салона
- `GET /api/bookings` - Получить записи (для авторизованного пользователя)
- `GET /api/master/bookings` - Получить записи мастера
- `GET /api/client/bookings` - Получить записи клиента
- `PUT /api/bookings/:id` - Обновить запись
- `DELETE /api/bookings/:id` - Удалить запись

### 4. Catalog Service (Порт 3004)
**Назначение:** Управление каталогом услуг и мастеров
- Управление услугами салонов
- Управление мастерами
- Публичный доступ к каталогу

**API Endpoints:**
- `POST /api/services` - Обновить услуги
- `GET /api/services/:userId` - Получить услуги салона (публично)
- `POST /api/masters` - Обновить мастеров
- `GET /api/masters/:userId` - Получить мастеров салона (публично)
- `GET /api/masters/search` - Поиск мастеров

### 5. File Service (Порт 3005)
**Назначение:** Управление файлами (фото мастеров)
- Загрузка фото мастеров
- Получение фото мастеров
- Удаление фото
- Health check MinIO

**API Endpoints:**
- `POST /api/masters/:masterId/photos` - Загрузить фото мастера
- `GET /api/masters/:masterId/photos` - Получить список фото мастера
- `GET /api/masters/photos/:masterId/:filename` - Получить фото
- `DELETE /api/masters/:masterId/photos/:filename` - Удалить фото
- `POST /api/master/photos` - Загрузить фото (для мастера)
- `GET /api/master/photos` - Получить фото (для мастера)
- `DELETE /api/master/photos/:filename` - Удалить фото (для мастера)
- `GET /api/minio/health` - Проверка MinIO

### 6. Notification Service (Порт 3006)
**Назначение:** Управление уведомлениями
- Создание уведомлений
- Получение уведомлений
- Отметка прочитанными
- Удаление уведомлений

**API Endpoints:**
- `GET /api/notifications` - Получить уведомления
- `POST /api/notifications` - Создать уведомление
- `PUT /api/notifications/:id/read` - Отметить как прочитанное
- `PUT /api/notifications/read-all` - Отметить все как прочитанные
- `DELETE /api/notifications/:id` - Удалить уведомление
- `DELETE /api/notifications` - Удалить все уведомления

### 7. Telegram Service (Порт 3007)
**Назначение:** Интеграция с Telegram
- Обработка webhook от Telegram
- Отправка уведомлений через Telegram
- Настройки Telegram
- Связывание аккаунтов

**API Endpoints:**
- `GET /api/telegram/settings` - Получить настройки Telegram (админ)
- `POST /api/telegram/settings` - Обновить настройки Telegram (админ)
- `GET /api/telegram/bot-token` - Получить токен бота
- `GET /api/telegram/connect-link` - Получить ссылку для подключения
- `POST /api/telegram/link` - Привязать Telegram аккаунт
- `POST /api/telegram/unlink` - Отвязать Telegram аккаунт
- `GET /api/telegram/webhook` - Получить информацию о webhook
- `POST /api/telegram/webhook` - Webhook от Telegram
- `GET /api/owners/by-phone/:phone` - Поиск владельца по телефону

### 8. API Gateway (Порт 3000)
**Назначение:** Единая точка входа, маршрутизация запросов
- Маршрутизация запросов к микросервисам
- Статические файлы
- HTML страницы
- Балансировка нагрузки
- Общие middleware (security, compression, rate limiting)

## Общие модули (shared/)

- **database.js** - Подключение к PostgreSQL, модели данных
- **utils.js** - Общие утилиты (валидация, форматирование)
- **cache.js** - Кэширование данных

## База данных

Все микросервисы используют общую PostgreSQL базу данных. Каждый сервис работает со своими таблицами, но имеет доступ ко всем необходимым данным.

## Взаимодействие между сервисами

Сервисы взаимодействуют через HTTP REST API. Для внутренних запросов используется Docker сеть.

## Развертывание

Все сервисы разворачиваются через Docker Compose. Конфигурация в `docker-compose.microservices.yml`.

## Переменные окружения

Каждый сервис имеет свои переменные окружения, описанные в `.env.example` файлах.

