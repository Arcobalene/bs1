FROM node:18-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY services/user-service/package*.json ./
RUN npm install --omit=dev

# Копируем shared модули
COPY shared ./shared

# Копируем код сервиса
COPY services/user-service/server.js ./

EXPOSE 3002

CMD ["node", "server.js"]

