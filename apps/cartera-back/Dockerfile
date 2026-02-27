FROM docker.io/oven/bun:latest

# 1. Instalar dependencias de Chromium (Sencillo)
RUN apt update && apt install -y \
    ca-certificates \
    chromium \
    && rm -rf /var/lib/apt/lists/*

# 2. Configuración de Puppeteer y Usuario
RUN groupadd -r appuser && useradd -r -g appuser -G audio,video appuser \
    && mkdir -p /home/appuser/Downloads \
    && chown -R appuser:appuser /home/appuser

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# 3. Preparar el Monorepo
WORKDIR /usr/src/app

# Copiar archivos de configuración de la raíz para que Bun reconozca el monorepo
COPY package.json bun.lockb* ./

# Copiar el paquete compartido y la app
COPY packages/email ./packages/email
COPY apps/cartera-back ./apps/cartera-back

# Instalamos desde la raíz para que resuelva los workspaces correctamente
RUN bun install

# --- EL TRUCO DEL CRM ---
# Nos aseguramos de que el link en node_modules sea el código real físicamente
WORKDIR /usr/src/app/apps/cartera-back
RUN rm -rf node_modules/@cci/email && \
    mkdir -p node_modules/@cci && \
    cp -r /usr/src/app/packages/email node_modules/@cci/email

# 4. Finalizar
RUN chown -R appuser:appuser /usr/src/app/apps/cartera-back
USER appuser

EXPOSE 9000
CMD ["bun", "run", "devStart"]