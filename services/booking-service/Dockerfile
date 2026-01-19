FROM node:18-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY services/booking-service/package*.json ./services/booking-service/
RUN cd services/booking-service && npm install --omit=dev && npm cache clean --force

# Копируем shared модули
COPY shared ./shared

# Копируем код сервиса
COPY services/booking-service/server.js ./services/booking-service/

WORKDIR /app/services/booking-service

EXPOSE 3003

CMD ["node", "server.js"]

