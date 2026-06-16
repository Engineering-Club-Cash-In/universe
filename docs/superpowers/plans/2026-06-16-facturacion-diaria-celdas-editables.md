# Facturación Diaria — Celdas editables (lock por fila) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir editar a mano cualquier celda del reporte Facturación Diaria por día (con botón "Guardar cambios"), bloqueando el día editado para que la regeneración automática lo respete, con auditoría completa y solo para ADMIN.

**Architecture:** Se extiende la tabla `facturacion_snapshot_diario` con un flag `bloqueado`; `generarSnapshotDiario` salta los días bloqueados; un endpoint `PUT /celdas` hace upsert de las celdas tocadas + bloquea + audita, y un helper liviano `recomputarAcumuladosMes` refresca solo los acumulados (sin tocar diarias ni leer la fuente, seguro para días históricos del Excel). El front agrega un "Modo edición" inline visible solo a ADMIN.

**Tech Stack:** Bun, Elysia, Drizzle ORM, Postgres, `big.js`, React 19, TanStack Query, axios (`@/Provider/interceptor`), `bun:test`.

**Spec:** `docs/superpowers/specs/2026-06-16-facturacion-diaria-celdas-editables-design.md`

---

## File Structure

- `apps/cartera-back/drizzle/0014_snapshot_editable_lock.sql` — **crear** (migración idempotente)
- `apps/cartera-back/src/database/db/schema.ts` — **modificar** (3 columnas + tabla auditoría)
- `apps/cartera-back/src/controllers/facturacionSnapshot.ts` — **modificar** (helpers puros, lock guard, guardarCeldas, desbloquear, recomputarAcumuladosMes)
- `apps/cartera-back/src/controllers/facturacionSnapshot.test.ts` — **crear** (tests de funciones puras)
- `apps/cartera-back/src/routers/facturacionSnapshot.ts` — **modificar** (2 endpoints + gate ADMIN)
- `apps/carteraFront/src/private/cartera/services/facturacionDiaria.services.ts` — **modificar** (2 services + interface)
- `apps/carteraFront/src/private/cartera/components/FacturacionDiaria.tsx` — **modificar** (modo edición)

---

## Task 1: Migración + schema (lock + auditoría)

**Files:**
- Create: `apps/cartera-back/drizzle/0014_snapshot_editable_lock.sql`
- Modify: `apps/cartera-back/src/database/db/schema.ts` (tras `facturacion_snapshot_diario`, ~línea 1353)

- [ ] **Step 1: Escribir la migración SQL**

Crear `apps/cartera-back/drizzle/0014_snapshot_editable_lock.sql`:

```sql
-- Lock por fila + auditoría para edición manual del snapshot diario.
ALTER TABLE cartera.facturacion_snapshot_diario
  ADD COLUMN IF NOT EXISTS bloqueado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bloqueado_por integer,
  ADD COLUMN IF NOT EXISTS bloqueado_at timestamp;

CREATE TABLE IF NOT EXISTS cartera.facturacion_snapshot_auditoria (
  id serial PRIMARY KEY,
  fecha date NOT NULL,
  columna varchar(100) NOT NULL,
  valor_anterior text,
  valor_nuevo text,
  accion varchar(20) NOT NULL,
  usuario_id integer,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_snapshot_auditoria_fecha
  ON cartera.facturacion_snapshot_auditoria (fecha);
CREATE INDEX IF NOT EXISTS idx_snapshot_auditoria_created
  ON cartera.facturacion_snapshot_auditoria (created_at);
```

- [ ] **Step 2: Actualizar el schema Drizzle — columnas de lock**

En `schema.ts`, dentro de `facturacion_snapshot_diario`, después de `updated_at` (antes del cierre del objeto de columnas, ~línea 1348):

```ts
      bloqueado: boolean("bloqueado").notNull().default(false),
      bloqueado_por: integer("bloqueado_por"),
      bloqueado_at: timestamp("bloqueado_at"),
```

Verificar que `boolean` esté importado de `drizzle-orm/pg-core` al inicio del archivo (si no, agregarlo al import existente).

- [ ] **Step 3: Agregar la tabla de auditoría al schema Drizzle**

En `schema.ts`, justo después del cierre de `facturacion_snapshot_diario` (después de la línea 1353):

```ts
  export const facturacion_snapshot_auditoria = customSchema.table(
    "facturacion_snapshot_auditoria",
    {
      id: serial("id").primaryKey(),
      fecha: date("fecha").notNull(),
      columna: varchar("columna", { length: 100 }).notNull(),
      valor_anterior: text("valor_anterior"),
      valor_nuevo: text("valor_nuevo"),
      accion: varchar("accion", { length: 20 }).notNull(),
      usuario_id: integer("usuario_id"),
      created_at: timestamp("created_at").defaultNow().notNull(),
    }
  );
```

Verificar que `text` y `varchar` estén importados (ya se usan en el archivo).

- [ ] **Step 4: Typecheck del backend**

Run: `cd apps/cartera-back && bun --bun tsc --noEmit 2>&1 | head -20`
Expected: sin errores nuevos en `schema.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/cartera-back/drizzle/0014_snapshot_editable_lock.sql apps/cartera-back/src/database/db/schema.ts
git commit -m "feat(cartera): schema lock + auditoría para snapshot editable"
```

---

## Task 2: Helpers puros — whitelist de columnas y validación

**Files:**
- Modify: `apps/cartera-back/src/controllers/facturacionSnapshot.ts` (agregar exports cerca del tope, tras los imports)
- Test: `apps/cartera-back/src/controllers/facturacionSnapshot.test.ts` (crear)

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/cartera-back/src/controllers/facturacionSnapshot.test.ts`:

```ts
import { describe, expect, it, mock } from "bun:test";

// El controller importa ../database; lo mockeamos para poder importar los helpers puros.
mock.module("../database", () => ({ db: {} }));

const { esColumnaEditable, validarValores } = await import("./facturacionSnapshot");

describe("esColumnaEditable", () => {
  it("acepta columnas de valor", () => {
    expect(esColumnaEditable("capital_total")).toBe(true);
    expect(esColumnaEditable("facturacion_acumulado")).toBe(true);
    expect(esColumnaEditable("roy_hipotecario")).toBe(true);
  });
  it("rechaza columnas no editables", () => {
    expect(esColumnaEditable("id")).toBe(false);
    expect(esColumnaEditable("fecha")).toBe(false);
    expect(esColumnaEditable("anio")).toBe(false);
    expect(esColumnaEditable("bloqueado")).toBe(false);
    expect(esColumnaEditable("columna_inventada")).toBe(false);
  });
});

describe("validarValores", () => {
  it("ok con columnas válidas y números", () => {
    const r = validarValores({ capital_total: "100.50", facturacion: "0" });
    expect(r.ok).toBe(true);
    expect(r.invalidas).toEqual([]);
  });
  it("marca columna no editable", () => {
    const r = validarValores({ fecha: "2026-06-10" });
    expect(r.ok).toBe(false);
    expect(r.invalidas).toContain("fecha");
  });
  it("marca valor no numérico", () => {
    const r = validarValores({ capital_total: "abc" });
    expect(r.ok).toBe(false);
    expect(r.invalidas).toContain("capital_total");
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd apps/cartera-back && bun test src/controllers/facturacionSnapshot.test.ts 2>&1 | head -30`
Expected: FAIL — `esColumnaEditable is not a function` (aún no existe).

- [ ] **Step 3: Implementar los helpers**

En `facturacionSnapshot.ts`, tras los imports (antes de la primera función exportada), agregar:

```ts
// ── Edición manual: whitelist de columnas editables + validación ──────────────
export const COLUMNAS_EDITABLES: ReadonlySet<string> = new Set([
  // Capital
  "cap_autocompras","cap_sobre_vehiculo","nuevo_cap_autocompras","cap_hipotecario","cap_extra_financiamiento","cap_reestructura","capital_total",
  // Interés
  "int_autocompras","int_sobre_vehiculo","nuevo_int_autocompras","int_hipotecario","int_extra_financiamiento","int_reestructura","interes_cube",
  // Membresía
  "mem_autocompras","mem_sobre_vehiculo","nuevo_mem_autocompras","mem_hipotecario","mem_extra_financiamiento","mem_reestructura","membresia",
  // Otros ingresos
  "oi_autocompras","oi_sobre_vehiculo","nuevo_oi_autocompras","oi_hipotecario","oi_extra_financiamiento","oi_reestructura","otros_ingresos","administrativos","otros_cobros",
  // Mora
  "mora_autocompras","mora_sobre_vehiculo","nuevo_mora_autocompras","mora_hipotecario","mora_extra_financiamiento","mora_reestructura","mora_cube",
  // Royalty
  "roy_autocompras","roy_sobre_vehiculo","nuevo_roy_autocompras","roy_hipotecario","roy_extra_financiamiento","roy_reestructura","royalty",
  // Totales / acumulados / servicios
  "facturacion","facturacion_acumulado","servicios_seguro_gps","acum_servicios_seguro_gps","facturacion_mas_servicios","acumulado_total","facturacion_inversionistas","acumulado_inversionistas","tendencia_fin_mes","tendencia_semanal","ingreso_carros","reserva_acumulada","semana",
  // Metas
  "meta_facturacion_mensual","meta_facturacion_semanal","meta_facturacion_diaria","porcentaje_meta_mensual","meta_diaria",
]);

export function esColumnaEditable(col: string): boolean {
  return COLUMNAS_EDITABLES.has(col);
}

export function validarValores(valores: Record<string, unknown>): {
  ok: boolean;
  invalidas: string[];
} {
  const invalidas: string[] = [];
  for (const [col, val] of Object.entries(valores)) {
    if (!esColumnaEditable(col)) {
      invalidas.push(col);
      continue;
    }
    const n = Number(val);
    if (val === null || val === "" || Number.isNaN(n) || !Number.isFinite(n)) {
      invalidas.push(col);
    }
  }
  return { ok: invalidas.length === 0, invalidas };
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd apps/cartera-back && bun test src/controllers/facturacionSnapshot.test.ts 2>&1 | head -30`
Expected: PASS (3 describe, todos verdes).

- [ ] **Step 5: Commit**

```bash
git add apps/cartera-back/src/controllers/facturacionSnapshot.ts apps/cartera-back/src/controllers/facturacionSnapshot.test.ts
git commit -m "feat(cartera): whitelist + validación de columnas editables del snapshot"
```

---

## Task 3: Suma corrida pura + `recomputarAcumuladosMes`

**Files:**
- Modify: `apps/cartera-back/src/controllers/facturacionSnapshot.ts`
- Test: `apps/cartera-back/src/controllers/facturacionSnapshot.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Agregar a `facturacionSnapshot.test.ts`:

```ts
const { calcularAcumuladosCorridos } = await import("./facturacionSnapshot");

describe("calcularAcumuladosCorridos", () => {
  it("suma corrida e ignora bloqueados para escribir, pero incluye sus diarias", () => {
    const dias = [
      { fecha: "2026-06-01", bloqueado: false, facturacion: "100", servicios_seguro_gps: "10", facturacion_inversionistas: "5", ingreso_carros: "0" },
      { fecha: "2026-06-02", bloqueado: true,  facturacion: "200", servicios_seguro_gps: "20", facturacion_inversionistas: "5", ingreso_carros: "0" },
      { fecha: "2026-06-03", bloqueado: false, facturacion: "300", servicios_seguro_gps: "30", facturacion_inversionistas: "5", ingreso_carros: "1" },
    ];
    const r = calcularAcumuladosCorridos(dias);
    // El día 2 (bloqueado) NO genera update.
    expect(r.map((u) => u.fecha)).toEqual(["2026-06-01", "2026-06-03"]);
    // Día 1: fact_acum=100
    expect(r[0].facturacion_acumulado).toBe("100.00");
    // Día 3: incluye el día 2 bloqueado → 100+200+300 = 600
    expect(r[1].facturacion_acumulado).toBe("600.00");
    expect(r[1].acum_servicios_seguro_gps).toBe("60.00");
    expect(r[1].acumulado_inversionistas).toBe("15.00");
    // acumulado_total = fact_acum + serv_acum + carros_acum = 600+60+1 = 661
    expect(r[1].acumulado_total).toBe("661.00");
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd apps/cartera-back && bun test src/controllers/facturacionSnapshot.test.ts 2>&1 | head -30`
Expected: FAIL — `calcularAcumuladosCorridos is not a function`.

- [ ] **Step 3: Implementar la función pura**

En `facturacionSnapshot.ts` (cerca de los otros helpers). Asume que `Big` ya está importado (lo usa todo el controller):

```ts
export type DiaAcumulable = {
  fecha: string;
  bloqueado: boolean;
  facturacion: string | number;
  servicios_seguro_gps: string | number;
  facturacion_inversionistas: string | number;
  ingreso_carros: string | number;
};

export type UpdateAcumulado = {
  fecha: string;
  facturacion_acumulado: string;
  acum_servicios_seguro_gps: string;
  acumulado_inversionistas: string;
  acumulado_total: string;
};

// Suma corrida sobre días YA ordenados por fecha. Acumula TODAS las diarias
// (incluidas las de días bloqueados) pero solo emite update para los NO bloqueados.
// No toca reserva_acumulada (es MTD desde pagos, sin columna diaria).
export function calcularAcumuladosCorridos(
  dias: DiaAcumulable[]
): UpdateAcumulado[] {
  let accFact = new Big(0);
  let accServ = new Big(0);
  let accInv = new Big(0);
  let accCarros = new Big(0);
  const updates: UpdateAcumulado[] = [];
  for (const d of dias) {
    accFact = accFact.plus(new Big(d.facturacion || 0));
    accServ = accServ.plus(new Big(d.servicios_seguro_gps || 0));
    accInv = accInv.plus(new Big(d.facturacion_inversionistas || 0));
    accCarros = accCarros.plus(new Big(d.ingreso_carros || 0));
    if (!d.bloqueado) {
      updates.push({
        fecha: d.fecha,
        facturacion_acumulado: accFact.toFixed(2),
        acum_servicios_seguro_gps: accServ.toFixed(2),
        acumulado_inversionistas: accInv.toFixed(2),
        acumulado_total: accFact.plus(accServ).plus(accCarros).toFixed(2),
      });
    }
  }
  return updates;
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd apps/cartera-back && bun test src/controllers/facturacionSnapshot.test.ts 2>&1 | head -30`
Expected: PASS.

- [ ] **Step 5: Implementar `recomputarAcumuladosMes` (wrapper con DB)**

En `facturacionSnapshot.ts` agregar (usa `db`, `sql` ya importados):

```ts
// Refresca SOLO las columnas de acumulado de los días no bloqueados del mes,
// usando la suma corrida de las diarias guardadas. No lee la fuente ni toca
// diarias → seguro para días históricos importados del Excel.
export async function recomputarAcumuladosMes(anio: number, mes: number) {
  const inicio = `${anio}-${String(mes).padStart(2, "0")}-01`;
  const res = await db.execute(sql`
    SELECT fecha::text AS fecha, bloqueado,
           facturacion, servicios_seguro_gps, facturacion_inversionistas, ingreso_carros
    FROM cartera.facturacion_snapshot_diario
    WHERE anio = ${anio} AND mes = ${mes}
    ORDER BY fecha
  `);
  const dias = ((res as any).rows ?? res) as DiaAcumulable[];
  const updates = calcularAcumuladosCorridos(dias);
  for (const u of updates) {
    await db.execute(sql`
      UPDATE cartera.facturacion_snapshot_diario SET
        facturacion_acumulado = ${u.facturacion_acumulado},
        acum_servicios_seguro_gps = ${u.acum_servicios_seguro_gps},
        acumulado_inversionistas = ${u.acumulado_inversionistas},
        acumulado_total = ${u.acumulado_total},
        updated_at = now()
      WHERE fecha = ${u.fecha}::date
    `);
  }
  return { success: true, dias_actualizados: updates.length };
}
```

- [ ] **Step 6: Typecheck + commit**

Run: `cd apps/cartera-back && bun --bun tsc --noEmit 2>&1 | head -20`
Expected: sin errores nuevos.

```bash
git add apps/cartera-back/src/controllers/facturacionSnapshot.ts apps/cartera-back/src/controllers/facturacionSnapshot.test.ts
git commit -m "feat(cartera): suma corrida pura + recomputarAcumuladosMes (no pisa histórico)"
```

---

## Task 4: Lock guard en `generarSnapshotDiario`

**Files:**
- Modify: `apps/cartera-back/src/controllers/facturacionSnapshot.ts` (inicio de `generarSnapshotDiario`)

- [ ] **Step 1: Leer el inicio de `generarSnapshotDiario`**

Run: `cd apps/cartera-back && grep -n "export async function generarSnapshotDiario" src/controllers/facturacionSnapshot.ts`
Abrir ~15 líneas tras esa firma para ver dónde se calcula `monthStart`/`fecha`.

- [ ] **Step 2: Insertar el guard al inicio de la función**

Inmediatamente después de la línea de apertura `export async function generarSnapshotDiario(fecha: string) {`, agregar:

```ts
  // Si el día está bloqueado (editado a mano), NO se sobreescribe.
  const lockRes = await db.execute(sql`
    SELECT bloqueado FROM cartera.facturacion_snapshot_diario
    WHERE fecha = ${fecha}::date
  `);
  const lockRow = ((lockRes as any).rows ?? lockRes)[0];
  if (lockRow?.bloqueado === true) {
    return { success: true, skipped: true, reason: "bloqueado", fecha };
  }
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/cartera-back && bun --bun tsc --noEmit 2>&1 | head -20`
Expected: sin errores nuevos.

- [ ] **Step 4: Commit**

```bash
git add apps/cartera-back/src/controllers/facturacionSnapshot.ts
git commit -m "feat(cartera): generarSnapshotDiario respeta días bloqueados"
```

---

## Task 5: Controladores `guardarCeldasSnapshot` y `desbloquearDiaSnapshot`

**Files:**
- Modify: `apps/cartera-back/src/controllers/facturacionSnapshot.ts`

- [ ] **Step 1: Implementar `guardarCeldasSnapshot`**

Agregar al final de `facturacionSnapshot.ts`:

```ts
type CambioDia = { fecha: string; valores: Record<string, unknown> };

// Guarda (upsert) las celdas tocadas por día, bloquea el día, audita cada cambio
// y refresca los acumulados de los meses afectados. Solo columnas del whitelist.
export async function guardarCeldasSnapshot(input: {
  cambios: CambioDia[];
  usuarioId: number | null;
}) {
  const { cambios, usuarioId } = input;
  if (!Array.isArray(cambios) || cambios.length === 0) {
    return { success: false, message: "Sin cambios" };
  }
  // Validar todo antes de escribir.
  for (const c of cambios) {
    const v = validarValores(c.valores);
    if (!v.ok) {
      return { success: false, message: `Columnas inválidas en ${c.fecha}`, invalidas: v.invalidas };
    }
  }

  const mesesAfectados = new Set<string>();

  await db.transaction(async (tx) => {
    for (const c of cambios) {
      const [y, m] = c.fecha.split("-");
      const anio = Number(y);
      const mes = Number(m);
      mesesAfectados.add(`${anio}-${mes}`);

      // Fila actual (para valores viejos + saber si ya estaba bloqueado).
      const prevRes = await tx.execute(sql`
        SELECT * FROM cartera.facturacion_snapshot_diario WHERE fecha = ${c.fecha}::date
      `);
      const prev = ((prevRes as any).rows ?? prevRes)[0] ?? null;

      const cols = Object.keys(c.valores);
      // SET dinámico de las columnas tocadas. Usamos sql.raw para el nombre de
      // columna (ya validado contra el whitelist) y bind del valor.
      const sets = cols.map(
        (col) => sql`${sql.raw(col)} = ${String(c.valores[col])}`
      );

      if (prev) {
        await tx.execute(sql`
          UPDATE cartera.facturacion_snapshot_diario
          SET ${sql.join(sets, sql`, `)},
              bloqueado = true, bloqueado_por = ${usuarioId}, bloqueado_at = now(), updated_at = now()
          WHERE fecha = ${c.fecha}::date
        `);
      } else {
        // Insert mínimo: fecha + anio + mes + columnas tocadas + lock.
        const insertCols = ["fecha", "anio", "mes", ...cols, "bloqueado", "bloqueado_por", "bloqueado_at"];
        const insertVals = [
          sql`${c.fecha}::date`, sql`${anio}`, sql`${mes}`,
          ...cols.map((col) => sql`${String(c.valores[col])}`),
          sql`true`, sql`${usuarioId}`, sql`now()`,
        ];
        await tx.execute(sql`
          INSERT INTO cartera.facturacion_snapshot_diario (${sql.join(insertCols.map((x) => sql.raw(x)), sql`, `)})
          VALUES (${sql.join(insertVals, sql`, `)})
        `);
      }

      // Auditoría por celda.
      for (const col of cols) {
        const anterior = prev ? (prev[col] ?? null) : null;
        await tx.execute(sql`
          INSERT INTO cartera.facturacion_snapshot_auditoria (fecha, columna, valor_anterior, valor_nuevo, accion, usuario_id)
          VALUES (${c.fecha}::date, ${col}, ${anterior === null ? null : String(anterior)}, ${String(c.valores[col])}, 'edit', ${usuarioId})
        `);
      }
      // Auditoría de lock si no estaba bloqueado.
      if (!prev || prev.bloqueado !== true) {
        await tx.execute(sql`
          INSERT INTO cartera.facturacion_snapshot_auditoria (fecha, columna, valor_anterior, valor_nuevo, accion, usuario_id)
          VALUES (${c.fecha}::date, '*', NULL, NULL, 'lock', ${usuarioId})
        `);
      }
    }
  });

  // Refrescar acumulados de cada mes afectado (fuera de la transacción de escritura
  // de celdas; recomputarAcumuladosMes hace sus propios updates).
  for (const k of mesesAfectados) {
    const [anio, mes] = k.split("-").map(Number);
    await recomputarAcumuladosMes(anio, mes);
  }

  return { success: true, dias: cambios.length, meses: mesesAfectados.size };
}
```

- [ ] **Step 2: Implementar `desbloquearDiaSnapshot`**

Agregar a continuación:

```ts
export async function desbloquearDiaSnapshot(fecha: string, usuarioId: number | null) {
  const [y, m] = fecha.split("-");
  const anio = Number(y);
  const mes = Number(m);
  await db.execute(sql`
    UPDATE cartera.facturacion_snapshot_diario
    SET bloqueado = false, bloqueado_por = ${usuarioId}, bloqueado_at = now(), updated_at = now()
    WHERE fecha = ${fecha}::date
  `);
  await db.execute(sql`
    INSERT INTO cartera.facturacion_snapshot_auditoria (fecha, columna, valor_anterior, valor_nuevo, accion, usuario_id)
    VALUES (${fecha}::date, '*', NULL, NULL, 'unlock', ${usuarioId})
  `);
  // Vuelve a valores del sistema y refresca acumulados.
  await generarSnapshotDiario(fecha);
  await recomputarAcumuladosMes(anio, mes);
  return { success: true, fecha };
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/cartera-back && bun --bun tsc --noEmit 2>&1 | head -20`
Expected: sin errores nuevos. (Si `sql.join`/`sql.raw` no existieran en la versión de drizzle, ver nota al pie — pero drizzle-orm los expone.)

- [ ] **Step 4: Commit**

```bash
git add apps/cartera-back/src/controllers/facturacionSnapshot.ts
git commit -m "feat(cartera): guardarCeldas + desbloquearDia (upsert, lock, auditoría)"
```

---

## Task 6: Endpoints router (PUT /celdas, POST /desbloquear-dia, gate ADMIN)

**Files:**
- Modify: `apps/cartera-back/src/routers/facturacionSnapshot.ts`

- [ ] **Step 1: Importar los nuevos controladores**

En el `import { ... } from "../controllers/facturacionSnapshot"` agregar:
`guardarCeldasSnapshot,` y `desbloquearDiaSnapshot,`.

- [ ] **Step 2: Agregar el endpoint `PUT /celdas` (antes del `GET /`)**

```ts
  // PUT - Guardar celdas editadas a mano (batch). Bloquea los días tocados. Solo ADMIN.
  .put(
    "/celdas",
    async ({ body, user, set }: any) => {
      if (user?.role !== "ADMIN") {
        set.status = 403;
        return { success: false, message: "Solo ADMIN puede editar el reporte" };
      }
      try {
        const result = await guardarCeldasSnapshot({
          cambios: body.cambios,
          usuarioId: user?.id ?? null,
        });
        if (!result.success) set.status = 400;
        return result;
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Error guardando celdas", error: String(error) };
      }
    },
    {
      body: t.Object({
        cambios: t.Array(
          t.Object({
            fecha: t.String(),
            valores: t.Record(t.String(), t.Union([t.String(), t.Number()])),
          })
        ),
      }),
    }
  )

  // POST - Desbloquear un día (vuelve a automático). Solo ADMIN.
  .post(
    "/desbloquear-dia",
    async ({ body, user, set }: any) => {
      if (user?.role !== "ADMIN") {
        set.status = 403;
        return { success: false, message: "Solo ADMIN puede desbloquear" };
      }
      try {
        return await desbloquearDiaSnapshot(body.fecha, user?.id ?? null);
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Error desbloqueando el día", error: String(error) };
      }
    },
    { body: t.Object({ fecha: t.String() }) }
  )
```

Nota: `user` viene del `authMiddleware` (`app.derive` → `{ user: decoded }`); el payload JWT trae `role` e `id` (mismo patrón que `payments.ts:1473`).

- [ ] **Step 3: Typecheck**

Run: `cd apps/cartera-back && bun --bun tsc --noEmit 2>&1 | head -20`
Expected: sin errores nuevos.

- [ ] **Step 4: Smoke test del server (arranca sin romper)**

Run: `cd apps/cartera-back && timeout 12 bun run src/index.ts 2>&1 | head -20`
Expected: el server levanta (mensaje de arranque), sin error de rutas.

- [ ] **Step 5: Commit**

```bash
git add apps/cartera-back/src/routers/facturacionSnapshot.ts
git commit -m "feat(cartera): endpoints PUT /celdas y POST /desbloquear-dia (gate ADMIN)"
```

---

## Task 7: Front — services

**Files:**
- Modify: `apps/carteraFront/src/private/cartera/services/facturacionDiaria.services.ts`

- [ ] **Step 1: Agregar `bloqueado` a la interface `SnapshotDiario`**

En la interface `SnapshotDiario` (línea ~6) agregar campos opcionales:

```ts
  bloqueado?: boolean;
  bloqueado_por?: number | null;
  bloqueado_at?: string | null;
```

- [ ] **Step 2: Agregar los services**

Al final del archivo:

```ts
export const guardarCeldasSnapshot = async (
  cambios: { fecha: string; valores: Record<string, string | number> }[]
) => {
  const { data } = await api.put(`${API_URL}/api/facturacion-snapshot/celdas`, {
    cambios,
  });
  return data;
};

export const desbloquearDiaSnapshot = async (fecha: string) => {
  const { data } = await api.post(
    `${API_URL}/api/facturacion-snapshot/desbloquear-dia`,
    { fecha }
  );
  return data;
};
```

- [ ] **Step 3: Typecheck del front**

Run: `cd apps/carteraFront && bunx tsc --noEmit 2>&1 | head -20`
Expected: sin errores nuevos en el services.

- [ ] **Step 4: Commit**

```bash
git add apps/carteraFront/src/private/cartera/services/facturacionDiaria.services.ts
git commit -m "feat(cartera-front): services guardarCeldas + desbloquearDia"
```

---

## Task 8: Front — modo edición inline en `FacturacionDiaria.tsx`

**Files:**
- Modify: `apps/carteraFront/src/private/cartera/components/FacturacionDiaria.tsx`

- [ ] **Step 1: Imports y rol**

Al inicio del componente `FacturacionDiaria`, agregar imports y leer el rol:

```ts
// imports (arriba del archivo)
import { useAuth } from "@/Provider/authProvider";
import { guardarCeldasSnapshot, desbloquearDiaSnapshot } from "../services/facturacionDiaria.services";
```

Dentro del componente (junto a `const qc = useQueryClient();`):

```ts
  const { user } = useAuth();
  const esAdmin = user?.role === "ADMIN";
  const [modoEdicion, setModoEdicion] = useState(false);
  // edits: { [fechaISO]: { [columna]: string } }
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const hayCambios = Object.values(edits).some((c) => Object.keys(c).length > 0);
```

- [ ] **Step 2: Helpers de edición + mutaciones**

Dentro del componente:

```ts
  const setCell = (fecha: string, columna: string, valor: string) =>
    setEdits((e) => ({ ...e, [fecha]: { ...(e[fecha] || {}), [columna]: valor } }));

  const guardarMut = useMutation({
    mutationFn: async () => {
      const cambios = Object.entries(edits)
        .filter(([, v]) => Object.keys(v).length > 0)
        .map(([fecha, valores]) => ({ fecha, valores }));
      return guardarCeldasSnapshot(cambios);
    },
    onSuccess: () => {
      setEdits({});
      setModoEdicion(false);
      qc.invalidateQueries({ queryKey: ["facturacion-snapshot"] });
    },
  });

  const desbloquearMut = useMutation({
    mutationFn: (fecha: string) => desbloquearDiaSnapshot(fecha),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["facturacion-snapshot"] }),
  });
```

Nota: confirmar el `queryKey` real de la query de snapshots en este archivo (buscar `useQuery({ queryKey:`). Usar exactamente ese key en `invalidateQueries`.

- [ ] **Step 3: Botones de barra (toggle + guardar) — solo ADMIN**

En la barra de acciones (junto al botón de descargar Excel, ~línea 175-220), agregar:

```tsx
{esAdmin && (
  <div className="flex items-center gap-2">
    <button
      onClick={() => { setModoEdicion((m) => !m); setEdits({}); }}
      className="px-3 py-2 text-sm rounded bg-blue-100 text-blue-800 font-semibold"
    >
      {modoEdicion ? "Cancelar edición" : "Modo edición"}
    </button>
    {modoEdicion && (
      <button
        disabled={!hayCambios || guardarMut.isPending}
        onClick={() => guardarMut.mutate()}
        className="px-3 py-2 text-sm rounded bg-green-600 text-white font-semibold disabled:opacity-50"
      >
        {guardarMut.isPending ? "Guardando…" : "Guardar cambios"}
      </button>
    )}
  </div>
)}
```

- [ ] **Step 4: Celda editable**

Localizar el render de cada celda de valor (donde se usa `fmt(row[col.k])`, ~líneas 240-300). Reemplazar el contenido de la celda por:

```tsx
{modoEdicion && esAdmin ? (
  <input
    type="number"
    step="0.01"
    defaultValue={edits[row.fecha]?.[col.k] ?? row[col.k] ?? ""}
    onChange={(e) => setCell(row.fecha, col.k, e.target.value)}
    className={`w-24 text-right border rounded px-1 py-0.5 text-xs ${
      edits[row.fecha]?.[col.k] !== undefined ? "bg-yellow-50 border-yellow-400" : "border-gray-200"
    }`}
  />
) : (
  fmt(row[col.k])
)}
```

(Aplica el mismo patrón tanto a la celda de `total` como a las de `detalle` de cada grupo.)

- [ ] **Step 5: Indicador de fila bloqueada + desbloquear**

En la celda de `Fecha` de cada fila, agregar junto a la fecha:

```tsx
{row.bloqueado && (
  <button
    title="Día manual (bloqueado). Click para desbloquear y volver a automático."
    onClick={() => {
      if (window.confirm(`¿Desbloquear ${row.fecha}? Volverá a calcularse desde el sistema (días históricos previos al 2026-06-10 pueden quedar en 0).`))
        desbloquearMut.mutate(row.fecha);
    }}
    className="ml-2 text-amber-600"
  >🔒</button>
)}
```

- [ ] **Step 6: Typecheck + build del front**

Run: `cd apps/carteraFront && bunx tsc --noEmit 2>&1 | head -30`
Expected: sin errores nuevos.

- [ ] **Step 7: Commit**

```bash
git add apps/carteraFront/src/private/cartera/components/FacturacionDiaria.tsx
git commit -m "feat(cartera-front): modo edición inline + lock/unlock en Facturación Diaria"
```

---

## Task 9: Aplicar migración + QA manual (DEV → prod)

**Files:** ninguno (operación).

- [ ] **Step 1: Aplicar la migración 0014 a DEV Neon**

Script bun en `apps/cartera-back/` que conecta a la URL DEV Neon (la del `.env`, `neondb`), verifica que NO es prod (`current_database()='neondb'`), y corre el SQL de `drizzle/0014_snapshot_editable_lock.sql`. Verificar columnas creadas (`\d` equivalente vía information_schema).

- [ ] **Step 2: QA funcional en DEV**

Levantar el back contra DEV. Probar con un token ADMIN: `PUT /api/facturacion-snapshot/celdas` con un día → verificar `bloqueado=true`, fila de auditoría `edit`+`lock`, y que `generarSnapshotDiario` de ese día responde `skipped:true`. Editar día intermedio y verificar que los acumulados de días posteriores no bloqueados se refrescan. Probar `desbloquear-dia` → `unlock` en auditoría + recalculado. Probar token no-ADMIN → 403.

- [ ] **Step 3: Aplicar la migración 0014 a PROD**

Mismo script, apuntando al pooler Supabase 5432 (verificar `count(creditos)>1000` antes). Idempotente.

- [ ] **Step 4: PR contra develop**

```bash
git push -u origin feat/cartera-snapshot-celdas-editables
gh pr create --base develop --title "feat(cartera): celdas editables del reporte Facturación Diaria (lock por fila + auditoría)" --body-file <descripción detallada>
```

Atender comentarios de code review (Codex/reviewers) en el hilo del PR.

---

## Self-Review (del autor del plan)

- **Cobertura del spec:** datos (T1) ✓, lock guard (T4) ✓, PUT/celdas + desbloquear (T5/T6) ✓, recompute liviano sin pisar histórico (T3) ✓, front edición + lock/unlock + gate ADMIN (T7/T8) ✓, auditoría (T5) ✓, permisos ADMIN (T6/T8) ✓, pruebas (T2/T3 unit + T9 manual) ✓, caveat desbloqueo histórico (T8 step 5 confirm) ✓.
- **Consistencia de tipos:** `calcularAcumuladosCorridos`/`DiaAcumulable`/`UpdateAcumulado` usados igual en T3 y `recomputarAcumuladosMes`. `guardarCeldasSnapshot({cambios, usuarioId})` igual en T5 y T6. `esColumnaEditable`/`validarValores` igual en T2 y T5.
- **Riesgo a vigilar:** `sql.raw` para nombres de columna — seguro porque las columnas pasan por `validarValores` (whitelist) antes de construir el SQL; nunca viene texto libre del usuario a `sql.raw`.
