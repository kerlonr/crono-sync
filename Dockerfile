FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

RUN apk add --no-cache git docker-cli docker-cli-compose

COPY --chown=node:node package*.json ./

RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node public ./public
COPY scripts ./scripts
COPY --chown=node:node server.js ./server.js

RUN chmod +x ./scripts/webhook-deploy.sh

EXPOSE 3000

CMD ["npm", "start"]
