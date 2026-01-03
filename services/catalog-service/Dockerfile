FROM node:18-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY services/catalog-service/package*.json ./
RUN npm install --production

COPY services/catalog-service/server.js ./

EXPOSE 3004

CMD ["node", "server.js"]

