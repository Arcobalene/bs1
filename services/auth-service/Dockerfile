FROM node:18-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY services/auth-service/package*.json ./
RUN npm install --production

# Копируем shared модули
COPY shared ./shared

# Копируем код сервиса
COPY services/auth-service/server.js ./

EXPOSE 3001

CMD ["node", "server.js"]

