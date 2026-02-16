# Stage 1: Install dependencies (cached unless package.json/bun.lock change)
FROM node:20-slim AS deps
WORKDIR /app

RUN npm install -g bun

# Copy all workspace dependency manifests for lockfile resolution
COPY apps/crm/package.json apps/crm/bun.lock ./apps/crm/
COPY apps/crm/apps/web/package.json ./apps/crm/apps/web/
COPY apps/crm/apps/server/package.json ./apps/crm/apps/server/
COPY packages/infornet ./packages/infornet
COPY packages/sms ./packages/sms

WORKDIR /app/apps/crm/apps/web
RUN bun install --frozen-lockfile

# Stage 2: Build (invalidated only on source changes)
FROM node:20-slim AS builder
WORKDIR /app

COPY --from=deps /usr/local/lib/node_modules/bun /usr/local/lib/node_modules/bun
COPY --from=deps /usr/local/bin/bun /usr/local/bin/bun

ENV VITE_SERVER_URL=https://crmapi.s3.devteamatcci.site
ENV VITE_FRONTEND_URL=https://crm.s3.devteamatcci.site

# Copy cached node_modules from deps stage
COPY --from=deps /app/apps/crm/apps/web/node_modules ./apps/crm/apps/web/node_modules
COPY --from=deps /app/apps/crm/node_modules ./apps/crm/node_modules

# Copy server files needed by web (vite alias: server -> ../server)
COPY apps/crm/apps/server/tsconfig.json ./apps/crm/apps/server/
COPY apps/crm/apps/server/src/lib/roles.ts ./apps/crm/apps/server/src/lib/roles.ts
COPY apps/crm/apps/server/src/db/schema ./apps/crm/apps/server/src/db/schema

# Copy web source and config
COPY apps/crm/apps/web/src ./apps/crm/apps/web/src
COPY apps/crm/apps/web/index.html ./apps/crm/apps/web/
COPY apps/crm/apps/web/vite.config.ts ./apps/crm/apps/web/
COPY apps/crm/apps/web/tsconfig.json ./apps/crm/apps/web/
COPY apps/crm/apps/web/components.json ./apps/crm/apps/web/
COPY apps/crm/apps/web/package.json ./apps/crm/apps/web/

WORKDIR /app/apps/crm/apps/web
RUN bun run build

# Stage 3: Production (nginx)
FROM nginx:alpine

COPY --from=builder /app/apps/crm/apps/web/dist /usr/share/nginx/html
COPY apps/crm/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
