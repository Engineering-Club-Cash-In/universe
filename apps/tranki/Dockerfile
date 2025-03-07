FROM nginx:latest

# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy pre-built files to nginx html directory
COPY dist/ /usr/share/nginx/html/

# If you have a custom nginx configuration
COPY ngingx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
