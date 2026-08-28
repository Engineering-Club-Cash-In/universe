// ============================================================
// Backfill de `facturas_electronicas.concepto` (+ inversionista_id).
//
// Contexto:
//   La columna `concepto` la agregó la migración 0030 para poder re-facturar solo
//   los rubros que faltaron cuando una corrida de /facturar-pago-completo sale a
//   medias (src/cofidi/facturasFaltantes.ts). Todo lo emitido ANTES de esa
//   migración quedó en NULL, y el diff trata "concepto NULL" como BLOQUEADO:
//   esos pagos siguen necesitando anular todo a mano.
//
//   Este script infiere el concepto a posteriori CRUZANDO POR MONTO el
//   `monto_total` del DTE contra los rubros del mismo pago.
//
// Fuentes de candidatos (por pago):
//   • cartera.facturacion_desglose (cuando existe, es lo que el endpoint escribió):
//       rubro MORA                      → MORA
//       rubro OTROS                     → OTROS
//       rubros SEGURO + GPS + MEMBRESIA → OTROS_SERVICIOS (van en UN solo DTE)
//       rubro INTERES                   → INTERESES_CUBE (residuo CUBE + cash_in)
//   • cartera.pagos_credito (fallback: el desglose solo existe desde 2026 y cubre
//       una fracción de las facturas). mora / otros / seguro+gps+membresía son los
//       MISMOS montos que el endpoint le pasa a calcularIvaExacto, así que el
//       cruce es igual de exacto. INTERESES_CUBE NO tiene fallback: el residuo de
//       CUBE no se puede reconstruir desde pagos_credito.
//   • cartera.pagos_credito_inversionistas (o ..._facturado si pci está vacío):
//       (abono_interes + abono_iva_12) por inversionista no-CUBE → INTERESES + su id.
//
// REGLA DE ORO: solo se etiquetan matches INEQUÍVOCOS.
//   Si dos rubros distintos del mismo pago tienen el mismo monto, o si nada cuadra,
//   la factura se deja en NULL. Etiquetar mal es peor que no etiquetar: el diff
//   creería que un rubro ya está facturado y NO lo emitiría (sub-facturación).
//   Único desempate permitido: el emisor_nit. Si el DTE lo emitió un facturador
//   propio (SE PRESTA / AMJK / AUTOCASH / ...) es INTERESES sí o sí, y el
//   inversionista es el que hace match con ese facturador.
//
//   Corolario importante: en los pagos SIN desglose y CON interés existe un DTE
//   de CUBE cuyo monto no se puede reconstruir. Un match "único" sobre una
//   factura emitida por CUBE en esos pagos NO es inequívoco — podría ser ese DTE
//   de intereses. Se marcan como ambiguas (ver 2b). Esto cuesta cobertura
//   (73% → 46% en el dump) y evita etiquetar mal ~5.5k facturas.
//
// USO:
//   SUPABASE_DB_URL=postgresql://postgres:...@localhost:5433/dump20260828 \
//     bun run src/scripts/backfill-concepto-facturas.ts            # dry-run (default)
//   ... bun run src/scripts/backfill-concepto-facturas.ts --apply  # escribe
//
//   Opcional: --sample=N ejemplos por categoría; --csv=RUTA para el reporte de
//   re-emisiones (default /private/tmp/backfill-concepto-reemisiones.csv).
//
// ⚠️ ANTES DE --apply EN PROD: revisar con conta el CSV de re-emisiones. Etiquetar
//    habilita el modo FALTANTES, y los pagos listados ahí emitirían DTEs nuevos
//    ante SAT si alguien los re-factura.
// ============================================================
import { sql } from "drizzle-orm";
import Big from "big.js";
import { db, client } from "../database";
import {
  CLUB_CASHIN_CONFIG,
  INVERSIONISTAS_FACTURADORES,
  esInversionistaCube,
} from "../utils/functions/const";
import { big, computarDiffFacturas } from "../cofidi/facturasFaltantes";

Big.DP = 20;
Big.RM = Big.roundHalfUp;

const APPLY = process.argv.includes("--apply");
const SAMPLE = Number(
  process.argv.find((a) => a.startsWith("--sample="))?.split("=")[1] ?? 3
);
/** CSV con los pagos que quedarían re-facturables (para que conta los revise). */
const CSV_PATH =
  process.argv.find((a) => a.startsWith("--csv="))?.split("=")[1] ??
  "/private/tmp/backfill-concepto-reemisiones.csv";

/** NIT emisor de CUBE: cualquier otro NIT es un facturador propio de inversionista. */
const NIT_CUBE = CLUB_CASHIN_CONFIG.emisor.nit;

/** NIT del facturador propio → palabras clave del nombre del inversionista.
 *  DERIVADO de INVERSIONISTAS_FACTURADORES (fuente única): una copia a mano ya
 *  había nacido desfasada (a SE PRESTA le faltaban variantes de keywords). */
const FACTURADORES_POR_NIT: Record<string, string[]> = Object.fromEntries(
  INVERSIONISTAS_FACTURADORES.map((f) => [String(f.config.emisor.nit), f.keywords])
);

type Concepto = "MORA" | "OTROS_SERVICIOS" | "OTROS" | "INTERESES" | "INTERESES_CUBE";

type Candidato = {
  concepto: Concepto;
  inversionista_id: number | null;
  /** Nombre del inversionista (solo INTERESES), para desempatar por emisor. */
  nombre?: string;
  monto: string; // fixed(2)
  fuente: string;
};

/** Normaliza a 2 decimales con la MISMA tolerancia que los bloques de emisión y
 *  el diff (helper `big` de facturasFaltantes): NULL/''/basura → 0, pero
 *  '12abc' → 12.00 igual que el parseFloat con que se facturó. Zerear esos
 *  valores (como hacía la versión anterior) perdía el candidato de un rubro que
 *  SÍ se facturó, abriendo la puerta a un match coincidencial con otro rubro. */
const fix2 = (v: unknown) => big(v as any).toFixed(2);

/** `= ANY(...)` con una lista larga: drizzle inlinaría un ROW(...) y Postgres
 *  revienta pasadas 1664 entradas. Se manda como UN parámetro de texto. */
const idsCsv = (ids: number[]) => ids.join(",");
const esCube = esInversionistaCube;

async function main() {
  console.log(`\n🏷️  Backfill de concepto en facturas_electronicas (${APPLY ? "APPLY" : "DRY-RUN"})\n`);

  // ── 1. Facturas sin etiquetar (ACTIVAS y ANULADAS, con pago) ────────────────
  const facturasRes = await db.execute(sql`
    SELECT factura_id, pago_id, monto_total::text AS monto_total, emisor_nit, status::text AS status
    FROM cartera.facturas_electronicas
    WHERE concepto IS NULL
      AND pago_id IS NOT NULL
    ORDER BY factura_id
  `);
  const facturas = (facturasRes as any).rows as {
    factura_id: number;
    pago_id: number;
    monto_total: string;
    emisor_nit: string | null;
    status: string;
  }[];

  if (facturas.length === 0) {
    console.log("✅ No hay facturas sin concepto con pago asociado. Nada que hacer.");
    return;
  }

  const pagoIds = [...new Set(facturas.map((f) => f.pago_id))];
  console.log(`📄 ${facturas.length} factura(s) sin concepto sobre ${pagoIds.length} pago(s).`);

  // ── 2. Candidatos por pago ─────────────────────────────────────────────────
  const candidatos = new Map<number, Candidato[]>();
  const push = (pago_id: number, c: Candidato) => {
    if (new Big(c.monto).lte(0)) return;
    const arr = candidatos.get(pago_id) ?? [];
    arr.push(c);
    candidatos.set(pago_id, arr);
  };

  // 2a. facturacion_desglose (fuente preferida: es lo que escribió el endpoint).
  const desgloseRes = await db.execute(sql`
    SELECT pago_id, rubro::text AS rubro, monto_total::text AS monto_total
    FROM cartera.facturacion_desglose
    WHERE pago_id = ANY(string_to_array(${idsCsv(pagoIds)}, ',')::int[])
  `);
  const porPagoDesglose = new Map<number, Map<string, Big>>();
  for (const r of (desgloseRes as any).rows as any[]) {
    const m = porPagoDesglose.get(r.pago_id) ?? new Map<string, Big>();
    m.set(r.rubro, (m.get(r.rubro) ?? new Big(0)).plus(new Big(r.monto_total)));
    porPagoDesglose.set(r.pago_id, m);
  }
  for (const [pago_id, rubros] of porPagoDesglose) {
    push(pago_id, { concepto: "MORA", inversionista_id: null, monto: fix2(rubros.get("MORA") ?? 0), fuente: "desglose" });
    push(pago_id, { concepto: "OTROS", inversionista_id: null, monto: fix2(rubros.get("OTROS") ?? 0), fuente: "desglose" });
    const otrosServicios = (rubros.get("SEGURO") ?? new Big(0))
      .plus(rubros.get("GPS") ?? new Big(0))
      .plus(rubros.get("MEMBRESIA") ?? new Big(0));
    push(pago_id, { concepto: "OTROS_SERVICIOS", inversionista_id: null, monto: fix2(otrosServicios), fuente: "desglose" });
    // El rubro INTERES del desglose ES el total del DTE de CUBE (residuo + cash_in).
    push(pago_id, { concepto: "INTERESES_CUBE", inversionista_id: null, monto: fix2(rubros.get("INTERES") ?? 0), fuente: "desglose" });
  }

  // 2b. pagos_credito como fallback para los pagos SIN desglose.
  //
  // ⚠️ Acá NO hay candidato INTERESES_CUBE: el residuo de CUBE es
  //    (interés+IVA) − Σ partes no-CUBE + cash_in, y esas partes salen del
  //    `monto_aportado` del roster EN EL MOMENTO de facturar, que para un pago
  //    viejo ya no se puede recuperar (el roster cambia con reinversiones y
  //    compras de cartera). Reconstruirlo con el roster de HOY daría un candidato
  //    posiblemente equivocado, y un candidato equivocado puede producir una
  //    ETIQUETA equivocada — mucho peor que perder cobertura.
  //
  //    Pero omitir el candidato NO vuelve seguro el match: si el pago tiene
  //    interés, existe un DTE de CUBE cuyo monto no conocemos, y puede empatar
  //    con mora/otros/otros_servicios. Caso real del dump: factura 4315 (pago
  //    116815) de Q882.00 se etiquetaba MORA cuando el totalCube del loop también
  //    da Q882.00 → tras --apply el diff habría emitido un SEGUNDO DTE de Q882
  //    ante SAT. Por eso `pagosConCubeIrreconstruible` marca esos pagos y el
  //    matcher trata como AMBIGUA cualquier factura emitida por CUBE en ellos.
  //
  //    ⚠️ El mismo hoyo existe con desglose PARCIAL: si el flujo de interés de la
  //    corrida original abortó (interesFlujoOk=false), el desglose tiene filas de
  //    MORA/OTROS/etc. pero NO la fila INTERES — y el DTE de CUBE (si alcanzó a
  //    emitirse) es igual de irreconstruible. Una fila INTERES=0 sí es confiable
  //    (flujo OK con residuo 0 → no hubo DTE de CUBE). Por eso la guarda mira
  //    "falta la fila INTERES", no "falta todo el desglose".
  const pagosSinDesglose = pagoIds.filter((p) => !porPagoDesglose.has(p));
  const pagosConCubeIrreconstruible = new Set<number>();
  {
    const pagosRes = await db.execute(sql`
      SELECT pago_id, mora, otros, abono_seguro, abono_gps, membresias_pago, abono_interes
      FROM cartera.pagos_credito
      WHERE pago_id = ANY(string_to_array(${idsCsv(pagoIds)}, ',')::int[])
    `);
    const sinDesglose = new Set(pagosSinDesglose);
    for (const p of (pagosRes as any).rows as any[]) {
      const desglose = porPagoDesglose.get(p.pago_id);
      const hayInteres = new Big(fix2(p.abono_interes)).gt(0);
      if (hayInteres && (!desglose || !desglose.has("INTERES"))) {
        pagosConCubeIrreconstruible.add(p.pago_id);
      }

      if (!sinDesglose.has(p.pago_id)) continue; // el fallback 2b es solo sin desglose
      push(p.pago_id, { concepto: "MORA", inversionista_id: null, monto: fix2(p.mora), fuente: "pagos_credito" });
      push(p.pago_id, { concepto: "OTROS", inversionista_id: null, monto: fix2(p.otros), fuente: "pagos_credito" });
      const otrosServicios = new Big(fix2(p.abono_seguro))
        .plus(fix2(p.abono_gps))
        .plus(fix2(p.membresias_pago));
      push(p.pago_id, { concepto: "OTROS_SERVICIOS", inversionista_id: null, monto: fix2(otrosServicios), fuente: "pagos_credito" });
    }
  }

  // 2c. Parte de cada inversionista no-CUBE (interés + IVA) → INTERESES.
  //     pci manda; pcif (el congelado) cubre los pagos parciales donde pci está vacío.
  const invRes = await db.execute(sql`
    SELECT pci.pago_id,
           pci.inversionista_id,
           i.nombre,
           (pci.abono_interes + pci.abono_iva_12)::text AS total,
           'pci' AS fuente
    FROM cartera.pagos_credito_inversionistas pci
    JOIN cartera.inversionistas i ON i.inversionista_id = pci.inversionista_id
    WHERE pci.pago_id = ANY(string_to_array(${idsCsv(pagoIds)}, ',')::int[])
    UNION ALL
    SELECT f.pago_id,
           f.inversionista_id,
           i.nombre,
           (f.abono_interes + f.abono_iva_12)::text AS total,
           'pcif' AS fuente
    FROM cartera.pagos_credito_inversionistas_facturado f
    JOIN cartera.inversionistas i ON i.inversionista_id = f.inversionista_id
    WHERE f.pago_id = ANY(string_to_array(${idsCsv(pagoIds)}, ',')::int[])
      -- Por (pago, inversionista) y NO solo por pago: una distribución pci que
      -- quedó a medias (filas para 2 de 3 inversionistas — modo de falla real,
      -- repair c1094) dejaría al 3º sin candidato si el NOT EXISTS fuera por pago.
      AND NOT EXISTS (
        SELECT 1 FROM cartera.pagos_credito_inversionistas p2
        WHERE p2.pago_id = f.pago_id
          AND p2.inversionista_id = f.inversionista_id
      )
  `);
  for (const r of (invRes as any).rows as any[]) {
    if (esCube(r.nombre)) continue; // el DTE de CUBE es el residuo, no su fila de pci
    push(r.pago_id, {
      concepto: "INTERESES",
      inversionista_id: r.inversionista_id,
      nombre: r.nombre,
      monto: fix2(r.total),
      fuente: r.fuente,
    });
  }

  // ── 3. Match por monto (+ desempate por emisor) ────────────────────────────
  const decisiones: {
    factura_id: number;
    pago_id: number;
    concepto: Concepto;
    inversionista_id: number | null;
    fuente: string;
  }[] = [];
  const sinMatch: typeof facturas = [];
  const ambiguas: { f: (typeof facturas)[number]; opciones: string[] }[] = [];
  const porConcepto = new Map<string, number>();
  const porFuente = new Map<string, number>();
  const ejemplos = new Map<string, string[]>();

  const anota = (k: string, linea: string) => {
    const arr = ejemplos.get(k) ?? [];
    if (arr.length < SAMPLE) arr.push(linea);
    ejemplos.set(k, arr);
  };

  for (const f of facturas) {
    const monto = fix2(f.monto_total);
    let matches = (candidatos.get(f.pago_id) ?? []).filter((c) => c.monto === monto);

    // Restricción por emisor: un NIT que no es el de CUBE solo puede ser el DTE
    // de intereses de ESE inversionista (los rubros MORA/OTROS/etc. siempre los
    // emite CUBE). Se aplica SIEMPRE — no solo como desempate con matches>1: un
    // match ÚNICO de MORA sobre una factura de AUTOCASH no es "inequívoco", es
    // una coincidencia de montos con el candidato INTERESES ausente (pci/pcif
    // incompletos). Sin esta restricción se etiquetaba ese rubro con confianza.
    if (f.emisor_nit && f.emisor_nit !== NIT_CUBE) {
      const keywords = FACTURADORES_POR_NIT[f.emisor_nit];
      matches = matches.filter(
        (c) =>
          c.concepto === "INTERESES" &&
          // NIT conocido: además el candidato debe ser el inversionista de ESE
          // facturador. NIT no-CUBE desconocido: al menos nunca MORA/OTROS/etc.
          (!keywords || keywords.some((k) => (c.nombre ?? "").toUpperCase().includes(k)))
      );
    }

    // Duplicados exactos del MISMO candidato (p. ej. pci y desglose coincidiendo)
    // no son ambigüedad: colapsan a una sola decisión.
    const unicos = new Map<string, Candidato>();
    for (const c of matches) unicos.set(`${c.concepto}:${c.inversionista_id ?? ""}`, c);
    matches = [...unicos.values()];

    // 🛡️ Candidato INTERESES_CUBE DESCONOCIDO (pago sin desglose y con interés).
    //    El DTE de CUBE sale con el NIT de CUBE, igual que MORA/OTROS/etc., así
    //    que un match sobre una factura emitida por CUBE puede ser en realidad
    //    ese DTE de intereses. Sin forma de distinguirlos → AMBIGUA → NULL.
    //    Las emitidas por un facturador propio quedan a salvo: el DTE de CUBE
    //    nunca sale con el NIT de AUTOCASH/AMJK/SE PRESTA/...
    //    emisor_nit NULL (facturas viejas) se trata como CUBE por precaución.
    const emisorPuedeSerCube = !f.emisor_nit || f.emisor_nit === NIT_CUBE;
    if (
      matches.length > 0 &&
      emisorPuedeSerCube &&
      pagosConCubeIrreconstruible.has(f.pago_id)
    ) {
      ambiguas.push({ f, opciones: [...matches.map((c) => c.concepto), "INTERESES_CUBE(desconocido)"] });
      anota(
        "ambigua_cube_desconocido",
        `factura ${f.factura_id} (pago ${f.pago_id}) Q${monto} → ${matches.map((c) => c.concepto).join("|")} vs el DTE de CUBE del pago, que no se puede reconstruir`
      );
      continue;
    }

    if (matches.length === 1) {
      const c = matches[0];
      decisiones.push({
        factura_id: f.factura_id,
        pago_id: f.pago_id,
        concepto: c.concepto,
        inversionista_id: c.concepto === "INTERESES" ? c.inversionista_id : null,
        fuente: c.fuente,
      });
      const k = c.concepto;
      porConcepto.set(k, (porConcepto.get(k) ?? 0) + 1);
      porFuente.set(c.fuente, (porFuente.get(c.fuente) ?? 0) + 1);
      anota(`ok:${k}`, `factura ${f.factura_id} (pago ${f.pago_id}) Q${monto} → ${k}${c.inversionista_id ? ` inv ${c.inversionista_id}` : ""} [${c.fuente}]`);
    } else if (matches.length === 0) {
      sinMatch.push(f);
      anota("sin_match", `factura ${f.factura_id} (pago ${f.pago_id}) Q${monto} emisor ${f.emisor_nit ?? "?"} | candidatos: ${(candidatos.get(f.pago_id) ?? []).map((c) => `${c.concepto}=${c.monto}`).join(", ") || "ninguno"}`);
    } else {
      const opciones = matches.map((c) => `${c.concepto}${c.inversionista_id ? `:${c.inversionista_id}` : ""}`);
      ambiguas.push({ f, opciones });
      anota("ambigua", `factura ${f.factura_id} (pago ${f.pago_id}) Q${monto} → ${opciones.join(" | ")}`);
    }
  }

  // ── 4. Reporte ─────────────────────────────────────────────────────────────
  const pct = (n: number) => `${((n / facturas.length) * 100).toFixed(1)}%`;
  console.log(`\n📊 COBERTURA (${facturas.length} facturas sin concepto)`);
  console.log(`   ✅ etiquetables : ${decisiones.length} (${pct(decisiones.length)})`);
  for (const [k, v] of [...porConcepto.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`        · ${k.padEnd(16)} ${v}`);
  }
  console.log(`   🤷 ambiguas     : ${ambiguas.length} (${pct(ambiguas.length)}) → quedan NULL`);
  console.log(`   ❓ sin match    : ${sinMatch.length} (${pct(sinMatch.length)}) → quedan NULL`);
  console.log(`\n   fuente del match: ${[...porFuente.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`);

  if (SAMPLE > 0) {
    console.log(`\n🔎 EJEMPLOS (hasta ${SAMPLE} por categoría)`);
    for (const [k, lineas] of ejemplos) {
      console.log(`   [${k}]`);
      for (const l of lineas) console.log(`      ${l}`);
    }
  }

  // ── 4.5 ¿Qué pagos EMITIRÍAN DTEs nuevos si alguien los re-factura? ────────
  //
  // Etiquetar habilita el modo FALTANTES. Un pago cuyas ACTIVAS quedan TODAS
  // etiquetadas y al que igual le falta algún rubro pasa de "BLOQUEADO" a
  // "re-facturable": si alguien aprieta el botón, SAT recibe DTEs nuevos.
  //
  // La mayoría de las veces eso es exactamente lo que se busca (la corrida
  // original falló). Pero cuando dos rubros del pago tienen el MISMO monto, una
  // sola factura pudo haber cubierto uno y el diff cree que falta el otro
  // (ej. pago 114839: otros=450 y abono_interes=450, una sola factura de Q450).
  // No es un bug del diff — es una decisión de negocio — así que se listan para
  // que conta los revise ANTES de aplicar el backfill en prod.
  const reemisiones = await simularReemisiones(decisiones);
  console.log(`\n🚨 RE-EMISIONES POTENCIALES tras el backfill`);
  console.log(`   ${reemisiones.filas.length} pago(s) quedarían re-facturables con rubros faltantes.`);
  if (reemisiones.noSimulables > 0) {
    console.log(`   (${reemisiones.noSimulables} pago(s) de cancelación/reset no se simulan: reparten por cuota_inversionista, no por monto_aportado)`);
  }
  const porMotivo = new Map<string, number>();
  for (const r of reemisiones.filas) porMotivo.set(r.motivo, (porMotivo.get(r.motivo) ?? 0) + 1);
  for (const m of ["montos_empatados", "posible_roster_cambiado", "rubro_no_emitido"]) {
    const n = porMotivo.get(m) ?? 0;
    if (n === 0) continue;
    const icono = m === "rubro_no_emitido" ? "  " : "⚠️";
    console.log(`   ${icono} ${String(n).padStart(4)} ${m}`);
    for (const r of reemisiones.filas.filter((x) => x.motivo === m).slice(0, 5)) {
      console.log(`           pago ${r.pago_id} (crédito ${r.credito_id}) faltarían [${r.faltantes}] | activas: ${r.activas}`);
    }
  }
  if (reemisiones.filas.length > 0) {
    await Bun.write(CSV_PATH, reemisiones.csv);
    console.log(`   📄 CSV: ${CSV_PATH}`);
  }

  // ── 5. Escritura ───────────────────────────────────────────────────────────
  if (!APPLY) {
    console.log(`\n📝 DRY-RUN: no se escribió nada. Reintentar con --apply para etiquetar las ${decisiones.length} facturas.`);
    return;
  }

  let escritas = 0;
  const LOTE = 500;
  for (let i = 0; i < decisiones.length; i += LOTE) {
    const lote = decisiones.slice(i, i + LOTE);
    // UN solo UPDATE ... FROM (VALUES ...) por lote: contra el pooler de prod,
    // un UPDATE por fila son miles de round-trips seriados (minutos de pura
    // latencia). El WHERE repite concepto IS NULL: si otro proceso ya la
    // etiquetó, gana él. Los VALUES van inlined (números e identificadores de
    // nuestro propio catálogo, no input externo) para no pelear con el límite
    // de parámetros.
    const values = lote
      .map(
        (d) =>
          `(${d.factura_id}, '${d.concepto}', ${d.inversionista_id ?? "NULL"})`
      )
      .join(", ");
    await db.execute(sql`
      UPDATE cartera.facturas_electronicas AS f
      SET concepto = v.concepto,
          inversionista_id = v.inversionista_id
      FROM (VALUES ${sql.raw(values)}) AS v(factura_id, concepto, inversionista_id)
      WHERE f.factura_id = v.factura_id
        AND f.concepto IS NULL
    `);
    escritas += lote.length;
    console.log(`   💾 ${escritas}/${decisiones.length}`);
  }
  console.log(`\n✅ Backfill aplicado: ${escritas} factura(s) etiquetada(s).`);
}

/**
 * Simula el diff de /facturar-pago-completo COMO SI el backfill ya estuviera
 * aplicado, para saber qué pagos pasarían de "BLOQUEADO" a "re-facturable con
 * rubros faltantes" (= DTEs nuevos ante SAT si alguien aprieta el botón).
 *
 * Reusa la MISMA función pura del endpoint (computarDiffFacturas), así que el
 * reporte no puede divergir del comportamiento real.
 */
async function simularReemisiones(
  decisiones: {
    factura_id: number;
    pago_id: number;
    concepto: Concepto;
    inversionista_id: number | null;
  }[]
) {
  const conceptoPorFactura = new Map(decisiones.map((d) => [d.factura_id, d]));
  // Los pagos que tocó el backfill son los únicos que pueden cambiar de modo.
  // (pago_id viaja en las decisiones: re-consultarlo era un round-trip por datos
  // que main() ya tenía en memoria.)
  const ids = [...new Set(decisiones.map((d) => d.pago_id))];
  if (ids.length === 0) return { filas: [], csv: "", noSimulables: 0 };

  const pagosRes = await db.execute(sql`
    SELECT pc.pago_id, pc.credito_id, pc.validation_status,
           pc.mora, pc.otros, pc.abono_seguro, pc.abono_gps, pc.membresias_pago,
           pc.abono_interes, pc.abono_iva_12,
           c.bandera_reinversion,
           EXISTS (
             SELECT 1 FROM cartera.compras_credito_inversionista cci
             WHERE cci.credito_id = pc.credito_id
               AND cci.pendiente_facturar = true
               AND cci.tipo_operacion = 'compra_cartera'
           ) AS prorrateo_pendiente
    FROM cartera.pagos_credito pc
    JOIN cartera.creditos c ON c.credito_id = pc.credito_id
    WHERE pc.pago_id = ANY(string_to_array(${idsCsv(ids)}, ',')::int[])
  `);
  const pagos = (pagosRes as any).rows as any[];

  // Roster vivo por crédito (el histórico no es recuperable; ver nota en 2b).
  const creditoIds = [...new Set(pagos.map((p) => p.credito_id).filter(Boolean))];
  const rosterRes = await db.execute(sql`
    SELECT ci.credito_id, ci.inversionista_id, i.nombre, i.emite_factura,
           ci.porcentaje_participacion_inversionista AS porcentaje_participacion,
           ci.porcentaje_cash_in, ci.monto_aportado,
           esp.status AS status_espejo
    FROM cartera.creditos_inversionistas ci
    JOIN cartera.inversionistas i ON i.inversionista_id = ci.inversionista_id
    LEFT JOIN cartera.creditos_inversionistas_espejo esp
      ON esp.credito_id = ci.credito_id AND esp.inversionista_id = ci.inversionista_id
    WHERE ci.credito_id = ANY(string_to_array(${idsCsv(creditoIds)}, ',')::int[])
  `);
  const rosterPorCredito = new Map<number, any[]>();
  for (const r of (rosterRes as any).rows as any[]) {
    const arr = rosterPorCredito.get(r.credito_id) ?? [];
    arr.push(r);
    rosterPorCredito.set(r.credito_id, arr);
  }

  // TODAS las ACTIVAS del pago (no solo las que el backfill etiqueta): una que
  // siga en NULL deja el pago BLOQUEADO, que es justo lo que hay que detectar.
  const activasRes = await db.execute(sql`
    SELECT factura_id, pago_id, concepto, inversionista_id, monto_total::text AS monto_total
    FROM cartera.facturas_electronicas
    WHERE pago_id = ANY(string_to_array(${idsCsv(ids)}, ',')::int[])
      AND status = 'ACTIVA'
  `);
  const activasPorPago = new Map<number, any[]>();
  for (const r of (activasRes as any).rows as any[]) {
    const arr = activasPorPago.get(r.pago_id) ?? [];
    arr.push(r);
    activasPorPago.set(r.pago_id, arr);
  }

  const filas: {
    pago_id: number;
    credito_id: number;
    motivo: string;
    faltantes: string;
    activas: string;
    montos_empatados: boolean;
  }[] = [];
  let noSimulables = 0;

  for (const p of pagos) {
    // Cancelación: reparte por cuota_inversionista, no por monto_aportado. La
    // simulación daría un esperado distinto al real → no se reporta, se cuenta.
    if (p.validation_status === "reset") {
      noSimulables++;
      continue;
    }

    const invs = rosterPorCredito.get(p.credito_id) ?? [];
    const totalConIva = new Big(fix2(p.abono_interes)).plus(fix2(p.abono_iva_12));
    const totalBase = invs.reduce((s, i) => s.plus(new Big(fix2(i.monto_aportado))), new Big(0));
    const roster = invs.map((i) => ({
      inversionista_id: i.inversionista_id,
      nombre: i.nombre,
      emite_factura: i.emite_factura,
      status_espejo: i.status_espejo,
      porcentaje_participacion: i.porcentaje_participacion,
      porcentaje_cash_in: i.porcentaje_cash_in,
      interes_proporcional: totalBase.gt(0)
        ? totalConIva.times(new Big(fix2(i.monto_aportado)).div(totalBase)).round(2).toString()
        : "0",
    }));

    const activas = (activasPorPago.get(p.pago_id) ?? []).map((a) => {
      const d = conceptoPorFactura.get(a.factura_id);
      return {
        factura_id: a.factura_id,
        concepto: d?.concepto ?? a.concepto ?? null,
        inversionista_id: d?.inversionista_id ?? a.inversionista_id ?? null,
        monto_total: a.monto_total,
      };
    });

    const diff = computarDiffFacturas({
      pagoData: p,
      inversionistas: roster,
      activas,
      tieneOperacionesPendientesFacturar: p.prorrateo_pendiente === true,
    });

    if (diff.modo !== "FALTANTES" || diff.faltantes.size === 0) continue;

    // ¿Dos rubros distintos del pago con el MISMO monto? Ese es el caso peligroso:
    // una sola factura pudo cubrir uno y el diff cree que falta el otro.
    const montosRubro = [
      fix2(p.mora),
      fix2(p.otros),
      new Big(fix2(p.abono_seguro)).plus(fix2(p.abono_gps)).plus(fix2(p.membresias_pago)).toFixed(2),
      totalConIva.toFixed(2),
    ].filter((m) => new Big(m).gt(0));
    const montos_empatados = new Set(montosRubro).size !== montosRubro.length;

    // Por qué revisarlo antes de habilitar la re-facturación:
    //   • montos_empatados: dos rubros del pago valen lo mismo, una sola factura
    //     pudo cubrir uno y el diff cree que falta el otro.
    //   • posible_roster_cambiado: el faltante es el DTE de un inversionista.
    //     Un inversionista que ENTRÓ después de la corrida original lo corta la
    //     regla (d) del diff (el DTE de CUBE vivo ya no cuadra al centavo con el
    //     residuo actual), y uno que SALIÓ lo corta la regla (b) (logrado ⊄
    //     esperado). Lo que sobrevive acá es el caso indistinguible con datos de
    //     hoy: el roster cuadra pero el DTE del inversionista no existe — o la
    //     corrida original falló ahí (re-facturable de verdad), o el inversionista
    //     entonces se autofacturaba / no tenía config y su flag cambió después
    //     (re-facturar DUPLICARÍA un interés que él ya facturó por su cuenta).
    //     Por eso se listan para revisión humana.
    //   • rubro_no_emitido: el caso sano — un rubro del pago sin ningún DTE.
    const faltantesArr = [...diff.faltantes];
    const motivo = montos_empatados
      ? "montos_empatados"
      : faltantesArr.some((k) => k.startsWith("INTERESES:"))
        ? "posible_roster_cambiado"
        : "rubro_no_emitido";

    filas.push({
      pago_id: p.pago_id,
      credito_id: p.credito_id,
      motivo,
      faltantes: faltantesArr.join(" "),
      activas: activas.map((a) => `${a.factura_id}:${a.concepto}:Q${a.monto_total}`).join(" "),
      montos_empatados,
    });
  }

  const ORDEN = ["montos_empatados", "posible_roster_cambiado", "rubro_no_emitido"];
  filas.sort(
    (a, b) => ORDEN.indexOf(a.motivo) - ORDEN.indexOf(b.motivo) || a.pago_id - b.pago_id
  );

  const csv = [
    "pago_id,credito_id,motivo,faltantes,facturas_activas",
    ...filas.map((r) =>
      [r.pago_id, r.credito_id, r.motivo, `"${r.faltantes}"`, `"${r.activas}"`].join(",")
    ),
  ].join("\n");

  return { filas, csv, noSimulables };
}

main()
  .then(async () => {
    await client.end();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("💥 Error:", e);
    await client.end().catch(() => {});
    process.exit(1);
  });
