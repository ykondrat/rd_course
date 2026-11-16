FROM node:24-slim AS build

WORKDIR /app

COPY package*.json ./

RUN --mount=type=secret,id=npm_token,required=true \
    NPM_TOKEN="$(cat /run/secrets/npm_token)" \
    && test -n "$NPM_TOKEN" \
    && npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM node:24-slim AS deps

WORKDIR /app

COPY package*.json ./

RUN --mount=type=secret,id=npm_token,required=true \
    NPM_TOKEN="$(cat /run/secrets/npm_token)" \
    && test -n "$NPM_TOKEN" \
    && npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

FROM gcr.io/distroless/nodejs24-debian12:nonroot AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY openapi ./openapi

USER nonroot

EXPOSE 3000

CMD ["dist/main.js"]
