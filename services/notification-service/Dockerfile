FROM node:18-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY services/notification-service/package*.json ./
RUN npm install --omit=dev

# Копируем shared модули
COPY shared ./shared

# Копируем код сервиса
COPY services/notification-service/server.js ./

EXPOSE 3006

CMD ["node", "server.js"]

