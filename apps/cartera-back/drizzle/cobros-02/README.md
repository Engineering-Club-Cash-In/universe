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
| `0006_buckets_dias_sla.sql` | CB-020: agrega `buckets.dias_sla` (días para contactar desde que el crédito entra al bucket) + seed placeholder B1-B5 (B0 = NULL, sin SLA). Consumido por la Cola del Día del CRM (`GET /buckets/cola-dia`). |
| `0007_promesas_pago_espejo.sql` | CB-030: tabla `promesas_pago_espejo`, copia local de promesas de pago vigentes sincronizada desde crm-server (contactos_cobros vive en otra DB). procesarMoras la consulta para congelar SOLO las cuotas prometidas (no el crédito completo) mientras la promesa esté vigente. |
| `0008_pagalo_payment_imports.sql` | CB-028: ledger idempotente de grupos Págalo, validación crédito↔SIFCO, vínculo de N `pagos_credito` mediante `pagalo_import_id` y origen `pagalo`. Requiere los dos links CAPITAL/MORA_INTERES aceptados antes de aplicar pagos. |
| `0009_pagalo_un_solo_link.sql` | CB-105: el ledger acepta grupos de **un solo link** (selección sin capital o solo capital — D-48 del bot): evidencia por lado nullable + CHECK de coherencia explícito (monto > 0 ⇒ evidencia completa; monto = 0 ⇒ lado vacío). Se aplica después de la 0008. |
| `0009_pagalo_optional_capital.sql` | CB-028 (#1422): la versión **mora-only** del mismo ajuste, hecha en paralelo (solo capital opcional; exige `facturable_total > 0`). Compatible pero más restrictiva que la de CB-105. |
| `0010_pagalo_solo_capital.sql` | CB-105: **estado final de las dos 0009 gemelas** (D-48, decisión de Daniel): re-afirma montos `>= 0` en ambos lados y lado facturable nullable con su CHECK de coherencia — la última palabra, corra lo que corra antes. |
| `0011_pagalo_review_missing_credit.sql` | CB-105: permite auditar `REVIEW_REQUIRED` sin crédito vivo si SIFCO cambió o crédito fue eliminado; `APPLIED` conserva identidad crédito↔SIFCO obligatoria. |
| `0012_pagalo_validado_cuenta_factura.sql` | D-10 v2 / D-50 v2: siembra la cuenta de empresa virtual **PAGALO** (`numero_cuenta = PAGALO-LINK`, la exige `asignarCuentaPagalo`) y agrega `factura_status/factura_error/factura_at` al ledger para el resultado de la facturación post-commit. |
| `0013_pagalo_recibo_status.sql` | D-10 v2: `recibo_status/recibo_at` en el ledger — outbox mínimo del recibo por WhatsApp post-commit (claim `ENVIANDO`; lo reanudan el replay del CRM y el barrido). |
| `0014_estado_facturacion_pago.sql` | Visibilidad de la facturación (Daniel 2026-08-27): `pagos_credito.factura_status/factura_error/factura_at` (qué pago quedó sin factura o a medias, separado de `validation_status`) y `facturas_electronicas.rubro/inversionista_id` (qué cubre cada DTE) + backfill del histórico desde `facturacion_desglose`. NO refactura nada: es información para conta. |
| `0016_cb033_convenio_decisiones.sql` | CB-033: dos tablas — `convenio_operaciones` (reclamo idempotente del `operacion_id`, muta al cerrar) y `convenio_decisiones` (bitácora append-only de aprobación/rechazo, indexada por `credito_id` porque el rechazo borra la fila de `convenios_pago`). FK cruzada `convenio_operaciones.decision_id → convenio_decisiones` es `DEFERRABLE INITIALLY DEFERRED` (se resuelve dentro de la misma transacción del servicio, `convenioDecision.ts`). Ver [Ficha 360 §3.5](../../../../docs/features/cobros-02/06-ficha-360.md#35-aprobación-de-convenios-cb-033) en el CRM. |

## Asignación inicial (`asignacion/`) — carga de datos, NO schema

Scripts **set-based** (nada de ir crédito por crédito) para poblar el modelo
una vez aplicadas las migraciones 0000→0003. El schema se pasa como variable de psql (`-v schema=cartera_cobros2`; sin
ella, 01/02/03 asumen el sandbox y 04 asume `cartera`). Correr en orden; los
scripts son idempotentes y revientan (no siguen a medias) si falta un
prerequisito. Lo más cómodo es `carga_inicial.sh`, que hace todo.

| Archivo | Qué hace |
|---|---|
| `asignacion/carga_inicial.sh` | **Orquestador parametrizable** (2026-09-09): `--origen/--origen-schema` (solo lectura) → `--destino/--destino-schema`, `--pool pool.csv`, `--fases`, `--dry-run`, `--reemplazar`, `--permitir-prod`. Copia el schema (renombrando al vuelo), aplica las migraciones del bloque, y corre 01→04 con `-v schema=`. Rechaza hosts `-pooler` y prod sin bandera. |
| `asignacion/alinear_desde_prod.sh` | **Alineación desde producción, a demanda** (no programada): dump de prod a un schema de trabajo, migraciones, trasplante del historial/pool/catálogo/dueños del sandbox, línea base de los créditos nuevos, **el motor** (que es quien mueve los buckets y registra las BAJADAS de quien ya pagó), `02` para residuos, swap por rename y retención. Ver el runbook. |
| `asignacion/_lib.sh` | Funciones compartidas (renombrado de dump y migraciones, aplicar migraciones, verificación). |
| `asignacion/pool.csv` | **El parámetro del pool**: `email_cash_in,buckets,nombre_referencia`; varios buckets con `\|` (ej. `1\|2`). La llave es el correo, no el nombre ni el id (cambiaron de persona entre refrescos). |
| `asignacion/01_pool_asesor_bucket.sql` | Puebla el pool `asesor_bucket` desde `pool.csv` (`-v pool_csv=`). **Autoritativo**: reactiva los pares del CSV y desactiva los que ya no estén. Guards: correo sin asesor activo, bucket fuera de catálogo, bucket sin asesor. Ya no crea el asesor de prueba. |
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
