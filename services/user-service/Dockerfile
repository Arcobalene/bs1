# Multi-stage build для оптимизации размера образа
FROM node:18-alpine AS builder

WORKDIR /app

# Копируем package.json файлы
COPY package*.json ./
COPY services/user-service/package*.json ./services/user-service/
COPY shared ./shared/

# Устанавливаем зависимости
# Используем npm install вместо npm ci, так как package-lock.json может быть устаревшим
# npm install обновит зависимости согласно package.json и создаст актуальный lock файл
# Добавляем retry и увеличенные таймауты для стабильности сети
RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-timeout 300000 && \
    npm install --production --omit=dev && \
    npm cache clean --force

# Production образ
FROM node:18-alpine

# Устанавливаем curl для healthcheck
RUN apk add --no-cache curl

WORKDIR /app

# Копируем node_modules из builder
COPY --from=builder /app/node_modules ./node_modules

# Копируем код приложения
COPY services/user-service/server.js ./
COPY services/user-service/package.json ./
COPY shared ./shared/

# Создаем непривилегированного пользователя
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3002/health || exit 1

CMD ["node", "server.js"]

