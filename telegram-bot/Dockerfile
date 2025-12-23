FROM node:18-alpine

# Устанавливаем системные зависимости для SQLite
RUN apk add --no-cache python3 make g++ sqlite sqlite-dev

WORKDIR /app

# Копируем package.json отдельно для кэширования слоев
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install --omit=dev

# Копируем исходный код
COPY . .

# Создаем директории для данных
RUN mkdir -p /app/data && chown -R node:node /app/data

# Переключаемся на пользователя node
USER node

# Открываем порт для веб-сервера бота
EXPOSE 3001

# Команда запуска
CMD ["node", "bot.js"]

