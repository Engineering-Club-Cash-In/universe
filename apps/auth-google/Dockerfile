FROM docker.io/oven/bun:1 AS base
WORKDIR /usr/src/app

# =========================
# Etapa: install
# Solo re-corre cuando cambian package.json, bun.lockb o packages/email
# =========================
FROM base AS install

# 1. Archivos de configuración (más estables → van primero para maximizar cache)
COPY package.json bun.lockb* ./
COPY packages/email/package.json ./packages/email/package.json
COPY apps/auth-google/package.json ./apps/auth-google/package.json

# 2. Instalar deps del workspace (cacheado mientras no cambie lockb/package.json)
RUN bun install

# 3. Source de @cci/email (cambia menos frecuente que el app)
COPY packages/email ./packages/email

# 4. Hacer @cci/email físico con sus dependencias
WORKDIR /usr/src/app/apps/auth-google
RUN rm -rf node_modules/@cci/email && \
    mkdir -p node_modules/@cci && \
    cp -r /usr/src/app/packages/email node_modules/@cci/email

WORKDIR /usr/src/app/apps/auth-google/node_modules/@cci/email
RUN bun install --production

# =========================
# Etapa: runner
# Re-corre cuando cambia el source del app — sin installs, rápido
# =========================
FROM base AS runner
WORKDIR /usr/src/app

# Node_modules del stage de install (vienen cacheados del stage anterior)
COPY --from=install /usr/src/app/node_modules ./node_modules
COPY --from=install /usr/src/app/apps/auth-google/node_modules ./apps/auth-google/node_modules

# Solo el source del app (node_modules excluido por .dockerignore → no sobreescribe lo de arriba)
COPY apps/auth-google ./apps/auth-google

WORKDIR /usr/src/app/apps/auth-google

USER bun

EXPOSE 9500

CMD ["bun", "start"]
