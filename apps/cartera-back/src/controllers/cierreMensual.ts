import { eq, lt } from "drizzle-orm";
import { db } from "../database";
import {
  creditos,
  moras_credito,
  cierre_mensual,
  cierre_mora_aging,
  StatusCredit,
} from "../database/db/schema";
import Big from "big.js";
import { toZonedTime } from "date-fns-tz";

const TZ_GUATEMALA = "America/Guatemala";

// Todos los estados posibles, para que la foto siempre tenga una fila por estado
// (aunque ese mes no haya créditos en él).
const TODOS_LOS_ESTADOS = Object.values(StatusCredit) as string[];

/**
 * Devuelve el primer día (YYYY-MM-01) del mes ANTERIOR a la fecha dada, en hora Guatemala.
 * Ej: si hoy es 2026-06-05 → "2026-05-01" (se cierra mayo).
 */
function periodoMesAnterior(ref: Date): string {
  const guate = toZonedTime(ref, TZ_GUATEMALA);
  const anio = guate.getFullYear();
  const mes = guate.getMonth(); // 0-index; este valor YA es el mes anterior al +1 humano
  // mes actual humano = guate.getMonth()+1. El mes anterior es guate.getMonth() (1..12 cuando no es enero).
  const primerDiaMesAnterior = new Date(anio, mes - 1, 1);
  const y = primerDiaMesAnterior.getFullYear();
  const m = String(primerDiaMesAnterior.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

/**
 * Periodo que debe cerrarse HOY según el día del mes (hora Guatemala). Pensado para
 * correr a diario manteniendo UN registro por mes (upsert que se va refrescando):
 * - Hasta el día 5: se sigue cerrando el mes ANTERIOR (gracia para que asiente la data;
 *   el corte por fecha_creacion hace que ese cierre ignore los créditos del mes nuevo).
 * - Del día 6 en adelante: ya se toma en cuenta el mes ACTUAL.
 * Ej: 3-jul → "2026-06-01" (sigue junio); 6-jul → "2026-07-01" (arranca julio).
 */
function periodoObjetivo(ref: Date): string {
  const guate = toZonedTime(ref, TZ_GUATEMALA);
  if (guate.getDate() <= 5) return periodoMesAnterior(ref);
  const anio = guate.getFullYear();
  const mes = String(guate.getMonth() + 1).padStart(2, "0");
  return `${anio}-${mes}-01`;
}

/**
 * Primer instante del mes SIGUIENTE al periodo, en hora Guatemala (UTC-6 fijo, sin DST).
 * Sirve de corte: todo crédito creado >= este instante (es decir, del mes siguiente en
 * adelante) NO entra en la foto del periodo. Ej: periodo "2026-05-01" → 2026-06-01 00:00 GT.
 */
function cutoffFinDePeriodo(periodo: string): Date {
  const [anio, mes] = periodo.split("-").map(Number); // mes = 1..12
  // Date.UTC con `mes` (1-index) como argumento 0-index cae en el mes SIGUIENTE;
  // +6h porque Guatemala es UTC-6. Maneja diciembre→enero por overflow.
  return new Date(Date.UTC(anio, mes, 1, 6, 0, 0));
}

interface AcumEstado {
  cantidad_creditos: number;
  capital_total: Big;
  creditos_con_mora: Set<number>;
  capital_en_mora: Big;
}

/**
 * Genera (o regenera) la foto mensual de la cartera.
 *
 * - `capital_total`: suma del campo `capital` (monto colocado) de los créditos por estado.
 * - Las columnas de mora salen de la tabla OFICIAL de mora (`moras_credito` con `activa = true`),
 *   la misma que llena el job `procesarMoras` junto con el estado MOROSO. Por eso un crédito
 *   ACTIVO no arrastra mora (la mora activa va de la mano del estado MOROSO).
 * - Solo entran créditos con `fecha_creacion` ANTERIOR al fin del periodo (hora Guatemala):
 *   si se cierra mayo, los créditos creados en junio en adelante NO se cuentan ni se suman.
 *
 * Idempotente: hace upsert sobre (periodo, status_credit).
 *
 * @param periodoOverride opcional "YYYY-MM-01" para regenerar un mes específico.
 *                        Si no se pasa, usa periodoObjetivo(hoy): hasta el día 5 cierra
 *                        el mes anterior; del 6 en adelante, el mes actual (hora Guatemala).
 */
export async function generarCierreMensual(periodoOverride?: string) {
  const ahora = new Date();
  const periodo = periodoOverride ?? periodoObjetivo(ahora);
  const cutoff = cutoffFinDePeriodo(periodo);

  console.log("\n╔════════════════════════════════════════════════════════════");
  console.log(`║ [JOB] 📊 GENERANDO CIERRE MENSUAL — periodo ${periodo}`);
  console.log(`║ Solo créditos creados antes de ${cutoff.toISOString()} (fin de periodo GT)`);
  console.log("╚════════════════════════════════════════════════════════════\n");

  // 1. Inicializar acumulador con TODOS los estados en cero.
  const acum: Record<string, AcumEstado> = {};
  for (const estado of TODOS_LOS_ESTADOS) {
    acum[estado] = {
      cantidad_creditos: 0,
      capital_total: new Big(0),
      creditos_con_mora: new Set<number>(),
      capital_en_mora: new Big(0),
    };
  }

  // 2. Conteo y capital por estado (foto actual de creditos), excluyendo los
  //    créditos creados después del periodo (p.ej. los de junio al cerrar mayo).
  const creditosRows = await db
    .select({
      credito_id: creditos.credito_id,
      capital: creditos.capital,
      statusCredit: creditos.statusCredit,
    })
    .from(creditos)
    .where(lt(creditos.fecha_creacion, cutoff));

  // Mapa credito_id -> { estado, capital } para cruzar con la mora.
  const creditoInfo = new Map<number, { estado: string; capital: Big }>();

  for (const c of creditosRows) {
    const estado = c.statusCredit ?? StatusCredit.ACTIVO;
    if (!acum[estado]) {
      // Estado inesperado (no en el enum): lo agregamos igual para no perder data.
      acum[estado] = {
        cantidad_creditos: 0,
        capital_total: new Big(0),
        creditos_con_mora: new Set<number>(),
        capital_en_mora: new Big(0),
      };
    }
    const capital = new Big(c.capital ?? 0);
    acum[estado].cantidad_creditos += 1;
    acum[estado].capital_total = acum[estado].capital_total.plus(capital);
    creditoInfo.set(c.credito_id, { estado, capital });
  }

  // 3. Mora OFICIAL: tabla moras_credito con activa=true (la que llena procesarMoras
  //    junto con el estado MOROSO). Atribuimos cada mora a la fila del estado del crédito.
  const moras = await db
    .select({
      credito_id: moras_credito.credito_id,
    })
    .from(moras_credito)
    .where(eq(moras_credito.activa, true));

  for (const m of moras) {
    const info = creditoInfo.get(m.credito_id);
    if (!info) continue; // mora huérfana, ignorar

    const bucket = acum[info.estado];
    if (!bucket.creditos_con_mora.has(m.credito_id)) {
      bucket.creditos_con_mora.add(m.credito_id);
      bucket.capital_en_mora = bucket.capital_en_mora.plus(info.capital);
    }
  }

  // 4. Upsert por estado.
  let filas = 0;
  for (const [estado, data] of Object.entries(acum)) {
    const valores = {
      periodo,
      status_credit: estado,
      cantidad_creditos: data.cantidad_creditos,
      capital_total: data.capital_total.toFixed(2),
      creditos_con_mora: data.creditos_con_mora.size,
      capital_en_mora: data.capital_en_mora.toFixed(2),
    };

    await db
      .insert(cierre_mensual)
      .values(valores)
      .onConflictDoUpdate({
        target: [cierre_mensual.periodo, cierre_mensual.status_credit],
        set: {
          cantidad_creditos: valores.cantidad_creditos,
          capital_total: valores.capital_total,
          creditos_con_mora: valores.creditos_con_mora,
          capital_en_mora: valores.capital_en_mora,
          created_at: new Date(),
        },
      });

    console.log(
      `  [${estado}] créditos=${valores.cantidad_creditos} capital=${valores.capital_total} ` +
        `conMora=${valores.creditos_con_mora} capitalMora=${valores.capital_en_mora}`
    );
    filas++;
  }

  console.log(`\n✅ Cierre mensual generado: ${filas} filas para el periodo ${periodo}\n`);

  // 5. Aging de mora (buckets por cuotas atrasadas) — mismo periodo y mismo corte.
  const aging = await generarCierreMoraAging(periodo, cutoff);

  return { ok: true, periodo, filas, aging: aging.buckets };
}

// Definición de los buckets de aging por cuotas atrasadas.
// El orden importa: se evalúa de mayor a menor para que "4 o más" caiga en 120.
const BUCKETS_AGING = [
  { bucket: "120", cuotas_min: 4, test: (c: number) => c >= 4 },
  { bucket: "90", cuotas_min: 3, test: (c: number) => c === 3 },
  { bucket: "60", cuotas_min: 2, test: (c: number) => c === 2 },
  { bucket: "30", cuotas_min: 1, test: (c: number) => c === 1 },
] as const;

/**
 * Genera (o regenera) el aging de mora del periodo: agrupa los créditos con mora ACTIVA
 * por cuotas atrasadas en buckets 30/60/90/120 y guarda, por bucket, la cantidad de
 * créditos y la suma de `monto_mora`.
 *
 * - Deduplica por crédito (puede haber >1 mora activa por el bug de duplicados): se queda
 *   con la mora de MAYOR cuotas_atrasadas (el peor atraso) y su `monto_mora`.
 * - Aplica el MISMO filtro por fecha_creacion que el cierre (excluye créditos creados
 *   después del periodo).
 *
 * Idempotente: upsert sobre (periodo, bucket).
 */
export async function generarCierreMoraAging(periodo: string, cutoffOverride?: Date) {
  const cutoff = cutoffOverride ?? cutoffFinDePeriodo(periodo);

  // Créditos válidos del periodo (creados antes del corte).
  const creditosValidos = await db
    .select({ id: creditos.credito_id })
    .from(creditos)
    .where(lt(creditos.fecha_creacion, cutoff));
  const valido = new Set<number>(creditosValidos.map((c) => c.id));

  // Moras activas con su atraso y monto.
  const moras = await db
    .select({
      credito_id: moras_credito.credito_id,
      cuotas_atrasadas: moras_credito.cuotas_atrasadas,
      monto_mora: moras_credito.monto_mora,
    })
    .from(moras_credito)
    .where(eq(moras_credito.activa, true));

  // Dedup por crédito: nos quedamos con la mora de mayor cuotas_atrasadas.
  const porCredito = new Map<number, { cuotas: number; monto: Big }>();
  for (const m of moras) {
    if (!valido.has(m.credito_id)) continue; // crédito fuera del periodo
    if (m.cuotas_atrasadas < 1) continue; // sin atraso real, no aplica bucket
    const prev = porCredito.get(m.credito_id);
    const monto = new Big(m.monto_mora);
    // Mayor cuotas_atrasadas; en empate, el monto_mora mayor (determinístico).
    if (!prev || m.cuotas_atrasadas > prev.cuotas || (m.cuotas_atrasadas === prev.cuotas && monto.gt(prev.monto))) {
      porCredito.set(m.credito_id, { cuotas: m.cuotas_atrasadas, monto });
    }
  }

  // Acumular en los 4 buckets (siempre las 4 filas, aunque queden en cero).
  const acum: Record<string, { cuotas_min: number; n: number; monto: Big }> = {};
  for (const b of BUCKETS_AGING) acum[b.bucket] = { cuotas_min: b.cuotas_min, n: 0, monto: new Big(0) };
  for (const { cuotas, monto } of porCredito.values()) {
    const def = BUCKETS_AGING.find((b) => b.test(cuotas))!;
    acum[def.bucket].n += 1;
    acum[def.bucket].monto = acum[def.bucket].monto.plus(monto);
  }

  // Upsert por bucket.
  const buckets: { bucket: string; cuotas_min: number; cantidad_creditos: number; monto_mora: string }[] = [];
  for (const b of BUCKETS_AGING) {
    const d = acum[b.bucket];
    const valores = {
      periodo,
      bucket: b.bucket,
      cuotas_min: d.cuotas_min,
      cantidad_creditos: d.n,
      monto_mora: d.monto.toFixed(2),
    };
    await db
      .insert(cierre_mora_aging)
      .values(valores)
      .onConflictDoUpdate({
        target: [cierre_mora_aging.periodo, cierre_mora_aging.bucket],
        set: {
          cuotas_min: valores.cuotas_min,
          cantidad_creditos: valores.cantidad_creditos,
          monto_mora: valores.monto_mora,
          created_at: new Date(),
        },
      });
    buckets.push(valores);
    console.log(`  [mora ${b.bucket}] créditos=${valores.cantidad_creditos} montoMora=${valores.monto_mora}`);
  }

  console.log(`\n✅ Aging de mora generado: 4 buckets para el periodo ${periodo}\n`);
  return { ok: true, periodo, buckets };
}

/**
 * Lista las filas de cierre mensual, opcionalmente filtrando por periodo.
 */
export async function getCierreMensual(periodo?: string) {
  const rows = periodo
    ? await db
        .select()
        .from(cierre_mensual)
        .where(eq(cierre_mensual.periodo, periodo))
    : await db.select().from(cierre_mensual);

  return rows;
}

/**
 * Lista el aging de mora, opcionalmente filtrando por periodo.
 */
export async function getCierreMoraAging(periodo?: string) {
  const rows = periodo
    ? await db
        .select()
        .from(cierre_mora_aging)
        .where(eq(cierre_mora_aging.periodo, periodo))
    : await db.select().from(cierre_mora_aging);

  return rows;
}
