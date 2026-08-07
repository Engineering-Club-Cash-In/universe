/**
 * Alinea el espejo de un inversionista al padre y re-basa su histórico de
 * `monto_aportado` para que `/calcularPagosEspejo` deje de fallar con
 * `[MONTO_ESPEJO_INCONSISTENTE]`.
 *
 * El error sale de `insertPagosCreditoInversionistas` (payments.ts): compara
 * `creditos_inversionistas_espejo.monto_aportado` contra el ÚLTIMO snapshot de
 * `historico_liquidaciones_espejo`, descontando las compras posteriores a ese
 * snapshot. Ese snapshot solo lo escribe la liquidación, así que un inversionista
 * que nunca se liquidó (o al que le amortizaron el espejo a mano) se queda con un
 * histórico viejo y el cuadre revienta.
 *
 * Dos pasos, en este orden:
 *
 *   1. ALINEAR  — `espejo.monto_aportado := padre.monto_aportado` donde difieran.
 *      NO se toca `creditos.capital` ni el padre: el invariante
 *      `SUM(creditos_inversionistas.monto_aportado) == creditos.capital` queda igual.
 *      Solo se mueve la fila del inversionista objetivo; el espejo descuadrado de
 *      TERCEROS en el mismo crédito se reporta pero no se toca.
 *
 *   2. HISTÓRICO — inserta un snapshot nuevo en `historico_liquidaciones_espejo`
 *      con el valor del espejo YA alineado, `liquidacion_id = NULL`. Es una foto de
 *      referencia, no una liquidación: no mueve plata. La base del interés sale de
 *      `creditos_inversionistas_espejo.monto_aportado` (menos ajustes de compras),
 *      no del histórico — el histórico solo valida.
 *
 * Reja de seguridad: alinear el espejo al padre solo es inocuo si el inversionista
 * NUNCA fue liquidado. Con liquidaciones el espejo es un libro aparte y pisarlo
 * cambiaría pagos históricos, así que el script aborta salvo `--permitir-liquidados`.
 *
 * Modo seco por defecto. Para escribir: --apply.
 *
 * Uso:
 *   bun run src/scripts/espejo/alinearEspejoHistorico.ts --inversionista=97
 *   bun run src/scripts/espejo/alinearEspejoHistorico.ts --inversionista=97 --apply
 */
import Big from "big.js";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "../../database";
import {
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  historico_liquidaciones_espejo,
  inversionistas,
  liquidaciones,
} from "../../database/db";

/** Mismos estados que recorre `calcularYRegistrarPagosEspejo` en payments.ts. */
const ESTADOS_VIVOS = [
  "ACTIVO",
  "MOROSO",
  "PENDIENTE_CANCELACION",
  "EN_CONVENIO",
  "CANCELADO",
  "INCOBRABLE",
] as const;

function arg(n: string) {
  const p = process.argv.find((a) => a.startsWith(`--${n}=`));
  return p ? p.slice(n.length + 3) : undefined;
}
const flag = (n: string) => process.argv.includes(`--${n}`);

const INV_ID = Number(arg("inversionista"));
const APLICAR = flag("apply");
const SIN_ALINEAR = flag("sin-alinear");
const SIN_HISTORICO = flag("sin-historico");
const PERMITIR_PROD = flag("permitir-prod");
const PERMITIR_LIQUIDADOS = flag("permitir-liquidados");
const SOLO = arg("solo")?.split(",").map((s) => s.trim()).filter(Boolean);

/**
 * El padre guarda 8 decimales (es el prorrateo del capital) y el espejo suele estar
 * redondeado a 2, así que padre y espejo empatan con ruido de milésimas. Solo se
 * considera descuadre real a partir de un centavo.
 *
 * El histórico NO lleva tolerancia: `insertPagosCreditoInversionistas` compara con
 * `.eq()` exacto, así que cualquier diferencia —por chica que sea— tumba el cálculo.
 */
const TOL_ALINEAR = new Big("0.01");

const q = (v: string | number | null | undefined) =>
  (v == null ? "—" : new Big(v).toFixed(2)).padStart(12);

interface Item {
  credito_id: number;
  sifco: string;
  status: string;
  capital: string;
  padre: string | null;
  espejo: string;
  /** Valor con el que queda el espejo tras el paso 1. */
  espejo_final: string;
  alinear: boolean;
  hist_monto: string | null;
  hist_fecha: Date | null;
  rebasar: boolean;
  terceros_descuadrados: { nombre: string; padre: string; espejo: string }[];
}

async function main() {
  if (!Number.isInteger(INV_ID)) {
    console.error("Falta --inversionista=<id>");
    process.exit(1);
  }

  const url = process.env.SUPABASE_DB_URL ?? "";
  const esProd = /supabase\.com/i.test(url);
  const host = url.replace(/^.*@/, "").split("/")[0] || "(desconocido)";
  console.log(`\n🔌 Base: ${host}${esProd ? "  ⚠️  PRODUCCIÓN" : ""}`);
  if (esProd && APLICAR && !PERMITIR_PROD) {
    console.error("⛔ Abortado: escribir contra producción exige --permitir-prod.");
    process.exit(1);
  }

  const [inv] = await db
    .select({ id: inversionistas.inversionista_id, nombre: inversionistas.nombre })
    .from(inversionistas)
    .where(eq(inversionistas.inversionista_id, INV_ID))
    .limit(1);
  if (!inv) {
    console.error(`⛔ No existe el inversionista ${INV_ID}.`);
    process.exit(1);
  }

  const nLiq = (
    await db
      .select({ id: liquidaciones.liquidacion_id })
      .from(liquidaciones)
      .where(eq(liquidaciones.inversionista_id, INV_ID))
  ).length;

  console.log(`👤 Inversionista ${inv.id} — ${inv.nombre}`);
  console.log(`📑 Liquidaciones registradas: ${nLiq}`);
  if (nLiq > 0 && !PERMITIR_LIQUIDADOS) {
    console.error(
      "\n⛔ Abortado: este inversionista YA tiene liquidaciones. Su espejo es un libro\n" +
        "   aparte (compras de cartera, ajustes manuales) y alinearlo al padre pisaría\n" +
        "   pagos históricos. Revisar caso por caso o correr con --permitir-liquidados."
    );
    process.exit(1);
  }

  // ── Estado vivo ────────────────────────────────────────────────────────────
  const filas = await db
    .select({
      credito_id: creditos_inversionistas_espejo.credito_id,
      espejo: creditos_inversionistas_espejo.monto_aportado,
      sifco: creditos.numero_credito_sifco,
      status: creditos.statusCredit,
      capital: creditos.capital,
    })
    .from(creditos_inversionistas_espejo)
    .innerJoin(creditos, eq(creditos.credito_id, creditos_inversionistas_espejo.credito_id))
    .where(
      and(
        eq(creditos_inversionistas_espejo.inversionista_id, INV_ID),
        inArray(creditos.statusCredit, ESTADOS_VIVOS as unknown as string[])
      )
    );

  const items: Item[] = [];
  for (const f of filas) {
    if (SOLO && !SOLO.includes(f.sifco)) continue;

    const [padreRow] = await db
      .select({ monto: creditos_inversionistas.monto_aportado })
      .from(creditos_inversionistas)
      .where(
        and(
          eq(creditos_inversionistas.credito_id, f.credito_id),
          eq(creditos_inversionistas.inversionista_id, INV_ID)
        )
      )
      .limit(1);

    const [hist] = await db
      .select({
        monto: historico_liquidaciones_espejo.monto_aportado,
        fecha: historico_liquidaciones_espejo.fecha,
      })
      .from(historico_liquidaciones_espejo)
      .where(
        and(
          eq(historico_liquidaciones_espejo.credito_id, f.credito_id),
          eq(historico_liquidaciones_espejo.inversionista_id, INV_ID)
        )
      )
      .orderBy(desc(historico_liquidaciones_espejo.fecha))
      .limit(1);

    const padre = padreRow?.monto ?? null;
    const alinear =
      !SIN_ALINEAR &&
      padre != null &&
      new Big(f.espejo).minus(new Big(padre)).abs().gte(TOL_ALINEAR);
    const espejoFinal = alinear ? new Big(padre!).toFixed(8) : new Big(f.espejo).toFixed(8);
    const rebasar =
      !SIN_HISTORICO && hist != null && !new Big(espejoFinal).eq(new Big(hist.monto));

    // Terceros con el espejo descuadrado en el mismo crédito: se reportan, no se tocan.
    const otros = await db
      .select({
        nombre: inversionistas.nombre,
        padre: creditos_inversionistas.monto_aportado,
        espejo: creditos_inversionistas_espejo.monto_aportado,
      })
      .from(creditos_inversionistas)
      .innerJoin(
        inversionistas,
        eq(inversionistas.inversionista_id, creditos_inversionistas.inversionista_id)
      )
      .leftJoin(
        creditos_inversionistas_espejo,
        and(
          eq(creditos_inversionistas_espejo.credito_id, creditos_inversionistas.credito_id),
          eq(
            creditos_inversionistas_espejo.inversionista_id,
            creditos_inversionistas.inversionista_id
          )
        )
      )
      .where(eq(creditos_inversionistas.credito_id, f.credito_id));

    items.push({
      credito_id: f.credito_id,
      sifco: f.sifco,
      status: f.status ?? "",
      capital: f.capital ?? "0",
      padre,
      espejo: f.espejo,
      espejo_final: espejoFinal,
      alinear,
      hist_monto: hist?.monto ?? null,
      hist_fecha: hist?.fecha ? new Date(hist.fecha) : null,
      rebasar,
      terceros_descuadrados: otros
        .filter(
          (o) =>
            o.nombre !== inv.nombre &&
            o.espejo != null &&
            new Big(o.espejo).minus(new Big(o.padre ?? 0)).abs().gte(TOL_ALINEAR)
        )
        .map((o) => ({
          nombre: o.nombre,
          padre: new Big(o.padre ?? 0).toFixed(2),
          espejo: new Big(o.espejo ?? 0).toFixed(2),
        })),
    });
  }

  items.sort((a, b) => a.sifco.localeCompare(b.sifco));

  // ── Reporte ────────────────────────────────────────────────────────────────
  console.log(`\n📊 Créditos vivos con espejo de ${inv.nombre}: ${items.length}\n`);
  console.log(
    "SIFCO                                      STATUS         PADRE       ESPEJO   " +
      "  ESPEJO→      HIST     ACCIÓN"
  );
  console.log("─".repeat(120));
  for (const it of items) {
    const acciones = [it.alinear ? "alinear" : "", it.rebasar ? "histórico" : ""]
      .filter(Boolean)
      .join(" + ");
    console.log(
      `${it.sifco.padEnd(42)} ${it.status.padEnd(12)} ${q(it.padre)} ${q(it.espejo)} ` +
        `${q(it.espejo_final)} ${q(it.hist_monto)}  ${acciones || "—"}`
    );
  }

  const aAlinear = items.filter((i) => i.alinear);
  const aRebasar = items.filter((i) => i.rebasar);
  console.log(
    `\n➡️  A alinear espejo→padre: ${aAlinear.length}   ` +
      `A re-basar histórico: ${aRebasar.length}`
  );

  const conTerceros = items.filter(
    (i) => (i.alinear || i.rebasar) && i.terceros_descuadrados.length
  );
  if (conTerceros.length) {
    console.log(
      `\n⚠️  Terceros con espejo ≠ padre en esos créditos (NO se tocan, revisión aparte):`
    );
    for (const it of conTerceros) {
      for (const t of it.terceros_descuadrados) {
        console.log(
          `   ${it.sifco}  ${t.nombre.padEnd(26)} padre ${t.padre.padStart(12)}  espejo ${t.espejo.padStart(12)}`
        );
      }
    }
  }

  if (!APLICAR) {
    console.log("\n🧪 Modo seco. Nada se escribió. Agregá --apply para aplicar.");
    process.exit(0);
  }

  // ── Aplicar ────────────────────────────────────────────────────────────────
  const ahora = new Date();
  let alineados = 0;
  let historicos = 0;
  const errores: string[] = [];

  for (const it of items) {
    if (!it.alinear && !it.rebasar) continue;
    try {
      await db.transaction(async (tx) => {
        if (it.alinear) {
          await tx
            .update(creditos_inversionistas_espejo)
            .set({ monto_aportado: it.espejo_final, updated_at: ahora })
            .where(
              and(
                eq(creditos_inversionistas_espejo.credito_id, it.credito_id),
                eq(creditos_inversionistas_espejo.inversionista_id, INV_ID)
              )
            );
          alineados++;
        }
        if (it.rebasar) {
          await tx.insert(historico_liquidaciones_espejo).values({
            monto_aportado: it.espejo_final,
            inversionista_id: INV_ID,
            credito_id: it.credito_id,
            liquidacion_id: null,
            fecha: ahora,
          });
          historicos++;
        }
      });
      console.log(
        `✅ ${it.sifco}  ${it.alinear ? `espejo ${new Big(it.espejo).toFixed(2)} → ${new Big(it.espejo_final).toFixed(2)}` : ""}` +
          `${it.alinear && it.rebasar ? " | " : ""}` +
          `${it.rebasar ? `histórico ${new Big(it.hist_monto ?? 0).toFixed(2)} → ${new Big(it.espejo_final).toFixed(2)}` : ""}`
      );
    } catch (e: any) {
      errores.push(`${it.sifco}: ${e?.message ?? e}`);
      console.error(`❌ ${it.sifco}: ${e?.message ?? e}`);
    }
  }

  console.log(
    `\n🏁 Espejos alineados: ${alineados}   Snapshots de histórico insertados: ${historicos}   Errores: ${errores.length}`
  );
  process.exit(errores.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
