FROM docker.io/oven/bun:1
WORKDIR /app

# Copiar manifest del root (declara los workspaces)
COPY package.json ./

# Copiar packages/email completo (es workspace dep de auth-google)
COPY packages/email ./packages/email

# Copiar app source
COPY apps/auth-google ./apps/auth-google

# Install en build (camino feliz: si no hay volumen montado, ya queda listo).
RUN bun install --filter=auth-google --linker=hoisted --production

WORKDIR /app/apps/auth-google

EXPOSE 9500

# En runtime: si Coolify monta un volumen persistente sobre node_modules con datos
# fosilizados (symlinks colgantes de un build viejo), reinstalamos. La detección
# `! [ -e node_modules/hono/package.json ]` falla cuando el symlink existe pero
# su target no, así que cubre el caso del volumen stale.
CMD ["sh", "-c", "if ! [ -e node_modules/hono/package.json ]; then echo '>> volumen stale detectado, limpiando y reinstalando deps' && rm -rf /app/node_modules /app/apps/auth-google/node_modules /app/packages/email/node_modules && cd /app && bun install --filter=auth-google --linker=hoisted --production; fi && cd /app/apps/auth-google && exec bun run src/index.ts"]
