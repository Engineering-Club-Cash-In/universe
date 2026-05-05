FROM docker.io/oven/bun:latest

WORKDIR /usr/src/app

# Copiar archivos de configuración de la raíz para que Bun reconozca el monorepo
COPY package.json bun.lock* ./

# Copiar la app (backend-2 no depende de paquetes compartidos del workspace)
COPY apps/backend-2 ./apps/backend-2

# Instalar dependencias desde la raíz (resuelve workspaces)
RUN bun install --frozen-lockfile || bun install

# Trabajar dentro de la app
WORKDIR /usr/src/app/apps/backend-2

EXPOSE 9000
CMD ["bun", "run", "src/index.ts"]
