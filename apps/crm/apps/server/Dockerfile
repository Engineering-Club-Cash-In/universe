# Imagen base de Bun fijada al packageManager de apps/crm/package.json
FROM docker.io/oven/bun:1.3.14 AS base
WORKDIR /usr/src/app

# =========================
# Etapa: instalar dependencias determinísticamente
# =========================
FROM base AS deps
WORKDIR /usr/src/app

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

# Copiamos solo el binario generado
COPY --from=builder /usr/src/app/apps/crm/apps/server/server .

EXPOSE 9000
ENTRYPOINT ["./server"]
