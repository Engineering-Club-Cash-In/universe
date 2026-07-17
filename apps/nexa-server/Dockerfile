FROM oven/bun:1.3.12-alpine AS base
WORKDIR /app/apps/nexa-server

FROM base AS deps
COPY apps/nexa-server/package.json apps/nexa-server/bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS prod-deps
COPY apps/nexa-server/package.json apps/nexa-server/bun.lock ./
RUN bun install --production --frozen-lockfile

FROM deps AS build
COPY apps/nexa-server ./
RUN ./node_modules/.bin/tsc --noEmit

FROM base AS runner
ENV NODE_ENV=production
COPY --from=prod-deps --chown=bun:bun /app/apps/nexa-server/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/apps/nexa-server ./
EXPOSE 7010
USER bun
CMD ["bun", "run", "src/entrypoint.ts"]
