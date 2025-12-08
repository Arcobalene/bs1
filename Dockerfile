# Используем официальный образ Node.js
FROM node:18-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package.json и package-lock.json (если есть)
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install

# Копируем все файлы приложения
COPY . .

# Создаем папку для данных
RUN mkdir -p /app/data

# Открываем порт
EXPOSE 3000

# Запускаем приложение
CMD ["node", "server.js"]

