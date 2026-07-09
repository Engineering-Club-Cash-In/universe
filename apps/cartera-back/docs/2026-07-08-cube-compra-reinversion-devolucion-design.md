# CUBE compra (devolución) + reinversión del saliente — Diseño

- **Fecha:** 2026-07-08
- **Branch:** `feat/cartera-abonos-cancelacion-devolucion`
- **App:** `apps/cartera-back`
- **Autor:** Juan Diego Alvarado

## 1. Contexto y problema

Existen créditos de "carros recuperados" que deben devolverse a **CUBE Investments S.A.** (id `86`):
CUBE se queda con el crédito completo y el **inversionista saliente** (el no-CUBE que participaba) sale
de ese crédito. El capital que CUBE le compra al saliente debe **reinvertirse** en otros créditos.

Hoy el flujo de devolución (rama actual) hace, al **Aceptar** en el módulo *Devolución Cube*
(`aceptarDevolucion`):

1. `estado_devolucion` → `VERIFICADO` (atómico, anti doble-aceptación).
2. `registrarCancelacionEspejo`: inserta una fila `abonos_capital` tipo `CANCELACION` por inversionista
   del espejo, con su capital real (`monto_aportado_espejo − compras_pendientes`), `liquidado=false`,
   idempotente.

El **traslado real del pool a CUBE** solo ocurre hoy en la **liquidación**
(`payments.ts` → `aplicarDevolucionCube` cuando `estado_devolucion === 'VERIFICADO'` → llama a
`exitInvestor`). Ese `exitInvestor` tiene dos efectos colaterales indeseados para este caso:

- **Inactiva al inversionista de forma GLOBAL** (`inversionistas.status = 'inactivo'`), aunque siga
  participando en decenas de créditos vivos (los 8 salientes de este lote tienen entre 6 y 27
  créditos más). Esto es una **salida parcial**, no una salida total.
- **Manda correo** a una lista fija.

Además, el saliente **va a reinvertir** el capital que CUBE le compra, así que dejarlo `inactivo`
es incorrecto.

## 2. Alcance (los 9 créditos de este lote)

Los 9 créditos a procesar y su saliente (monto tomado del **espejo**), con el % que el saliente
tiene en el crédito recuperado:

| # | Crédito | SIFCO | Saliente (inv_id) | CUBE en crédito | Monto espejo | % part/cash |
|---|---|---|---|---|---|---|
| 1 | 224 | 01010214120030 | Anna Lisseth Lorenzo Rodas (7) | Sí (MERGE) | Q263.16 | 70/30 |
| 2 | 1047 | 01010214107130 | Inversiones Mónaco S.A. (92) | Sí (MERGE) | Q3,195.38 | 80/20 |
| 3 | 838 | 01010214114960 | Adriana Bahaia (1) | Sí (MERGE) | Q19,385.95 | 80/20 |
| 4 | 5256 | 01010214123980 | LA LO LO (88) | Sí (MERGE) | Q24,404.79 | 80/20 |
| 5 | 570 | 01010214116250 | Werner Oswaldo Osoy Trejo (82) | Sí (MERGE) | Q15,572.46 | 80/20 |
| 6 | 8722 | CRM-875fd63f-… | Luis Pedro Sandoval Ortiz (57) | Sí (MERGE) | Q1,068.76 | 80/20 |
| 7 | 466 | 01010214120710 | Jose Jorge Massis (47) | **No (SWAP)** | Q122,797.32 | 75/25 |
| 8 | 646 | 01010214111310 | Werner Oswaldo Osoy Trejo (82) | **No (SWAP)** | Q67,836.93 | 80/20 |
| 9 | 595 | 01010214114550 | Tonejos S.A. (81) | **No (SWAP)** | Q139,739.28 | 75/25 |

Monto de reinversión **por inversionista** (suma de sus créditos absorbidos; Werner acumula 570+646):

| Saliente | Monto a reinvertir (espejo) | % part/cash |
|---|---|---|
| Anna Lisseth (7) | Q263.16 | 70/30 |
| Inversiones Mónaco (92) | Q3,195.38 | 80/20 |
| Adriana Bahaia (1) | Q19,385.95 | 80/20 |
| LA LO LO (88) | Q24,404.79 | 80/20 |
| Werner (82) [570+646] | Q83,409.39 | 80/20 |
| Luis P. Sandoval (57) | Q1,068.76 | 80/20 |
| Jose Massis (47) | Q122,797.32 | 75/25 |
| Tonejos (81) | Q139,739.28 | 75/25 |

Nota: todos los 9 están hoy `estado_devolucion=NO_APLICA` (padre) salvo que ya se hayan aceptado.
Todos sus rows de espejo están `status=completado`, `tipo_reinversion=null`. No hay reinversión
pendiente que resolver antes.

## 3. El flujo (2 movimientos, en orden)

**Movimiento A — CUBE compra el crédito recuperado** (por cada uno de los 9):
CUBE absorbe al saliente (SWAP si CUBE no está, MERGE si está) en padre + espejo y queda
**100% CUBE-puro** (`cash_in=100 / participacion=0`), estilo `exitInvestor`, pero **sin inactivar**
al inversionista y **sin correo**. Esto "devuelve" el capital del saliente.

**Movimiento B — el saliente reinvierte ese capital** (por cada saliente):
Con el monto (espejo) que CUBE le compró, se llama `addInvestorToCredit` en **modo automático**
(el endpoint escoge créditos por score), `tipo_operacion="reinversion"`, con el **% del crédito
recuperado**, y el registro en `compras_credito_inversionista` con **`fecha = 2026-06-10`**.

## 4. Decisiones (cerradas)

- **Split de CUBE al absorber:** CUBE-puro `0/100` (como `exitInvestor` hoy).
- **Disparo del pool-move:** método/script batch aparte (no en `aceptarDevolucion`).
- **Alcance por crédito:** absorbe a **todos** los no-CUBE (CUBE queda 100%); valida si CUBE ya está
  (MERGE) o no (SWAP).
- **El "método" es solo pool-move.** Los extras (estado, orquestación) van en el **script**.
- **% de la reinversión (Mov B):** el que el saliente tiene **en el crédito recuperado**
  (coincide con su % predominante).
- **Monto de la reinversión (Mov B):** del **espejo**.
- **Selección de créditos (Mov B):** **automática** (`getCreditCandidates` por score).
- **Fecha 2026-06-10:** va en **`compras_credito_inversionista.fecha`** (NO en
  `fecha_inicio_participacion`, que el endpoint ya ignora).
- **`tipo_reinversion` (Mov B):** lo resuelve el propio endpoint (usa el que el inversionista ya tiene,
  vía `tipoReinvActualPorInv`).
- **Enfoque de reutilización:** **A — helper compartido** (refactor de `exitInvestor`).
- **Estado tras Mov A (extra del script):** `estado_devolucion → NO_APLICA` para cerrar el ciclo y no
  chocar con la liquidación.

## 5. Componentes / archivos

| Archivo | Cambio |
|---|---|
| `src/controllers/absorberEnCube.ts` (nuevo) | `absorberInversionistaEnCube(tx, creditoId, invId)` + `cubeCompraCredito(tx, creditoId)` |
| `src/controllers/investor.ts` | Refactor: `exitInvestor` consume el helper (comportamiento externo idéntico) |
| `src/controllers/addInvestorToCredit.ts` | Nuevo param opcional `fecha_compra` → `compras_credito_inversionista.fecha` (default sigue `now()`) |
| `src/scripts/cubeCompraReinversion.ts` (nuevo) | Orquesta A→B, guard DB, dry-run, backup, logging |

## 6. Movimiento A — el helper (Enfoque A)

### 6.1 `absorberInversionistaEnCube(tx, creditoId, invId)`

Extrae el cuerpo del `for` de `exitInvestor` (hoy en `investor.ts` ~L5389–5796). Por cada
`(crédito, inversionista)`:

- Lee `creditoData` (tasa, cuota, seguro, gps, membresía), el row del saliente en **padre** y si
  **CUBE** está en el crédito.
- **SWAP** (CUBE ausente): el row del saliente pasa a `inversionista_id=86`, CUBE-puro
  (`cash_in=100 / part=0`), cuota + IVAs recalculados con `calcDerivadosCubePuro` desde la tasa.
- **MERGE** (CUBE presente): suma `monto_aportado` del saliente al row de CUBE, CUBE-puro, borra el
  row del saliente.
- Mismo tratamiento en **espejo** (`status="completado"`).
- Recalcula cuotas del pool (fórmula `calculateInvestorQuotas`) + `bandera_reinversion=false`.
- **NO hace:** `status='inactivo'`, correo, `abonos_capital`, `estado_devolucion`.
- **Devuelve:** `{ credito_id, numero_credito_sifco, monto_transferido, cube_preexistente, accion: "swap"|"merge" }`.
- Si el saliente no está en el crédito: lo decide el caller (omitir/registrar error).

### 6.2 `cubeCompraCredito(tx, creditoId)`

- Lee todos los inversionistas **no-CUBE** del crédito (padre).
- Si no hay no-CUBE → no-op (ya es 100% CUBE).
- Por cada uno → `absorberInversionistaEnCube` (secuencial: tras el 1er SWAP los siguientes ven CUBE
  y hacen MERGE).
- Devuelve el detalle agregado del crédito. Solo pool-move.

### 6.3 Refactor de `exitInvestor`

Su `for` interno pasa a `const r = await absorberInversionistaEnCube(tx, credito_id, inversionista_id)`
+ acumular `resultados`/`errores`/`totalTransferido`. **Todo lo demás intacto** (validaciones,
`status='inactivo'`, correo, respuesta HTTP). Comportamiento externo idéntico → blindado con tests.

## 7. Movimiento B — la reinversión vía `addInvestorToCredit`

Por cada saliente, una llamada a `addInvestorToCredit` (modo automático):

- `inversionista_id` = saliente
- `monto_aportado` = monto del **espejo** que CUBE le compró (suma de sus créditos absorbidos)
- `tipo_operacion = "reinversion"`
- `porcentaje_inversion / porcentaje_cash_in` = el del **crédito recuperado**
- `fecha_compra = "2026-06-10"` → `compras_credito_inversionista.fecha`
- `tipo_reinversion` = lo resuelve el endpoint (el que ya tiene el inv)

### Único cambio de código al endpoint

Aceptar `fecha_compra?: string` (YYYY-MM-DD) opcional en el schema y pasarlo al insert de
`compras_credito_inversionista` (hoy `investor... addInvestorToCredit.ts` ~L1089), reemplazando el
default `now()` cuando venga. Nada más (no se toca `fecha_inicio_participacion`).

## 8. El script `scripts/cubeCompraReinversion.ts`

1. **Guard de DB:** imprime `inet_server_addr` + counts y **exige confirmar PROD vs DEV/sandbox**
   antes de escribir (por el riesgo de env vivo).
2. **Dry-run** (transacción + ROLLBACK) mostrando el plan A y B por inversionista.
3. **Backup** de filas afectadas (`creditos_inversionistas`, `_espejo`, `creditos.estado_devolucion`,
   `compras_credito_inversionista`) a `cartera._bk_cube_compra_reinv_<fecha>`.
4. **Ejecuta A** (los 9 absorbs vía `cubeCompraCredito`) → `estado_devolucion → NO_APLICA`.
5. **Ejecuta B** (una reinversión por saliente, `fecha_compra=2026-06-10`).
6. Resumen final + total transferido.

## 9. Orden / correctness

- **Aceptar antes que todo:** `registrarCancelacionEspejo` lee el espejo del saliente, que A borra/absorbe
  → el crédito debe estar **aceptado (VERIFICADO + CANCELACION)** antes de correr el script.
- **A antes que B:** primero CUBE absorbe (libera el capital) y recién ahí el saliente reinvierte.
- **Estado tras A → NO_APLICA:** evita que la liquidación re-dispare devolución/`exitInvestor`.
- El refactor de `exitInvestor` no cambia su comportamiento externo.

## 10. Testing

- **Sandbox local:** DB `cartera_sandbox` en el contenedor `cartera-local` (postgres:15, 5433), clon del
  local con 1673 créditos / 2349 espejo. Conexión:
  `postgresql://postgres:localdev123@localhost:5433/cartera_sandbox`. Restore point:
  `pg_dump` custom en `/tmp/cartera_full.dump` (contenedor) y en scratchpad del host.
  **Deshacer** = DROP + CREATE + `pg_restore`. Todo el script se prueba ahí antes de prod.
- **Unit del helper:** SWAP (sin CUBE), MERGE (con CUBE), saliente ausente, múltiples no-CUBE, sync
  padre/espejo, suma de cuotas ≈ cuota del crédito.
- **No-regresión de `exitInvestor`:** mismo comportamiento pre/post refactor.
- **Endpoint:** `addInvestorToCredit` con `fecha_compra` setea `compras_credito_inversionista.fecha`.
- **Integración A→B** en un crédito de prueba del sandbox.

## 11. Fuera de alcance (YAGNI)

- No se expone endpoint HTTP para `cubeCompraCredito` (solo método + script) hasta que se necesite.
- No se cambia el disparo en `aceptarDevolucion` (se mantiene el método batch).
- No se toca `fecha_inicio_participacion` ni la lógica de saldo de reinversión existente.
- Los 6 créditos ya en el módulo (pendientes de aceptar) no entran en este lote; se procesan luego con
  el mismo script una vez aceptados.

## 12. Supuestos / a validar en implementación

- El monto reinvertible por inversionista = suma del `monto_aportado` del **espejo** de sus créditos
  absorbidos (confirmado con el usuario).
- La reinversión automática requiere que CUBE tenga capital disponible en créditos candidatos; tras
  absorber, CUBE tiene saldo de sobra. Validar que `getCreditCandidates` devuelva suficientes créditos
  para cubrir el monto de cada saliente (especialmente Massis Q122.8k y Tonejos Q139.7k).
