# Build stage
FROM oven/bun:latest AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build arguments for environment variables
ARG VITE_API_URL=https://api.devteamatcci.site
ARG VITE_API_URL_DOCUMENTS=https://legal-docs-blueprints.s4.devteamatcci.site
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_API_URL_DOCUMENTS=${VITE_API_URL_DOCUMENTS}

# Build the application
RUN bun run build

# Production stage
FROM nginx:alpine

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration for SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
