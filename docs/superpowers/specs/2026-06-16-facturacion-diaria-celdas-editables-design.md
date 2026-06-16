# Facturación Diaria — Celdas editables tipo Excel (con lock por fila)

**Fecha:** 2026-06-16
**Estado:** Diseño aprobado (pendiente revisión del spec por el usuario)
**Módulo:** `apps/cartera-back` (Elysia/Drizzle) + `apps/carteraFront` (React)

## Objetivo

Que el reporte **Facturación Diaria** se comporte como el Excel "Reuniones diarias":
permitir editar **a mano** los valores por día (cualquier celda, incluidos los
acumulados), con un botón **"Guardar cambios"** (batch, no autosave). El sistema
sigue generando los días automáticamente, pero un día editado a mano queda
**bloqueado** y la regeneración automática lo respeta.

## Decisiones (cerradas con el usuario)

| Tema | Decisión |
|---|---|
| Qué se edita | **Todo libre** — cualquier celda numérica, incluidos totales y acumulados. Sin fórmulas forzadas (se aceptan incoherencias total ≠ suma). |
| Manual vs automático | **Lock por fila** — al guardar, el día queda `bloqueado=true`; `generarSnapshotDiario`, `regenerarSnapshotRango` y el cron #872 lo **saltan**. Desbloquear lo devuelve a automático. |
| Permisos | **Solo ADMIN** edita/bloquea/desbloquea. Ver: ADMIN y CONTA (sin cambio). |
| Auditoría | **Bitácora completa** por celda: usuario, timestamp, columna, valor anterior → nuevo, acción. |
| Enfoque | **A** — extender tabla y endpoints actuales + edición inline en el componente existente. (No grid externo, no overrides celda-por-celda.) |

## Contexto del código actual

- Tabla `cartera.facturacion_snapshot_diario`: 1 fila ancha por día (~68 columnas:
  hojas rubro×producto, totales diarios, acumulados, tendencias, metas, helpers).
  Único por `fecha`. Money = `numeric(18,2)`.
- `controllers/facturacionSnapshot.ts`:
  - `generarSnapshotDiario(fecha)` recomputa TODO el día desde fuentes (desglose,
    pagos, gastos_administrativos, ingresos_carros, pci) y hace upsert.
  - Acumulados = **suma corrida** de las columnas diarias del mes
    (`SUM(columna WHERE fecha>=monthStart AND fecha<hoy) + valor de hoy`).
  - `regenerarSnapshotRango(inicio, fin)` regenera en orden (force).
  - `aplicarManualesEnSnapshotDia`, `aplicarMetaEnSnapshotsMes` = updates quirúrgicos.
- `routers/facturacionSnapshot.ts`: `POST /generar`, `POST /regenerar-rango`,
  `POST /aplicar-manuales-dia`, `POST /aplicar-meta-mes`, `GET /excel`, `GET /`.
  Prefijo `/api/facturacion-snapshot`, `authMiddleware`.
- Cron #872 (`schedule.ts`, 01:00 GT): regenera force los últimos 3 días.
- Front: `components/FacturacionDiaria.tsx` + `services/facturacionDiaria.services.ts`.
  Tabla colapsable por grupos (default solo totales), fila TOTALES, descarga Excel,
  secciones carros/gastos/metas. Ruta `/facturacion-diaria` (ADMIN, CONTA).

## Diseño

### 1. Modelo de datos — migración `drizzle/0014_snapshot_editable_lock.sql` (idempotente)

`facturacion_snapshot_diario` (+3 columnas):
- `bloqueado boolean NOT NULL DEFAULT false`
- `bloqueado_por integer` (id de usuario; sin FK estricta para no acoplar)
- `bloqueado_at timestamp`

Tabla nueva `cartera.facturacion_snapshot_auditoria`:
- `id serial PK`
- `fecha date NOT NULL` — día del snapshot editado
- `columna varchar(100) NOT NULL`
- `valor_anterior text` — representación textual (soporta money, %, int)
- `valor_nuevo text`
- `accion varchar(20) NOT NULL` — `'edit' | 'lock' | 'unlock'`
- `usuario_id integer`
- `created_at timestamp NOT NULL DEFAULT now()`
- Índices: `(fecha)`, `(created_at)`

Schema Drizzle (`database/db/schema.ts`) actualizado a la par. Aplicar a **DEV
Neon** primero, luego prod (correr el SQL a mano, drizzle-kit no se usa).

### 2. Backend — respeto del lock

- `generarSnapshotDiario(fecha)`: al inicio, leer la fila; si existe y
  `bloqueado=true` → **return temprano** `{ success:true, skipped:true,
  reason:'bloqueado' }` sin sobreescribir nada.
- `regenerarSnapshotRango` y el **cron #872** heredan el skip (llaman a
  `generarSnapshotDiario`).
- Invariante clave: el acumulado de un día auto se calcula con la **suma corrida
  de las columnas diarias** de los días previos (incluidos los bloqueados con sus
  valores manuales) → sigue cuadrando sin importar qué esté bloqueado. No requiere
  cambios extra en el cálculo del acumulado.

### 3. Backend — endpoints nuevos

**`PUT /api/facturacion-snapshot/celdas`** — guardar cambios (batch):
- Body: `{ cambios: [{ fecha: "YYYY-MM-DD", valores: { <columna>: <valor>, … } }, …] }`.
  Usuario tomado del auth.
- Pasos (en transacción):
  1. **Gate ADMIN** (rechaza con 403 si no).
  2. Validar columnas contra whitelist `COLUMNAS_EDITABLES` (las ~60 numéricas +
     `semana`; nunca `id/fecha/anio/mes/created_at/updated_at/bloqueado*`).
  3. Validar que cada valor sea numérico.
  4. Por cada día: leer fila actual (valores viejos para auditoría); **upsert** de
     las celdas tocadas + `bloqueado=true, bloqueado_por, bloqueado_at,
     updated_at`. Si la fila no existía → insert (bloqueado).
  5. Escribir **auditoría** por cada celda cambiada (`edit`, viejo→nuevo) + una fila
     `lock` si el día no estaba bloqueado antes.
  6. Tras guardar todos los días: `regenerarSnapshotRango(inicioMesAfectado, hoy)`
     (que salta bloqueados) → refresca los acumulados de los días **no** bloqueados
     del/los mes(es) afectado(s) para mantener la columna continua.
- Respuesta: filas actualizadas + resumen (días bloqueados, celdas cambiadas).

**`POST /api/facturacion-snapshot/desbloquear-dia`** — `{ fecha }`:
- Gate ADMIN. `bloqueado=false`; auditoría `accion='unlock'`; `generarSnapshotDiario(fecha)`
  (vuelve a valores del sistema); `regenerarSnapshotRango(inicioMes, hoy)` para
  refrescar acumulados.

`GET /` (existente) devuelve además `bloqueado`/`bloqueado_por`/`bloqueado_at` por fila.

### 4. Front — edición inline (`FacturacionDiaria.tsx` + services)

- Toggle **"Modo edición"** visible **solo si el usuario es ADMIN** (rol del auth context).
- En modo edición: cada celda numérica → `<input>` controlado; estado de celdas
  **sucias** (resaltadas); validación numérica en blur; funciona en vista colapsada
  (totales) y expandida (hojas por producto).
- Columna 🔒/🔓 por fila: indica si el día es manual. Click en 🔓 sobre un día
  bloqueado → confirma y llama `desbloquear-dia`.
- Botón **"Guardar cambios"** (deshabilitado sin cambios) → arma `PUT /celdas`
  agrupando celdas sucias por día → al éxito invalida React Query, refetch, toast.
- Filas bloqueadas con tinte/badge "manual".
- Service nuevo: `guardarCeldas(cambios)`, `desbloquearDia(fecha)`.

### 5. Casos borde / consistencia

- Día sin fila → insert (bloqueado). No-ADMIN → 403. Columna fuera de whitelist /
  valor no numérico → 400, no se aplica.
- Placeholders futuros (del import Excel): editarlos los bloquea → el cron ya no
  los toca.
- **Incoherencia aceptada (por "todo libre")**: si se edita a mano el *acumulado*
  de un día bloqueado, los días automáticos posteriores calculan su acumulado por
  suma corrida de las **diarias** (no encadenan el acumulado manual). Documentado;
  es el costo de permitir editar todo.
- Concurrencia: last-write-wins; la auditoría deja rastro de ambos cambios.

### 6. Pruebas

- Backend: skip de bloqueados en `generar`/`regenerar`/cron; `PUT /celdas`
  (upsert + auditoría + cascada de acumulados); gate ADMIN; whitelist de columnas;
  `desbloquear-dia` regenera desde el sistema.
- QA manual contra **DEV Neon** (clon de cartera, correos suprimidos) antes de prod.
- Migración: DEV → prod (verificar a qué BD se pega antes de escribir).

### 7. Entrega

- Branch `feat/cartera-snapshot-celdas-editables` (vs `develop`).
- Implementación back + front + migración siguiendo el plan (writing-plans).
- Posible ejecución por agente en background sobre worktree; PR contra `develop`
  con descripción detallada y atención a comentarios de code review.

## Fuera de alcance (YAGNI)

- Grid tipo Excel con navegación por flechas / copy-paste (enfoque C) — futura iteración.
- Overrides celda-por-celda con recálculo parcial (enfoque B) — descartado por lock-por-fila.
- Editar columnas helper (`anio/mes`) o `fecha`.
