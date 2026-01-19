# Multi-stage build для оптимизации размера образа
FROM node:18-alpine AS builder

WORKDIR /app

# Копируем только package.json сервиса для оптимизации кэширования слоев
COPY services/catalog-service/package*.json ./
COPY shared ./shared/

# Устанавливаем зависимости
RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-timeout 300000 && \
    npm install --production --omit=dev && \
    npm cache clean --force

# Production образ
FROM node:18-alpine

# Устанавливаем wget для healthcheck
RUN apk add --no-cache wget

WORKDIR /app

# Копируем node_modules из builder
COPY --from=builder /app/node_modules ./node_modules

# Копируем код приложения с сохранением структуры директорий
COPY services/catalog-service ./services/catalog-service/
COPY shared ./shared/

# Создаем непривилегированного пользователя
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

WORKDIR /app/services/catalog-service

EXPOSE 3004

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3004/health || exit 1

CMD ["node", "server.js"]

