FROM node:18-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY services/telegram-service/package*.json ./services/telegram-service/
RUN cd services/telegram-service && npm install --omit=dev && npm cache clean --force

# Копируем shared модули
COPY shared ./shared

# Копируем код сервиса
COPY services/telegram-service/server.js ./services/telegram-service/

WORKDIR /app/services/telegram-service

EXPOSE 3007

CMD ["node", "server.js"]

