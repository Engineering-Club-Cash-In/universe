# Bitácora de escrituras: `crm_entity_audit`

Una fila por operación que crea, actualiza o borra un **lead**, una
**oportunidad** o un **vehículo**, con quién la hizo, desde dónde y el body
redactado. Sirve para responder "¿quién movió esta oportunidad al 30%?" o
"¿quién le cambió el vehículo a esta opp ganada?" sin adivinar.

## Qué guarda

| columna | contenido |
|---|---|
| `entity_type` | `lead` \| `opportunity` \| `vehicle` |
| `entity_id` | id de la entidad (texto; `NULL` si un `create` falló antes de tener id) |
| `action` | `create`, `update`, `delete`, `reassign`, `approve_analysis`, `mark_sold`, … |
| `procedure` | ruta ORPC (`crm.updateOpportunity`) o nombre de la función (`bot.getRenapInfoController`) |
| `performed_by` / `performed_by_role` | usuario de la sesión; `NULL` en flujos sin usuario |
| `source` | `crm` (usuario logueado) \| `bot` \| `portal` \| `public` \| `system` |
| `input` | body redactado (ver abajo) |
| `ok` / `error_code` / `duration_ms` | resultado de la operación |

Sin FKs a propósito: la bitácora sobrevive al borrado de la entidad y nunca
puede ser la causa de que falle la operación que registra.

## Cómo entra una fila

1. **Procedures ORPC** — declaran `.meta({ audit: { entity, action, idFrom } })`
   y `auditMiddleware` (`lib/audit.ts`, montado en `publicProcedure`) hace el
   resto: registra éxito y error, con `idFrom` como `input.opportunityId`,
   `output.id`, `input.vehicle.id`, etc. Los procedures sin `meta.audit` no
   pagan nada.
2. **Escrituras fuera de /rpc** (bot de WhatsApp, portal, formularios públicos,
   `closeOpportunity`, migración automática desde cartera) — llaman a
   `logEntityAudit(db | tx, {...})` explícitamente. Si se pasa la transacción,
   la fila se commitea con el cambio.

Un procedure con ramas que terminan en acciones distintas (por ejemplo
`crm.createLead`, que puede dar de alta un lead o reasignar uno que ya existía)
declara `.meta({ audit: { …, onlyOnError: true } })`: audita su éxito a mano en
cada rama y deja que el middleware registre solo los intentos rechazados, para
que no sea el único procedure sin filas `ok = false`.

Un helper compartido por varios flujos (como `createOpportunityForLead`, que
usan el formulario público y el portal) recibe el `source` por parámetro en vez
de fijarlo, si no la procedencia se pierde.

Para auditar un procedure nuevo basta con agregarle el `.meta({ audit })`.

## Redacción del body

`prepareAuditInput` recorta strings > 2 KB, reemplaza claves que parezcan
sensibles o binarias (`*base64*`, `password`, `token`, `otp`, …), acota arrays
a 100 items y profundidad a 6 niveles; si aun así el JSON pasa 64 KB, guarda
solo la lista de claves. Lo único pesado en estas entidades son fotos y
documentos en base64, que es justo lo que se omite.

## Consultas típicas

```sql
-- Línea de tiempo de una oportunidad
SELECT created_at, action, procedure, performed_by, source, ok, input
FROM crm_entity_audit
WHERE entity_type = 'opportunity' AND entity_id = '<uuid>'
ORDER BY created_at DESC;

-- Todo lo que tocó un usuario esta semana
SELECT created_at, entity_type, entity_id, action, procedure
FROM crm_entity_audit
WHERE performed_by = '<user id>' AND created_at > now() - interval '7 days'
ORDER BY created_at DESC;

-- Cambios de vehículo sobre oportunidades ganadas
SELECT a.created_at, a.performed_by, a.input->>'vehicleId' AS nuevo_vehiculo
FROM crm_entity_audit a
JOIN opportunities o ON o.id::text = a.entity_id
WHERE a.entity_type = 'opportunity' AND a.action = 'update'
  AND o.status = 'won' AND a.input ? 'vehicleId';
```

## Retención

Append-only con índices por `(entity_type, entity_id, created_at)`,
`(performed_by, created_at)` y `created_at`. Con el volumen del CRM son pocos
GB al año; cuando moleste, borrar filas con más de 12 meses.
