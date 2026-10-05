# Stage 1: instalar dependencias y construir
FROM oven/bun:1 AS builder
WORKDIR /app

# El lockfile de tracker vive en la raíz del workspace, y --frozen-lockfile
# valida el manifiesto de CADA miembro del workspace contra él (no solo el de
# tracker) — así que hay que copiarlos todos aunque solo instalemos para
# tracker. --filter tracker abajo limita lo que realmente se instala (~560
# paquetes en vez de las ~4300 dependencias de todo el monorepo). Un app o
# package nuevo en la raíz rompe este build hasta agregar su COPY acá.
COPY package.json bun.lock ./
COPY apps/auth-google/package.json ./apps/auth-google/
COPY apps/backend-2/package.json ./apps/backend-2/
COPY apps/cartera-back/package.json ./apps/cartera-back/
COPY apps/carteraFront/package.json ./apps/carteraFront/
COPY apps/crm/package.json ./apps/crm/
COPY apps/dashboard/package.json ./apps/dashboard/
COPY apps/investment-calculator/package.json ./apps/investment-calculator/
COPY apps/legal-docs-blueprints/package.json ./apps/legal-docs-blueprints/
COPY apps/legal-documents/package.json ./apps/legal-documents/
COPY apps/marketing-landing/package.json ./apps/marketing-landing/
COPY apps/mintaka/package.json ./apps/mintaka/
COPY apps/mizar/package.json ./apps/mizar/
COPY apps/monthly-goals/package.json ./apps/monthly-goals/
COPY apps/nexa-server/package.json ./apps/nexa-server/
COPY apps/payment-requests/package.json ./apps/payment-requests/
COPY apps/portal-web/package.json ./apps/portal-web/
COPY apps/taller/package.json ./apps/taller/
COPY apps/tracker/package.json ./apps/tracker/
COPY apps/tranki/package.json ./apps/tranki/
COPY packages/email/package.json ./packages/email/
COPY packages/infornet/package.json ./packages/infornet/
COPY packages/simpletech/package.json ./packages/simpletech/
COPY packages/sms/package.json ./packages/sms/
COPY packages/structured-logger/package.json ./packages/structured-logger/
COPY packages/ts-schemas/package.json ./packages/ts-schemas/

RUN bun install --filter tracker --frozen-lockfile

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
