# Production stage - serve pre-built static files
FROM nginx:alpine

# Environment variables (will be baked into the static files)
ENV VITE_SERVER_URL=https://crmapi.s3.devteamatcci.site
ENV VITE_DEV_MODE=FALSE
ENV VITE_LOGO_URL=https://pub-8081c8d6e5e743f9adfc9e0db92e5a88.r2.dev/reports/LOGO_NUEVO_CASHIN.png

# Copy pre-built dist folder
COPY dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
