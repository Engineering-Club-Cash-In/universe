FROM oven/bun:1.3.10-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml bun.lock ./
COPY apps/nexa-server/package.json apps/nexa-server/package.json
RUN bun install --frozen-lockfile

FROM deps AS build
COPY apps/nexa-server apps/nexa-server
WORKDIR /app/apps/nexa-server
RUN bun run check-types

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/nexa-server ./apps/nexa-server
WORKDIR /app/apps/nexa-server
EXPOSE 7010
CMD ["bun", "run", "src/index.ts"]
