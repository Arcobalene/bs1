# Исправление проблемы 502 Bad Gateway

## Проблема
Nginx не мог подключиться к Gateway, получая ошибку `Connection refused (111)`.

## Решение

### 1. Исправлены пути в рефакторенной версии Gateway
- Пути к `shared` модулям: `../shared/` → `./shared/`
- Пути к `views`: уже были правильными (`./views/`)
- Пути к `public`: уже были правильными (`./public/`)

### 2. Заменен `gateway/server.js` на рефакторенную версию
Рефакторенная версия включает:
- Структурированное логирование
- Централизованную обработку ошибок
- Валидацию конфигурации
- Улучшенную безопасность (Helmet, CORS, rate limiting)

## Что нужно сделать

### Пересобрать и перезапустить контейнеры:

```bash
# Остановить контейнеры
docker-compose -f docker-compose.microservices.yml down

# Пересобрать gateway
docker-compose -f docker-compose.microservices.yml build gateway

# Запустить все сервисы
docker-compose -f docker-compose.microservices.yml up -d

# Проверить логи gateway
docker-compose -f docker-compose.microservices.yml logs -f gateway
```

### Проверить статус:

```bash
# Проверить статус всех контейнеров
docker-compose -f docker-compose.microservices.yml ps

# Проверить health check gateway
curl http://localhost:3000/health

# Проверить логи nginx
docker logs beauty-studio-nginx
```

## Ожидаемый результат

После пересборки:
- Gateway должен успешно запуститься
- Health check должен проходить (`/health` возвращает 200)
- Nginx должен успешно подключаться к Gateway
- Сайт должен быть доступен

## Резервная копия

Старая версия `server.js` сохранена в `gateway/server.js.backup` на случай необходимости отката.

