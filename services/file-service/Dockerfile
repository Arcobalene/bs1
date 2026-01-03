FROM node:18-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY services/file-service/package*.json ./
RUN npm install --production

COPY services/file-service/server.js ./

EXPOSE 3005

CMD ["node", "server.js"]

