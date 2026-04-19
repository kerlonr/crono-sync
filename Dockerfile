FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY --chown=node:node package*.json ./

RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node public ./public
COPY --chown=node:node server.js ./server.js

USER node

EXPOSE 3000

CMD ["npm", "start"]
