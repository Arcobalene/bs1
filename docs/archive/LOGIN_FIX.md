# Исправление проблемы с логином

## Проблема
Логин не работал из-за несовпадения настроек сессий между gateway и auth-service.

## Что было исправлено:

### 1. Auth Service (services/auth-service/server.js)
- ✅ Добавлен `trust proxy` для работы за gateway/nginx
- ✅ Изменено имя cookie на `beauty.studio.sid` (совпадает с gateway)
- ✅ Синхронизированы настройки secure cookie с gateway
- ✅ Добавлены настройки `sameSite: 'lax'` и `path: '/'`
- ✅ Используется тот же `SESSION_SECRET`, что и в gateway

### 2. Gateway (gateway/server.js)
- ✅ Обновлен `onProxyRes` для правильной передачи Set-Cookie заголовков от auth-service клиенту

## Критические изменения:

### До исправления:
- Auth-service использовал cookie `connect.sid` (по умолчанию)
- Gateway использовал cookie `beauty.studio.sid`
- Настройки secure cookie не совпадали
- Cookies от auth-service не передавались обратно клиенту

### После исправления:
- Оба сервиса используют cookie `beauty.studio.sid`
- Настройки secure cookie синхронизированы
- Cookies правильно передаются от auth-service через gateway клиенту
- Trust proxy настроен в обоих сервисах

## Как это работает:

1. Клиент отправляет POST `/api/login` → Gateway
2. Gateway проксирует запрос → Auth-service
3. Auth-service создает сессию и устанавливает cookie `beauty.studio.sid`
4. Gateway копирует Set-Cookie заголовок от auth-service в свой ответ
5. Клиент получает cookie и может использовать его для последующих запросов

## После исправлений:

Перезапустите сервисы:
```bash
docker-compose -f docker-compose.microservices.yml restart auth-service gateway
```

Логин должен работать корректно!

