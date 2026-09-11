# Tracker de Predios y Agencias

Front ligero para que predios y agencias consulten en qué etapa va el crédito de
los vehículos que colocaron. Consume la API del CRM (`apps/crm/apps/server`) por
oRPC y comparte su sesión de Better Auth.

## Desarrollo

```bash
cp .env.example .env   # VITE_SERVER_URL apunta al server del CRM
bun install            # desde la raíz del monorepo
bun run dev            # http://localhost:3002
```

El server del CRM debe estar corriendo en `:3000` (`bun dev:server` dentro de
`apps/crm`). Su CORS ya permite cualquier `localhost:*` en desarrollo.

## Acceso

Solo entran usuarios con rol `partner` que tengan al menos una fila en
`partner_members`. El alcance de lo que ven sale de ahí: las oportunidades cuyo
`company_id` esté entre sus companies asignadas.
