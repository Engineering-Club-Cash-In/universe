# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a React dashboard application built with:
- **React 19** with TypeScript
- **TanStack Router** (code-based routing)
- **TanStack Query** for data fetching
- **Tailwind CSS v4** with CSS variables
- **Vite** as the build tool
- **Bun** as the package manager
- **Vitest** for testing
- **shadcn/ui** components (New York style)

Part of a monorepo structure at `/home/lralda/cci/universe` with workspace configuration.

## Essential Commands

```bash
# Install dependencies
bun install

# Development server (port 3000)
bun run dev
# or
bun run start

# Build for production
bun run build

# Preview production build
bun run serve

# Run tests
bun run test

# Add shadcn components
pnpx shadcn@latest add <component-name>
```

## Project Architecture

### Routing Structure
- **Code-based routing** using TanStack Router (not file-based)
- Routes defined in `src/main.tsx`
- Root route includes layout with `<Header />` component and devtools
- To add routes: create route with `createRoute()` and add to `routeTree`

### State Management
- **TanStack Query** for server state
- Query client created in `src/integrations/tanstack-query/root-provider.tsx`
- Provider wraps the entire app in `src/main.tsx`
- React Query DevTools included (bottom-right)

### Component Structure
- UI components use **shadcn/ui** with New York style
- Component aliases configured:
  - `@/components` → Components directory
  - `@/lib` → Utilities (includes `cn()` helper)
  - `@/ui` → UI components
- Tailwind utility helper: `cn()` function in `src/lib/utils.ts`

### Styling Configuration
- **Tailwind CSS v4** with CSS variables
- Main styles in `src/styles.css`
- Using Zinc as base color
- Icons from `lucide-react`

### TypeScript Configuration
- Strict mode enabled
- Path alias: `@/*` maps to `./src/*`
- Target: ES2022
- Module resolution: bundler mode
- No unused locals/parameters checking enabled

## Key Files Structure

```
src/
├── main.tsx                  # App entry, router setup, providers
├── App.tsx                   # Main app component
├── components/
│   └── Header.tsx           # App header component
├── integrations/
│   └── tanstack-query/
│       ├── root-provider.tsx # Query client setup
│       └── layout.tsx        # React Query DevTools
├── lib/
│   └── utils.ts             # cn() utility for className merging
├── routes/
│   └── demo.tanstack-query.tsx # Demo route for TanStack Query
└── styles.css               # Global styles with Tailwind
```

## Adding New Features

### Adding a New Route
1. Create component in appropriate location
2. In `src/main.tsx`, create route:
   ```tsx
   const newRoute = createRoute({
     getParentRoute: () => rootRoute,
     path: '/new-path',
     component: YourComponent,
   })
   ```
3. Add to routeTree: `rootRoute.addChildren([...existing, newRoute])`

### Adding shadcn Components
```bash
pnpx shadcn@latest add button
```
Components are automatically configured with correct paths and styling.

### Using TanStack Query
```tsx
const { data } = useQuery({
  queryKey: ['dataKey'],
  queryFn: fetchFunction,
  initialData: [],
})
```

## Testing Approach
- Test runner: Vitest
- Environment: jsdom
- Testing libraries: @testing-library/react, @testing-library/dom
- Run tests with: `bun run test`