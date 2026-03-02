FROM docker.io/oven/bun:1

# Preparar el Monorepo
WORKDIR /usr/src/app

# Copiar archivos de configuración de la raíz para que Bun reconozca el monorepo
COPY package.json bun.lockb* ./

# Copiar el paquete compartido y la app
COPY packages/email ./packages/email
COPY apps/auth-google ./apps/auth-google

# Instalamos desde la raíz para que resuelva los workspaces correctamente
RUN bun install

# Nos aseguramos de que el link en node_modules sea el código real físicamente
WORKDIR /usr/src/app/apps/auth-google
RUN rm -rf node_modules/@cci/email && \
    mkdir -p node_modules/@cci && \
    cp -r /usr/src/app/packages/email node_modules/@cci/email

# Usuario no-root para seguridad
USER bun

EXPOSE 9500

CMD ["bun", "start"]
