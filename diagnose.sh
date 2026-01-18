#!/bin/bash
# Скрипт диагностики Beauty Studio

echo "=== ДИАГНОСТИКА BEAUTY STUDIO ==="
echo ""

echo "1. Проверка Docker контейнеров:"
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""

echo "2. Проверка логов Gateway (последние 50 строк):"
docker-compose -f docker-compose.microservices.yml logs --tail=50 gateway
echo ""

echo "3. Проверка логов User Service (последние 50 строк):"
docker-compose -f docker-compose.microservices.yml logs --tail=50 user-service
echo ""

echo "4. Проверка логов Auth Service (последние 50 строк):"
docker-compose -f docker-compose.microservices.yml logs --tail=50 auth-service
echo ""

echo "5. Проверка PostgreSQL:"
docker exec postgres psql -U beauty_user -d beauty_studio -c "\dt" 2>&1
echo ""

echo "6. Проверка Redis:"
docker exec redis redis-cli PING 2>&1
echo ""

echo "7. Проверка сети Docker:"
docker network ls
docker network inspect bs_beauty-network 2>&1 | grep -A 20 "Containers"
echo ""

echo "8. Health checks изнутри gateway:"
docker exec gateway curl -s http://user-service:3002/health 2>&1
docker exec gateway curl -s http://auth-service:3001/health 2>&1
docker exec gateway curl -s http://booking-service:3003/health 2>&1
echo ""

echo "9. Проверка environment variables gateway:"
docker exec gateway env | grep -E "SERVICE_URL|REDIS|DB_" 2>&1
echo ""

echo "10. Проверка environment variables user-service:"
docker exec user-service env | grep -E "DB_|REDIS|PORT" 2>&1
echo ""

echo "=== ДИАГНОСТИКА ЗАВЕРШЕНА ==="
