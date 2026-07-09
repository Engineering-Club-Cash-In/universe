// ============================================================================
// RUNBOOK — LEER ANTES DE CORRER CONTRA PROD
// ============================================================================
//   - Correr SOLO contra la DB que se pretende tocar. El guard imprime
//     inet_server_addr() + count(*) de cartera.creditos ANTES de hacer nada:
//     confirmar esa salida contra la base esperada ANTES de agregar --apply.
//   - Default es DRY-RUN (solo calcula y muestra el monto por saliente).
//     `--apply` es lo único que dispara escrituras reales.
//   - Movimiento A hace commit POR CRÉDITO (una tx por cada uno de los 9).
//     Movimiento B corre dentro de la transacción propia de
//     addInvestorToCredit (una tx por saliente). El run NO es atómico de
//     punta a punta: un fallo a mitad de camino puede dejar Movimiento A
//     aplicado y Movimiento B parcial.
//   - ANTES de un --apply contra prod: verificar en vivo el headroom de
//     candidatos para los 8 salientes (en particular Massis ~Q122.8k y
//     Tonejos ~Q139.7k, los montos más grandes del lote). El script ahora
//     ABORTA (throw) si algún saliente queda con monto_sin_asignar > 0 —
//     ya no continúa silenciosamente con un candidato insuficiente.
//   - RECUPERACIÓN ante fallo parcial: restaurar `creditos_inversionistas` /
//     `_espejo` desde `cartera._bk_cube_compra_reinv_<stamp>_ci` /
//     `_esp`, y `estado_devolucion` desde `_estado`. Luego DROP a las 3
//     tablas `_bk_*` y recién ahí reintentar — un re-run con los backups
//     todavía presentes se bloquea solo (CREATE TABLE no tiene
//     IF NOT EXISTS, así que revienta si las `_bk_*` del mismo stamp ya
//     existen).
// ============================================================================
//
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
//   - Backup: antes de tocar nada, crea 3 tablas `_bk_cube_compra_reinv_*`:
//     snapshot COMPLETO (whole-table, sin WHERE) de `creditos_inversionistas`
//     y `creditos_inversionistas_espejo` (Movimiento B muta candidatos
//     elegidos dinámicamente que NO son necesariamente los 9 créditos del
//     lote, así que el backup no puede acotarse a esos 9), más un snapshot
//     acotado de `estado_devolucion` de los 9 (lo único que Movimiento A
//     cambia en `creditos`).
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
  // 2) BACKUP, ANTES de mutar nada.
  //
  // Movimiento B (addInvestorToCredit en modo automático) hace delete+rebuild
  // sobre `creditos_inversionistas` / `_espejo` en créditos CANDIDATOS
  // elegidos dinámicamente (no son los 9 de CREDITOS_A) — no hay forma de
  // saber de antemano cuáles son, así que el backup de esas dos tablas debe
  // ser de TABLA COMPLETA (sin WHERE) para que Movimiento B sea reversible.
  // Movimiento A solo cambia `estado_devolucion` en `creditos`, y solo en
  // los 9 créditos del lote, así que ese snapshot sí puede acotarse a ellos.
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

  const bkCi = await db.execute(dsql`create table cartera._bk_cube_compra_reinv_${dsql.raw(stamp)}_ci as
    select * from cartera.creditos_inversionistas`);
  const bkEsp = await db.execute(dsql`create table cartera._bk_cube_compra_reinv_${dsql.raw(stamp)}_esp as
    select * from cartera.creditos_inversionistas_espejo`);
  const bkEstado = await db.execute(dsql`create table cartera._bk_cube_compra_reinv_${dsql.raw(stamp)}_estado as
    select credito_id, estado_devolucion from cartera.creditos where credito_id in (${idsCredLiteral})`);

  const rowCount = (r: any) => (r as any).count ?? (r as any).rowCount ?? "?";
  console.log(
    `Backup creado: cartera._bk_cube_compra_reinv_${stamp}_ci (${rowCount(bkCi)} filas, tabla completa), ` +
      `_esp (${rowCount(bkEsp)} filas, tabla completa), ` +
      `_estado (${rowCount(bkEstado)} filas, los 9 créditos)`,
  );

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
    const sinAsignar = new Big(out.monto_sin_asignar ?? 0);
    if (sinAsignar.gt(0)) {
      throw new Error(
        `Movimiento B: saliente ${saliente} quedó con monto_sin_asignar=${sinAsignar.toFixed(2)} (candidatos insuficientes). Abortando; restaurar desde backup _bk_cube_compra_reinv_* y reintentar tras verificar headroom.`,
      );
    }
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
