# Stage 1: instalar dependencias y construir
FROM oven/bun:1 AS builder
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/tracker/package.json ./apps/tracker/package.json
RUN bun install --frozen-lockfile --filter=tracker

WORKDIR /app/apps/tracker

ENV VITE_SERVER_URL=https://crmapi.s3.devteamatcci.site

# Tipos del server del CRM: el tracker los importa con `import type` (se borran
# en el bundle), pero se copian para que la resolución no dependa del entorno.
COPY apps/crm/apps/server/src/routers /app/apps/crm/apps/server/src/routers
COPY apps/crm/apps/server/src/lib /app/apps/crm/apps/server/src/lib
COPY apps/crm/apps/server/src/db /app/apps/crm/apps/server/src/db

COPY apps/tracker/src ./src
COPY apps/tracker/index.html ./
COPY apps/tracker/vite.config.ts ./
COPY apps/tracker/tsconfig.json ./

RUN bun --bun run build

# Stage 2: producción (nginx)
FROM nginx:alpine

COPY --from=builder /app/apps/tracker/dist /usr/share/nginx/html
COPY apps/tracker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
