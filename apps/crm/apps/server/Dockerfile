# Imagen base de Bun
FROM oven/bun:latest AS base
WORKDIR /usr/src/app

# =========================
# Etapa: compilar la app
# =========================
FROM base AS builder
WORKDIR /usr/src/app

# Copiamos los paquetes locales (infornet y sms)
COPY packages/infornet ./packages/infornet
COPY packages/sms ./packages/sms

# Instalamos dependencias del paquete infornet
WORKDIR /usr/src/app/packages/infornet
RUN bun install

# Instalamos dependencias del paquete sms
WORKDIR /usr/src/app/packages/sms
RUN bun install

# Copiamos el código del server manteniendo la estructura de rutas
WORKDIR /usr/src/app
COPY apps/crm/apps/server ./apps/crm/apps/server

# Instalamos dependencias desde el directorio del server
WORKDIR /usr/src/app/apps/crm/apps/server
RUN bun install

# Reemplazar los symlinks de @repo/* con el contenido real
RUN rm -rf node_modules/@repo/infornet node_modules/@repo/sms && \
    mkdir -p node_modules/@repo && \
    cp -r /usr/src/app/packages/infornet node_modules/@repo/infornet && \
    cp -r /usr/src/app/packages/sms node_modules/@repo/sms

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
