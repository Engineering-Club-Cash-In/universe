# Auth Google Service

Servicio de autenticación con Google usando Better Auth, Hono, Drizzle ORM y PostgreSQL.

## 🚀 Características

- ✅ Autenticación con Google OAuth y Email/Password
- ✅ Gestión de sesiones con Better Auth
- ✅ Base de datos PostgreSQL con Drizzle ORM
- ✅ Schema personalizado con pgEnum y pgSchema
- ✅ Rate Limiting para seguridad
- ✅ Validación de variables de entorno
- ✅ Sistema de roles (ADMIN, INVESTOR, DEBTOR, SELLER, CLIENT)
- ✅ **Hono Framework** - Ultra rápido y ligero
- ✅ TypeScript
- ✅ Hot reload con tsx

## 📋 Requisitos Previos

- Node.js 18+
- pnpm 10+
- PostgreSQL 14+

## 🛠️ Instalación

1. Instalar dependencias:
```bash
pnpm install
```

2. Configurar variables de entorno:
```bash
cp .env.example .env
```

Edita el archivo `.env` con tus credenciales:
- `DATABASE_URL`: URL de conexión a PostgreSQL
- `GOOGLE_CLIENT_ID`: Client ID de Google OAuth
- `GOOGLE_CLIENT_SECRET`: Client Secret de Google OAuth
- `BETTER_AUTH_SECRET`: Secreto para Better Auth (genera uno aleatorio)

3. Configurar Google OAuth:
   - Ve a [Google Cloud Console](https://console.cloud.google.com/)
   - Crea un nuevo proyecto o selecciona uno existente
   - Habilita Google+ API
   - Crea credenciales OAuth 2.0
   - Agrega `http://localhost:3000/api/auth/callback/google` como URI de redirección autorizada

4. Generar y aplicar migraciones:
```bash
pnpm db:generate
pnpm db:push
```

## 🎯 Scripts Disponibles

- `pnpm dev` - Inicia el servidor en modo desarrollo con hot reload
- `pnpm build` - Compila el proyecto a JavaScript
- `pnpm start` - Inicia el servidor en producción
- `pnpm db:generate` - Genera migraciones de Drizzle
- `pnpm db:push` - Aplica migraciones a la base de datos
- `pnpm db:studio` - Abre Drizzle Studio para gestionar la BD

## 📁 Estructura del Proyecto

```
src/
├── db/
│   ├── connection.ts    # Configuración de conexión a PostgreSQL
│   └── schema.ts        # Schema de tablas con pgEnum y pgTable
├── lib/
│   └── auth.ts          # Configuración de Better Auth
├── middleware/
│   └── error.ts         # Middleware de manejo de errores
├── routes/
│   ├── auth.routes.ts   # Rutas de autenticación
│   └── health.routes.ts # Health check
└── index.ts             # Punto de entrada
```

## 🗄️ Schema de Base de Datos

### Tablas

- **users**: Información de usuarios
- **accounts**: Cuentas vinculadas con Google
- **sessions**: Sesiones activas
- **verification_tokens**: Tokens de verificación

### Enums

- **provider**: Tipo de proveedor (google)
- **account_status**: Estado de la cuenta (active, suspended, deleted)

## 🔌 Endpoints

### Health Check
- `GET /health` - Verifica el estado del servicio

### Autenticación con Google
- `POST /api/auth/sign-in/social` - Inicia el flujo de autenticación con Google
- `GET /api/auth/callback/google` - Callback de Google OAuth

### Autenticación con Email/Password
- `POST /api/auth/sign-up/email` - Registro con email y password (Rate limit: 3/hora)
- `POST /api/auth/sign-in/email` - Login con email y password (Rate limit: 5/15min)

### Gestión de Sesión
- `POST /api/auth/sign-out` - Cierra la sesión
- `GET /api/auth/session` - Obtiene la sesión actual

### Rate Limits
- Sign up: 3 intentos por hora
- Sign in: 5 intentos por 15 minutos
- API general: 100 requests por 15 minutos

## 🔒 Seguridad

- ✅ Rate limiting en endpoints críticos
- ✅ Validación estricta de variables de entorno al inicio
- ✅ CORS configurado con origen específico
- ✅ Passwords hasheados automáticamente por Better Auth
- ✅ Tokens de sesión seguros con expiración
- ✅ SSL habilitado en producción
- ✅ Validación de longitud de password (8-128 caracteres)
- ✅ Pool de conexiones optimizado con límites
- ✅ Cierre graceful de conexiones

## 🚦 Desarrollo

```bash
# Iniciar en modo desarrollo
pnpm dev

# El servidor estará disponible en http://localhost:3000
```

## 📝 Variables de Entorno

| Variable | Descripción | Requerido |
|----------|-------------|-----------|
| DATABASE_URL | URL de conexión a PostgreSQL | ✅ |
| PORT | Puerto del servidor | ❌ (default: 3000) |
| NODE_ENV | Entorno de ejecución | ❌ (default: development) |
| BETTER_AUTH_SECRET | Secreto para Better Auth | ✅ |
| BETTER_AUTH_URL | URL base del servicio | ✅ |
| GOOGLE_CLIENT_ID | Client ID de Google | ✅ |
| GOOGLE_CLIENT_SECRET | Client Secret de Google | ✅ |
| GOOGLE_REDIRECT_URI | URI de redirección de Google | ✅ |
| CORS_ORIGIN | Origen permitido para CORS | ❌ (default: *) |

## 📄 Licencia

ISC
