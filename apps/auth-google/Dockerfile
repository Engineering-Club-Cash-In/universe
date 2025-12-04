# Imagen base de Bun
FROM oven/bun:1 AS base
WORKDIR /usr/src/app

# =========================
# Etapa: instalar dependencias
# =========================
FROM base AS install

# Copiamos archivos de dependencias
COPY package.json bun.lock* ./

# Instalamos solo dependencias de producción
RUN bun install --frozen-lockfile --production

# =========================
# Etapa: runner final
# =========================
FROM base AS runner
WORKDIR /usr/src/app

# Copiamos dependencias
COPY --from=install /usr/src/app/node_modules ./node_modules

# Copiamos el código fuente
COPY . .

# Usuario no-root para seguridad
USER bun

EXPOSE 9500

CMD ["bun", "start"]
