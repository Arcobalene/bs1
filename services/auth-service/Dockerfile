# Multi-stage build для оптимизации размера образа
FROM node:18-alpine AS builder

WORKDIR /app

# Копируем package.json файлы
COPY package*.json ./
COPY services/auth-service/package*.json ./services/auth-service/
COPY shared ./shared/

# Устанавливаем зависимости
# Используем npm install вместо npm ci, так как package-lock.json может быть устаревшим
# npm install обновит зависимости согласно package.json и создаст актуальный lock файл
RUN npm install --production --omit=dev && npm cache clean --force

# Production образ
FROM node:18-alpine

# Устанавливаем curl для healthcheck
RUN apk add --no-cache curl

WORKDIR /app

# Копируем node_modules из builder
COPY --from=builder /app/node_modules ./node_modules

# Копируем код приложения
COPY services/auth-service/server.js ./
COPY services/auth-service/package.json ./
COPY shared ./shared/

# Создаем непривилегированного пользователя
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "server.js"]

