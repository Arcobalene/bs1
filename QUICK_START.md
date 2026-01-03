# Быстрый старт микросервисов

## ⚠️ Важно

Текущая реализация содержит **минимальные заглушки** для всех микросервисов. Сервисы запускаются и отвечают на health check, но функциональность еще не реализована.

## Запуск

```bash
# Запустить все сервисы
docker-compose -f docker-compose.microservices.yml up -d --build

# Посмотреть логи
docker-compose -f docker-compose.microservices.yml logs -f

# Остановить все сервисы
docker-compose -f docker-compose.microservices.yml down
```

## Проверка работы

После запуска все сервисы должны отвечать на health check:

```bash
# Проверка всех сервисов
curl http://localhost:3001/health  # Auth Service
curl http://localhost:3002/health  # User Service
curl http://localhost:3003/health  # Booking Service
curl http://localhost:3004/health  # Catalog Service
curl http://localhost:3005/health  # File Service
curl http://localhost:3006/health  # Notification Service
curl http://localhost:3007/health  # Telegram Service
curl http://localhost:3000/health  # API Gateway
```

Все должны вернуть `{"status":"ok",...}`

## Следующие шаги

Для полной функциональности необходимо:

1. Реализовать endpoints в каждом микросервисе
2. Настроить доступ к shared модулям (database, utils, cache)
3. Настроить взаимодействие между сервисами
4. Добавить middleware для авторизации
5. Протестировать работу

См. MICROSERVICES_IMPLEMENTATION.md для подробностей.

