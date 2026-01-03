FROM node:18-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY services/file-service/package*.json ./
RUN npm install --omit=dev

# Копируем shared модули
COPY shared ./shared

# Копируем код сервиса
COPY services/file-service/server.js ./

EXPOSE 3005

CMD ["node", "server.js"]

