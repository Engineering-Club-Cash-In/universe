FROM docker.io/oven/bun:1.3.14

# Chromium/Chrome runtime dependencies only. Do not install Debian's `chromium`
# package here: GitHub Actions fresh builds can pick a newer browser than local
# cached builds, and Chromium 150 crashed in production containers with
# `Trace/breakpoint trap` / Puppeteer `Failed to launch the browser process`.
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

# 1. Configuración de Puppeteer y Usuario
RUN groupadd -r appuser && useradd -r -g appuser -G audio,video appuser \
    && mkdir -p /home/appuser/Downloads \
    && chown -R appuser:appuser /home/appuser

ENV PUPPETEER_CACHE_DIR=/usr/src/app/.cache/puppeteer \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chrome-for-testing

ARG PUPPETEER_CHROME_VERSION=148.0.7778.97

# 2. Preparar el Monorepo
WORKDIR /usr/src/app

# Copiar archivos de configuración de la raíz para que Bun reconozca el monorepo
COPY package.json bun.lock* ./

# Copiar el paquete compartido y la app
COPY packages/email ./packages/email
COPY apps/cartera-back ./apps/cartera-back

# Instalamos desde la raíz para que resuelva los workspaces correctamente.
# Luego instalamos el browser soportado por Puppeteer y creamos un symlink
# estable para producción.
RUN bun install \
    && mkdir -p "$PUPPETEER_CACHE_DIR" \
    && cd apps/cartera-back \
    && bunx puppeteer browsers install "chrome@${PUPPETEER_CHROME_VERSION}" \
    && CHROME_BIN="$(find "$PUPPETEER_CACHE_DIR" -path '*/chrome-linux64/chrome' -type f | sort | tail -n 1)" \
    && test -n "$CHROME_BIN" \
    && ln -sf "$CHROME_BIN" /usr/bin/chrome-for-testing \
    && /usr/bin/chrome-for-testing --version

# --- EL TRUCO DEL CRM ---
# Nos aseguramos de que el link en node_modules sea el código real físicamente
WORKDIR /usr/src/app/apps/cartera-back
RUN rm -rf node_modules/@cci/email && \
    mkdir -p node_modules/@cci && \
    cp -r /usr/src/app/packages/email node_modules/@cci/email

# 3. Finalizar
RUN chown -R appuser:appuser /usr/src/app/apps/cartera-back "$PUPPETEER_CACHE_DIR"
USER appuser

EXPOSE 9000
CMD ["bun", "run", "devStart"]
