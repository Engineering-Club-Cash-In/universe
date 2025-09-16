# Build stage
FROM node:20-slim AS builder
WORKDIR /app

# Declarar variables de entorno directamente
ENV VITE_SERVER_URL=https://metasapi.s3.devteamatcci.site
ENV VITE_FRONTEND_URL=https://metas.s3.devteamatcci.site

RUN npm install -g bun
# Copy the entire monthly-goals workspace (both web and server)
COPY . ./
# Navigate to web directory
WORKDIR /app/apps/web
# Install dependencies
RUN bun install --frozen-lockfile
# Build the application
RUN bun run build

# Production stage
FROM nginx:alpine
# Copy built files from builder stage
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
# Copy nginx configuration for SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]