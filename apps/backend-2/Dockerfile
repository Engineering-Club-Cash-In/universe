# Imagen base de Bun
FROM oven/bun AS base
WORKDIR /usr/src/app

# =========================
# Etapa: instalar dependencias
# =========================
FROM base AS install
RUN mkdir -p /temp/prod

# Copiamos package.json (y lock si existe) para instalar dependencias
COPY package.json /temp/prod/
# Si tienes bun.lockb, descomenta esta línea:
# COPY bun.lockb /temp/prod/

# Copiamos el resto del código
COPY . /temp/prod/

# Instalamos dependencias
RUN cd /temp/prod && bun install

# =========================
# Etapa: compilar la app
# =========================
FROM base AS builder
WORKDIR /usr/src/app

# Traemos node_modules del stage install
COPY --from=install /temp/prod/node_modules ./node_modules

# Traemos el código fuente
COPY . .

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
COPY --from=builder /usr/src/app/server .

EXPOSE 9000
ENTRYPOINT ["./server"]
