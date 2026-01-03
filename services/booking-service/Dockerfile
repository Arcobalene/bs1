FROM node:18-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY services/booking-service/package*.json ./
RUN npm install --omit=dev

# Копируем shared модули
COPY shared ./shared

# Копируем код сервиса
COPY services/booking-service/server.js ./

EXPOSE 3003

CMD ["node", "server.js"]

