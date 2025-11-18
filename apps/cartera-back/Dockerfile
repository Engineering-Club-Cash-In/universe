FROM oven/bun

# Instalar dependencias de Chromium
RUN apt update && apt install -y \
    ca-certificates \
    chromium \
    && rm -rf /var/lib/apt/lists/*

# Crear usuario no-root
RUN groupadd -r appuser && useradd -r -g appuser -G audio,video appuser \
    && mkdir -p /home/appuser/Downloads \
    && chown -R appuser:appuser /home/appuser

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json bun.lockb ./
RUN rm -rf db-replica
RUN bun install
COPY . .

# Dar permisos al usuario
RUN chown -R appuser:appuser /app

# Cambiar a usuario no-root
USER appuser

EXPOSE 9000
CMD ["bun", "run","devStart"]