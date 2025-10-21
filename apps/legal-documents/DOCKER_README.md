# Legal Documents - Docker Setup

## 🐳 Docker Multi-Stage Build

Este proyecto usa un Dockerfile multi-stage que:
1. **Build Stage**: Usa `oven/bun:latest` para compilar la aplicación
2. **Production Stage**: Usa `nginx:alpine` para servir los archivos estáticos

## 🚀 Deploy Rápido a AWS ECR (Recomendado)

### Deployment con un solo comando

```bash
# Deploy a AWS ECR Public Registry
bun run deploy
```

Este comando ejecuta automáticamente:
1. ✅ Autenticación con AWS ECR
2. ✅ Build de la imagen Docker
3. ✅ Tag de la imagen
4. ✅ Push a ECR público

**Requisitos:**
- AWS CLI configurado con credenciales
- Docker instalado
- Permisos para push a `public.ecr.aws/a6w8m2u2`

**Variables de entorno opcionales:**
```bash
# Cambiar URL del API (default: https://api.devteamatcci.site)
VITE_API_URL=https://api.custom.com bun run deploy
```

**Output esperado:**
```
🚀 Starting deployment process...
📝 Step 1/4: Authenticating with AWS ECR...
✅ Authentication successful
🔨 Step 2/4: Building Docker image...
✅ Build successful
🏷️  Step 3/4: Tagging image...
✅ Image tagged
⬆️  Step 4/4: Pushing to ECR...
✅ Push successful
🎉 Deployment completed successfully!
```

**Imagen resultante:**
```
public.ecr.aws/a6w8m2u2/cci/legal-documents:latest
```

Usa esta URI en Coolify para desplegar la aplicación.

---

## 📋 Prerequisitos

- Docker instalado
- AWS CLI configurado (para deployment)
- Acceso a la API en `https://api.devteamatcci.site`

## 🚀 Build y Ejecución

### Opción 1: Build con valores por defecto

```bash
# Build de la imagen
docker build -t legal-documents .

# Ejecutar el contenedor
docker run -p 8080:80 legal-documents
```

La aplicación estará disponible en `http://localhost:8080`

### Opción 2: Build con URL de API personalizada

```bash
# Build con ARG personalizado
docker build \
  --build-arg VITE_API_URL=https://api.custom.com \
  -t legal-documents .

# Ejecutar
docker run -p 8080:80 legal-documents
```

### Opción 3: Usando docker-compose (recomendado)

Crear `docker-compose.yml`:

```yaml
version: '3.8'

services:
  legal-documents:
    build:
      context: .
      args:
        VITE_API_URL: https://api.devteamatcci.site
    ports:
      - "8080:80"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost/"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 5s
```

Ejecutar:

```bash
docker-compose up -d
```

## 🔍 Verificación

### Health Check

El contenedor incluye un health check que verifica cada 30 segundos:

```bash
# Ver el estado del contenedor
docker ps

# Ver logs del health check
docker inspect --format='{{json .State.Health}}' <container-id>
```

### Logs

```bash
# Ver logs del contenedor
docker logs -f <container-id>

# Ver logs de nginx
docker exec <container-id> tail -f /var/log/nginx/access.log
```

## 📁 Archivos de Configuración

### Dockerfile
- **Build Stage**: Instala dependencias y compila con Bun
- **Production Stage**: Sirve archivos con nginx
- **Health Check**: Verifica disponibilidad cada 30s

### nginx.conf
- **SPA Routing**: Redirige todas las rutas a `index.html`
- **Cache**: Assets estáticos con cache de 1 año
- **Gzip**: Compresión activada
- **Security Headers**: Headers de seguridad incluidos

### .dockerignore
Excluye archivos innecesarios del build:
- `node_modules`
- `dist`
- `.env` files
- IDE configs
- Docs

## 🛠️ Desarrollo Local

Para desarrollo local sin Docker:

```bash
# Instalar dependencias
bun install

# Crear archivo .env
cp .env.example .env

# Ejecutar en modo desarrollo
bun run dev
```

## 🔐 Variables de Entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `VITE_API_URL` | URL del API backend | `https://api.devteamatcci.site` |

**Nota**: Las variables de entorno se baquean en el build, no son configurables en runtime.

## 📦 Optimizaciones

### Tamaño de Imagen

El uso de multi-stage build reduce el tamaño final:
- Build stage: ~1.5GB (incluye Bun y dependencias)
- Production stage: ~50MB (solo nginx + assets)

### Performance

- **Gzip compression**: Reduce transferencia de datos
- **Asset caching**: Cache de 1 año para assets estáticos
- **No-cache para index.html**: Asegura última versión siempre

### Security

- `X-Frame-Options`: Previene clickjacking
- `X-Content-Type-Options`: Previene MIME sniffing
- `X-XSS-Protection`: Protección contra XSS

## 🐛 Troubleshooting

### El contenedor no arranca

```bash
# Ver logs detallados
docker logs <container-id>

# Verificar puerto disponible
lsof -i :8080
```

### Routing no funciona

Verificar que `nginx.conf` está copiado correctamente:

```bash
docker exec <container-id> cat /etc/nginx/conf.d/default.conf
```

### Build falla

```bash
# Limpiar cache de Docker
docker builder prune

# Build sin cache
docker build --no-cache -t legal-documents .
```

## 🚀 Deploy a Producción

### Tags Recomendados

```bash
# Tag con versión
docker tag legal-documents registry.example.com/legal-documents:1.0.0

# Tag latest
docker tag legal-documents registry.example.com/legal-documents:latest

# Push
docker push registry.example.com/legal-documents:1.0.0
docker push registry.example.com/legal-documents:latest
```

### Kubernetes

Ejemplo de deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: legal-documents
spec:
  replicas: 3
  selector:
    matchLabels:
      app: legal-documents
  template:
    metadata:
      labels:
        app: legal-documents
    spec:
      containers:
      - name: legal-documents
        image: registry.example.com/legal-documents:1.0.0
        ports:
        - containerPort: 80
        livenessProbe:
          httpGet:
            path: /
            port: 80
          initialDelaySeconds: 5
          periodSeconds: 30
```

## 📝 Notas

- El build tarda ~2-3 minutos dependiendo del hardware
- La imagen final pesa ~50MB
- Nginx sirve en el puerto 80 por defecto
- TanStack Router requiere que todas las rutas redirijan a `index.html`
