# CUBE compra (devolución) + reinversión del saliente — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que CUBE absorba los créditos de carros recuperados (sin inactivar al inversionista) y que el saliente reinvierta ese capital vía `addInvestorToCredit`, con la compra fechada 2026-06-10.

**Architecture:** Se extrae el bloque per-crédito de `exitInvestor` a un helper puro y transaccional (`absorberInversionistaEnCube`); `exitInvestor` pasa a consumirlo. Un método batch `cubeCompraCredito` absorbe a todos los no-CUBE de un crédito. Un script orquestador corre A (absorber) → B (reinversión) contra la DB, probándose primero en el sandbox local.

**Tech Stack:** TypeScript, Bun (runtime + `bun test`), Drizzle ORM, Big.js, Elysia, Postgres 15 (Docker `cartera-local`).

## Global Constraints

- `CUBE_INVESTMENT_ID = 86` (constante ya usada en el repo; no redefinir un valor distinto).
- CUBE siempre queda **CUBE-puro**: `porcentaje_cash_in="100"`, `porcentaje_participacion_inversionista="0"`.
- Montos monetarios SIEMPRE con **Big.js** (nunca floats). `monto_aportado` se persiste con `.toFixed(8)`; cuotas/derivados con `.toFixed(2)`.
- Runner de tests: `bun test` (imports desde `"bun:test"`). Tests unitarios mockean `../database` con `mock.module`.
- La rama de trabajo es `feat/cartera-abonos-cancelacion-devolucion` en el checkout **primario** `/Users/juandiegoalvarado/Documents/universe`.
- **NUNCA correr el script contra PROD** hasta validación explícita. Toda prueba va al sandbox `postgresql://postgres:localdev123@localhost:5433/cartera_sandbox`.
- Reset del sandbox (deshacer):
  ```bash
  docker exec -e PGPASSWORD=localdev123 cartera-local psql -U postgres -d postgres \
    -c "DROP DATABASE IF EXISTS cartera_sandbox WITH (FORCE);" -c "CREATE DATABASE cartera_sandbox;"
  docker exec -e PGPASSWORD=localdev123 cartera-local pg_restore -U postgres --no-owner --no-privileges \
    -d cartera_sandbox /tmp/cartera_full.dump
  ```
- Spec de referencia: `apps/cartera-back/docs/2026-07-08-cube-compra-reinversion-devolucion-design.md`.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/controllers/absorberEnCube.ts` (nuevo) | `calcDerivadosCubePuro`, `absorberInversionistaEnCube(tx, creditoId, invId, logger?)`, `cubeCompraCredito(tx, creditoId, logger?)` |
| `src/controllers/investor.ts` (modificar) | `exitInvestor` consume el helper; se elimina el bloque per-crédito duplicado |
| `src/controllers/addInvestorToCredit.ts` (modificar) | Nuevo param `fecha_compra?`; se usa en el insert de `compras_credito_inversionista` |
| `src/controllers/absorberEnCube.test.ts` (nuevo) | Unit de `calcDerivadosCubePuro` + integración sandbox de SWAP/MERGE/batch |
| `src/controllers/addInvestorToCredit.test.ts` (nuevo) | Unit del `fecha_compra` en el insert |
| `src/scripts/cubeCompraReinversion.ts` (nuevo) | Orquestador A→B con guard/dry-run/backup |

---

## Task 1: Param `fecha_compra` en `addInvestorToCredit`

Cambio pequeño e independiente: permitir que el registro de `compras_credito_inversionista` use una fecha explícita (2026-06-10) en vez de `now()`.

**Files:**
- Modify: `src/controllers/addInvestorToCredit.ts` (schema ~L62-100; desestructuración ~L329-340; insert ~L1089-1101)
- Test: `src/controllers/addInvestorToCredit.test.ts` (crear)

**Interfaces:**
- Produces: el endpoint `addInvestorToCredit` acepta `fecha_compra?: string` (YYYY-MM-DD). Cuando viene, `compras_credito_inversionista.fecha = new Date(fecha_compra + "T12:00:00")`.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/controllers/addInvestorToCredit.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { resolverFechaCompra } from "./addInvestorToCredit";

describe("resolverFechaCompra", () => {
  it("usa la fecha explícita al mediodía (evita corrimiento de TZ)", () => {
    const d = resolverFechaCompra("2026-06-10");
    expect(d.toISOString().slice(0, 10)).toBe("2026-06-10");
  });

  it("devuelve undefined cuando no viene fecha (deja el default now())", () => {
    expect(resolverFechaCompra(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd apps/cartera-back && bun test src/controllers/addInvestorToCredit.test.ts`
Expected: FAIL — `resolverFechaCompra` no existe (import error).

- [ ] **Step 3: Implementar `resolverFechaCompra` + cablearlo**

En `src/controllers/addInvestorToCredit.ts`:

3a. Agregar el campo al schema (junto a los demás, ~L83):

```typescript
  // Fecha explícita para el registro en compras_credito_inversionista.fecha
  // (NO afecta fecha_inicio_participacion). YYYY-MM-DD.
  fecha_compra: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
```

3b. Exportar el helper puro (arriba del handler, después de los imports):

```typescript
// Convierte "YYYY-MM-DD" a un Date al mediodía local para evitar que el
// almacenamiento en timestamptz corra el día. undefined => usar default now().
export function resolverFechaCompra(fecha?: string): Date | undefined {
  if (!fecha) return undefined;
  return new Date(`${fecha}T12:00:00`);
}
```

3c. Desestructurar `fecha_compra` (~L329-340, junto a `manual`):

```typescript
      minimo,
      manual,
      fecha_compra,
```

3d. Calcular una vez antes del loop de créditos y usarlo en el insert (~L1089):

```typescript
    const fechaCompraResuelta = resolverFechaCompra(fecha_compra);
```

Y en el `.values({...})` de `compras_credito_inversionista` (~L1089), agregar:

```typescript
        await tx.insert(compras_credito_inversionista).values({
          credito_id,
          inversionista_id,
          monto_aportado: montoParaEsteCredito.toString(),
          tipo_operacion,
          tipo_reinversion:
            tipo_reinversion ??
            tipoReinvActualPorInv.get(inversionista_id) ??
            null,
          status: statusEspejo,
          ...(fechaCompraResuelta ? { fecha: fechaCompraResuelta } : {}),
        });
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `cd apps/cartera-back && bun test src/controllers/addInvestorToCredit.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cartera-back/src/controllers/addInvestorToCredit.ts apps/cartera-back/src/controllers/addInvestorToCredit.test.ts
git commit -m "feat(cartera): addInvestorToCredit acepta fecha_compra para compras_credito_inversionista.fecha

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Extraer `calcDerivadosCubePuro` como función pura exportada

Es la fórmula que deriva cuota + montos + IVAs de un row CUBE-puro. Hoy es un closure dentro de `exitInvestor` (~L5485-5507). Extraerla la hace testeable y reutilizable por el helper.

**Files:**
- Create: `src/controllers/absorberEnCube.ts`
- Modify: `src/controllers/investor.ts` (~L5485-5507: reemplazar el closure por una llamada al import)
- Test: `src/controllers/absorberEnCube.test.ts` (crear)

**Interfaces:**
- Produces:
  ```typescript
  function calcDerivadosCubePuro(montoAportado: Big, porcentajeInteres: string | number): {
    cuota_inversionista: string; monto_inversionista: string; monto_cash_in: string;
    iva_inversionista: string; iva_cash_in: string;
  }
  ```

- [ ] **Step 1: Escribir el test que falla**

En `src/controllers/absorberEnCube.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import Big from "big.js";
import { calcDerivadosCubePuro } from "./absorberEnCube";

describe("calcDerivadosCubePuro", () => {
  it("CUBE-puro: todo va a cash_in, participacion en 0", () => {
    // monto 10000, tasa 2% => cuota = 200.00
    const d = calcDerivadosCubePuro(new Big("10000"), "2");
    expect(d.cuota_inversionista).toBe("200.00");
    expect(d.monto_cash_in).toBe("200.00");
    expect(d.monto_inversionista).toBe("0.00");
    expect(d.iva_cash_in).toBe("24.00");        // 200 * 0.12
    expect(d.iva_inversionista).toBe("0.00");
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd apps/cartera-back && bun test src/controllers/absorberEnCube.test.ts`
Expected: FAIL — módulo/función no existe.

- [ ] **Step 3: Crear el módulo con la función pura**

Crear `src/controllers/absorberEnCube.ts`:

```typescript
import Big from "big.js";

export const CUBE_INVESTMENT_ID = 86;

// Deriva cuota + montos + IVAs para un row CUBE-puro (cash_in=100, part=0)
// a partir del monto_aportado final y la tasa del crédito. Idéntica a la
// fórmula que usaba exitInvestor (consistente con processAndReplaceCreditInvestors).
export function calcDerivadosCubePuro(montoAportado: Big, porcentajeInteres: string | number) {
  const cuota = montoAportado.times(porcentajeInteres).div(100).round(2);
  const montoInversionista = new Big(0);        // participacion = 0
  const montoCashIn = cuota;                     // cash_in = 100
  const ivaInversionista = new Big(0);
  const ivaCashIn = montoCashIn.gt(0) ? montoCashIn.times(0.12).round(2) : new Big(0);
  return {
    cuota_inversionista: cuota.toFixed(2),
    monto_inversionista: montoInversionista.toFixed(2),
    monto_cash_in: montoCashIn.toFixed(2),
    iva_inversionista: ivaInversionista.toFixed(2),
    iva_cash_in: ivaCashIn.toFixed(2),
  };
}
```

- [ ] **Step 4: Reemplazar el closure en `investor.ts`**

Borrar la definición del closure `calcDerivadosCubePuro` (~L5485-5507) y agregar el import arriba del archivo:

```typescript
import { calcDerivadosCubePuro } from "./absorberEnCube";
```

(Las llamadas existentes `calcDerivadosCubePuro(new Big(...))` pasan a `calcDerivadosCubePuro(new Big(...), creditoData.porcentaje_interes)`.)

- [ ] **Step 5: Correr tests + typecheck**

Run: `cd apps/cartera-back && bun test src/controllers/absorberEnCube.test.ts && bunx tsc --noEmit`
Expected: PASS + sin errores de tipos en investor.ts.

- [ ] **Step 6: Commit**

```bash
git add apps/cartera-back/src/controllers/absorberEnCube.ts apps/cartera-back/src/controllers/absorberEnCube.test.ts apps/cartera-back/src/controllers/investor.ts
git commit -m "refactor(cartera): extraer calcDerivadosCubePuro a absorberEnCube.ts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Helper `absorberInversionistaEnCube` + refactor de `exitInvestor`

Extraer el cuerpo del `for` de `exitInvestor` (per-crédito) al helper. `exitInvestor` conserva su comportamiento externo (validaciones, `status='inactivo'`, correo, respuesta HTTP).

**Files:**
- Modify: `src/controllers/absorberEnCube.ts` (agregar el helper)
- Modify: `src/controllers/investor.ts` (reemplazar el bloque ~L5388-5813 por una llamada + acumulación)
- Test: `src/controllers/absorberEnCube.test.ts` (agregar integración sandbox)

**Interfaces:**
- Consumes: `calcDerivadosCubePuro` (Task 2), tablas Drizzle `creditos`, `creditos_inversionistas`, `creditos_inversionistas_espejo`.
- Produces:
  ```typescript
  type AbsorberResultado =
    | { ok: true; credito_id: number; numero_credito_sifco: string | null;
        monto_transferido: string; cube_preexistente: boolean; accion: "swap" | "merge" }
    | { ok: false; credito_id: number; razon: string };

  async function absorberInversionistaEnCube(
    tx: any, credito_id: number, inversionista_id: number,
    logger?: { log?: (...a: any[]) => void; warn?: (...a: any[]) => void }
  ): Promise<AbsorberResultado>;
  ```

- [ ] **Step 1: Escribir el test de integración que falla (sandbox)**

Agregar al final de `src/controllers/absorberEnCube.test.ts`. Este test corre SOLO si `SANDBOX_DB_URL` está seteada (integración real):

```typescript
import { describe, expect, it } from "bun:test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";
import { creditos_inversionistas, creditos_inversionistas_espejo } from "../database/db";
import { absorberInversionistaEnCube } from "./absorberEnCube";

const SB = process.env.SANDBOX_DB_URL;
const d = SB ? describe : describe.skip;

d("absorberInversionistaEnCube (integración sandbox)", () => {
  it("MERGE: crédito 838 con CUBE presente → CUBE queda 100%, saliente borrado", async () => {
    const sql = postgres(SB!);
    const db = drizzle(sql);
    try {
      await db.transaction(async (tx) => {
        const r = await absorberInversionistaEnCube(tx, 838, 1); // Adriana Bahaia
        expect(r.ok).toBe(true);
        if (r.ok) { expect(r.accion).toBe("merge"); }

        const rows = await tx.select().from(creditos_inversionistas)
          .where(eq(creditos_inversionistas.credito_id, 838));
        expect(rows.length).toBe(1);
        expect(rows[0].inversionista_id).toBe(86);
        expect(rows[0].porcentaje_cash_in).toBe("100");

        const saliente = await tx.select().from(creditos_inversionistas)
          .where(and(eq(creditos_inversionistas.credito_id, 838),
                     eq(creditos_inversionistas.inversionista_id, 1)));
        expect(saliente.length).toBe(0);
        throw new Error("ROLLBACK");   // no persistir: deja el sandbox intacto
      }).catch((e) => { if (e.message !== "ROLLBACK") throw e; });
    } finally { await sql.end(); }
  });

  it("SWAP: crédito 466 sin CUBE → el row del saliente pasa a CUBE (100%)", async () => {
    const sql = postgres(SB!);
    const db = drizzle(sql);
    try {
      await db.transaction(async (tx) => {
        const r = await absorberInversionistaEnCube(tx, 466, 47); // Jose Massis
        expect(r.ok).toBe(true);
        if (r.ok) { expect(r.accion).toBe("swap"); }
        const rows = await tx.select().from(creditos_inversionistas)
          .where(eq(creditos_inversionistas.credito_id, 466));
        expect(rows.length).toBe(1);
        expect(rows[0].inversionista_id).toBe(86);
        throw new Error("ROLLBACK");
      }).catch((e) => { if (e.message !== "ROLLBACK") throw e; });
    } finally { await sql.end(); }
  });

  it("saliente ausente → ok:false con razón", async () => {
    const sql = postgres(SB!);
    const db = drizzle(sql);
    try {
      await db.transaction(async (tx) => {
        const r = await absorberInversionistaEnCube(tx, 838, 999999);
        expect(r.ok).toBe(false);
        throw new Error("ROLLBACK");
      }).catch((e) => { if (e.message !== "ROLLBACK") throw e; });
    } finally { await sql.end(); }
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd apps/cartera-back && SANDBOX_DB_URL="postgresql://postgres:localdev123@localhost:5433/cartera_sandbox" bun test src/controllers/absorberEnCube.test.ts`
Expected: FAIL — `absorberInversionistaEnCube` no existe.

- [ ] **Step 3: Implementar `absorberInversionistaEnCube`**

En `src/controllers/absorberEnCube.ts`, agregar la función. El cuerpo es **exactamente** el bloque per-crédito de `exitInvestor` (`investor.ts` L5398-L5810 en el estado previo al refactor), con estos ajustes:
- Firma `(tx, credito_id, inversionista_id, logger)`; `const log = logger?.log ?? (()=>{}); const warn = logger?.warn ?? (()=>{});`.
- Los `continue`/`errores.push` de los guards (crédito inexistente ~L5412; saliente ausente ~L5436) se reemplazan por `return { ok: false, credito_id, razon: "..." }`.
- La `calcDerivadosCubePuro(x)` interna pasa a `calcDerivadosCubePuro(x, creditoData.porcentaje_interes)` (import de Task 2, ya en el módulo).
- Al final, en vez de `resultados.push(...)`, `return { ok: true, credito_id, numero_credito_sifco: creditoData.numero_credito_sifco ?? null, monto_transferido: montoTransferido.toFixed(2), cube_preexistente: cubePreexistente, accion: cubePreexistente ? "merge" : "swap" }`.
- Importar en el módulo las tablas y helpers Drizzle que usa el bloque: `and, eq` de `drizzle-orm`; `creditos, creditos_inversionistas, creditos_inversionistas_espejo` de `../database/db`.

(El bloque incluye `calcDerivadosCubePuro` local que YA no va — usar el import; `recalcularCuotasPool` se mantiene como closure interno del helper tal cual está en L5712-5782.)

- [ ] **Step 4: Correr los tests de integración y verlos pasar**

Run: `cd apps/cartera-back && SANDBOX_DB_URL="postgresql://postgres:localdev123@localhost:5433/cartera_sandbox" bun test src/controllers/absorberEnCube.test.ts`
Expected: PASS (calc puro + 3 integración). El sandbox queda intacto (todo con ROLLBACK).

- [ ] **Step 5: Refactor de `exitInvestor` para consumir el helper**

En `investor.ts`, reemplazar el cuerpo del `for (const [idx, credito_id] of creditoIds.entries())` (L5388-L5813) por:

```typescript
      for (const [idx, credito_id] of creditoIds.entries()) {
        log(`─────────────────────────────────────────────────────────`);
        log(`📂 [${idx + 1}/${creditoIds.length}] Procesando crédito_id=${credito_id}`);
        const r = await absorberInversionistaEnCube(tx, credito_id, inversionista_id, { log, warn });
        if (!r.ok) { errores.push({ credito_id: r.credito_id, razon: r.razon }); continue; }
        totalTransferido = totalTransferido.plus(new Big(r.monto_transferido));
        resultados.push({
          credito_id: r.credito_id,
          numero_credito_sifco: r.numero_credito_sifco,
          monto_transferido: r.monto_transferido,
          cube_preexistente: r.cube_preexistente,
          accion: r.accion,
        });
      }
```

Agregar el import: `import { calcDerivadosCubePuro, absorberInversionistaEnCube } from "./absorberEnCube";`

- [ ] **Step 6: No-regresión de `exitInvestor` + typecheck**

Run: `cd apps/cartera-back && bun test src/controllers/investor.test.ts && bunx tsc --noEmit`
Expected: PASS. (Si `investor.test.ts` no cubre exitInvestor, además correr la validación de sandbox del Step 7.)

- [ ] **Step 7: Validación manual de no-regresión en sandbox**

Correr `exitInvestor` contra el sandbox sobre un crédito y confirmar que el inversionista queda `inactivo` (comportamiento viejo intacto). Luego **resetear el sandbox** (comando del Global Constraints). Documentar el resultado.

- [ ] **Step 8: Commit**

```bash
git add apps/cartera-back/src/controllers/absorberEnCube.ts apps/cartera-back/src/controllers/absorberEnCube.test.ts apps/cartera-back/src/controllers/investor.ts
git commit -m "refactor(cartera): exitInvestor usa absorberInversionistaEnCube (helper compartido)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Método batch `cubeCompraCredito(tx, creditoId)`

Absorbe a TODOS los no-CUBE de un crédito (llama al helper por cada uno). Solo pool-move.

**Files:**
- Modify: `src/controllers/absorberEnCube.ts`
- Test: `src/controllers/absorberEnCube.test.ts`

**Interfaces:**
- Consumes: `absorberInversionistaEnCube` (Task 3).
- Produces:
  ```typescript
  async function cubeCompraCredito(
    tx: any, credito_id: number, logger?: { log?: Function; warn?: Function }
  ): Promise<{ credito_id: number; absorbidos: AbsorberResultado[] }>;
  ```

- [ ] **Step 1: Escribir el test de integración que falla**

Agregar en `absorberEnCube.test.ts` (dentro del bloque `d(...)`):

```typescript
  it("cubeCompraCredito 838 → absorbe al único no-CUBE, CUBE queda 100%", async () => {
    const sql = postgres(SB!);
    const db = drizzle(sql);
    try {
      await db.transaction(async (tx) => {
        const { cubeCompraCredito } = await import("./absorberEnCube");
        const res = await cubeCompraCredito(tx, 838);
        expect(res.absorbidos.length).toBe(1);
        const rows = await tx.select().from(creditos_inversionistas)
          .where(eq(creditos_inversionistas.credito_id, 838));
        expect(rows.length).toBe(1);
        expect(rows[0].inversionista_id).toBe(86);
        throw new Error("ROLLBACK");
      }).catch((e) => { if (e.message !== "ROLLBACK") throw e; });
    } finally { await sql.end(); }
  });
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `cd apps/cartera-back && SANDBOX_DB_URL="postgresql://postgres:localdev123@localhost:5433/cartera_sandbox" bun test src/controllers/absorberEnCube.test.ts`
Expected: FAIL — `cubeCompraCredito` no existe.

- [ ] **Step 3: Implementar `cubeCompraCredito`**

En `absorberEnCube.ts`:

```typescript
export async function cubeCompraCredito(
  tx: any, credito_id: number, logger?: { log?: Function; warn?: Function }
) {
  const noCube = await tx
    .select({ inversionista_id: creditos_inversionistas.inversionista_id })
    .from(creditos_inversionistas)
    .where(eq(creditos_inversionistas.credito_id, credito_id));

  const salientes = noCube
    .map((r: any) => r.inversionista_id)
    .filter((id: number) => id !== CUBE_INVESTMENT_ID);

  const absorbidos: AbsorberResultado[] = [];
  for (const invId of salientes) {
    absorbidos.push(await absorberInversionistaEnCube(tx, credito_id, invId, logger));
  }
  return { credito_id, absorbidos };
}
```

(Exportar el tipo `AbsorberResultado` desde el módulo.)

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `cd apps/cartera-back && SANDBOX_DB_URL="postgresql://postgres:localdev123@localhost:5433/cartera_sandbox" bun test src/controllers/absorberEnCube.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cartera-back/src/controllers/absorberEnCube.ts apps/cartera-back/src/controllers/absorberEnCube.test.ts
git commit -m "feat(cartera): cubeCompraCredito — CUBE absorbe a todos los no-CUBE de un crédito

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Script orquestador `cubeCompraReinversion.ts`

Corre A (absorber los 9 + estado→NO_APLICA) y B (una reinversión por saliente, `fecha_compra=2026-06-10`), con guard de DB, dry-run, backup y logging.

**Files:**
- Create: `src/scripts/cubeCompraReinversion.ts`
- Modify: `src/controllers/addInvestorToCredit.ts` (exportar el handler ya existe; el script llama la función directamente o vía HTTP — ver Step 3)

**Interfaces:**
- Consumes: `cubeCompraCredito` (Task 4), `addInvestorToCredit` (Task 1), `resolverFechaCompra`.

- [ ] **Step 1: Definir el mapeo de entrada (datos del spec)**

En `src/scripts/cubeCompraReinversion.ts`, constantes verificadas contra la DB:

```typescript
// credito_id -> saliente inv_id (los 9 del lote)
const CREDITOS_A = [
  { credito_id: 224,  saliente: 7  },
  { credito_id: 1047, saliente: 92 },
  { credito_id: 838,  saliente: 1  },
  { credito_id: 5256, saliente: 88 },
  { credito_id: 570,  saliente: 82 },
  { credito_id: 8722, saliente: 57 },
  { credito_id: 466,  saliente: 47 },
  { credito_id: 646,  saliente: 82 },
  { credito_id: 595,  saliente: 81 },
];
const FECHA_COMPRA = "2026-06-10";
// % por saliente = el del crédito recuperado
const PCT_POR_SALIENTE: Record<number, { part: number; cash: number }> = {
  7: { part: 70, cash: 30 }, 92: { part: 80, cash: 20 }, 1: { part: 80, cash: 20 },
  88: { part: 80, cash: 20 }, 82: { part: 80, cash: 20 }, 57: { part: 80, cash: 20 },
  47: { part: 75, cash: 25 }, 81: { part: 75, cash: 25 },
};
```

- [ ] **Step 2: Guard de DB + dry-run + backup + ejecución**

El script (esqueleto completo, con `--apply` para pasar de dry-run a real):

```typescript
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray, sql as dsql } from "drizzle-orm";
import Big from "big.js";
import { creditos, creditos_inversionistas_espejo } from "../database/db";
import { cubeCompraCredito } from "../controllers/absorberEnCube";
import { addInvestorToCredit } from "../controllers/addInvestorToCredit";

const APPLY = process.argv.includes("--apply");
const URL = process.env.SUPABASE_DB_URL!;

async function main() {
  const client = postgres(URL, { ssl: URL.includes("localhost") ? false : "require" });
  const db = drizzle(client);

  // GUARD: mostrar a qué base pegamos
  const [meta] = await db.execute(dsql`select inet_server_addr()::text addr,
    (select count(*) from cartera.creditos) n`) as any;
  console.log(`DB addr=${meta.addr} creditos=${meta.n} APPLY=${APPLY}`);
  if (!APPLY) console.log("== DRY-RUN (usa --apply para ejecutar de verdad) ==");

  // 1) Monto espejo por saliente (lo que reinvierte)
  const idsCred = CREDITOS_A.map((c) => c.credito_id);
  const espejo = await db.select({
      credito_id: creditos_inversionistas_espejo.credito_id,
      inv: creditos_inversionistas_espejo.inversionista_id,
      monto: creditos_inversionistas_espejo.monto_aportado,
    }).from(creditos_inversionistas_espejo)
    .where(inArray(creditos_inversionistas_espejo.credito_id, idsCred));
  const montoPorSaliente = new Map<number, Big>();
  for (const { credito_id, saliente } of CREDITOS_A) {
    const row = espejo.find((e) => e.credito_id === credito_id && e.inv === saliente);
    if (!row) throw new Error(`Sin row espejo para crédito ${credito_id}/inv ${saliente}`);
    montoPorSaliente.set(saliente,
      (montoPorSaliente.get(saliente) ?? new Big(0)).plus(new Big(row.monto)));
  }
  console.log("Monto a reinvertir por saliente:",
    [...montoPorSaliente].map(([k, v]) => `${k}:Q${v.toFixed(2)}`).join("  "));

  if (!APPLY) { await client.end(); return; }

  // 2) BACKUP de filas afectadas
  const stamp = FECHA_COMPRA.replace(/-/g, "");
  await db.execute(dsql`create table if not exists cartera._bk_cube_compra_reinv_${dsql.raw(stamp)}_ci as
    select * from cartera.creditos_inversionistas where credito_id = any(${idsCred})`);
  await db.execute(dsql`create table if not exists cartera._bk_cube_compra_reinv_${dsql.raw(stamp)}_esp as
    select * from cartera.creditos_inversionistas_espejo where credito_id = any(${idsCred})`);

  // 3) MOVIMIENTO A: absorber + estado_devolucion -> NO_APLICA (por crédito, tx propia)
  for (const { credito_id } of CREDITOS_A) {
    await db.transaction(async (tx) => {
      const res = await cubeCompraCredito(tx, credito_id, { log: console.log, warn: console.warn });
      await tx.update(creditos).set({ estado_devolucion: "NO_APLICA" })
        .where(eq(creditos.credito_id, credito_id));
      console.log(`A ✔ crédito ${credito_id}:`, JSON.stringify(res.absorbidos));
    });
  }

  // 4) MOVIMIENTO B: reinversión por saliente vía addInvestorToCredit (automático)
  for (const [saliente, monto] of montoPorSaliente) {
    const pct = PCT_POR_SALIENTE[saliente];
    const body = {
      inversionista_id: saliente,
      monto_aportado: Number(monto.toFixed(2)),
      porcentaje_inversion: pct.part,
      porcentaje_cash_in: pct.cash,
      tipo_operacion: "reinversion" as const,
      fecha_compra: FECHA_COMPRA,
    };
    const set: any = { status: 200 };
    const out = await addInvestorToCredit({ body, set, request: {} as any });
    console.log(`B ✔ saliente ${saliente} (Q${monto.toFixed(2)}) status=${set.status}`,
      JSON.stringify(out));
  }

  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Dry-run en sandbox**

Run:
```bash
cd apps/cartera-back
SUPABASE_DB_URL="postgresql://postgres:localdev123@localhost:5433/cartera_sandbox" \
  bun run src/scripts/cubeCompraReinversion.ts
```
Expected: imprime addr/counts, "== DRY-RUN ==", y el monto a reinvertir por saliente (Anna Q263.16, Mónaco Q3,195.38, Adriana Q19,385.95, LA LO LO Q24,404.79, Werner Q83,409.39, Luis Q1,068.76, Massis Q122,797.32, Tonejos Q139,739.28). No escribe nada.

- [ ] **Step 4: Ejecución real en sandbox (--apply) + verificación**

Run:
```bash
cd apps/cartera-back
SUPABASE_DB_URL="postgresql://postgres:localdev123@localhost:5433/cartera_sandbox" \
  bun run src/scripts/cubeCompraReinversion.ts --apply
```
Verificar en el sandbox:
```bash
docker exec -e PGPASSWORD=localdev123 cartera-local psql -U postgres -d cartera_sandbox -c \
 "select credito_id, count(*) filter (where inversionista_id<>86) no_cube from cartera.creditos_inversionistas where credito_id in (224,1047,838,5256,570,8722,466,646,595) group by 1 order by 1;"
```
Expected: los 9 con `no_cube=0` (CUBE quedó 100%).
```bash
docker exec -e PGPASSWORD=localdev123 cartera-local psql -U postgres -d cartera_sandbox -c \
 "select inversionista_id, count(*), to_char(fecha,'YYYY-MM-DD') from cartera.compras_credito_inversionista where to_char(fecha,'YYYY-MM-DD')='2026-06-10' group by 1,3 order by 1;"
```
Expected: filas de reinversión con `fecha=2026-06-10` para los 8 salientes.

- [ ] **Step 5: Confirmar "sin asignar" = 0 (capacidad de candidatos)**

Revisar en el output del Step 4 que cada llamada B reporte `monto_sin_asignar = 0`. Si algún saliente (esp. Massis Q122.8k, Tonejos Q139.7k) queda con monto sin asignar, anotarlo: significa que no hubo suficientes créditos candidatos con capital de CUBE. Decisión con el usuario antes de prod (no bloquea el sandbox).

- [ ] **Step 6: Reset del sandbox**

Run el comando de reset del Global Constraints. Verificar que vuelve a 1673/2349.

- [ ] **Step 7: Commit**

```bash
git add apps/cartera-back/src/scripts/cubeCompraReinversion.ts
git commit -m "feat(cartera): script orquestador CUBE compra + reinversión (dry-run/apply, guard, backup)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (cobertura vs spec)

- Spec §3 Mov A → Tasks 2,3,4. ✅
- Spec §3 Mov B → Tasks 1,5. ✅
- Spec §4 CUBE-puro / % del crédito / monto espejo / fecha en compras / automático → Tasks 1,2,5. ✅
- Spec §6 helper + refactor exitInvestor → Tasks 2,3. ✅
- Spec §7 endpoint fecha_compra → Task 1. ✅
- Spec §8 script (guard/dry-run/backup/A→B) → Task 5. ✅
- Spec §9 orden (estado→NO_APLICA tras A) → Task 5 Step 2. ✅
- Spec §10 testing sandbox → Tasks 3,4,5. ✅
- Spec §12 capacidad de candidatos → Task 5 Step 5. ✅

## Notas de ejecución

- **Precondición operativa (fuera del script):** los 9 créditos deben estar **aceptados** (VERIFICADO + CANCELACION vía `aceptarDevolucion`) antes de correr el script, porque `registrarCancelacionEspejo` lee el espejo del saliente que el Mov A borra. En el sandbox, si no están aceptados, el Mov A igual funciona (no depende de la CANCELACION), pero para reproducir el flujo real conviene aceptarlos primero.
- **Werner (inv 82)** aparece en 2 créditos (570 y 646); su reinversión es UNA sola por Q83,409.39.
- El paso a **prod** se hace en una sesión aparte, con el guard confirmando `inet_server_addr`, y sólo tras validar el sandbox.
