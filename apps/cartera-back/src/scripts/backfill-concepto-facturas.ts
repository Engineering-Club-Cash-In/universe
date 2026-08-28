// ============================================================
// Backfill de `facturas_electronicas.concepto` (+ inversionista_id).
//
// Contexto:
//   La columna `concepto` la agregó la migración 0029 para poder re-facturar solo
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
// USO:
//   SUPABASE_DB_URL=postgresql://postgres:...@localhost:5433/dump20260828 \
//     bun run src/scripts/backfill-concepto-facturas.ts            # dry-run (default)
//   ... bun run src/scripts/backfill-concepto-facturas.ts --apply  # escribe
//
//   Opcional: --sample=N imprime N ejemplos de cada categoría del reporte.
// ============================================================
import { sql } from "drizzle-orm";
import Big from "big.js";
import { db, client } from "../database";
import { CLUB_CASHIN_CONFIG } from "../utils/functions/const";

Big.DP = 20;
Big.RM = Big.roundHalfUp;

const APPLY = process.argv.includes("--apply");
const SAMPLE = Number(
  process.argv.find((a) => a.startsWith("--sample="))?.split("=")[1] ?? 3
);

/** NIT emisor de CUBE: cualquier otro NIT es un facturador propio de inversionista. */
const NIT_CUBE = CLUB_CASHIN_CONFIG.emisor.nit;

/** NIT del facturador propio → palabras clave del nombre del inversionista.
 *  Espejo de INVERSIONISTAS_FACTURADORES en utils/functions/const.ts. */
const FACTURADORES_POR_NIT: Record<string, string[]> = {
  "52956032": ["SE PRESTA", "SE-PRESTA", "SEPRESTA"],
  "100691455": ["AMJK"],
  "2694247K": ["CREACION E IMAGEN", "CREACION IMAGEN", "CREACIÓN"],
  "54603064": ["GRUPO BATRO", "BATRO"],
  "96896035": ["AUTOCASH", "AUTO CASH", "AUTO-CASH", "AUTOCA"],
};

type Concepto = "MORA" | "OTROS_SERVICIOS" | "OTROS" | "INTERESES" | "INTERESES_CUBE";

type Candidato = {
  concepto: Concepto;
  inversionista_id: number | null;
  /** Nombre del inversionista (solo INTERESES), para desempatar por emisor. */
  nombre?: string;
  monto: string; // fixed(2)
  fuente: string;
};

/** Normaliza a 2 decimales. Los campos de pagos_credito traen NULL y strings
 *  vacíos de la época de las migraciones desde SIFCO: ahí el rubro es 0. */
const fix2 = (v: unknown) => {
  try {
    return new Big((v as any) ?? 0).round(2).toFixed(2);
  } catch {
    return "0.00";
  }
};

/** `= ANY(...)` con una lista larga: drizzle inlinaría un ROW(...) y Postgres
 *  revienta pasadas 1664 entradas. Se manda como UN parámetro de texto. */
const idsCsv = (ids: number[]) => ids.join(",");
const esCube = (n: string) => n.trim().toUpperCase().includes("CUBE INVESTMENTS");

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
  const pagosSinDesglose = pagoIds.filter((p) => !porPagoDesglose.has(p));
  if (pagosSinDesglose.length > 0) {
    const pagosRes = await db.execute(sql`
      SELECT pago_id, mora, otros, abono_seguro, abono_gps, membresias_pago
      FROM cartera.pagos_credito
      WHERE pago_id = ANY(string_to_array(${idsCsv(pagosSinDesglose)}, ',')::int[])
    `);
    for (const p of (pagosRes as any).rows as any[]) {
      push(p.pago_id, { concepto: "MORA", inversionista_id: null, monto: fix2(p.mora), fuente: "pagos_credito" });
      push(p.pago_id, { concepto: "OTROS", inversionista_id: null, monto: fix2(p.otros), fuente: "pagos_credito" });
      const otrosServicios = new Big(p.abono_seguro ?? 0)
        .plus(p.abono_gps ?? 0)
        .plus(p.membresias_pago ?? 0);
      push(p.pago_id, { concepto: "OTROS_SERVICIOS", inversionista_id: null, monto: fix2(otrosServicios), fuente: "pagos_credito" });
      // Sin candidato INTERESES_CUBE: el residuo de CUBE no se reconstruye desde acá.
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
      AND NOT EXISTS (
        SELECT 1 FROM cartera.pagos_credito_inversionistas p2 WHERE p2.pago_id = f.pago_id
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

    // Desempate por emisor: un NIT que no es el de CUBE solo puede ser el DTE de
    // intereses de ESE inversionista (los rubros MORA/OTROS/etc. siempre los
    // emite CUBE). Se usa tanto para descartar rubros como para fijar el inv.
    const keywords = f.emisor_nit && f.emisor_nit !== NIT_CUBE ? FACTURADORES_POR_NIT[f.emisor_nit] : null;
    if (keywords && matches.length > 1) {
      const soloEseFacturador = matches.filter(
        (c) =>
          c.concepto === "INTERESES" &&
          keywords.some((k) => (c.nombre ?? "").toUpperCase().includes(k))
      );
      if (soloEseFacturador.length > 0) matches = soloEseFacturador;
    }

    // Duplicados exactos del MISMO candidato (p. ej. pci y desglose coincidiendo)
    // no son ambigüedad: colapsan a una sola decisión.
    const unicos = new Map<string, Candidato>();
    for (const c of matches) unicos.set(`${c.concepto}:${c.inversionista_id ?? ""}`, c);
    matches = [...unicos.values()];

    if (matches.length === 1) {
      const c = matches[0];
      decisiones.push({
        factura_id: f.factura_id,
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

  // ── 5. Escritura ───────────────────────────────────────────────────────────
  if (!APPLY) {
    console.log(`\n📝 DRY-RUN: no se escribió nada. Reintentar con --apply para etiquetar las ${decisiones.length} facturas.`);
    return;
  }

  let escritas = 0;
  const LOTE = 500;
  for (let i = 0; i < decisiones.length; i += LOTE) {
    const lote = decisiones.slice(i, i + LOTE);
    await db.transaction(async (tx) => {
      for (const d of lote) {
        // El WHERE repite concepto IS NULL: si otro proceso ya la etiquetó, gana él.
        await tx.execute(sql`
          UPDATE cartera.facturas_electronicas
          SET concepto = ${d.concepto},
              inversionista_id = ${d.inversionista_id}
          WHERE factura_id = ${d.factura_id}
            AND concepto IS NULL
        `);
      }
    });
    escritas += lote.length;
    console.log(`   💾 ${escritas}/${decisiones.length}`);
  }
  console.log(`\n✅ Backfill aplicado: ${escritas} factura(s) etiquetada(s).`);
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
