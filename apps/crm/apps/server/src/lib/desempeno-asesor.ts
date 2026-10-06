/**
 * Rangos de fecha del bloque "Mi desempeño" (Figma › Dashboard del Asesor,
 * selector Día / Semana / Mes). Todo en día de Guatemala.
 *
 *  · día    → hoy; se compara con ayer.
 *  · semana → lunes de esta semana hasta hoy; se compara con el mismo tramo
 *             de la semana anterior (lunes a mismo día de la semana).
 *  · mes    → día 1 hasta hoy; se compara con el mismo tramo del mes anterior
 *             (recortado al último día si ese mes es más corto).
 *
 * `hasta` es EXCLUSIVO (medianoche del día siguiente), igual que el resto de
 * los rangos de cobros.
 */

import { gtDateStrToDate, toDateStrGT } from "./guatemala-month-window";

export const PERIODOS_DESEMPENO = ["dia", "semana", "mes"] as const;
export type PeriodoDesempeno = (typeof PERIODOS_DESEMPENO)[number];

export interface RangoFechas {
	/** Inclusivo (medianoche GT). */
	desde: Date;
	/** Exclusivo (medianoche GT del día siguiente al último). */
	hasta: Date;
	/** YYYY-MM-DD del primer y último día (inclusivos), para mostrar y para `date`. */
	desdeStr: string;
	hastaStr: string;
}

function rango(desdeStr: string, hastaStrInclusivo: string): RangoFechas {
	const hasta = gtDateStrToDate(hastaStrInclusivo);
	return {
		desde: gtDateStrToDate(desdeStr),
		hasta: new Date(hasta.getTime() + 24 * 60 * 60 * 1000),
		desdeStr,
		hastaStr: hastaStrInclusivo,
	};
}

/** Suma días a un YYYY-MM-DD (aritmética de calendario, sin husos). */
export function sumarDiasStr(fecha: string, dias: number): string {
	const [y, m, d] = fecha.split("-").map(Number);
	const t = Date.UTC(y, m - 1, d) + dias * 24 * 60 * 60 * 1000;
	return new Date(t).toISOString().slice(0, 10);
}

export function rangosDesempeno(
	periodo: PeriodoDesempeno,
	ahora: Date = new Date(),
): { actual: RangoFechas; anterior: RangoFechas } {
	const hoy = toDateStrGT(ahora);
	if (periodo === "dia") {
		const ayer = sumarDiasStr(hoy, -1);
		return { actual: rango(hoy, hoy), anterior: rango(ayer, ayer) };
	}
	if (periodo === "semana") {
		const [y, m, d] = hoy.split("-").map(Number);
		const diaSemana = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
		const desdeLunes = (diaSemana + 6) % 7;
		const lunes = sumarDiasStr(hoy, -desdeLunes);
		return {
			actual: rango(lunes, hoy),
			anterior: rango(sumarDiasStr(lunes, -7), sumarDiasStr(hoy, -7)),
		};
	}
	const [y, m, d] = hoy.split("-").map(Number);
	const primero = `${hoy.slice(0, 8)}01`;
	const mesAnt = m === 1 ? 12 : m - 1;
	const anioAnt = m === 1 ? y - 1 : y;
	const diasMesAnt = new Date(Date.UTC(anioAnt, mesAnt, 0)).getUTCDate();
	const mm = String(mesAnt).padStart(2, "0");
	const diaAnt = String(Math.min(d, diasMesAnt)).padStart(2, "0");
	return {
		actual: rango(primero, hoy),
		anterior: rango(`${anioAnt}-${mm}-01`, `${anioAnt}-${mm}-${diaAnt}`),
	};
}
