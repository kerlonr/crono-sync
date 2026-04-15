FROM node:20-alpine

RUN apk add --no-cache git

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]