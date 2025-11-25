# Deployment con Coolify

## Variables de Entorno Requeridas

Configura estas variables en Coolify:

```bash
DOCUMENSO_API_TOKEN=tu_token_aqui
DOCUMENSO_BASE_URL=https://documenso.s2.devteamatcci.site/api/v2-beta
PORT=4000
```

## Pasos para Deploy

### 1. En Coolify:

1. Ve a tu proyecto en Coolify
2. Click en "New Resource" → "Docker Compose"
3. Conecta tu repositorio Git
4. Selecciona la rama (ejemplo: `main` o `develop`)
5. Coolify detectará automáticamente el `docker-compose.yml`

### 2. Configurar Variables de Entorno:

En la sección de "Environment Variables" de Coolify, agrega:
- `DOCUMENSO_API_TOKEN`
- `DOCUMENSO_BASE_URL`
- `PORT` (opcional, default: 4000)

### 3. Configurar Volúmenes Persistentes:

Coolify debería detectar automáticamente los volúmenes definidos en docker-compose:
- `./templates` → Templates de contratos
- `./output` → Archivos generados

### 4. Deploy:

Click en "Deploy" y Coolify:
- Clonará el repo
- Construirá la imagen Docker
- Levantará Gotenberg y la app
- Expondrá el puerto 4000

## Estructura de Servicios

- **app**: API principal (Elysia + Bun)
- **gotenberg**: Servicio de conversión DOCX → PDF

## Healthcheck

El servicio expone `/health` para verificar el estado:

```bash
curl https://tu-dominio.com/health
```

Respuesta esperada:
```json
{
  "status": "ok",
  "service": "Contract Generator API",
  "timestamp": "2025-10-30T...",
  "gotenberg": "available"
}
```
