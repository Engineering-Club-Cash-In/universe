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

## Utilities
- Always use zsh as the default shell
- All texts must be in spanish when facing client side
