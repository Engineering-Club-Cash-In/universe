// ============================================================================
// RUNBOOK — LEER ANTES DE CORRER CONTRA PROD
// ============================================================================
//   - Correr SOLO contra la DB que se pretende tocar. El guard imprime
//     inet_server_addr() + current_database() + count(*) de cartera.creditos
//     ANTES de hacer nada: confirmar esa salida contra la base esperada ANTES
//     de agregar --apply.
//   - GUARD DURO: bajo `--apply` es OBLIGATORIO pasar también
//     `--confirm-db=<nombre_exacto_de_la_db>`. El script compara ese valor
//     contra `select current_database()` y ABORTA (throw, antes de calcular
//     montos y antes de crear cualquier backup) si falta el flag o si no
//     coincide EXACTO. Ya no basta con "revisar el print de arriba a ojo":
//     si el nombre no calza, el script se niega a escribir.
//   - Default es DRY-RUN (solo calcula y muestra el monto por saliente).
//     `--apply` es lo único que dispara escrituras reales, y sigue sin pedir
//     `--confirm-db` en dry-run (a propósito: no hay nada que proteger todavía).
//   - Movimiento A hace commit POR CRÉDITO (una tx por cada uno de los 9), y
//     ANTES de absorber verifica que el pool no-CUBE del crédito sea EXACTO
//     `[saliente designado]` — si hay un inversionista inesperado o el
//     saliente ya no está, aborta ese crédito sin mutarlo (protege contra
//     data drift, típico en DEV/sandbox). La absorción es TARGETED
//     (absorberInversionistaEnCube directo sobre el saliente), no
//     "absorber a todos los no-CUBE" (cubeCompraCredito).
//     Movimiento B corre dentro de la transacción propia de
//     addInvestorToCredit (una tx por saliente) y EXCLUYE explícitamente los
//     9 créditos del lote de su buscador de candidatos (`excluir_creditos`),
//     con un post-check adicional que reconfirma que los 9 siguen CUBE-only
//     al final del script. El run NO es atómico de punta a punta: un fallo a
//     mitad de Movimiento B puede dejar Movimiento A aplicado Y el saliente
//     QUE ESTABA CORRIENDO en ese momento parcialmente reinvertido Y
//     COMMITTED — addInvestorToCredit hace commit de su propia transacción
//     antes de que el throw de "monto_sin_asignar > 0" (o cualquier otro
//     chequeo posterior) llegue a interrumpir el script.
//   - ANTES de un --apply contra prod: verificar en vivo el headroom de
//     candidatos para los 8 salientes (en particular Massis ~Q122.8k y
//     Tonejos ~Q139.7k, los montos más grandes del lote). El script ahora
//     ABORTA (throw) si algún saliente queda con monto_sin_asignar > 0 —
//     ya no continúa silenciosamente con un candidato insuficiente.
//   - RECUPERACIÓN ante fallo parcial: dado que un fallo a mitad de
//     Movimiento B puede dejar committed la reinversión PARCIAL del saliente
//     que estaba corriendo (ver arriba), la recuperación NO es "solo
//     restaurar lo de Movimiento A": hay que restaurar LAS CUATRO tablas de
//     backup completas y volver a empezar, no intentar reparar a mano.
//       1. `creditos_inversionistas`      ← `cartera._bk_cube_compra_reinv_<stamp>_ci`
//       2. `creditos_inversionistas_espejo` ← `..._esp`
//       3. `creditos.estado_devolucion` (9 créditos) ← `..._estado`
//       4. `compras_credito_inversionista` ← `..._compras`
//     Restaurar CADA tabla completa (delete + insert desde el backup, o
//     truncate + insert), en ESE ORDEN no importa pero las 4 deben quedar
//     restauradas antes de reintentar. Luego DROP a las 4 tablas `_bk_*` y
//     recién ahí reintentar — un re-run con los backups todavía presentes se
//     bloquea solo (CREATE TABLE no tiene IF NOT EXISTS, así que revienta si
//     las `_bk_*` del mismo stamp ya existen).
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
//     1. Guard de roster: el pool no-CUBE del padre debe ser EXACTO
//        `[saliente]` (el designado en CREDITOS_A) — si no, throw antes de
//        tocar el crédito.
//     2. absorberInversionistaEnCube(tx, credito_id, saliente): absorbe
//        PUNTUALMENTE a ese inversionista hacia CUBE (SWAP/MERGE en padre y
//        espejo). Ya NO se usa cubeCompraCredito (que absorbería a
//        CUALQUIER no-CUBE que hubiera, no solo al designado).
//     3. estado_devolucion → NO_APLICA (el crédito ya no está "en camino
//        de vuelta a CUBE": ya volvió).
//
//   MOVIMIENTO B — por cada saliente (8, porque Werner sale de 2 créditos
//   pero reinvierte una sola vez):
//     - addInvestorToCredit en modo AUTOMÁTICO (sin `manual`), tipo_operacion
//       "reinversion", con el monto ESPEJO que CUBE absorbió (suma si el
//       saliente tenía más de un crédito en el lote) y el % de participación/
//       cash_in que tenía en el crédito recuperado (PCT_POR_SALIENTE).
//       `fecha_compra` fija el `compras_credito_inversionista.fecha` sin
//       tocar `fecha_inicio_participacion`. `excluir_creditos` = los 9 del
//       lote, para que ningún saliente reinvierta de vuelta en el crédito
//       (o en otro de los 9) del que Movimiento A lo acaba de sacar.
//     - Post-check final: re-consulta los 9 créditos y confirma que siguen
//       CUBE-only (0 inversionistas no-CUBE cada uno); throw si no.
//
// SEGURIDAD:
//   - Guard de DB: imprime inet_server_addr() + current_database() + count(*)
//     de cartera.creditos ANTES de hacer nada, para confirmar contra qué base
//     se corre. Bajo `--apply` además EXIGE `--confirm-db=<nombre>` que debe
//     coincidir con `current_database()` — si no, aborta antes de escribir.
//   - DRY-RUN por defecto: solo calcula y muestra el monto a reinvertir por
//     saliente. Ningún UPDATE/INSERT/CREATE TABLE ocurre sin `--apply`.
//   - Backup: antes de tocar nada, crea 4 tablas `_bk_cube_compra_reinv_*`:
//     snapshot COMPLETO (whole-table, sin WHERE) de `creditos_inversionistas`,
//     `creditos_inversionistas_espejo` y `compras_credito_inversionista`
//     (Movimiento B muta/inserta en candidatos elegidos dinámicamente que NO
//     son necesariamente los 9 créditos del lote, así que el backup no puede
//     acotarse a esos 9), más un snapshot acotado de `estado_devolucion` de
//     los 9 (lo único que Movimiento A cambia en `creditos`).
//   - Movimiento A corre en una transacción POR CRÉDITO (si un crédito
//     falla, no arrastra a los demás), con guard de roster + absorción
//     targeted (ver arriba). Movimiento B usa la transacción propia de
//     addInvestorToCredit (una por saliente) + `excluir_creditos` + post-check.
//
// USO:
//   SUPABASE_DB_URL=... bun run src/scripts/cubeCompraReinversion.ts                                      # dry-run
//   SUPABASE_DB_URL=... bun run src/scripts/cubeCompraReinversion.ts --apply --confirm-db=<nombre_db>     # real
// ============================================================================

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray, sql as dsql } from "drizzle-orm";
import Big from "big.js";
import { creditos, creditos_inversionistas, creditos_inversionistas_espejo } from "../database/db";
import { absorberInversionistaEnCube, CUBE_INVESTMENT_ID } from "../controllers/absorberEnCube";
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
// --confirm-db=<nombre> — obligatorio bajo --apply (ver GUARD DURO más abajo).
// El dry-run NO lo requiere (queda flag-free a propósito).
const CONFIRM_DB_ARG = process.argv.find((a) => a.startsWith("--confirm-db="));
const CONFIRM_DB = CONFIRM_DB_ARG ? CONFIRM_DB_ARG.slice("--confirm-db=".length) : undefined;

async function main() {
  if (!URL) {
    throw new Error("SUPABASE_DB_URL no está definida");
  }

  const client = postgres(URL, { ssl: URL.includes("localhost") ? false : "require" });
  const db = drizzle(client);

  // ──────────────────────────────────────────────────────────────────
  // GUARD: mostrar a qué base pegamos ANTES de hacer cualquier otra cosa.
  // inet_server_addr()/count(*) quedan solo para visibilidad (NULL en
  // Neon, donde no hay una IP de servidor expuesta); el guard DURO real
  // es current_database() + --confirm-db, más abajo.
  // ──────────────────────────────────────────────────────────────────
  const meta = await db.execute(dsql`select inet_server_addr()::text addr,
    current_database() dbname,
    (select count(*) from cartera.creditos) n`);
  const metaRow: any = (meta as any)[0] ?? (meta as any).rows?.[0];
  console.log(`DB addr=${metaRow.addr} database=${metaRow.dbname} creditos=${metaRow.n} APPLY=${APPLY}`);
  if (!APPLY) console.log("== DRY-RUN (usa --apply para ejecutar de verdad) ==");

  // ──────────────────────────────────────────────────────────────────
  // GUARD DURO: bajo --apply es OBLIGATORIO pasar --confirm-db=<nombre>
  // y que coincida EXACTO con select current_database(). Si falta, o no
  // coincide, se aborta ACÁ — antes de calcular montos, antes de crear
  // los backups, antes de cualquier escritura. Reemplaza la confianza
  // ciega en "ya revisé el print de arriba" por una verificación que el
  // script hace fallar solo.
  // ──────────────────────────────────────────────────────────────────
  if (APPLY) {
    if (!CONFIRM_DB) {
      throw new Error(
        `GUARD: falta --confirm-db=<nombre_db>. Es obligatorio bajo --apply. Base real detectada: "${metaRow.dbname}". ` +
          `Reintentar con --apply --confirm-db=${metaRow.dbname} si esa es la base correcta.`,
      );
    }
    if (CONFIRM_DB !== metaRow.dbname) {
      throw new Error(
        `GUARD: --confirm-db="${CONFIRM_DB}" NO coincide con la base real (current_database()="${metaRow.dbname}"). ` +
          `Abortando antes de escribir nada.`,
      );
    }
    console.log(`✅ GUARD DURO OK: --confirm-db="${CONFIRM_DB}" coincide con current_database()`);
  }

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
  // compras_credito_inversionista: Movimiento B (addInvestorToCredit) INSERTa
  // filas nuevas acá por cada crédito candidato que toca (no son necesariamente
  // los 9 del lote), así que igual que _ci/_esp el backup debe ser de TABLA
  // COMPLETA para poder revertir un DELETE de las filas insertadas por este run.
  const bkCompras = await db.execute(dsql`create table cartera._bk_cube_compra_reinv_${dsql.raw(stamp)}_compras as
    select * from cartera.compras_credito_inversionista`);

  const rowCount = (r: any) => (r as any).count ?? (r as any).rowCount ?? "?";
  console.log(
    `Backup creado: cartera._bk_cube_compra_reinv_${stamp}_ci (${rowCount(bkCi)} filas, tabla completa), ` +
      `_esp (${rowCount(bkEsp)} filas, tabla completa), ` +
      `_estado (${rowCount(bkEstado)} filas, los 9 créditos), ` +
      `_compras (${rowCount(bkCompras)} filas, tabla completa)`,
  );

  // ──────────────────────────────────────────────────────────────────
  // 3) MOVIMIENTO A: absorber + estado_devolucion -> NO_APLICA
  //    (por crédito, transacción propia)
  // ──────────────────────────────────────────────────────────────────
  for (const { credito_id, saliente } of CREDITOS_A) {
    await db.transaction(async (tx) => {
      // ── Guard de roster (ANTES de absorber nada) ──────────────────────
      // El spec asume que cada uno de los 9 créditos tiene EXACTAMENTE un
      // inversionista no-CUBE: el `saliente` designado en CREDITOS_A. En
      // DEV/sandbox los datos pueden haber divergido (otro inversionista
      // coló, o el saliente ya no está). Verificamos el pool no-CUBE del
      // padre y abortamos ANTES de mutar este crédito si no calza EXACTO
      // con `[saliente]` — el rollback de la tx deja el crédito intacto.
      const rosterNoCube = await tx
        .select({ inversionista_id: creditos_inversionistas.inversionista_id })
        .from(creditos_inversionistas)
        .where(eq(creditos_inversionistas.credito_id, credito_id));
      const idsNoCube = rosterNoCube
        .map((r: any) => r.inversionista_id)
        .filter((id: number) => id !== CUBE_INVESTMENT_ID)
        .sort((a: number, b: number) => a - b);

      if (idsNoCube.length !== 1 || idsNoCube[0] !== saliente) {
        throw new Error(
          `Roster inesperado en crédito ${credito_id}: se esperaba SOLO al saliente designado ${saliente}, ` +
            `pero el pool no-CUBE actual es [${idsNoCube.join(", ")}]. Abortando ANTES de absorber ` +
            `(posible data drift: crédito con inversionista adicional, o el saliente ya no está en el padre).`,
        );
      }

      // ── Absorción TARGETED (solo el saliente designado) ───────────────
      // A propósito NO usamos cubeCompraCredito (absorbe a TODOS los
      // no-CUBE del crédito): tras el guard de arriba ya sabemos que el
      // único no-CUBE es el saliente, pero llamar directo a
      // absorberInversionistaEnCube deja explícito que este movimiento
      // opera sobre UN inversionista puntual, no sobre "lo que sea que
      // haya en el pool".
      const res = await absorberInversionistaEnCube(tx, credito_id, saliente, {
        log: console.log,
        warn: console.warn,
      });
      // Si el saliente designado no se pudo absorber (ok:false), abortamos
      // ANTES de apagar estado_devolucion: el rollback de la tx deja el
      // crédito intacto y el error detiene el script antes de llegar a
      // Movimiento B (que reinvertiría un monto calculado sobre un
      // supuesto que no se cumplió).
      if (!res.ok) {
        throw new Error(
          `Absorción incompleta en crédito ${credito_id} (saliente ${saliente}): ${JSON.stringify(res)}`,
        );
      }
      await tx
        .update(creditos)
        .set({ estado_devolucion: "NO_APLICA" })
        .where(eq(creditos.credito_id, credito_id));
      console.log(`A ✔ crédito ${credito_id} (saliente ${saliente}):`, JSON.stringify(res));
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
      // Tras Movimiento A los 9 créditos quedan estado_devolucion=NO_APLICA,
      // es decir, elegibles para getCreditCandidates. Sin esta exclusión, un
      // saliente podría reinvertir de vuelta en el mismo crédito (o en otro
      // de los 9) del que Movimiento A lo acaba de sacar — reversión real
      // solo posible hoy en el 5256 (el único ACTIVO), pero se excluyen los
      // 9 por seguridad.
      excluir_creditos: CREDITOS_A.map((c) => c.credito_id),
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

  // ──────────────────────────────────────────────────────────────────
  // 5) POST-CHECK (belt-and-suspenders): los 9 créditos del lote deben
  //    seguir siendo CUBE-only después de Movimiento B. El `excluir_creditos`
  //    de arriba ya debería garantizar esto, pero lo re-verificamos por si
  //    hubiera algún hueco (otro caller concurrente, bug en el filtro, etc.):
  //    si cualquiera de los 9 volvió a tener un inversionista no-CUBE,
  //    abortamos con el detalle en vez de dar el run por bueno en silencio.
  // ──────────────────────────────────────────────────────────────────
  const rosterFinal = await db
    .select({
      credito_id: creditos_inversionistas.credito_id,
      inversionista_id: creditos_inversionistas.inversionista_id,
    })
    .from(creditos_inversionistas)
    .where(inArray(creditos_inversionistas.credito_id, idsCred));

  const noCubeFinalPorCredito = new Map<number, number[]>();
  for (const row of rosterFinal) {
    if (row.inversionista_id === CUBE_INVESTMENT_ID) continue;
    const arr = noCubeFinalPorCredito.get(row.credito_id) ?? [];
    arr.push(row.inversionista_id);
    noCubeFinalPorCredito.set(row.credito_id, arr);
  }

  const contaminados = [...noCubeFinalPorCredito.entries()].filter(([, ids]) => ids.length > 0);
  if (contaminados.length > 0) {
    throw new Error(
      `POST-CHECK falló: los siguientes créditos del lote YA NO son CUBE-only tras Movimiento B: ` +
        contaminados.map(([id, ids]) => `${id}:[${ids.join(",")}]`).join("  ") +
        `. No debería pasar (excluir_creditos debió prevenirlo) — investigar antes de dar el run por bueno.`,
    );
  }
  console.log(`✅ POST-CHECK: los ${idsCred.length} créditos del lote siguen CUBE-only (0 no-CUBE cada uno).`);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
