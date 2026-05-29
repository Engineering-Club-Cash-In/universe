import { Elysia, t } from "elysia";
import path from "path";
import Big from "big.js";
import { and, desc, eq, inArray, notLike, sql } from "drizzle-orm";
import { db } from "../database";
import { creditos, cuotas_credito, pagos_credito, usuarios } from "../database/db";
import { sifcoDb } from "../database/sifco";
import { estado_cuenta_transacciones } from "../database/sifco/schema";
import { repararTotalRestante } from "../controllers/updateCredit";

const PYTHON_SCRIPT_PATH = path.join(
  process.cwd(),
  "scripts",
  "buscar_capital_excel_cartera.py",
);

const TOLERANCIA = new Big("50");

interface CalcDesdeBD {
  credito_id: number;
  capital_actual: Big;
  capital_inicial: Big;
  cuotas_pagadas: number;
  cuota_fija: Big;
  fijos: Big;
  tasa: Big;
}

async function calcularCapitalInicialDesdeBD(
  numero_sifco: string,
): Promise<CalcDesdeBD | null> {
  const [credito] = await db
    .select({
      credito_id: creditos.credito_id,
      cuota: creditos.cuota,
      porcentaje_interes: creditos.porcentaje_interes,
      seguro_10_cuotas: creditos.seguro_10_cuotas,
      gps: creditos.gps,
      membresias_pago: creditos.membresias_pago,
    })
    .from(creditos)
    .where(eq(creditos.numero_credito_sifco, numero_sifco))
    .limit(1);

  if (!credito) return null;

  const [ultimoPago] = await db
    .select({
      numero_cuota: cuotas_credito.numero_cuota,
      total_restante: pagos_credito.total_restante,
      pago_id: pagos_credito.pago_id,
    })
    .from(pagos_credito)
    .innerJoin(
      cuotas_credito,
      eq(pagos_credito.cuota_id, cuotas_credito.cuota_id),
    )
    .where(
      and(
        eq(pagos_credito.credito_id, credito.credito_id),
        eq(cuotas_credito.pagado, true),
        sql`${cuotas_credito.numero_cuota} > 0`,
      ),
    )
    .orderBy(desc(cuotas_credito.numero_cuota), desc(pagos_credito.pago_id))
    .limit(1);

  if (!ultimoPago) return null;

  const cuotasPagadas = ultimoPago.numero_cuota;
  if (cuotasPagadas === 0 || ultimoPago.total_restante == null) return null;

  const capitalActual = new Big(ultimoPago.total_restante);
  const cuotaFija = new Big(credito.cuota);
  const fijos = new Big(credito.seguro_10_cuotas ?? 0)
    .plus(new Big(credito.gps ?? 0))
    .plus(new Big(credito.membresias_pago ?? 0));
  const tasa = new Big(credito.porcentaje_interes ?? 0).div(100);
  const factor = new Big(1).plus(tasa.times(new Big("1.12")));

  let capital = capitalActual;
  for (let k = 0; k < cuotasPagadas; k++) {
    capital = cuotaFija.minus(fijos).plus(capital).div(factor);
  }

  return {
    credito_id: credito.credito_id,
    capital_actual: capitalActual,
    capital_inicial: capital,
    cuotas_pagadas: cuotasPagadas,
    cuota_fija: cuotaFija,
    fijos,
    tasa,
  };
}

async function obtenerDesembolsoSifco(
  numero_sifco: string,
): Promise<{ capital_desembolsado: number; fecha: string | null } | null> {
  if (!sifcoDb) return null;

  const [trx] = await sifcoDb
    .select({
      capital_desembolsado: estado_cuenta_transacciones.capital_desembolsado,
      fecha_valor: estado_cuenta_transacciones.fecha_valor,
    })
    .from(estado_cuenta_transacciones)
    .where(
      and(
        eq(estado_cuenta_transacciones.pre_numero, numero_sifco),
        eq(estado_cuenta_transacciones.trx_cod, 2001),
      ),
    )
    .limit(1);

  if (!trx?.capital_desembolsado) return null;

  return {
    capital_desembolsado: Number(trx.capital_desembolsado),
    fecha: trx.fecha_valor ?? null,
  };
}

type ResultadoValidacion =
  | {
      estado: "validado";
      numero_credito_sifco: string;
      capital_inicial_calculado: number;
      capital_inicial_sifco: number;
      capital_inicial_usado: number;
      diferencia: number;
      cuotas_pagadas: number;
    }
  | {
      estado: "flagged";
      numero_credito_sifco: string;
      razon: string;
      capital_inicial_calculado?: number;
      capital_inicial_sifco?: number;
      diferencia?: number;
      cuotas_pagadas?: number;
      capital_actual_db?: number;
    }
  | {
      estado: "descartado";
      numero_credito_sifco: string;
      razon: string;
    };

/**
 * Procesa un solo crédito: calcula P desde DB, lo compara con SIFCO.
 * Si pasa la validación, opcionalmente repara. Si no, devuelve flag o descartado.
 *
 * Categorías:
 *  - validado: cálculo y SIFCO pegan (≤ tolerancia) → se repara con valor SIFCO
 *  - flagged:  hay data pero no pegan → requiere fallback Excel
 *  - descartado: sin cuotas pagadas o crédito inexistente → no aplica
 */
async function procesarCredito(
  numero_credito_sifco: string,
  opciones: { reparar: boolean } = { reparar: true },
): Promise<ResultadoValidacion> {
  const calc = await calcularCapitalInicialDesdeBD(numero_credito_sifco);
  if (!calc) {
    return {
      estado: "descartado",
      numero_credito_sifco,
      razon: "Crédito sin cuotas pagadas o sin datos completos",
    };
  }

  const capitalCalculado = calc.capital_inicial.round(2);
  const sifco = await obtenerDesembolsoSifco(numero_credito_sifco);

  if (!sifco) {
    return {
      estado: "flagged",
      numero_credito_sifco,
      capital_inicial_calculado: Number(capitalCalculado),
      cuotas_pagadas: calc.cuotas_pagadas,
      razon: "No se encontró transacción DESEMBOLSO (trx_cod=2001) en SIFCO",
    };
  }

  const sifcoBig = new Big(sifco.capital_desembolsado);
  const diff = calc.capital_inicial.minus(sifcoBig).abs();

  if (diff.gt(TOLERANCIA)) {
    return {
      estado: "flagged",
      numero_credito_sifco,
      capital_inicial_calculado: Number(capitalCalculado),
      capital_inicial_sifco: sifco.capital_desembolsado,
      diferencia: Number(diff.round(2)),
      cuotas_pagadas: calc.cuotas_pagadas,
      capital_actual_db: Number(calc.capital_actual.round(2)),
      razon: `Diferencia ${diff.round(2)} > tolerancia Q${TOLERANCIA}. Posible crédito renumerado/refinanciado.`,
    };
  }

  // Validado
  if (opciones.reparar) {
    await repararTotalRestante({
      numero_credito_sifco,
      capital_inicial: sifco.capital_desembolsado,
      dry_run: false,
    });
  }

  return {
    estado: "validado",
    numero_credito_sifco,
    capital_inicial_calculado: Number(capitalCalculado),
    capital_inicial_sifco: sifco.capital_desembolsado,
    capital_inicial_usado: sifco.capital_desembolsado,
    diferencia: Number(diff.round(2)),
    cuotas_pagadas: calc.cuotas_pagadas,
  };
}

/**
 * Limita la concurrencia de un array de tareas.
 */
async function ejecutarConConcurrencia<T>(
  items: string[],
  concurrencia: number,
  worker: (item: string) => Promise<T>,
): Promise<T[]> {
  const resultados: T[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: concurrencia }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      try {
        resultados[i] = await worker(items[i]);
      } catch (e: any) {
        resultados[i] = { error: e?.message ?? String(e), numero: items[i] } as any;
      }
    }
  });
  await Promise.all(workers);
  return resultados;
}

// =====================================================
// FALLBACK EXCEL — para los flagged del bulk matemático
// =====================================================

interface ExcelLookupResult {
  numero_sifco: string;
  estrategia: "sifco_directo" | "sifco_partido" | "nombre_unico" | "nombre_partido";
  capital_inicial: number;
  fuente: string;
  nombre_cliente: string | null;
  primera_cuota_excel?: number;
  primera_hoja?: string;
  advertencia?: string;
  creditos_encontrados?: Array<{ sifco: string; capital_inicial: number; fuente: string }>;
  validacion?: {
    cuota: number;
    interes_excel: number | null;
    sifco_consultado: string;
  };
}

async function buscarCapitalEnExcel(
  numero_sifco: string,
  nombre_cliente: string | null,
  validar_cuota?: number,
  capital_math?: number,
): Promise<{ ok: true; data: ExcelLookupResult } | { ok: false; error: string }> {
  const args = [PYTHON_SCRIPT_PATH, numero_sifco, "--json"];
  if (nombre_cliente) {
    args.push("--nombre", nombre_cliente);
  }
  if (validar_cuota !== undefined) {
    args.push("--validar-cuota", String(validar_cuota));
  }
  if (capital_math !== undefined) {
    args.push("--capital-math", String(capital_math));
  }

  try {
    const proc = Bun.spawn(["python3", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0 && !stdout.trim()) {
      return { ok: false, error: stderr.trim() || `exit code ${exitCode}` };
    }

    const parsed = JSON.parse(stdout.trim());
    if (parsed.error) {
      return { ok: false, error: parsed.error };
    }
    if (!(parsed.capital_inicial > 0)) {
      return { ok: false, error: "capital_inicial inválido" };
    }
    return { ok: true, data: parsed as ExcelLookupResult };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

type ResultadoExcel =
  | {
      estado: "reparado_excel";
      numero_credito_sifco: string;
      capital_inicial: number;
      estrategia: string;
      fuente: string;
      nombre_cliente: string | null;
      advertencia?: string;
      creditos_encontrados?: any[];
      pagos_actualizados?: number;
      validacion?: {
        cuota: number;
        interes_excel: number;
        interes_predicho: number;
        diff: number;
        ok: boolean;
      };
    }
  | {
      estado: "no_se_pudo";
      numero_credito_sifco: string;
      razon: string;
      nombre_cliente: string | null;
    }
  | {
      estado: "validacion_fallida";
      numero_credito_sifco: string;
      capital_inicial: number;
      estrategia: string;
      nombre_cliente: string | null;
      cuota_validada: number;
      interes_excel: number;
      interes_predicho: number;
      diff: number;
      razon: string;
    };

const TOLERANCIA_INTERES = new Big("5");

/**
 * Forward-amortiza el capital P a través de `pasos` cuotas, usando la misma lógica
 * que repararTotalRestante.
 */
function forwardAmortizar(
  P: Big,
  cuotaFija: Big,
  fijos: Big,
  tasa: Big,
  pasos: number,
): Big {
  const factor = new Big(1).plus(tasa.times("1.12"));
  let capital = P;
  for (let k = 0; k < pasos; k++) {
    capital = capital.times(factor).minus(cuotaFija.minus(fijos));
    if (capital.lt(0)) capital = new Big(0);
  }
  return capital;
}

async function procesarCreditoConExcel(
  numero_credito_sifco: string,
  opciones: { reparar: boolean } = { reparar: true },
): Promise<ResultadoExcel> {
  // 1. Info del crédito (nombre + params para validación)
  const [info] = await db
    .select({
      credito_id: creditos.credito_id,
      cuota: creditos.cuota,
      porcentaje_interes: creditos.porcentaje_interes,
      seguro_10_cuotas: creditos.seguro_10_cuotas,
      gps: creditos.gps,
      membresias_pago: creditos.membresias_pago,
      nombre: usuarios.nombre,
    })
    .from(creditos)
    .leftJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
    .limit(1);

  const nombre_cliente = info?.nombre ?? null;

  // 2. Última cuota pagada (para validación)
  let ultimaCuotaPagada: number | null = null;
  if (info?.credito_id) {
    const [u] = await db
      .select({
        max: sql<number>`COALESCE(MAX(${cuotas_credito.numero_cuota}), 0)`,
      })
      .from(cuotas_credito)
      .where(
        and(
          eq(cuotas_credito.credito_id, info.credito_id),
          eq(cuotas_credito.pagado, true),
          sql`${cuotas_credito.numero_cuota} > 0`,
        ),
      );
    ultimaCuotaPagada = Number(u?.max ?? 0) || null;
  }

  // 3. Calcular el capital por matemática (hint para optimizar la búsqueda de companions)
  const calcMath = await calcularCapitalInicialDesdeBD(numero_credito_sifco);
  const capitalMathHint = calcMath
    ? Number(calcMath.capital_inicial.round(2))
    : undefined;

  // 4. Buscar en Excel (con validacion de cuota + hint matemático)
  const excel = await buscarCapitalEnExcel(
    numero_credito_sifco,
    nombre_cliente,
    ultimaCuotaPagada ?? undefined,
    capitalMathHint,
  );
  if (!excel.ok) {
    return {
      estado: "no_se_pudo",
      numero_credito_sifco,
      razon: excel.error,
      nombre_cliente,
    };
  }

  // 4. Sanity check de validación: comparar interés predicho vs interés del Excel
  // Solo si: tenemos ultima cuota, no es estrategia partida, y el Excel devolvió un interes
  const esPartido =
    excel.data.estrategia === "sifco_partido" ||
    excel.data.estrategia === "nombre_partido";

  let validacion: {
    cuota: number;
    interes_excel: number;
    interes_predicho: number;
    diff: number;
    ok: boolean;
  } | undefined = undefined;

  if (
    !esPartido &&
    ultimaCuotaPagada &&
    excel.data.validacion?.interes_excel != null &&
    info
  ) {
    const P = new Big(excel.data.capital_inicial);
    const cuotaFija = new Big(info.cuota);
    const fijos = new Big(info.seguro_10_cuotas ?? 0)
      .plus(info.gps ?? 0)
      .plus(info.membresias_pago ?? 0);
    const tasa = new Big(info.porcentaje_interes ?? 0).div(100);

    // capital ANTES de la cuota N = forward amortizar (N-1) veces
    const capitalAntes = forwardAmortizar(P, cuotaFija, fijos, tasa, ultimaCuotaPagada - 1);
    const interesPredicho = capitalAntes.times(tasa);
    const interesExcel = new Big(excel.data.validacion.interes_excel);
    const diff = interesPredicho.minus(interesExcel).abs();

    validacion = {
      cuota: ultimaCuotaPagada,
      interes_excel: Number(interesExcel.round(4)),
      interes_predicho: Number(interesPredicho.round(4)),
      diff: Number(diff.round(4)),
      ok: diff.lte(TOLERANCIA_INTERES),
    };

    if (!validacion.ok) {
      return {
        estado: "validacion_fallida",
        numero_credito_sifco,
        capital_inicial: excel.data.capital_inicial,
        estrategia: excel.data.estrategia,
        nombre_cliente,
        cuota_validada: validacion.cuota,
        interes_excel: validacion.interes_excel,
        interes_predicho: validacion.interes_predicho,
        diff: validacion.diff,
        razon: `Interés Excel (Q${validacion.interes_excel}) vs predicho (Q${validacion.interes_predicho}) | diff Q${validacion.diff} > Q${TOLERANCIA_INTERES}. Posible abono extra a capital.`,
      };
    }
  }

  // 5. Reparar (si validación pasó o no aplicaba)
  let pagos_actualizados: number | undefined;
  if (opciones.reparar) {
    const r = await repararTotalRestante({
      numero_credito_sifco,
      capital_inicial: excel.data.capital_inicial,
      dry_run: false,
    });
    pagos_actualizados = r.pagos_actualizados;
  }

  return {
    estado: "reparado_excel",
    numero_credito_sifco,
    capital_inicial: excel.data.capital_inicial,
    estrategia: excel.data.estrategia,
    fuente: excel.data.fuente,
    nombre_cliente,
    advertencia: excel.data.advertencia,
    creditos_encontrados: excel.data.creditos_encontrados,
    pagos_actualizados,
    validacion,
  };
}

export const repararMatematicoRouter = new Elysia()
  .post(
    "/reparar-matematico",
    async ({ body, set }: any) => {
      const { numero_credito_sifco } = body;
      const resultado = await procesarCredito(numero_credito_sifco, { reparar: true });
      set.status = 200;
      return resultado;
    },
    {
      body: t.Object({
        numero_credito_sifco: t.String({ minLength: 1 }),
      }),
      detail: {
        summary: "Reparar pagos validando con matemática DB vs SIFCO (Opción B)",
        description:
          "Rebobina desde pagos_credito.total_restante del último pago pagado, compara con DESEMBOLSO de SIFCO. Si |diff| <= Q5, repara con valor exacto de SIFCO. Si no, devuelve flag sin procesar.",
        tags: ["Créditos"],
      },
    },
  )
  .post(
    "/reparar-matematico-bulk",
    async ({ body, set }: any) => {
      const { concurrencia = 3, limit, dry_run = false } = body ?? {};

      // 1. Traer todos los créditos SIFCO (excluir CRM- y cancelados con capital=0)
      const cond = and(
        notLike(creditos.numero_credito_sifco, "CRM-%"),
        sql`${creditos.capital}::numeric > 0`,
      );
      const credits = await db
        .select({
          numero_credito_sifco: creditos.numero_credito_sifco,
        })
        .from(creditos)
        .where(cond)
        .limit(limit ?? 100000);

      const numeros = credits.map((c) => c.numero_credito_sifco);
      console.log(
        `\n🚀 reparar-matematico-bulk: ${numeros.length} créditos, concurrencia=${concurrencia}, dry_run=${dry_run}`,
      );

      const t0 = Date.now();
      const resultados = await ejecutarConConcurrencia(
        numeros,
        concurrencia,
        (n) => procesarCredito(n, { reparar: !dry_run }),
      );
      const elapsed_seg = Math.round((Date.now() - t0) / 1000);

      // 2. Clasificar
      const validados: any[] = [];
      const flagged: any[] = [];
      const descartados: any[] = [];
      const errores: any[] = [];

      for (const r of resultados) {
        if (r == null) continue;
        if ((r as any).error) {
          errores.push(r);
          continue;
        }
        const estado = (r as any).estado;
        if (estado === "validado") validados.push(r);
        else if (estado === "flagged") flagged.push(r);
        else if (estado === "descartado") descartados.push(r);
      }

      // 3. Agrupar razones de flagged
      const razones: Record<string, number> = {};
      for (const f of flagged) {
        const key = f.razon?.split(".")[0] ?? "desconocido";
        razones[key] = (razones[key] ?? 0) + 1;
      }

      console.log(
        `✅ Bulk terminado en ${elapsed_seg}s: ${validados.length} validados, ${flagged.length} flagged, ${descartados.length} descartados, ${errores.length} errores`,
      );

      set.status = 200;
      return {
        success: true,
        total_procesados: resultados.length,
        validados_count: validados.length,
        flagged_count: flagged.length,
        descartados_count: descartados.length,
        errores_count: errores.length,
        razones_flagged: razones,
        tolerancia: Number(TOLERANCIA),
        elapsed_seg,
        dry_run,
        validados,
        flagged,
        descartados,
        errores,
      };
    },
    {
      body: t.Optional(
        t.Object({
          concurrencia: t.Optional(t.Number()),
          limit: t.Optional(t.Number()),
          dry_run: t.Optional(t.Boolean()),
        }),
      ),
      detail: {
        summary: "Bulk: corre la validación matemática para TODOS los créditos SIFCO",
        description:
          "Trae todos los créditos cuyo numero_credito_sifco NO empieza con 'CRM-', y aplica la validación matemática + reparación. Devuelve resumen + listas de validados/flagged/errores. Si dry_run=true, no escribe nada en DB.",
        tags: ["Créditos"],
      },
    },
  )
  .post(
    "/reparar-excel-bulk",
    async ({ body, set }: any) => {
      const { creditos: lista, concurrencia = 2, dry_run = false } = body ?? {};
      if (!Array.isArray(lista) || lista.length === 0) {
        set.status = 400;
        return { success: false, error: "Debe proveer un array 'creditos' con números SIFCO" };
      }

      console.log(
        `\n🐍 reparar-excel-bulk: ${lista.length} créditos, concurrencia=${concurrencia}, dry_run=${dry_run}`,
      );

      const t0 = Date.now();
      const resultados = await ejecutarConConcurrencia(
        lista,
        concurrencia,
        (n) => procesarCreditoConExcel(n, { reparar: !dry_run }),
      );
      const elapsed_seg = Math.round((Date.now() - t0) / 1000);

      const reparados: any[] = [];
      const no_se_pudo: any[] = [];
      const validacion_fallida: any[] = [];
      const errores: any[] = [];
      for (const r of resultados) {
        if (r == null) continue;
        if ((r as any).error) {
          errores.push(r);
          continue;
        }
        const estado = (r as any).estado;
        if (estado === "reparado_excel") reparados.push(r);
        else if (estado === "no_se_pudo") no_se_pudo.push(r);
        else if (estado === "validacion_fallida") validacion_fallida.push(r);
      }

      // Agrupar razones de no_se_pudo
      const razones: Record<string, number> = {};
      for (const n of no_se_pudo) {
        const key = (n.razon ?? "desconocido").substring(0, 60);
        razones[key] = (razones[key] ?? 0) + 1;
      }

      // Agrupar por estrategia los reparados
      const estrategias: Record<string, number> = {};
      for (const r of reparados) {
        estrategias[r.estrategia] = (estrategias[r.estrategia] ?? 0) + 1;
      }

      console.log(
        `✅ Excel bulk en ${elapsed_seg}s: ${reparados.length} reparados, ${validacion_fallida.length} validacion_fallida, ${no_se_pudo.length} no_se_pudo, ${errores.length} errores`,
      );

      set.status = 200;
      return {
        success: true,
        total_procesados: resultados.length,
        reparados_count: reparados.length,
        validacion_fallida_count: validacion_fallida.length,
        no_se_pudo_count: no_se_pudo.length,
        errores_count: errores.length,
        estrategias,
        razones_no_se_pudo: razones,
        elapsed_seg,
        dry_run,
        reparados,
        validacion_fallida,
        no_se_pudo,
        errores,
      };
    },
    {
      body: t.Object({
        creditos: t.Array(t.String({ minLength: 1 })),
        concurrencia: t.Optional(t.Number()),
        dry_run: t.Optional(t.Boolean()),
      }),
      detail: {
        summary: "Bulk: busca capital inicial en Excel para una lista de créditos flagged",
        description:
          "Para cada crédito de la lista, busca el capital en el Excel histórico (vía script Python). Búsqueda: 1) por SIFCO exacto, 2) por nombre del cliente, 3) detecta créditos partidos con '_'. Si se encuentra, repara. Si no, lo deja en 'no_se_pudo' para revisión manual.",
        tags: ["Créditos"],
      },
    },
  )
  // ============================================================
  // BULK PURO MATEMÁTICO — sin SIFCO, sin Excel
  // Rebobina desde el estado actual de la DB y repara con ese valor.
  // ============================================================
  .post(
    "/reparar-matematico-puro-bulk",
    async ({ body, set }: any) => {
      const { concurrencia = 3, limit, offset = 0, dry_run = false } = body ?? {};

      // 1. Traer todos los créditos SIFCO (excluir CRM- y cancelados con capital=0)
      const cond = and(
        notLike(creditos.numero_credito_sifco, "CRM-%"),
        sql`${creditos.capital}::numeric > 0`,
      );
      const credits = await db
        .select({ numero_credito_sifco: creditos.numero_credito_sifco })
        .from(creditos)
        .where(cond)
        .orderBy(creditos.credito_id)
        .limit(limit ?? 100000)
        .offset(offset);

      const numeros = credits.map((c) => c.numero_credito_sifco);
      console.log(
        `\n🧮 reparar-matematico-puro-bulk: ${numeros.length} créditos, concurrencia=${concurrencia}, dry_run=${dry_run}`,
      );

      const t0 = Date.now();
      const resultados = await ejecutarConConcurrencia(
        numeros,
        concurrencia,
        async (numero_credito_sifco) => {
          const calc = await calcularCapitalInicialDesdeBD(numero_credito_sifco);
          if (!calc) {
            return {
              estado: "descartado" as const,
              numero_credito_sifco,
              razon: "Crédito sin cuotas pagadas o sin datos completos",
            };
          }

          const capital_inicial = Number(calc.capital_inicial.round(2));

          if (!dry_run) {
            try {
              const r = await repararTotalRestante({
                numero_credito_sifco,
                capital_inicial,
                dry_run: false,
              });
              return {
                estado: "reparado" as const,
                numero_credito_sifco,
                capital_inicial,
                cuotas_pagadas: calc.cuotas_pagadas,
                pagos_actualizados: r.pagos_actualizados,
              };
            } catch (e: any) {
              return {
                estado: "error" as const,
                numero_credito_sifco,
                capital_inicial,
                error: e?.message ?? String(e),
              };
            }
          }

          return {
            estado: "reparado" as const,
            numero_credito_sifco,
            capital_inicial,
            cuotas_pagadas: calc.cuotas_pagadas,
          };
        },
      );
      const elapsed_seg = Math.round((Date.now() - t0) / 1000);

      const reparados: any[] = [];
      const descartados: any[] = [];
      const errores: any[] = [];
      for (const r of resultados) {
        if (r == null) continue;
        if ((r as any).error && !(r as any).estado) {
          errores.push(r);
          continue;
        }
        const estado = (r as any).estado;
        if (estado === "reparado") reparados.push(r);
        else if (estado === "descartado") descartados.push(r);
        else if (estado === "error") errores.push(r);
      }

      console.log(
        `✅ Matemático puro en ${elapsed_seg}s: ${reparados.length} reparados, ${descartados.length} descartados, ${errores.length} errores`,
      );

      set.status = 200;
      return {
        success: true,
        total_procesados: resultados.length,
        reparados_count: reparados.length,
        descartados_count: descartados.length,
        errores_count: errores.length,
        elapsed_seg,
        dry_run,
        reparados,
        descartados,
        errores,
      };
    },
    {
      body: t.Optional(
        t.Object({
          concurrencia: t.Optional(t.Number()),
          limit: t.Optional(t.Number()),
          offset: t.Optional(t.Number()),
          dry_run: t.Optional(t.Boolean()),
        }),
      ),
      detail: {
        summary: "Bulk: repara TODOS los créditos usando solo matemática (rebobineo de la DB), sin SIFCO ni Excel",
        description:
          "Para cada crédito: rebobina desde pagos_credito.total_restante del último pago pagado, y usa ese valor como capital_inicial en repararTotalRestante. Sin validación contra SIFCO ni búsqueda en Excel.",
        tags: ["Créditos"],
      },
    },
  );
