FROM node:20-alpine AS base

ENV NODE_ENV=production

WORKDIR /app

COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node src ./src
COPY --chown=node:node server.js ./server.js

RUN chmod +x ./scripts/webhook-deploy.sh

FROM base AS app

USER node

EXPOSE 3000

CMD ["npm", "start"]

FROM base AS deployer

RUN apk add --no-cache git docker-cli docker-cli-compose

EXPOSE 8081

CMD ["npm", "run", "start:deployer"]
