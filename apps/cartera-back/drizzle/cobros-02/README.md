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
| `0000_motor_buckets.sql` | Motor de buckets: enums `bucket_evento_tipo` (INICIAL/SUBIDA/BAJADA) / `bucket_evento_origen`, tabla `buckets_historial` (transiciones, con CHECK de coherencia + unique parcial "1 INICIAL por crédito") y `asesor_bucket` (pool). |
| `0001_buckets_catalogo.sql` | Catálogo dinámico `buckets` (nombre/prefijo/rangos/estados/color) + CHECK de rangos + seed B0-B5 + FKs de `asesor_bucket.bucket` y `buckets_historial.bucket_(nuevo\|anterior)` al catálogo. |
| `0002_credito_asesor.sql` | Bitácora de reasignaciones `credito_asesor_historial` + enum `credito_asesor_origen`. **La asignación vive en `creditos.asesor_id`** (no hay tabla de estado): en cartera el asesor del crédito ES el cobrador (el vendedor vive en el CRM). Reasignar (futuro) = `UPDATE creditos SET asesor_id` (solo ese campo) + INSERT en la bitácora. |

## Decisiones de modelo (revisadas 2026-07-07, panel + confirmación de Daniel)

- **Asignación = `creditos.asesor_id`** (decisión de raíz): los reportes por asesor
  (paymentsByAdvisor, efectividad, embudo) siguen al dueño actual del cobro. Ese
  campo rota con los buckets; el vendedor/originación NO existe en esta base.
- **NO se materializa el bucket actual** (se deriva de `buckets_historial`) y **NO
  se unifican las bitácoras** (transiciones de bucket ≠ cambios de asesor). Válvula
  de escape solo si el volumen creciera ~100x: materializar estado con el patrón
  `moras_credito`+`moras_historial`.
- **"Asesor de apoyo"** (2º asesor en un crédito) = filtro futuro en el GET
  (ver todos los créditos del bucket), no filas/columnas.
- **Capacidad por asesor+bucket** = pieza futura (columna en `asesor_bucket`,
  migración `0003`), cuando se implemente la lógica de asignación.
- **Riesgo documentado del catálogo:** el CHECK de rangos evita min/max inválidos
  pero NO evita *gaps entre filas* (p.ej. desactivar B2): un crédito en el gap
  queda sin bucket en silencio. Editar el catálogo con cuidado.
