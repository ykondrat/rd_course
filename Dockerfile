FROM node:24-slim AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM node:24-slim AS deps

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:24-slim AS runner

WORKDIR /app

COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY openapi ./openapi
COPY db ./db
COPY .env.example ./

USER node

EXPOSE 3000

CMD ["node", "dist/main.js"]
