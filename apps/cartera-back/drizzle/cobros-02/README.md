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
| `0003_buckets_estado_mora.sql` | Agrega `buckets.estado_mora` (puente numero↔estadoMora: al_dia..mora_120_plus) + seed. Retira la duplicación con `config/moraBuckets.ts` (cartera-back) y el mirror en CRM. |

## Asignación inicial (`asignacion/`) — carga de datos, NO schema

Scripts **set-based** (nada de ir crédito por crédito) para poblar el modelo
una vez aplicadas las migraciones 0000→0003. Pensados para el **sandbox de
pruebas** (`cartera_cobros2`, copia del schema `cartera` en dev): cada archivo
abre con `SET LOCAL search_path TO cartera_cobros2;` — cambiar esa línea a
`cartera` cuando toque el ambiente real. Correr en orden; los 3 son
idempotentes y revientan (no siguen a medias) si falta un prerequisito.

| Archivo | Qué hace |
|---|---|
| `asignacion/01_pool_asesor_bucket.sql` | Crea el asesor de prueba de B1 y puebla el pool `asesor_bucket` por NOMBRE: B0 Caren Rivera · B1 Diego Gomez + Asesor Prueba B1 · B2 Samuel Gamboa · B3 Jorge Sente · B4 Erik Rivas · B5 Gerencia. |
| `asignacion/02_asignar_asesores_creditos.sql` | Deriva el bucket de cada crédito (mismas reglas del motor: fuera del funnel no se toca; `estados_incluidos` manda; si no, `cuotas_atrasadas` de la mora activa vs rangos del catálogo) y asigna asesor: 1 asesor → directo, N asesores → round-robin determinístico (parejo). Bitácora en `credito_asesor_historial` PRIMERO, luego `UPDATE creditos SET asesor_id` — **únicamente ese campo**. |
| `asignacion/03_linea_base_historial.sql` | Siembra el evento `INICIAL` en `buckets_historial` (solo créditos sin ningún registro), espejo de lo que haría el motor — así `procesarMoras` no re-siembra y solo registra SUBIDAs/BAJADAs reales. |

Dry-run contra dev (2026-07-08): B0 437 · B1 597 (→ 299/298) · B2 219 ·
B3 55 · B4 30 · B5 148 · FUERA 142 (no se tocan) — 1,193 créditos cambian de dueño.

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
  migración `0004`), cuando se implemente la lógica de asignación.
- **Riesgo documentado del catálogo:** el CHECK de rangos evita min/max inválidos
  pero NO evita *gaps entre filas* (p.ej. desactivar B2): un crédito en el gap
  queda sin bucket en silencio. Editar el catálogo con cuidado.
