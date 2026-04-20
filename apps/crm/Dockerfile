# Stage 1: Install dependencies and build
FROM oven/bun:1 AS builder
WORKDIR /app

# Copy all workspace dependency manifests for lockfile resolution
COPY apps/crm/package.json apps/crm/bun.lock ./apps/crm/
COPY apps/crm/apps/web/package.json ./apps/crm/apps/web/
COPY apps/crm/apps/server/package.json ./apps/crm/apps/server/
COPY packages/infornet ./packages/infornet
COPY packages/sms ./packages/sms
COPY packages/simpletech ./packages/simpletech
COPY packages/email ./packages/email

WORKDIR /app/apps/crm
RUN bun install --frozen-lockfile

ENV VITE_SERVER_URL=https://crmapi.s3.devteamatcci.site
ENV VITE_FRONTEND_URL=https://crm.s3.devteamatcci.site

# Copy server files needed by web (vite alias: server -> ../server)
COPY apps/crm/apps/server/tsconfig.json ./apps/server/
COPY apps/crm/apps/server/src/lib ./apps/server/src/lib
COPY apps/crm/apps/server/src/db/schema ./apps/server/src/db/schema

# Copy web source and config
COPY apps/crm/apps/web/src ./apps/web/src
COPY apps/crm/apps/web/index.html ./apps/web/
COPY apps/crm/apps/web/vite.config.ts ./apps/web/
COPY apps/crm/apps/web/tsconfig.json ./apps/web/
COPY apps/crm/apps/web/components.json ./apps/web/
COPY apps/crm/apps/web/package.json ./apps/web/

WORKDIR /app/apps/crm/apps/web
RUN bun --bun run build

# Stage 2: Production (nginx)
FROM nginx:alpine

COPY --from=builder /app/apps/crm/apps/web/dist /usr/share/nginx/html
COPY apps/crm/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
