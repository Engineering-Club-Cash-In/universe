# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Development
- `bun dev` - Start all applications in development mode (web on :3001, server on :3000)
- `bun dev:web` - Start only the web application (React + TanStack Router)
- `bun dev:server` - Start only the server (Hono + ORPC)
- `bun build` - Build all applications for production
- `bun check-types` - Run TypeScript type checking across all apps

### Database Operations
- `bun db:push` - Push schema changes to PostgreSQL database
- `bun db:studio` - Open Drizzle Studio for database management
- `bun db:generate` - Generate database migrations
- `bun db:migrate` - Run pending database migrations

### Code Quality
- `bun check` - Run Biome linting and formatting (uses tabs, double quotes)

## Architecture Overview

This is a monorepo CRM application built with the Better-T-Stack, featuring:

### Tech Stack
- **Runtime**: Bun
- **Frontend**: React 19 + TanStack Router + TailwindCSS + shadcn/ui
- **Backend**: Hono + ORPC (OpenRPC) + PostgreSQL + Drizzle ORM
- **Authentication**: Better Auth with email/password
- **Code Quality**: Biome (linting/formatting)

### Project Structure
```
apps/
├── web/          # React frontend application
│   ├── src/
│   │   ├── components/   # UI components (shadcn/ui based)
│   │   ├── routes/       # File-based routing with TanStack Router
│   │   ├── lib/          # Client utilities
│   │   └── utils/        # ORPC client setup
│   └── vite.config.ts   # Vite configuration
└── server/       # Hono backend API
    ├── src/
    │   ├── db/           # Database schema and connection
    │   ├── lib/          # Server utilities (auth, ORPC, context)
    │   └── routers/      # API route handlers
    └── drizzle.config.ts # Database configuration
```

### Key Architecture Patterns

**Type-Safe APIs**: End-to-end type safety between frontend and backend using ORPC
- Client setup: `apps/web/src/utils/orpc.ts`
- Server router: `apps/server/src/routers/index.ts`
- Procedures: `publicProcedure` and `protectedProcedure`

**Authentication Flow**: Better Auth handles sessions
- Context creation: `apps/server/src/lib/context.ts`
- Auth middleware: `apps/server/src/lib/orpc.ts`
- Session management integrated with ORPC context

**Database Schema**: Drizzle ORM with PostgreSQL
- Schema location: `apps/server/src/db/schema/`
- Auth tables: user, session, account, verification

**Frontend State Management**: TanStack Query integrated with ORPC
- Query client setup: `apps/web/src/utils/orpc.ts`
- Global error handling via toast notifications

## Environment Setup

### Required Environment Variables
- `DATABASE_URL` - PostgreSQL connection string (server)
- `CORS_ORIGIN` - Frontend URL for CORS (server)
- `VITE_SERVER_URL` - Backend API URL (web)

### Database Setup
1. Ensure PostgreSQL is running
2. Set `DATABASE_URL` in `apps/server/.env`
3. Run `bun db:push` to apply schema

## Development Workflow

1. **Starting Development**: Use `bun dev` to start both frontend and backend
2. **Type Checking**: Always run `bun check-types` before commits
3. **Code Formatting**: Use `bun check` to apply Biome formatting
4. **Database Changes**: Use `bun db:push` for schema changes, `bun db:studio` for data management
5. **Authentication**: The app uses Better Auth - sessions are handled automatically

## Code Style

- **Formatting**: Biome with tabs, double quotes
- **Components**: shadcn/ui patterns with class-variance-authority
- **Imports**: Organized imports enabled via Biome
- **Path Aliases**: Use `@/` for `src/` in web app

## Documentación de features

- **Decisiones internas del CRM**: `apps/crm/docs/RFC-00X-*.md`
- **Features que cruzan varias apps del monorepo**: `docs/features/<feature>/` en la raíz
  del repo. Antes de tocar código de uno de esos features, leer su documento.
  - [`docs/features/bot-whatsapp-cobros/`](../../docs/features/bot-whatsapp-cobros/README.md)
    — Bot de WhatsApp de cobros (CRM ↔ cartera-back ↔ SimpleTech). En definición.

### 🔒 Endpoints del bot de cobros: el Swagger es obligatorio

Los endpoints `/api/bot/cobros/*` los consume un integrador externo (SimpleTech). **Todo
cambio en ellos —una ruta nueva, un código de error nuevo, uno que cambia de nombre— se
documenta en `apps/server/src/lib/bot-cobros/openapi.ts` en el MISMO commit.**

No es una convención que dependa de acordarse: `lib/bot-cobros/openapi.test.ts` compara la
spec contra lo que el código realmente devuelve, y el pipeline corre esas pruebas antes de
construir la imagen. Sin documentar, **no despliega**.

Ver [D-23](../../docs/features/bot-whatsapp-cobros/DECISIONES.md#d-23--la-documentación-de-la-api-es-swagger-y-es-obligatoria).

### 📜 Endpoints del bot de cobros: TODOS dejan historial

**Todo servicio del bot —presente y futuro— nace dentro del historial de interacciones**
(regla general de [D-41](../../docs/features/bot-whatsapp-cobros/DECISIONES.md#d-41--el-registro-es-un-middleware-y-jamás-rompe-la-respuesta)).
El middleware `historialBotCobros` está montado comodín sobre `/api/bot/cobros/*` en
`index.ts`: un endpoint nuevo se registra solo, sin tocar nada.

Al crear un servicio nuevo del bot:
- **No hay que hacer nada** para que quede en el historial — ya cae.
- Opcional pero recomendado: agregarle un **curador** (la allowlist de qué guardar en
  `detalle`) en `apps/server/src/lib/bot-cobros/historial.ts`. Sin curador se registra
  con acción/éxito/`codigo` y `detalle` vacío.
- Quedar **fuera** del historial exige una entrada justificada en `RUTAS_SIN_HISTORIAL`
  (mismo patrón que `RUTAS_QUE_NO_SON_DE_SIMPLETECH` del candado del Swagger).
- **PII jamás en `detalle`**: ni códigos OTP, ni teléfonos completos, ni identificadores
  crudos ([D-42](../../docs/features/bot-whatsapp-cobros/DECISIONES.md#d-42--qué-guarda-cada-interacción-y-qué-nunca)).

Contrato completo: [`docs/features/bot-whatsapp-cobros/06-historial-interacciones.md`](../../docs/features/bot-whatsapp-cobros/06-historial-interacciones.md).

## Utilities
- Always use zsh as the default shell
- All texts must be in spanish when facing client side
