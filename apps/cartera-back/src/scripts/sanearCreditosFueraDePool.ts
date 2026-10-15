/**
 * COBROS-02 · SANEAMIENTO de créditos cuyo asesor no está en el pool de su
 * bucket actual (2026-10-15).
 *
 * Por qué hace falta. El paso 6 de `alinear_desde_prod.sh` (02 con conservar=1)
 * derivaba el bucket de la MORA ACTIVA, no del historial del motor. Un crédito
 * con capital 0 o negativo no lleva mora, así que lo leía como B0 y se lo daba
 * a una asesora de B0, mientras el motor —que cuenta cuotas— lo tenía en B3/B5.
 * Y el motor solo reasignaba al CAMBIAR de bucket, así que nunca lo corregía.
 * Casos del sandbox: 286 (B5), 930 (B5) y 8845 (B3). Las dos cosas ya están
 * arregladas (02 lee el bucket como el motor y el motor concilia cada noche);
 * este script limpia lo que quedó.
 *
 * Qué hace. Lista los créditos del funnel cuyo asesor no es elegible en su
 * bucket actual (`getCreditosFueraDePool`, la misma lectura de
 * `GET /buckets/creditos-fuera-de-pool`) y los reasigna con la regla del motor
 * (`elegirAsesorParaBucket`, carga viva). Escribe por la reasignación en bloque
 * existente (`reasignarAsesorLote`): locks por crédito y de los jobs,
 * compare-and-swap sobre el dueño leído y fila en `credito_asesor_historial`
 * (origen API_MANUAL, con el motivo de abajo). No hay UPDATE a mano.
 *
 * No toca:
 *   · EN_CONVENIO: el convenio congela bucket y asesor (decisión 9 del plan 08).
 *     Se listan aparte para revisarlos a mano.
 *   · Créditos de un asesor con ausencia abierta: los resuelve la devolución.
 *   · Buckets sin nadie elegible: se listan; hay que configurar el pool.
 *
 * Es IDEMPOTENTE: un crédito que ya quedó con un asesor elegible no vuelve a
 * salir. Se puede correr las veces que haga falta.
 *
 * ── Cómo se corre (desde apps/cartera-back) ────────────────────────────────
 *     bun run src/scripts/sanearCreditosFueraDePool.ts --dry-run
 *     bun run src/scripts/sanearCreditosFueraDePool.ts --aplicar --confirmar-bd=ep-green-tree [--usuario=correo@clubcashin.com]
 *
 * Sin `--aplicar` solo lista (es lo mismo que `--dry-run`). Toma la conexión de
 * `SUPABASE_DB_URL` y el schema de `CARTERA_SCHEMA`, como el resto de la app.
 * Se niega a correr contra producción (Supabase / ep-winter-butterfly): COBROS-02
 * vive en el sandbox hasta el pase, y ahí la conciliación nocturna del motor ya
 * cubre esto.
 */

import { sql } from "drizzle-orm";
import { client, db, lockPool } from "../database";
import { CARTERA_SCHEMA } from "../database/db/schema";
import {
  type CreditoFueraDePool,
  getAsesoresConAusenciaAbierta,
  getCreditosFueraDePool,
} from "../controllers/buckets/creditosFueraDePool";
import { getCargaDelBucket } from "../controllers/buckets/recuperacionVehiculo";
import { getAsesoresPorBucket } from "../controllers/buckets/reasignarAsesor";
import { reasignarAsesorLote } from "../controllers/buckets/reasignarAsesorLote";
import { MAX_CREDITOS_LOTE } from "../lib/buckets-reasignacion-lote";
import { planificarConciliacion } from "../lib/buckets-conciliacion-pool";

const MOTIVO =
  "Saneamiento COBROS-02: el asesor no estaba en el pool del bucket actual del crédito; se reasigna con la regla del motor (sanearCreditosFueraDePool)";

const args = process.argv.slice(2);
const APLICAR = args.includes("--aplicar");
const arg = (nombre: string) =>
  args.find((a) => a.startsWith(`--${nombre}=`))?.slice(nombre.length + 3);
const CONFIRMAR_BD = arg("confirmar-bd");
const USUARIO = arg("usuario");

function hostDe(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function fila(c: CreditoFueraDePool, nombres: Map<number, string>, destino?: number | null) {
  const dueno = c.asesor_id === null ? "(sin asesor)" : `${c.asesor_id} ${c.asesor_nombre ?? ""}`.trim();
  const pool = c.pool_del_bucket.length
    ? c.pool_del_bucket.map((id) => `${id} ${nombres.get(id) ?? ""}`.trim()).join(", ")
    : "—";
  return {
    credito_id: c.credito_id,
    sifco: c.numero_credito_sifco,
    estado: c.status_credito,
    bucket: `B${c.bucket}`,
    asesor_actual: dueno,
    pool_del_bucket: pool,
    ...(destino !== undefined
      ? { pasa_a: destino === null ? "—" : `${destino} ${nombres.get(destino) ?? ""}`.trim() }
      : {}),
  };
}

async function main() {
  const host = hostDe(process.env.SUPABASE_DB_URL);
  if (!host) throw new Error("SUPABASE_DB_URL no está definida o no se puede leer el host.");
  if (host.includes("supabase.com") || host.includes("ep-winter-butterfly")) {
    throw new Error(`Host de PRODUCCIÓN (${host}): este script solo corre contra el sandbox.`);
  }
  if (APLICAR && (!CONFIRMAR_BD || !host.includes(CONFIRMAR_BD))) {
    throw new Error(
      `Para escribir hay que confirmar la base: --confirmar-bd=<parte del host>. Host actual: ${host}`,
    );
  }

  console.log(
    `\n🧹 Saneamiento de créditos fuera del pool de su bucket\n   host:   ${host}\n   schema: ${CARTERA_SCHEMA}\n   modo:   ${APLICAR ? "APLICAR (escribe)" : "DRY-RUN (solo lista, no escribe)"}\n`,
  );

  // Toda la lectura va en UNA transacción READ ONLY: el dry-run no puede escribir
  // aunque alguien cambie estas funciones, y el plan sale de una sola foto. Las
  // escrituras de --aplicar van después, cada tanda en su propia transacción.
  const nombres = new Map<number, string>();
  const poolPorBucket = new Map<number, number[]>();
  const cargaPorBucket = new Map<number, Map<number, number>>();
  const { candidatos, convenios, ausentes } = await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const candidatos = await getCreditosFueraDePool({}, tx);
    const conConvenios = await getCreditosFueraDePool({ incluirConvenios: true }, tx);
    const ausentes = await getAsesoresConAusenciaAbierta(tx);
    for (const c of conConvenios) {
      if (c.asesor_id !== null && c.asesor_nombre) nombres.set(c.asesor_id, c.asesor_nombre);
    }
    // Pool y carga viva de cada bucket involucrado, con las mismas funciones que
    // la reasignación en bloque (que vuelve a validar el pool bajo sus locks).
    const buckets = [...new Set(candidatos.map((c) => c.bucket))].sort((a, b) => a - b);
    for (const bucket of buckets) {
      const pool = await getAsesoresPorBucket(bucket, tx, true);
      for (const a of pool) nombres.set(a.asesor_id, a.nombre);
      poolPorBucket.set(bucket, pool.map((a) => a.asesor_id));
      cargaPorBucket.set(bucket, await getCargaDelBucket(bucket, tx));
    }
    return {
      candidatos,
      convenios: conConvenios.filter((c) => c.status_credito === "EN_CONVENIO"),
      ausentes,
    };
  });

  const plan = planificarConciliacion({ candidatos, poolPorBucket, cargaPorBucket, ausentes });
  const destinoDe = new Map(plan.aReasignar.map((a) => [a.credito_id, a.asesor_nuevo]));
  const porId = new Map(candidatos.map((c) => [c.credito_id, c]));

  console.log(`Créditos del funnel con un asesor que no atiende su bucket: ${candidatos.length}`);
  if (plan.aReasignar.length > 0) {
    console.log(`\n▶ Se reasignan (${plan.aReasignar.length}):`);
    console.table(plan.aReasignar.map((a) => fila(porId.get(a.credito_id)!, nombres, destinoDe.get(a.credito_id))));
  }
  if (plan.sinElegible.length > 0) {
    console.log(`\n⚠️ Sin nadie elegible en el pool de su bucket — se quedan como están (${plan.sinElegible.length}):`);
    console.table(plan.sinElegible.map((c) => fila(porId.get(c.credito_id)!, nombres)));
  }
  if (plan.omitidosPorAusencia.length > 0) {
    console.log(`\n⏸️ Asesor con ausencia abierta — los resuelve la devolución (${plan.omitidosPorAusencia.length}):`);
    console.table(plan.omitidosPorAusencia.map((c) => fila(porId.get(c.credito_id)!, nombres)));
  }
  if (convenios.length > 0) {
    console.log(
      `\nℹ️ EN_CONVENIO con un asesor fuera del pool de su bucket congelado — NO se tocan, revisar a mano (${convenios.length}):`,
    );
    console.table(convenios.map((c) => fila(c, nombres)));
  }

  if (!APLICAR) {
    const fragmento = host.includes("ep-green-tree") ? "ep-green-tree" : "<parte del host>";
    console.log(
      `\nDRY-RUN: no se escribió nada. Para aplicar:\n  bun run src/scripts/sanearCreditosFueraDePool.ts --aplicar --confirmar-bd=${fragmento}\n`,
    );
    return;
  }
  if (plan.aReasignar.length === 0) {
    console.log("\nNada que reasignar.");
    return;
  }

  // Un lote por asesor destino (la reasignación en bloque es de N créditos a
  // UN asesor), en tandas del máximo que acepta. Cada tanda es todo o nada.
  const porDestino = new Map<number, typeof plan.aReasignar>();
  for (const a of plan.aReasignar) {
    const lista = porDestino.get(a.asesor_nuevo) ?? [];
    lista.push(a);
    porDestino.set(a.asesor_nuevo, lista);
  }
  let reasignados = 0;
  let omitidos = 0;
  let fallidos = 0;
  for (const [destino, lista] of porDestino) {
    for (let i = 0; i < lista.length; i += MAX_CREDITOS_LOTE) {
      const tanda = lista.slice(i, i + MAX_CREDITOS_LOTE);
      const esperados = new Map<number, number>();
      for (const a of tanda) if (a.asesor_anterior !== null) esperados.set(a.credito_id, a.asesor_anterior);
      const r = await reasignarAsesorLote({
        credito_ids: tanda.map((a) => a.credito_id),
        asesor_nuevo_id: destino,
        motivo: MOTIVO,
        usuario_email: USUARIO,
        duenios_esperados: esperados,
      });
      if (r.success) {
        reasignados += r.reasignados.length;
        omitidos += r.omitidos.length;
        console.log(
          `  ✅ → asesor ${destino} ${nombres.get(destino) ?? ""}: ${r.reasignados.length} reasignado(s)${r.omitidos.length ? `, ${r.omitidos.length} omitido(s): ${r.omitidos.map((o) => `${o.credito_id} (${o.motivo})`).join(", ")}` : ""}`,
        );
      } else {
        fallidos += tanda.length;
        console.error(
          `  ❌ → asesor ${destino}: ${r.message}${r.errores?.length ? ` — ${r.errores.map((e) => `${e.credito_id}: ${e.message}`).join(" | ")}` : ""}`,
        );
      }
    }
  }

  const quedan = await getCreditosFueraDePool();
  console.log(
    `\nResultado: ${reasignados} reasignado(s), ${omitidos} omitido(s), ${fallidos} en tandas que fallaron. Quedan fuera del pool: ${quedan.length}${quedan.length ? ` (${quedan.map((c) => c.credito_id).join(", ")})` : ""}.\nSi alguna tanda falló por el job de moras/convenios, vuelva a correrlo: es idempotente.\n`,
  );
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([client.end(), lockPool.end()]);
  });
