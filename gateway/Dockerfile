FROM node:18-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY gateway/package*.json ./
RUN npm install --production

COPY gateway/server.js ./

EXPOSE 3000

CMD ["node", "server.js"]

