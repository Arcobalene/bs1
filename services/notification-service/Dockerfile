FROM node:18-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY services/notification-service/package*.json ./services/notification-service/
RUN cd services/notification-service && npm install --omit=dev && npm cache clean --force

# Копируем shared модули
COPY shared ./shared

# Копируем код сервиса
COPY services/notification-service/server.js ./services/notification-service/

WORKDIR /app/services/notification-service

EXPOSE 3006

CMD ["node", "server.js"]

