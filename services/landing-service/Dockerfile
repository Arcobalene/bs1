# Multi-stage build для оптимизации размера образа
FROM node:18-alpine AS builder

WORKDIR /app

# Копируем package.json сервиса
COPY services/landing-service/package*.json ./

# Устанавливаем зависимости
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
COPY services/landing-service/server.js ./
COPY services/landing-service/package.json ./
COPY services/landing-service/views ./views/
COPY services/landing-service/public ./public/

# Создаем непривилегированного пользователя
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3008

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3008/health || exit 1

CMD ["node", "server.js"]
