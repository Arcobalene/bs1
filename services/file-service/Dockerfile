FROM node:18-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY services/file-service/package*.json ./services/file-service/
RUN cd services/file-service && npm install --omit=dev && npm cache clean --force

# Копируем shared модули
COPY shared ./shared

# Копируем код сервиса
COPY services/file-service/server.js ./services/file-service/

WORKDIR /app/services/file-service

EXPOSE 3005

CMD ["node", "server.js"]

