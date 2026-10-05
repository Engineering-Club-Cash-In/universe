import Big from "big.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../database";
import { creditos, cuotas_credito, moras_credito } from "../database/db/schema";
import { coberturaDeCuotaSql } from "../utils/cuotaYaPagadaSql";
import { inicioDiaGTComoTimestampUTC, partesGT } from "../utils/functions/diaGuatemala";
import { BASE_DIAS_MORA, TASA_MORA_MENSUAL } from "../utils/moraFormula";
import { moraPagadaPorCuota } from "../utils/moraPagadaPorCuota";
import { proyectarMoraDelMes, ultimoDiaDelMes } from "../utils/proyeccionMoraMes";
import { CREDIT_DETAIL_STATUSES } from "./creditDetailPolicy";

export type DiaProyeccionMora = {
  fecha: string;
  mora: string;
  /** Cuánto cambió respecto del día anterior (negativo si ese día pagó). */
  incremento: string;
  /** `mora − moraInicioMes`. */
  acumuladoMes: string;
  /** Cuotas que al día siguiente deben más. `null` en los días ya pasados: el historial no lo guarda. */
  cuotasSumando: number | null;
  tipo: "real" | "hoy" | "proyeccion";
};

export type ProyeccionMoraMes = {
  mes: string;
  hoy: string;
  /** capital × 1.12% ÷ 30: lo que suma UNA cuota por día. */
  cargoDiario: string;
  moraInicioMes: string;
  moraHoy: string;
  moraFinMes: string;
  dias: DiaProyeccionMora[];
};

/**
 * La mora del crédito día por día en el mes EN CURSO (calendario de Guatemala),
 * para la tarjeta «Proyección de mora del mes» del caso de cobros.
 *
 * Qué significa «la mora del día d» — una sola definición para todo el mes:
 * la mora con la que el crédito TERMINA ese día: lo que el cron escribió a las
 * 00:05 de ese día (con los días de atraso contados a d) más lo que cambió
 * durante el día (pagos, condonaciones, ajustes).
 *
 *  - Días ya pasados (`real`): el último evento de `moras_historial` anterior a
 *    la medianoche de Guatemala del día siguiente. Es lo que el sistema anotó
 *    de verdad: si el cliente pagó el día 10, ese día baja.
 *  - Hoy (`hoy`) y los que faltan (`proyeccion`): lo que el cron escribe (o
 *    escribiría) a las 00:05 de ese día con lo abonado hasta ahora y sin
 *    ningún pago más (`proyectarMoraDelMes`, que calcula con `hoy = d`).
 *  - `moraHoy`: lo que debe AHORA (`moras_credito` activa, 0 si no hay). Se
 *    aparta del día de hoy de la serie solo si alguien ajustó la mora a mano.
 *  - `moraInicioMes`: la mora con la que terminó el mes anterior (último evento
 *    anterior a la medianoche GT del día 1). Es la base del `acumuladoMes`.
 */
export async function getProyeccionMoraMes(
  numero_credito_sifco: string,
  ahora: Date = new Date(),
): Promise<ProyeccionMoraMes | { message: string }> {
  // La misma búsqueda que el detalle (`getCreditoByNumero`): un número SIFCO
  // puede repetirse en estados que el detalle no muestra.
  const [credito] = await db
    .select({
      credito_id: creditos.credito_id,
      capital: creditos.capital,
      statusCredit: creditos.statusCredit,
    })
    .from(creditos)
    .where(
      and(
        eq(creditos.numero_credito_sifco, numero_credito_sifco),
        inArray(creditos.statusCredit, [...CREDIT_DETAIL_STATUSES]),
      ),
    )
    .limit(1);
  if (!credito) return { message: "Crédito no encontrado" };

  const p = partesGT(ahora);
  const hoy = `${p.year}-${p.month}-${p.day}`;
  const mes = hoy.slice(0, 7);
  const finMes = ultimoDiaDelMes(hoy);
  const diasPasados = Number(p.day) - 1;

  // Impagas que vencen hasta fin de mes: las que vencen más adelante en el mes
  // entran solas el día que les toca. Las fechas salen como texto para no
  // pasar por la zona del proceso (ver `fechaCalendarioGT`).
  const cobertura = coberturaDeCuotaSql();
  const cuotas = await db
    .select({
      cuota_id: cuotas_credito.cuota_id,
      fecha_vencimiento: sql<string>`to_char(${cuotas_credito.fecha_vencimiento}, 'YYYY-MM-DD')`,
      cubiertaPorPagoValidado: cobertura.validado,
      fechasPendiente: cobertura.fechasPendiente,
    })
    .from(cuotas_credito)
    .where(
      and(
        eq(cuotas_credito.credito_id, credito.credito_id),
        eq(cuotas_credito.pagado, false),
        sql`${cuotas_credito.fecha_vencimiento}::date <= ${finMes}::date`,
      ),
    );
  const pagado = await moraPagadaPorCuota(cuotas.map((c) => c.cuota_id), db);
  const proyectados = proyectarMoraDelMes({
    capital: credito.capital,
    statusCredit: credito.statusCredit,
    hoy,
    cuotas: cuotas.map((c) => ({
      cuota_id: c.cuota_id,
      fecha_vencimiento: c.fecha_vencimiento,
      pagado: pagado.get(c.cuota_id) ?? 0,
      cubiertaPorPagoValidado: c.cubiertaPorPagoValidado,
      fechasPagoPendiente: c.fechasPendiente ? c.fechasPendiente.split(",") : [],
    })),
  });

  // Una sola consulta para todos los días pasados: por cada corte, el último
  // evento anterior (un descenso de índice por día, como el LATERAL de
  // `snapCte`). El corte `i` es la medianoche GT del día 1 + i, llevada a UTC
  // porque `moras_historial.fecha` guarda el instante en UTC y se compara
  // contra la columna cruda: i = 0 es «antes del día 1» (la base del mes) e
  // i = d es «al terminar el día d». Una mora desactivada vale 0, igual que en
  // Mora Histórica.
  //
  // El corte es la medianoche EXACTA, sin distinguir quién escribió el evento:
  // el cron corre a las 00:05 GT del día d (`schedule.ts`) y calcula con
  // `hoy = d`, así que su evento pertenece al día d igual que un pago de las
  // 00:02. Borde de transición: hasta sep-2026 el cron corría a las 23:59 y
  // terminaba pasada la medianoche, así que la corrida del 30-sep cae en el
  // 1-oct; es un solo mes y no justifica lógica especial.
  const inicioMesUtc = inicioDiaGTComoTimestampUTC(`${mes}-01`);
  const cierres = await db.execute<{ i: number; mora: string }>(sql`
    SELECT g.i::int AS i, COALESCE(u.monto, 0)::text AS mora
    FROM generate_series(0, ${diasPasados}::int) AS g(i)
    LEFT JOIN LATERAL (
      SELECT CASE WHEN h.tipo_evento = 'DESACTIVACION' THEN 0 ELSE h.monto_nuevo END AS monto
      FROM cartera.moras_historial h
      WHERE h.credito_id = ${credito.credito_id}
        AND h.fecha < ${inicioMesUtc}::timestamp + make_interval(days => g.i::int)
      ORDER BY h.fecha DESC, h.historial_id DESC
      LIMIT 1
    ) u ON true
    ORDER BY g.i`);
  const cierreDelDia = cierres.rows.map((r) => new Big(r.mora));

  const [activa] = await db
    .select({ monto_mora: moras_credito.monto_mora })
    .from(moras_credito)
    .where(and(eq(moras_credito.credito_id, credito.credito_id), eq(moras_credito.activa, true)))
    .limit(1);

  const inicio = cierreDelDia[0] ?? new Big(0);
  let anterior = inicio;
  const dia = (fecha: string, mora: Big, tipo: DiaProyeccionMora["tipo"], cuotasSumando: number | null) => {
    const fila = {
      fecha,
      mora: mora.toFixed(2),
      incremento: mora.minus(anterior).toFixed(2),
      acumuladoMes: mora.minus(inicio).toFixed(2),
      cuotasSumando,
      tipo,
    };
    anterior = mora;
    return fila;
  };
  const dias = [
    ...cierreDelDia
      .slice(1)
      .map((mora, i) => dia(`${mes}-${String(i + 1).padStart(2, "0")}`, mora, "real", null)),
    ...proyectados.map((d) =>
      dia(d.fecha, new Big(d.mora), d.fecha === hoy ? "hoy" : "proyeccion", d.cuotasSumando),
    ),
  ];

  return {
    mes,
    hoy,
    cargoDiario: new Big(credito.capital || 0).times(TASA_MORA_MENSUAL).div(BASE_DIAS_MORA).toFixed(2),
    moraInicioMes: inicio.toFixed(2),
    moraHoy: new Big(activa?.monto_mora ?? 0).toFixed(2),
    moraFinMes: dias[dias.length - 1].mora,
    dias,
  };
}
