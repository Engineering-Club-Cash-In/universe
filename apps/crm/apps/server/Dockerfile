# Imagen base de Bun fijada al packageManager de apps/crm/package.json
FROM docker.io/oven/bun:1.3.14 AS base
WORKDIR /usr/src/app

ARG PUPPETEER_CHROME_VERSION=148.0.7778.97

# =========================
# Etapa: instalar dependencias determinísticamente
# =========================
FROM base AS deps
WORKDIR /usr/src/app

# El navegador se instala en una etapa separada y se copia a la imagen final.
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Copiamos el lock canónico del workspace CRM y los paquetes locales requeridos.
COPY apps/crm/package.json apps/crm/bun.lock ./apps/crm/
COPY apps/crm/apps/server/package.json ./apps/crm/apps/server/package.json
COPY apps/crm/apps/web/package.json ./apps/crm/apps/web/package.json
COPY packages/infornet ./packages/infornet
COPY packages/sms ./packages/sms
COPY packages/simpletech ./packages/simpletech
COPY packages/email ./packages/email

WORKDIR /usr/src/app/apps/crm
RUN bun install --frozen-lockfile
WORKDIR /usr/src/app
RUN ln -s apps/crm/node_modules node_modules

# =========================
# Etapa: instalar Chromium soportado por Puppeteer
# =========================
FROM deps AS browser
WORKDIR /usr/src/app/apps/crm
ARG PUPPETEER_CHROME_VERSION
ENV PUPPETEER_SKIP_DOWNLOAD=false \
    PUPPETEER_CACHE_DIR=/usr/src/app/.cache/puppeteer
RUN mkdir -p "$PUPPETEER_CACHE_DIR" \
    && rm -rf "$PUPPETEER_CACHE_DIR/chrome/linux-${PUPPETEER_CHROME_VERSION}" \
    && bun ./apps/server/node_modules/.bin/puppeteer browsers install "chrome@${PUPPETEER_CHROME_VERSION}" \
    && test -n "$(find "$PUPPETEER_CACHE_DIR" -path '*/chrome-linux64/chrome' -type f | head -n 1)"

# =========================
# Etapa: smoke obligatorio de SQL auth compilado
# =========================
FROM deps AS auth-sql-smoke
WORKDIR /usr/src/app

# Copiamos solo el esquema auth y el harness para validar el SQL que emite el
# binario compilado contra las dependencias resueltas por apps/crm/bun.lock.
COPY apps/crm/apps/server/src/db/schema/auth.ts ./apps/crm/apps/server/src/db/schema/auth.ts
COPY apps/crm/apps/server/test/auth-sql-predicate-assertions.ts ./apps/crm/apps/server/test/auth-sql-predicate-assertions.ts
COPY apps/crm/apps/server/test/compiled-auth-sql-harness.ts ./apps/crm/apps/server/test/compiled-auth-sql-harness.ts

WORKDIR /usr/src/app/apps/crm/apps/server
RUN bun build \
    --compile \
    --minify-whitespace \
    --minify-syntax \
    --target bun \
    --outfile /tmp/crm-auth-sql-smoke \
    test/compiled-auth-sql-harness.ts
RUN /tmp/crm-auth-sql-smoke

# =========================
# Etapa: compilar la app
# =========================
FROM auth-sql-smoke AS builder
WORKDIR /usr/src/app

# Copiamos el código necesario para compilar el server.
COPY apps/crm/apps/server ./apps/crm/apps/server

WORKDIR /usr/src/app/apps/crm/apps/server
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

# Chromium/Chrome runtime dependencies.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

ENV HOME=/home/appuser \
    PUPPETEER_CACHE_DIR=/usr/src/app/.cache/puppeteer \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chrome-for-testing

# Copiamos solo el binario generado
COPY --from=builder /usr/src/app/apps/crm/apps/server/server .
COPY --from=browser /usr/src/app/.cache/puppeteer /usr/src/app/.cache/puppeteer

RUN groupadd -r appuser && useradd -r -m -d /home/appuser -g appuser -G audio,video appuser \
    && CHROME_BIN="$(find "$PUPPETEER_CACHE_DIR" -path '*/chrome-linux64/chrome' -type f | head -n 1)" \
    && test -n "$CHROME_BIN" \
    && ln -sf "$CHROME_BIN" /usr/bin/chrome-for-testing \
    && /usr/bin/chrome-for-testing --version \
    && chown -R appuser:appuser /usr/src/app "$PUPPETEER_CACHE_DIR"

EXPOSE 9000
USER appuser
ENTRYPOINT ["./server"]
