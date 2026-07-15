# Etapa 1: Build (multi-stage para que CI construya sin dist/ previo,
# mismo patrón que carteraFront)
FROM docker.io/node:20-alpine AS build

WORKDIR /app

COPY . .

RUN npm install --legacy-peer-deps

RUN node node_modules/vite/bin/vite.js build

# Etapa 2: Nginx
FROM docker.io/library/nginx:alpine

RUN rm -rf /usr/share/nginx/html/*

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
