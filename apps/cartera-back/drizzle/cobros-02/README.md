# Migraciones COBROS-02 (rediseño de cobros)

Estas migraciones están **agrupadas aparte** a propósito: pertenecen al rediseño
de cobros (**release COBROS-02**), una versión aislada que sale en meses y que
**NO pasa por develop**. Se separan de las migraciones normales de `drizzle/`
para que se sepa que se aplican como bloque cuando salga esa versión.

- **Se aplican a mano** (Cartera no usa `drizzle-kit` para esto). SQL idempotente.
- Corresponden al schema en `src/database/db/schema.ts`.
- Orden de aplicación = por número de archivo (`0000_...`, `0001_...`, ...).

## Contenido

| Archivo | Qué crea |
|---|---|
| `0000_motor_buckets.sql` | Motor de buckets: enums `bucket_evento_tipo`/`bucket_evento_origen`, tabla `buckets_historial` (transiciones) y `asesor_bucket` (asignación pool). |
