FROM node:20-alpine AS deps

WORKDIR /app
ARG APP_PORT

# Enable Yarn from Corepack for consistent package manager usage.
RUN corepack enable

COPY package.json ./
RUN yarn install

FROM node:20-alpine AS builder

WORKDIR /app
ARG APP_PORT

RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn build

FROM node:20-alpine AS runner

WORKDIR /app
ARG APP_PORT

ENV NODE_ENV=production
ENV PORT=${APP_PORT}

RUN corepack enable && npm install -g pm2

COPY package.json ./
RUN yarn install --production=true
COPY --from=builder /app/dist ./dist

EXPOSE ${APP_PORT}

CMD ["pm2-runtime", "start", "dist/main.js", "--name", "monthly-budget-app"]
