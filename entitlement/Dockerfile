FROM oven/bun:1.2-alpine AS base
WORKDIR /app

COPY package.json bun.lock ./
COPY entitlement/package.json ./entitlement/
COPY packages/auth/package.json ./packages/auth/
COPY packages/contracts/package.json ./packages/contracts/

RUN bun install --frozen-lockfile

COPY packages ./packages
COPY entitlement ./entitlement
COPY admin-ui ./admin-ui

WORKDIR /app/entitlement
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
