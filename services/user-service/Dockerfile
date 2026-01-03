FROM node:18-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY services/user-service/package*.json ./
RUN npm install --production

COPY services/user-service/server.js ./

EXPOSE 3002

CMD ["node", "server.js"]

