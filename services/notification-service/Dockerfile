FROM node:18-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY services/notification-service/package*.json ./
RUN npm install --production

COPY services/notification-service/server.js ./

EXPOSE 3006

CMD ["node", "server.js"]

