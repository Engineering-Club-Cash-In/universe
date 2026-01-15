# Build stage
FROM node:20-slim AS builder
WORKDIR /app

# Declarar variables de entorno directamente
ENV VITE_SERVER_URL=https://crmapi.s3.devteamatcci.site
ENV VITE_FRONTEND_URL=https://crm.s3.devteamatcci.site
# Agrega aquí todas las URLs que necesites

RUN npm install -g bun

# Copiamos el paquete infornet (requerido por el lockfile del workspace)
COPY packages/infornet ./packages/infornet

# Copiamos el workspace CRM completo
COPY apps/crm ./apps/crm

# Navigate to web directory
WORKDIR /app/apps/crm/apps/web

# Install dependencies
RUN bun install --frozen-lockfile

# Build the application
RUN bun run build

# Production stage
FROM nginx:alpine

# Copy built files from builder stage
COPY --from=builder /app/apps/crm/apps/web/dist /usr/share/nginx/html

# Copy nginx configuration for SPA routing
COPY apps/crm/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
