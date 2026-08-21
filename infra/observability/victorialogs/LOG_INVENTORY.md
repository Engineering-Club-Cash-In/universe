# Inventario de logging de Cartera

**Fecha del análisis:** 20 de agosto de 2026
**Commit inspeccionado:** `b97fdb9a31ea7a5ecea8b203afa3884fc30965df`
**Modo:** auditoría estática read-only; sin producción, instalaciones ni cambios en aplicaciones

## Resumen

| Alcance | Llamadas productivas | Tests |
|---|---:|---:|
| `apps/cartera-back` | 4,004 | 90 |
| `apps/carteraFront` | 147 | 0 |
| **Total** | **4,151** | **90** |

El total incluye llamadas ejecutables de consola y logging ad hoc. En backend también incluye `python.print`, `logger.*`, timers y tablas; excluye dependencias, builds, coverage, datos/fixtures generados y archivos clasificados como prueba.

## Acción recomendada

| Acción | Backend | Frontend | Total | Proporción |
|---|---:|---:|---:|---:|
| Eliminar ruido, debug o PII | 843 | 66 | **909** | 21.90% |
| Reemplazar por eventos estructurados | 400 | 81 | **481** | 11.59% |
| Conservar, pero estructurar | 275 | 0 | **275** | 6.62% |
| Revisión conservadora por datos sensibles | 2,486 | 0 | **2,486** | 59.89% |
| **Total** | **4,004** | **147** | **4,151** | **100%** |

`Revisión conservadora` no significa conservar. Cada llamada debe terminar clasificada como eliminación, allowlist estructurada o excepción aprobada. No se deben migrar automáticamente esas llamadas a VictoriaLogs.

## Backend por método

| Método | Llamadas productivas |
|---|---:|
| `console.log` | 2,583 |
| `console.error` | 447 |
| `console.warn` | 41 |
| `console.time` / `timeEnd` / `table` | 9 |
| Python `print` | 676 |
| `logger.info` | 191 |
| `logger.error` | 56 |
| `logger.debug` | 1 |
| **Total** | **4,004** |

### Hotspots backend

| Archivo | Llamadas |
|---|---:|
| `src/migration/migration.ts` | 316 |
| `src/controllers/liquidateInvestor.ts` | 279 |
| `src/migration/procesar_creditos.py` | 276 |
| `src/routers/cofidi.ts` | 209 |
| `src/controllers/registerPayment.ts` | 187 |
| `src/controllers/paymentAgreement.ts` | 167 |
| `src/controllers/investor.ts` | 153 |
| `src/controllers/payments.ts` | 151 |
| `src/controllers/credits.ts` | 139 |
| `src/migration/fusion_creditos.py` | 128 |
| `src/controllers/updateCredit.ts` | 124 |

## Frontend por método

| Método | Llamadas productivas |
|---|---:|
| `console.log` | 77 |
| `console.error` | 70 |
| `console.warn` / `debug` | 0 |
| **Total** | **147** |

No existe ninguna llamada protegida por modo desarrollo que resulte segura para conservar sin cambios.

### Hotspots frontend

| Archivo | Llamadas | Eliminar | Reemplazar |
|---|---:|---:|---:|
| `hooks/registerPayment.ts` | 42 | 41 | 1 |
| `services/services.ts` | 22 | 2 | 20 |
| `hooks/getInvestor.ts` | 11 | 0 | 11 |
| `CreditsPaymentsData.tsx` | 10 | 9 | 1 |
| `hooks/advisor.ts` | 9 | 0 | 9 |
| `PaymentsCredits.tsx` | 5 | 2 | 3 |

## Hallazgos críticos

1. `routers/midleware.ts` imprime el JWT decodificado completo.
2. `auditLog.ts` persiste body, query, params y response de mutaciones; requiere allowlist, retención y separación respecto a observabilidad.
3. `uploadsFiles.ts` imprime objetos `File`/Blob.
4. Integraciones COFIDI/SAT imprimen respuestas, errores, NIT, nombres o UUID completos.
5. `registerPayment.ts` imprime montos, mora, saldos, cuotas, boletas y resultados intermedios por paso.
6. El frontend registra payloads, respuestas y errores Axios crudos que pueden incluir config, headers o Authorization.
7. Upload y `/newPayment` comparten `catch`, impidiendo identificar la etapa fallida.
8. No existen request ID, idempotency key, timeout Axios ni telemetría estructurada.
9. El backend fuerza `NODE_ENV=DEV` mediante `devStart` y no tiene contrato central de nivel/formato.
10. Docker `json-file` carece de rotación y las imágenes no definen healthcheck.

## Secuencia de PRs

### PR 1 — Contención inmediata

- Eliminar JWT decodificado, objetos File, usuarios, payloads y respuestas completas.
- Reducir `registerPayment` a eventos agregados.
- Añadir gate que impida nuevas llamadas ad hoc fuera de excepciones aprobadas.

### PR 2 — Contrato y logger backend

- Logger JSON de una línea con allowlist.
- Middleware de request ID, inicio/fin, status y duración.
- Serialización segura de errores.
- CORS para aceptar/devolver el header de correlación.

### PR 3 — Flujo de pagos y frontend

- Separar errores de upload y `/newPayment`.
- Añadir `operation_id`, request ID e idempotencia.
- Instrumentar `ERR_NETWORK`, timeout, cancelación, offline y refresh.
- Eliminar las 41 trazas de `registerPayment.ts` frontend.

### PR 4 — Hotspots backend e integraciones

- Migrar pagos, liquidaciones, convenios, créditos y jobs.
- Sustituir respuestas de proveedores por status, duración, request ID y error code.
- Mantener migraciones/scripts fuera del pipeline productivo o en modo CLI seguro.

### PR 5 — Auditoría y operación

- Separar auditoría durable de logs operativos.
- Corregir timestamp UTC, índices, retención y purga de `audit_logs`.
- Añadir liveness/readiness, healthcheck y rotación local.
- Validar canary, volumen, cardinalidad y redacción en staging antes de producción.

## Regla de migración

No se hará reemplazo automático `console.* → logger.*`. Cada punto debe convertirse en un evento con nombre estable y campos permitidos, o eliminarse. Los bodies, responses, archivos, errores Axios completos y objetos de dominio quedan prohibidos por defecto.
