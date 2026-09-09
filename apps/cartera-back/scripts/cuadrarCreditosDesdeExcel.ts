/**
 * Cuadra créditos contra el Excel maestro de cartera en UNA sola pasada:
 * corrige las fechas del calendario y después sincroniza los montos.
 *
 * Las dos cosas viven hoy en endpoints separados (`/ajustar-credito` y
 * `/actualizar-pagos-excel`) y cada llamada re-escanea los 55MB del Excel. Acá
 * el índice se arma una vez y se reusa para las dos fases, que además tienen
 * que correr EN ESE ORDEN: si las fechas están mal, el match por mes le escribe
 * la misma fila del Excel a dos cuotas distintas.
 *
 *   bun run scripts/cuadrarCreditosDesdeExcel.ts <archivo-sifcos> [--apply]
 *                                                [--solo-fechas | --solo-pagos]
 *                                                [--companions=<archivo.json>]
 *                                                [--sin-cache]
 *
 * Sin --apply no escribe nada.
 *
 * --companions recibe un JSON { "<sifco base>": ["<companion>", ...] } para los
 * pools repartidos en varios SIFCOs: las filas del companion se suman al base.
 * Sirve también para los créditos del CRM que en el Excel viven bajo un SIFCO
 * real en vez de su id CRM-<uuid>.
 *
 * El índice del Excel se cachea en disco por etag, así que la primera corrida
 * paga el escaneo de los 55MB y las siguientes arrancan al instante.
 */
import Big from "big.js";
import { and, asc, eq, gt, ne } from "drizzle-orm";
import { db } from "../src/database";
import { creditos, cuotas_credito, pagos_credito } from "../src/database/db";
import { ajustarCuotasConSIFCO } from "../src/controllers/migratePayments";
import { construirUpdatesCuota } from "../src/routers/actualizarPagosExcel";
import { debeProtegerCuota, pagoTieneAplicacion } from "../src/routers/actualizarPagosExcelPolicy";
import {
  descargarCarteraDeR2,
  leerPagosCarteraPorVencimiento,
  aISO,
  type PagoCarteraExcel,
} from "../src/services/carteraExcelR2";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const SOLO_FECHAS = args.includes("--solo-fechas");
const SOLO_PAGOS = args.includes("--solo-pagos");
const SIN_CACHE = args.includes("--sin-cache");
const archivoCompanions = args.find((a) => a.startsWith("--companions="))?.split("=")[1];
const archivo = args.find((a) => !a.startsWith("--"));
if (!archivo) {
  console.error("uso: bun run scripts/cuadrarCreditosDesdeExcel.ts <archivo-sifcos> [--apply]");
  process.exit(1);
}
const sifcos = (await Bun.file(archivo).text())
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

const mes = (iso: string) => iso.slice(0, 7);

type Resultado = {
  sifco: string;
  credito_id: number | null;
  fechas: { estado: string; detalle?: string; ancla?: Record<string, unknown>; cambiadas?: number };
  pagos: { actualizados: number; omitidas: number; protegidas: number; motivo?: string };
};

// ── 1. Companions: companion → base, igual que /actualizar-pagos-excel ─────
const companionToBase = new Map<string, string>();
if (archivoCompanions) {
  const mapa = await Bun.file(archivoCompanions).json();
  for (const [base, comps] of Object.entries(mapa as Record<string, string[]>)) {
    const b = base.replace(/[^0-9]/g, "").padStart(14, "0");
    for (const c of comps) {
      companionToBase.set(c.replace(/[^0-9]/g, "").padStart(14, "0"), b);
    }
  }
  console.log(`🔗 ${companionToBase.size} companions cargados`);
}

// ── 2. Excel: UNA sola pasada, cacheada por etag ───────────────────────────
// El escaneo de los 55MB es lo caro (~1 min). Se serializa el índice a disco
// con el etag del archivo + la huella del pedido, así que re-correr sobre la
// misma lista arranca al instante.
const descarga = await descargarCarteraDeR2({});
const huella = Bun.hash(
  JSON.stringify([descarga.etag ?? "", sifcos, [...companionToBase.entries()].sort()]),
).toString(16);
const rutaCache = `/tmp/cartera-excel-cache/idx-${huella}.json`;

type Indice = Map<string, Map<string, PagoCarteraExcel>>;
let excelIdx: Indice;

if (!SIN_CACHE && (await Bun.file(rutaCache).exists())) {
  const crudo = await Bun.file(rutaCache).json();
  excelIdx = new Map(
    Object.entries(crudo as Record<string, Record<string, PagoCarteraExcel>>).map(
      ([sifco, meses]) => [sifco, new Map(Object.entries(meses))],
    ),
  );
  console.log(`⚡ Índice del Excel desde caché (${excelIdx.size} créditos)\n`);
} else {
  console.log(`📖 Leyendo el Excel una vez para ${sifcos.length} créditos...`);
  excelIdx = await leerPagosCarteraPorVencimiento(
    descarga.filePath,
    sifcos.map((s) => ({ sifco: s, vencimientos: [], todos: true })),
    companionToBase,
  );
  await Bun.write(
    rutaCache,
    JSON.stringify(
      Object.fromEntries([...excelIdx].map(([s, m]) => [s, Object.fromEntries(m)])),
    ),
  );
  console.log(`   listo (${excelIdx.size} créditos con filas), cacheado\n`);
}

const resultados: Resultado[] = [];

for (const sifco of sifcos) {
  const base = sifco.replace(/[^0-9]/g, "").padStart(14, "0");
  const filasExcel = excelIdx.get(base) ?? excelIdx.get(sifco);
  const res: Resultado = {
    sifco,
    credito_id: null,
    fechas: { estado: "sin_evaluar" },
    pagos: { actualizados: 0, omitidas: 0, protegidas: 0 },
  };

  const [credito] = await db
    .select({ credito_id: creditos.credito_id, plazo: creditos.plazo })
    .from(creditos)
    .where(eq(creditos.numero_credito_sifco, sifco))
    .limit(1);
  if (!credito) {
    res.fechas = { estado: "credito_no_existe" };
    resultados.push(res);
    continue;
  }
  res.credito_id = credito.credito_id;

  if (!filasExcel || filasExcel.size === 0) {
    res.fechas = { estado: "sin_filas_en_excel" };
    resultados.push(res);
    continue;
  }

  // ── 3. Fase fechas ───────────────────────────────────────────────────────
  if (!SOLO_PAGOS) {
    const cuotasDb = await db
      .select({
        numero_cuota: cuotas_credito.numero_cuota,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
      })
      .from(cuotas_credito)
      .where(eq(cuotas_credito.credito_id, credito.credito_id))
      .orderBy(asc(cuotas_credito.numero_cuota));

    // ⚠️ ajustarCuotasConSIFCO BORRA las cuotas con numero_cuota >
    // plazo_completo, y con ellas sus pagos. Mandarle `creditos.plazo` a secas
    // borraría datos en los créditos que tienen cuotas más allá de su plazo,
    // que son justamente los renumerados y los pools que estamos arreglando.
    // El plazo que se manda nunca es menor que la última cuota existente, así
    // que esa rama no se ejecuta: este script solo corre fechas, no recorta
    // calendarios.
    const maxCuotaDb = cuotasDb.reduce((m, c) => Math.max(m, c.numero_cuota), 0);
    const plazoSeguro = Math.max(credito.plazo ?? 0, maxCuotaDb);

    // Cinturón y tirantes: aunque plazoSeguro nunca sea menor que la última
    // cuota, si el cálculo fallara la función borraría cuotas CON SUS PAGOS.
    // Se verifica que ninguna cuota por encima del plazo tenga plata aplicada
    // y, si la hubiera, el crédito se salta en vez de arriesgarse.
    const enRiesgo = await db
      .select({ pago_id: pagos_credito.pago_id })
      .from(pagos_credito)
      .innerJoin(cuotas_credito, eq(pagos_credito.cuota_id, cuotas_credito.cuota_id))
      .where(
        and(
          eq(pagos_credito.credito_id, credito.credito_id),
          gt(cuotas_credito.numero_cuota, plazoSeguro),
        ),
      )
      .limit(1);
    if (enRiesgo.length > 0) {
      res.fechas = { estado: "saltado_borraria_pagos" };
      resultados.push(res);
      console.log(`${sifco}  SALTADO: el ajuste borraría cuotas con pagos`);
      continue;
    }

    // El calendario bueno es el del Excel: su columna "#" es el número de cuota
    // y su columna "Pago" la fecha de vencimiento. Se ancla en la cuota más
    // alta que el Excel numere y que exista en la DB, para no crear ni borrar.
    const anclas = [...filasExcel.values()]
      .filter((f) => f.numero_excel !== null && f.numero_excel > 0)
      .sort((a, b) => (a.numero_excel ?? 0) - (b.numero_excel ?? 0));
    const enDb = new Set(cuotasDb.map((c) => c.numero_cuota));
    const ancla = [...anclas].reverse().find((f) => enDb.has(f.numero_excel!));

    const mesesDb = cuotasDb
      .filter((c) => c.numero_cuota > 0 && c.fecha_vencimiento)
      .map((c) => mes(aISO(c.fecha_vencimiento as any)!));
    const hayDuplicados = new Set(mesesDb).size !== mesesDb.length;

    const desalineada = ancla
      ? aISO(
          cuotasDb.find((c) => c.numero_cuota === ancla.numero_excel)!
            .fecha_vencimiento as any,
        ) !== ancla.fecha_vencimiento
      : false;

    if (!ancla) {
      res.fechas = { estado: "sin_ancla_en_excel" };
    } else if (!hayDuplicados && !desalineada) {
      res.fechas = { estado: "ok" };
    } else {
      const cuerpo = {
        numero_credito_sifco: sifco,
        cuota_esperada: ancla.numero_excel!,
        fecha_cuota: ancla.fecha_vencimiento,
        plazo_completo: plazoSeguro,
        dia_vencimiento: Number(ancla.fecha_vencimiento.slice(8, 10)),
      };
      res.fechas = {
        estado: APPLY ? "ajustado" : "por_ajustar",
        detalle: [hayDuplicados ? "meses duplicados" : null, desalineada ? "desalineada vs Excel" : null]
          .filter(Boolean)
          .join(" + "),
        ancla: cuerpo,
      };
      if (APPLY) {
        await ajustarCuotasConSIFCO(cuerpo);
        const despues = await db
          .select({ n: cuotas_credito.numero_cuota, f: cuotas_credito.fecha_vencimiento })
          .from(cuotas_credito)
          .where(eq(cuotas_credito.credito_id, credito.credito_id));
        res.fechas.cambiadas = despues.filter((d) => {
          const antes = cuotasDb.find((c) => c.numero_cuota === d.n);
          return antes && aISO(antes.fecha_vencimiento as any) !== aISO(d.f as any);
        }).length;
      }
    }
  }

  // ── 4. Fase pagos (con las fechas ya corregidas) ─────────────────────────
  if (!SOLO_FECHAS) {
    const filas = await db
      .select()
      .from(pagos_credito)
      .innerJoin(cuotas_credito, eq(pagos_credito.cuota_id, cuotas_credito.cuota_id))
      .where(
        and(
          eq(pagos_credito.credito_id, credito.credito_id),
          eq(pagos_credito.paymentFalse, false),
          ne(pagos_credito.validationStatus, "pending"),
        ),
      )
      .orderBy(asc(cuotas_credito.numero_cuota), asc(pagos_credito.pago_id));

    const porCuota = new Map<
      number,
      { fecha: string | null; pagos: Array<{ pago_id: number; monto_aplicado: any; fecha_pago: any; tiene_aplicacion: boolean }> }
    >();
    const cuotaCero: number[] = [];
    for (const r of filas) {
      const c = r.cuotas_credito;
      if (c.numero_cuota === 0) { cuotaCero.push(r.pagos_credito.pago_id); continue; }
      if (!c.pagado) continue;
      if (!porCuota.has(c.numero_cuota)) {
        porCuota.set(c.numero_cuota, { fecha: aISO(c.fecha_vencimiento as any), pagos: [] });
      }
      porCuota.get(c.numero_cuota)!.pagos.push({
        pago_id: r.pagos_credito.pago_id,
        monto_aplicado: r.pagos_credito.monto_aplicado,
        fecha_pago: r.pagos_credito.fecha_pago,
        tiene_aplicacion: pagoTieneAplicacion(r.pagos_credito),
      });
    }

    const updates: Array<{ pago_id: number; datos: Record<string, unknown> }> = [];
    let primeraFila: PagoCarteraExcel | undefined;
    for (const [numero, info] of [...porCuota.entries()].sort((a, b) => a[0] - b[0])) {
      if (!info.fecha) { res.pagos.omitidas++; continue; }
      const excel = filasExcel.get(mes(info.fecha));
      if (!excel) { res.pagos.omitidas++; continue; }
      if (debeProtegerCuota(excel, info.pagos)) { res.pagos.protegidas++; continue; }
      if (!primeraFila) primeraFila = excel;
      updates.push(...construirUpdatesCuota(excel, info.pagos));
    }

    // Cuota 0 = desembolso: se le siembra el capital inicial del pool.
    if (primeraFila && cuotaCero.length) {
      const capitalInicial = new Big(primeraFila.total_restante)
        .plus(primeraFila.abono_capital)
        .round(2)
        .toString();
      for (const pago_id of cuotaCero) {
        updates.push({ pago_id, datos: { total_restante: capitalInicial } });
      }
    }

    res.pagos.actualizados = updates.length;
    if (APPLY && updates.length) {
      await db.transaction(async (tx) => {
        for (const u of updates) {
          await tx.update(pagos_credito).set(u.datos as any).where(eq(pagos_credito.pago_id, u.pago_id));
        }
      });
    }
  }

  resultados.push(res);
  const f = res.fechas.estado;
  console.log(
    `${sifco}  fechas=${f}${res.fechas.detalle ? ` (${res.fechas.detalle})` : ""}` +
      `  pagos=${res.pagos.actualizados}  omitidas=${res.pagos.omitidas}  protegidas=${res.pagos.protegidas}`,
  );
}

console.log(`\n${"=".repeat(70)}`);
console.log(APPLY ? "APLICADO" : "DRY RUN (sin --apply no se escribió nada)");
const porEstado = resultados.reduce<Record<string, number>>((a, r) => {
  a[r.fechas.estado] = (a[r.fechas.estado] ?? 0) + 1;
  return a;
}, {});
console.log("fechas:", porEstado);
console.log(
  "pagos:",
  resultados.reduce((a, r) => a + r.pagos.actualizados, 0),
  "| omitidas:",
  resultados.reduce((a, r) => a + r.pagos.omitidas, 0),
  "| protegidas:",
  resultados.reduce((a, r) => a + r.pagos.protegidas, 0),
);
await Bun.write("/tmp/cuadrar_resultado.json", JSON.stringify(resultados, null, 1));
console.log("detalle en /tmp/cuadrar_resultado.json");
process.exit(0);
