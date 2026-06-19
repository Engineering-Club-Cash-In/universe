FROM oven/bun:1.3.12-alpine AS base
WORKDIR /app/apps/nexa-server

FROM base AS deps
COPY apps/nexa-server/package.json ./
RUN bun install

FROM base AS prod-deps
COPY apps/nexa-server/package.json ./
RUN bun install --production

FROM deps AS build
COPY apps/nexa-server ./
RUN ./node_modules/.bin/tsc --noEmit

FROM base AS runner
ENV NODE_ENV=production
COPY --from=prod-deps /app/apps/nexa-server/node_modules ./node_modules
COPY --from=build /app/apps/nexa-server ./
EXPOSE 7010
CMD ["bun", "run", "src/index.ts"]
