# Imagen base de Bun
FROM oven/bun:latest AS base
WORKDIR /usr/src/app

# =========================
# Etapa: compilar la app
# =========================
FROM base AS builder
WORKDIR /usr/src/app

# Copiamos el paquete infornet (dependencia local)
COPY packages/infornet ./packages/infornet

# Instalamos dependencias del paquete infornet
WORKDIR /usr/src/app/packages/infornet
RUN bun install

# Copiamos el código del server manteniendo la estructura de rutas
WORKDIR /usr/src/app
COPY apps/crm/apps/server ./apps/crm/apps/server

# Instalamos dependencias desde el directorio del server
WORKDIR /usr/src/app/apps/crm/apps/server
RUN bun install

# Reemplazar el symlink de @repo/infornet con el contenido real
RUN rm -rf node_modules/@repo/infornet && \
    mkdir -p node_modules/@repo && \
    cp -r /usr/src/app/packages/infornet node_modules/@repo/infornet

# Compilamos la app
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
COPY --from=builder /usr/src/app/apps/crm/apps/server/server .

EXPOSE 9000
ENTRYPOINT ["./server"]
