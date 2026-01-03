FROM node:18-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY services/booking-service/package*.json ./
RUN npm install --production

COPY services/booking-service/server.js ./

EXPOSE 3003

CMD ["node", "server.js"]

