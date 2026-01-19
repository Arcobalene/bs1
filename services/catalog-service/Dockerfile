FROM node:18-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY services/catalog-service/package*.json ./services/catalog-service/
RUN cd services/catalog-service && npm install --omit=dev && npm cache clean --force

# Копируем shared модули
COPY shared ./shared

# Копируем код сервиса
COPY services/catalog-service/server.js ./services/catalog-service/

WORKDIR /app/services/catalog-service

EXPOSE 3004

CMD ["node", "server.js"]

