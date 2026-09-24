import type { CarteraCuotaCredito } from "../types/cartera-back";
import { toDateStrGT } from "./guatemala-month-window";

const MS_POR_DIA = 86_400_000;

/**
 * Fecha de CALENDARIO (año/mes/día) de un vencimiento, como número comparable
 * — `Date.UTC(y, m, d)`, o sea la medianoche UTC de ese día.
 *
 * Mismo criterio que `fechaCalendarioGT` en cartera-back
 * (`controllers/latefee.ts`), y a propósito: los dos lados tienen que contar
 * el mismo día o la ficha del caso desmiente al listado.
 *
 * `cuotas_credito.fecha_vencimiento` es una columna `date`: guarda la fecha de
 * calendario tal cual, NO un instante. Al CRM llega por JSON como
 * "2026-09-22". Nunca `new Date(str)`: eso la interpreta como medianoche UTC y
 * la convierte en un instante, que después se resta contra el reloj real —
 * justo el defecto que este archivo arregla. Se leen los primeros 10
 * caracteres y listo; lo que venga después ("T00:00:00.000Z", " 00:00:00") se
 * ignora, porque la hora de una fecha de calendario no significa nada.
 *
 * Se valida la FORMA antes de parsear: `Number("")` es 0, así que un string
 * truncado como "2026-09" devolvería en silencio el 31-ago-2026.
 *
 * Con los dos extremos en `Date.UTC(...)` la resta es exacta en múltiplos de
 * 86_400_000: no hay residuos de zona que redondear.
 */
export function fechaCalendarioGT(valor: string): number {
	if (typeof valor !== "string") return Number.NaN;
	const fecha = valor.slice(0, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return Number.NaN;
	return Date.UTC(
		Number(fecha.slice(0, 4)),
		Number(fecha.slice(5, 7)) - 1,
		Number(fecha.slice(8, 10)),
	);
}

/**
 * El día de HOY en Guatemala, en la misma escala que `fechaCalendarioGT`.
 *
 * Tiene que salir de la zona y no de los campos del proceso: el server corre
 * en UTC, así que entre las 00:00 y las 05:59 UTC el proceso ya cambió de día
 * y Guatemala (UTC−6) todavía no. Se pasa por la zona UNA vez —acá, que es
 * donde hay un instante real— y de ahí en adelante todo son fechas de
 * calendario contra fechas de calendario.
 */
export function hoyCalendarioGT(ahora: Date = new Date()): number {
	return fechaCalendarioGT(toDateStrGT(ahora));
}

/**
 * Días REALES de atraso: los de la cuota vencida MÁS ANTIGUA, contados en
 * calendario de Guatemala.
 *
 * Antes restaba el vencimiento (una fecha de calendario leída como medianoche
 * UTC) contra `new Date()` (un instante). Mezclar las dos cosas inflaba el
 * atraso en un día durante las seis horas que van de 00:00 a 05:59 UTC, o sea
 * toda la tarde y noche de Guatemala: una cuota que vencía HOY salía con "1
 * día de atraso". Ese número se muestra en la ficha del caso, ordena la
 * cobranza y además se ESCRIBE a `casos_cobros.dias_mora_maximo`.
 *
 * Las cuotas que llegan acá ya vienen filtradas por quien llama (son las
 * atrasadas del crédito): este helper sólo hace la aritmética de fechas.
 * Una fecha ilegible se saltea en vez de envenenar el resultado con NaN, que
 * en el sync terminaría en la base.
 */
export function calcularDiasMoraExactos(
	cuotasAtrasadas: CarteraCuotaCredito[],
): number {
	if (!cuotasAtrasadas || cuotasAtrasadas.length === 0) {
		return 0;
	}

	let masAntigua = Number.POSITIVE_INFINITY;
	for (const cuota of cuotasAtrasadas) {
		const fecha = fechaCalendarioGT(cuota.fecha_vencimiento);
		if (Number.isNaN(fecha)) continue;
		if (fecha < masAntigua) masAntigua = fecha;
	}
	if (!Number.isFinite(masAntigua)) return 0;

	const diasMora = Math.trunc((hoyCalendarioGT() - masAntigua) / MS_POR_DIA);

	// Una cuota que todavía no vence no es atraso.
	return Math.max(0, diasMora);
}

/**
 * Categoría de aging (30/60/90/120) del listado de cobranza.
 *
 * Es un BUCKET, no días: cuenta CUOTAS vencidas, no el atraso corrido. Va
 * aparte de `diasMoraDeListado` a propósito — antes los dos conceptos salían
 * del mismo `cuotasAtrasadas × 30`, así que arreglar los días habría movido
 * también los buckets del embudo. El mapeo es el mismo de siempre (1 cuota →
 * mora_30, 2 → mora_60, …), sólo que ahora no pasa por un número de días.
 */
export function estadoMoraPorCuotasAtrasadas(
	cuotasAtrasadas: number,
	statusCredit: string | null | undefined,
): string {
	if (statusCredit === "EN_CONVENIO") return "en_convenio";
	if (cuotasAtrasadas <= 0) return "al_dia";
	if (cuotasAtrasadas === 1) return "mora_30";
	if (cuotasAtrasadas === 2) return "mora_60";
	if (cuotasAtrasadas === 3) return "mora_90";
	if (cuotasAtrasadas === 4) return "mora_120";
	return "mora_120_plus";
}

/**
 * Días REALES de atraso de una fila del listado de cobranza.
 *
 * Los calcula cartera-back (`diasAtrasoMoraMaximo`, en el mismo paso que el
 * monto proporcional) como el atraso de la cuota vencida MÁS ANTIGUA. Antes se
 * inventaban acá como `cuotasAtrasadas × 30`: con la mora proporcional eso
 * anunciaba "30 días" al lado de un monto de 3 días, y además hacía que la
 * prioridad de la lista —que ordena por este número— saltara en escalones de
 * 30 días mientras la plata se mueve por día.
 *
 * `undefined` es el fail-open de cartera-back (si la proyección de mora falla,
 * el listado responde igual sin estos campos): se devuelve 0, que es "no sé",
 * y NO cambia el bucket de categoría, que sale de las cuotas.
 */
export function diasMoraDeListado(
	diasAtrasoMoraMaximo: number | null | undefined,
): number {
	if (typeof diasAtrasoMoraMaximo !== "number") return 0;
	if (!Number.isFinite(diasAtrasoMoraMaximo)) return 0;
	return Math.max(0, Math.trunc(diasAtrasoMoraMaximo));
}
