FROM node:18-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY services/telegram-service/package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Копируем shared модули
COPY shared ./shared

# Копируем код сервиса
COPY services/telegram-service/server.js ./

EXPOSE 3007

CMD ["node", "server.js"]

