// ============================================================================
// SCRIPT ORQUESTADOR: cubeCompraReinversion
// ============================================================================
//
// Ejecuta el Movimiento A → B de la compra de cartera + reinversión de los
// 9 créditos del lote (spec §3, §8, §9):
//
//   MOVIMIENTO A — por cada uno de los 9 créditos:
//     1. cubeCompraCredito(tx, credito_id): absorbe a TODOS los inversionistas
//        no-CUBE del crédito hacia CUBE (SWAP/MERGE en padre y espejo).
//     2. estado_devolucion → NO_APLICA (el crédito ya no está "en camino
//        de vuelta a CUBE": ya volvió).
//
//   MOVIMIENTO B — por cada saliente (8, porque Werner sale de 2 créditos
//   pero reinvierte una sola vez):
//     - addInvestorToCredit en modo AUTOMÁTICO (sin `manual`), tipo_operacion
//       "reinversion", con el monto ESPEJO que CUBE absorbió (suma si el
//       saliente tenía más de un crédito en el lote) y el % de participación/
//       cash_in que tenía en el crédito recuperado (PCT_POR_SALIENTE).
//       `fecha_compra` fija el `compras_credito_inversionista.fecha` sin
//       tocar `fecha_inicio_participacion`.
//
// SEGURIDAD:
//   - Guard de DB: imprime inet_server_addr() + count(*) de cartera.creditos
//     ANTES de hacer nada, para confirmar contra qué base se corre.
//   - DRY-RUN por defecto: solo calcula y muestra el monto a reinvertir por
//     saliente. Ningún UPDATE/INSERT/CREATE TABLE ocurre sin `--apply`.
//   - Backup: antes de tocar nada, crea 2 tablas `_bk_cube_compra_reinv_*`
//     con snapshot de las filas de los 9 créditos (padre + espejo).
//   - Movimiento A corre en una transacción POR CRÉDITO (si un crédito
//     falla, no arrastra a los demás). Movimiento B usa la transacción
//     propia de addInvestorToCredit (una por saliente).
//
// USO:
//   SUPABASE_DB_URL=... bun run src/scripts/cubeCompraReinversion.ts            # dry-run
//   SUPABASE_DB_URL=... bun run src/scripts/cubeCompraReinversion.ts --apply    # real
// ============================================================================

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray, sql as dsql } from "drizzle-orm";
import Big from "big.js";
import { creditos, creditos_inversionistas_espejo } from "../database/db";
import { cubeCompraCredito } from "../controllers/absorberEnCube";
import { addInvestorToCredit } from "../controllers/addInvestorToCredit";

// ============================================================================
// STEP 1: mapeo de entrada (datos del spec, verificados contra la DB)
// ============================================================================

// credito_id -> saliente inv_id (los 9 del lote)
const CREDITOS_A = [
  { credito_id: 224, saliente: 7 },
  { credito_id: 1047, saliente: 92 },
  { credito_id: 838, saliente: 1 },
  { credito_id: 5256, saliente: 88 },
  { credito_id: 570, saliente: 82 },
  { credito_id: 8722, saliente: 57 },
  { credito_id: 466, saliente: 47 },
  { credito_id: 646, saliente: 82 },
  { credito_id: 595, saliente: 81 },
];
const FECHA_COMPRA = "2026-06-10";
// % por saliente = el del crédito recuperado
const PCT_POR_SALIENTE: Record<number, { part: number; cash: number }> = {
  7: { part: 70, cash: 30 },
  92: { part: 80, cash: 20 },
  1: { part: 80, cash: 20 },
  88: { part: 80, cash: 20 },
  82: { part: 80, cash: 20 },
  57: { part: 80, cash: 20 },
  47: { part: 75, cash: 25 },
  81: { part: 75, cash: 25 },
};

const APPLY = process.argv.includes("--apply");
const URL = process.env.SUPABASE_DB_URL!;

async function main() {
  if (!URL) {
    throw new Error("SUPABASE_DB_URL no está definida");
  }

  const client = postgres(URL, { ssl: URL.includes("localhost") ? false : "require" });
  const db = drizzle(client);

  // ──────────────────────────────────────────────────────────────────
  // GUARD: mostrar a qué base pegamos ANTES de hacer cualquier otra cosa.
  // ──────────────────────────────────────────────────────────────────
  const meta = await db.execute(dsql`select inet_server_addr()::text addr,
    (select count(*) from cartera.creditos) n`);
  const metaRow: any = (meta as any)[0] ?? (meta as any).rows?.[0];
  console.log(`DB addr=${metaRow.addr} creditos=${metaRow.n} APPLY=${APPLY}`);
  if (!APPLY) console.log("== DRY-RUN (usa --apply para ejecutar de verdad) ==");

  // ──────────────────────────────────────────────────────────────────
  // 1) Monto espejo por saliente (lo que reinvierte)
  // ──────────────────────────────────────────────────────────────────
  const idsCred = CREDITOS_A.map((c) => c.credito_id);
  const espejo = await db
    .select({
      credito_id: creditos_inversionistas_espejo.credito_id,
      inv: creditos_inversionistas_espejo.inversionista_id,
      monto: creditos_inversionistas_espejo.monto_aportado,
    })
    .from(creditos_inversionistas_espejo)
    .where(inArray(creditos_inversionistas_espejo.credito_id, idsCred));

  const montoPorSaliente = new Map<number, Big>();
  for (const { credito_id, saliente } of CREDITOS_A) {
    const row = espejo.find((e) => e.credito_id === credito_id && e.inv === saliente);
    if (!row) throw new Error(`Sin row espejo para crédito ${credito_id}/inv ${saliente}`);
    montoPorSaliente.set(
      saliente,
      (montoPorSaliente.get(saliente) ?? new Big(0)).plus(new Big(row.monto)),
    );
  }
  console.log(
    "Monto a reinvertir por saliente:",
    [...montoPorSaliente].map(([k, v]) => `${k}:Q${v.toFixed(2)}`).join("  "),
  );

  if (!APPLY) {
    await client.end();
    return;
  }

  // ──────────────────────────────────────────────────────────────────
  // 2) BACKUP de filas afectadas (padre + espejo de los 9 créditos)
  //
  // NOTA: `= any(${idsCred})` con un arreglo JS interpolado directo en un
  // `sql` tag de drizzle-orm/postgres-js revienta con
  // "op ANY/ALL (array) requires array on right side" (el driver no lo
  // serializa como array de Postgres). Los ids son constantes fijas del
  // script (no input externo), así que se interpolan como lista literal
  // vía `dsql.raw` y se usa `in (...)` en vez de `= any(...)`.
  // ──────────────────────────────────────────────────────────────────
  const stamp = FECHA_COMPRA.replace(/-/g, "");
  const idsCredLiteral = dsql.raw(idsCred.join(","));
  await db.execute(dsql`create table if not exists cartera._bk_cube_compra_reinv_${dsql.raw(stamp)}_ci as
    select * from cartera.creditos_inversionistas where credito_id in (${idsCredLiteral})`);
  await db.execute(dsql`create table if not exists cartera._bk_cube_compra_reinv_${dsql.raw(stamp)}_esp as
    select * from cartera.creditos_inversionistas_espejo where credito_id in (${idsCredLiteral})`);
  console.log(`Backup creado: cartera._bk_cube_compra_reinv_${stamp}_{ci,esp}`);

  // ──────────────────────────────────────────────────────────────────
  // 3) MOVIMIENTO A: absorber + estado_devolucion -> NO_APLICA
  //    (por crédito, transacción propia)
  // ──────────────────────────────────────────────────────────────────
  for (const { credito_id } of CREDITOS_A) {
    await db.transaction(async (tx) => {
      const res = await cubeCompraCredito(tx, credito_id, { log: console.log, warn: console.warn });
      // Si algún saliente no se pudo absorber (ok:false), abortamos ANTES de
      // apagar estado_devolucion: el rollback de la tx deja el crédito
      // intacto y el error detiene el script antes de llegar a Movimiento B
      // (que reinvertiría un monto calculado sobre un supuesto que no se
      // cumplió).
      const fallidos = res.absorbidos.filter((a) => !a.ok);
      if (fallidos.length > 0) {
        throw new Error(
          `Absorción incompleta en crédito ${credito_id}: ${JSON.stringify(fallidos)}`,
        );
      }
      await tx
        .update(creditos)
        .set({ estado_devolucion: "NO_APLICA" })
        .where(eq(creditos.credito_id, credito_id));
      console.log(`A ✔ crédito ${credito_id}:`, JSON.stringify(res.absorbidos));
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // 4) MOVIMIENTO B: reinversión por saliente vía addInvestorToCredit
  //    (automático, sin `manual`)
  // ──────────────────────────────────────────────────────────────────
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
    console.log(
      `B ✔ saliente ${saliente} (Q${monto.toFixed(2)}) status=${set.status}`,
      JSON.stringify(out),
    );
    // Fail-fast: si addInvestorToCredit no reportó éxito (créditos candidatos
    // agotados, validación fallida, etc.), detenemos el script en vez de
    // seguir silenciosamente con el resto de salientes.
    if (!out?.success) {
      throw new Error(
        `Movimiento B falló para saliente ${saliente}: ${JSON.stringify(out)}`,
      );
    }
    if (new Big(out.monto_sin_asignar ?? 0).gt(0)) {
      console.warn(
        `⚠️  Saliente ${saliente}: monto_sin_asignar=${out.monto_sin_asignar} (no hubo suficientes créditos candidatos) — revisar antes de prod`,
      );
    }
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
