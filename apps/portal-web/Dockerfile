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
ARG VITE_IMAGE_URL=https://pub-6db6052b52cf40f7bb41443a6b24ef95.r2.dev
ARG VITE_FRONTEND_URL=https://portal.s2.devteamatcci.site
ARG VITE_WHATSAPP_PHONE_NUMBER=+59899683075
ARG VITE_PHONE_NUMBER=+50222341368
ARG VITE_URL_INSPECTION=https://taller.s3.devteamatcci.site/vehicle-inspection
ARG VITE_BETTER_AUTH_SECRET=7kP9mXqR4vL2nZwT8jYbC6dF3hGsU5aE
ARG VITE_BETTER_AUTH_URL=https://better-auth.devteamatcci.site

ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_API_URL_DOCUMENTS=${VITE_API_URL_DOCUMENTS}
ENV VITE_IMAGE_URL=${VITE_IMAGE_URL}
ENV VITE_FRONTEND_URL=${VITE_FRONTEND_URL}
ENV VITE_WHATSAPP_PHONE_NUMBER=${VITE_WHATSAPP_PHONE_NUMBER}
ENV VITE_PHONE_NUMBER=${VITE_PHONE_NUMBER}
ENV VITE_URL_INSPECTION=${VITE_URL_INSPECTION}
ENV VITE_BETTER_AUTH_SECRET=${VITE_BETTER_AUTH_SECRET}
ENV VITE_BETTER_AUTH_URL=${VITE_BETTER_AUTH_URL}

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
