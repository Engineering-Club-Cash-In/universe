# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `bun dev` - Start all applications in development mode (web on :3001, server on :3000)
- `bun dev:web` - Start only the web application
- `bun dev:server` - Start only the server
- `bun build` - Build all applications
- `bun check` - Run oxlint linter
- `bun check-types` - Check TypeScript types across all apps
- `bun run check-all` - Complete build and type checking (regenerates ORPC types)

### Database
- `bun db:push` - Push schema changes to database
- `bun db:studio` - Open Drizzle Studio UI
- `bun db:generate` - Generate migrations
- `bun db:migrate` - Run migrations
- `bun db:seed` - Create test users with different roles
- `bun db:clear` - Clear all data from database

### Testing
- Run a single test file: `bun test path/to/test.spec.ts`

## Architecture

This is a monorepo using Bun workspaces with two main applications:

### Web Application (`apps/web/`)
- **Framework**: React with TanStack Router (file-based routing)
- **Styling**: TailwindCSS v4 with shadcn/ui components
- **State Management**: TanStack Query for server state
- **Authentication**: Better Auth client integration
- **API Communication**: ORPC client for type-safe RPC calls
- **Build Tool**: Vite with TypeScript
- **Port**: 3001 (development)

### Server Application (`apps/server/`)
- **Framework**: Hono for HTTP server
- **API Layer**: ORPC for type-safe RPC endpoints
- **Database**: PostgreSQL with Drizzle ORM (Neon serverless driver)
- **Authentication**: Better Auth with database sessions
- **Runtime**: Bun
- **Port**: 3000 (development)

## Key Patterns

### API Routes
- All RPC endpoints are defined in `apps/server/src/routers/`
- Use `publicProcedure` for public endpoints
- Use `protectedProcedure` for authenticated endpoints
- Authentication middleware checks session via Better Auth

### Database Schema
- Schema definitions in `apps/server/src/db/schema/`
- Using Drizzle ORM with PostgreSQL dialect
- Authentication tables managed by Better Auth

### Frontend Routing
- Routes defined in `apps/web/src/routes/`
- File-based routing with TanStack Router
- Protected routes check authentication state

### Type Safety
- End-to-end type safety via ORPC
- Router types exported from server and imported in client
- Zod for runtime validation

## Environment Variables

### Server (`apps/server/.env`)
- `DATABASE_URL` - PostgreSQL connection string
- `CORS_ORIGIN` - Allowed CORS origin (e.g., http://localhost:3001)
- `BETTER_AUTH_SECRET` - Secret for session encryption
- `BETTER_AUTH_URL` - Authentication base URL

### Web (`apps/web/.env`)
- `VITE_SERVER_URL` - Backend server URL (e.g., http://localhost:3000)

## Important Notes
- Always use `bun` as the package manager
- Use absolute imports with `@/` alias for web app src files
- Authentication flow: Better Auth handles signup/signin with database sessions
- ORPC provides OpenAPI spec generation capability
- Components follow shadcn/ui patterns in `apps/web/src/components/ui/`
- **Type generation**: Use `bun run check-all` when ORPC types are not working correctly
- **Parallel commands**: Build and check-types may fail when run together, use `check-all` script instead

## Test Users (after running `bun db:seed`)
- **Super Admin**: admin@company.com / Admin123!
- **Department Manager**: gerente.ventas@company.com / Manager123!
- **Department Manager**: gerente.operaciones@company.com / Manager123!
- **Area Lead**: lead.marketing@company.com / Lead123!
- **Employee**: empleado.ventas@company.com / Employee123!
- **Employee**: empleado.marketing@company.com / Employee123!
- **Viewer**: viewer@company.com / Viewer123!
