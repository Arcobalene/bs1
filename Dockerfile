# Используем официальный образ Node.js
FROM node:18-alpine

# Устанавливаем curl для healthcheck
RUN apk add --no-cache curl

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package.json и package-lock.json (если есть)
COPY package*.json ./

# Устанавливаем зависимости (только production для меньшего размера образа)
# Используем npm install, так как package-lock.json может отсутствовать
RUN npm install --omit=dev && npm cache clean --force

# Копируем все файлы приложения
COPY . .

# Создаем папку для данных с правильными правами
RUN mkdir -p /app/data && chown -R node:node /app/data

# Переключаемся на непривилегированного пользователя
USER node

# Открываем порт
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

# Запускаем приложение
CMD ["node", "server.js"]

