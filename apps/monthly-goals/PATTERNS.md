# Patrones de Implementación Exitosos

## TanStack Start + Better Auth + Drizzle

### 1. Server Functions (TanStack Start Compliant)

```typescript
import { createServerFn } from '@tanstack/react-start'
import { getHeaders } from '@tanstack/react-start/server'
import { db } from '../lib/db'
import { auth } from '../lib/auth/config'
import { redirect } from '@tanstack/react-router'

// Helper para autenticación
async function requireAuth() {
  const headerEntries = getHeaders()
  // Convertir headers de TanStack a Web API Headers
  const headers = new Headers()
  for (const [key, value] of Object.entries(headerEntries)) {
    if (value) headers.append(key, value)
  }
  
  const session = await auth.api.getSession({ headers })
  if (!session?.user) {
    throw redirect({ to: '/login' }) // Sin status parameter
  }
  return session
}

// Helper para roles
async function requireRole(allowedRoles: string[]) {
  const session = await requireAuth()
  const user = session.user as { role?: string }
  if (!user.role || !allowedRoles.includes(user.role)) {
    throw new Error('Forbidden: Insufficient permissions') // No HTTPException
  }
  return session
}

// Función simple sin parámetros
export const getItems = createServerFn().handler(async () => {
  const result = await db.select().from(items)
  return result
})

// Función con validación y tipos de retorno explícitos
export const createItem = createServerFn()
  .validator((input: unknown) => {
    // Validación manual del input
    if (typeof input !== 'object' || input === null || !('name' in input)) {
      throw new Error('Invalid input: name is required')
    }
    return input as { name: string; description?: string }
  })
  .handler(async ({ data }): Promise<Item> => {
    await requireRole(['superAdmin', 'manager'])
    
    const result = await db
      .insert(items)
      .values({
        name: data.name,
        description: data.description,
      })
      .returning()
    
    return result[0]
  })
```

### 2. Tipos TypeScript

```typescript
// types/items.ts

// Tipo base que coincide con la tabla de DB
export interface Item {
  id: string
  name: string
  description: string | null
  createdAt: Date
  updatedAt: Date
}

// Tipo extendido con campos de JOINs
export interface ItemWithDetails extends Item {
  categoryName: string | null
  ownerName: string | null
  itemsCount?: number
}

// Tipos para inputs (NUNCA usar 'any')
export interface CreateItemInput {
  name: string
  description?: string // opcional con ?
  categoryId: string
}

export interface UpdateItemInput {
  id: string
  name?: string
  description?: string
}

export interface DeleteItemInput {
  id: string
}
```

### 3. Componentes React

```typescript
// routes/admin/items.tsx
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useRole } from '../../lib/auth/hooks'
import { getItems, createItem, updateItem, deleteItem } from '../../server/items'
import type { Item, ItemWithDetails, CreateItemInput } from '../../types/items'

export const Route = createFileRoute('/admin/items')({
  component: ItemsPage,
})

function ItemsPage() {
  const { isAdmin } = useRole()
  const queryClient = useQueryClient()
  
  // Query - dejar que TypeScript infiera el tipo del return
  const { data: items, isLoading } = useQuery({
    queryKey: ['items'],
    queryFn: async () => getItems(), // Server function ya tipada
  })
  
  // Mutation con tipos explícitos
  const createMutation = useMutation<Item, Error, CreateItemInput>({
    mutationFn: async (data) => createItem({ data }), // IMPORTANTE: wrapper { data }
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] })
    },
  })
  
  // Form submit
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget as HTMLFormElement)
    const name = formData.get('name') as string
    const description = formData.get('description') as string
    
    createMutation.mutate({
      name,
      description: description || undefined, // Convertir string vacío a undefined
    })
  }
  
  // Renderizado con tipo explícito si es necesario
  return (
    <div>
      {items?.map((item: ItemWithDetails) => (
        <div key={item.id}>{item.name}</div>
      ))}
    </div>
  )
}
```

### 4. Estructura de Archivos

```
src/
├── lib/
│   ├── auth/
│   │   ├── config.ts         # Better Auth config
│   │   ├── client.ts         # Auth client
│   │   ├── hooks.ts          # useAuth, useRole hooks
│   │   └── permissions.ts    # Access control
│   └── db/
│       ├── index.ts          # Drizzle instance
│       └── schema.ts         # Database schema
├── server/
│   ├── departments.ts        # Department server functions
│   ├── areas.ts              # Area server functions
│   └── team-members.ts       # Team member server functions
├── routes/
│   ├── admin.tsx             # Admin layout
│   └── admin/
│       ├── departments.tsx   # Departments UI
│       ├── areas.tsx         # Areas UI
│       └── teams.tsx         # Teams UI
└── types/
    ├── departments.ts        # Department types
    ├── areas.ts              # Area types
    └── team-members.ts       # Team member types
```

### 5. Puntos Clave

#### ✅ HACER:
- Usar `createServerFn()` sin `method` parameter
- Validar input con `(input: unknown)` y cast manual
- Convertir headers de TanStack a Web API Headers
- Usar `throw new Error()` para errores
- Usar `throw redirect({ to: '/path' })` sin `status`
- Tipar funciones del servidor con Promise<T>
- Llamar server functions con wrapper `{ data }`
- Convertir strings vacíos a undefined en forms

#### ❌ NO HACER:
- NUNCA usar `any` - prohibido completamente
- No usar `HTTPException` de Hono
- No usar `as any` para casteos
- No usar `status` en redirect de TanStack
- No quitar tipos para "simplificar"
- No usar placeholders - todo debe funcionar

### 6. Ejemplo de Migración de Next.js a TanStack Start

```typescript
// ❌ Next.js
import { NextRequest, NextResponse } from 'next/server'
export async function POST(req: NextRequest) {
  const data = await req.json()
  return NextResponse.json({ success: true })
}

// ✅ TanStack Start
import { createServerFn } from '@tanstack/react-start'
export const handleData = createServerFn()
  .validator((input: unknown) => input as DataType)
  .handler(async ({ data }) => {
    return { success: true }
  })
```

### 7. Testing de Tipos

Siempre ejecutar antes de commit:
```bash
bun run typecheck  # tsc --noEmit
```

---

*Documento creado después de implementar exitosamente Fase 2*
*Estos patrones han sido probados y funcionan correctamente*