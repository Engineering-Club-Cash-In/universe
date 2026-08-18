# Imagen base de Bun
FROM oven/bun:latest AS base
WORKDIR /usr/src/app

# =========================
# Etapa: compilar la app
# =========================
FROM base AS builder
WORKDIR /app

# Manifiestos primero: install reproducible y cacheable por capa.
# El bun.lock vive en apps/crm (raíz del workspace), así que se instala desde
# ahí — igual que el Dockerfile de crm-web. Sin esto el build resolvía los
# caret ranges a la última versión publicada en cada rebuild.
COPY apps/crm/package.json apps/crm/bun.lock ./apps/crm/
COPY apps/crm/apps/web/package.json ./apps/crm/apps/web/
COPY apps/crm/apps/server/package.json ./apps/crm/apps/server/

# Paquetes locales que el server referencia con file:../../../../packages/*
COPY packages/infornet ./packages/infornet
COPY packages/sms ./packages/sms
COPY packages/simpletech ./packages/simpletech
COPY packages/email ./packages/email

WORKDIR /app/apps/crm
RUN bun install --frozen-lockfile

# El código va después del install para no invalidar la capa de dependencias
COPY apps/crm/apps/server ./apps/server

# Compilamos la app
WORKDIR /app/apps/crm/apps/server
RUN bun build \
    --compile \
    --minify-whitespace \
    --minify-syntax \
    --target bun \
    --outfile server \
    src/index.ts

# =========================
# Etapa: runner final
# =========================
FROM base AS runner
WORKDIR /usr/src/app

# Copiamos solo el binario generado
COPY --from=builder /app/apps/crm/apps/server/server .

EXPOSE 9000
ENTRYPOINT ["./server"]
