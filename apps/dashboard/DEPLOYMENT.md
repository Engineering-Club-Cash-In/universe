# Jira Dashboard - Guía de Despliegue

## Descripción
Dashboard gerencial para visualización de sprints de Jira con sistema multi-tablero integrado.

## Características Principales
- **Visualización de Sprint Actual**: KPIs, burndown chart, velocidad del equipo
- **Sistema Multi-tablero**: Gestión de múltiples tableros de Jira
- **Panel Administrativo**: Interfaz para agregar, editar y eliminar tableros
- **Integración Real con Jira API**: Datos en tiempo real desde Jira

## Pre-requisitos
- Node.js 18+ o Bun
- Cuenta de Jira con acceso API
- Token de API de Jira

## Configuración

### 1. Variables de Entorno
Crea un archivo `.env` en la raíz del proyecto:

```env
# Credenciales de Jira
VITE_JIRA_DOMAIN=https://tu-dominio.atlassian.net
VITE_JIRA_EMAIL=tu-email@empresa.com
VITE_JIRA_API_TOKEN=tu-token-api

# Tablero por defecto (opcional)
VITE_JIRA_BOARD_ID=1
```

### 2. Instalación de Dependencias

```bash
# Con Bun (recomendado)
bun install

# Con npm
npm install
```

### 3. Configuración del Proxy
El archivo `vite.config.ts` ya incluye la configuración de proxy para evitar problemas de CORS:

```typescript
proxy: {
  '/api/jira': {
    target: process.env.VITE_JIRA_DOMAIN,
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/jira/, ''),
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        const auth = Buffer.from(`${email}:${token}`).toString('base64')
        proxyReq.setHeader('Authorization', `Basic ${auth}`)
      })
    }
  }
}
```

## Desarrollo Local

```bash
# Con Bun
bun run dev

# Con npm
npm run dev
```

El dashboard estará disponible en: http://localhost:3000

## Construcción para Producción

```bash
# Con Bun
bun run build

# Con npm
npm run build
```

Los archivos compilados se generarán en el directorio `dist/`

## Despliegue

### Opción 1: Servidor Estático (Nginx)

```nginx
server {
    listen 80;
    server_name dashboard.tu-dominio.com;
    root /var/www/dashboard/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/jira {
        proxy_pass https://tu-dominio.atlassian.net;
        proxy_set_header Authorization "Basic <tu-token-base64>";
        proxy_set_header Accept "application/json";
        proxy_set_header Content-Type "application/json";
    }
}
```

### Opción 2: Vercel

1. Instala Vercel CLI: `npm i -g vercel`
2. En la raíz del proyecto: `vercel`
3. Configura las variables de entorno en el dashboard de Vercel

### Opción 3: Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build
FROM nginx:alpine
COPY --from=0 /app/dist /usr/share/nginx/html
EXPOSE 80
```

## Uso del Sistema Multi-tablero

### Agregar un Tablero
1. Navega a "Administrar Tableros" desde el dashboard
2. Click en "Agregar Tablero"
3. Ingresa el ID del tablero de Jira
4. Click en "Verificar" para validar el tablero
5. Completa la información y guarda

### Cambiar entre Tableros
- Usa el selector en el header del dashboard
- O desde la página de administración, click en "Usar"

### Tablero por Defecto
- El primer tablero agregado se marca automáticamente como default
- Puedes cambiar el default desde la administración con el ícono de estrella

## Estructura del Proyecto

```
dashboard/
├── src/
│   ├── components/       # Componentes React
│   │   ├── BurndownChart.tsx
│   │   ├── VelocityChart.tsx
│   │   ├── IssuesTable.tsx
│   │   ├── TeamPerformance.tsx
│   │   └── Header.tsx
│   ├── pages/            # Páginas principales
│   │   ├── SprintDashboard.tsx
│   │   └── BoardsAdmin.tsx
│   ├── services/         # Servicios y APIs
│   │   ├── jira.ts      # Integración con Jira API
│   │   └── boards.ts    # Gestión de tableros
│   └── App.tsx
├── vite.config.ts        # Configuración de Vite
└── package.json
```

## Troubleshooting

### Error de CORS
- Verifica que el proxy esté configurado correctamente en `vite.config.ts`
- En producción, configura el proxy en tu servidor web

### No se cargan los datos
- Verifica las credenciales en el archivo `.env`
- Confirma que el token de API tenga los permisos necesarios
- Revisa que el ID del tablero sea correcto

### Error 401 Unauthorized
- Regenera el token de API en Jira
- Verifica que el email sea correcto
- Asegúrate de que el token no haya expirado

## Seguridad

⚠️ **Importante**: 
- Nunca expongas las credenciales de Jira en el frontend
- Usa variables de entorno para información sensible
- En producción, implementa un backend intermediario para manejar la autenticación
- Considera implementar rate limiting para las llamadas a la API

## Mantenimiento

### Actualizar Dependencias
```bash
bun update
```

### Limpiar Cache
```bash
rm -rf node_modules dist
bun install
```

### Logs y Monitoreo
- Los errores de API se muestran en la consola del navegador
- Revisa los logs del servidor proxy para problemas de conexión

## Contacto y Soporte

Para reportar problemas o solicitar nuevas características, contacta al equipo de desarrollo.