# Etapa 1: Build
FROM docker.io/node:20-alpine AS build

WORKDIR /app

# 1. Copia todo el código
COPY . .

# 2. Instalar dependencias con npm
RUN npm install --legacy-peer-deps

# 3. Variables de entorno
ARG VITE_BACK_URL=https://qk4sw4kc4c088c8csos400wc.s3.devteamatcci.site
ENV VITE_BACK_URL=$VITE_BACK_URL

# 4. Build
RUN node node_modules/vite/bin/vite.js build

# Etapa 2: Nginx
FROM nginx:alpine

RUN rm -rf /usr/share/nginx/html/*

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]