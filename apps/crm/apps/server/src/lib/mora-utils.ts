import type { CarteraCuotaCredito } from "../types/cartera-back";

/**
 * Calcula los días de mora exactos basándose en la fecha de vencimiento
 * de la cuota más antigua que está atrasada
 */
export function calcularDiasMoraExactos(
	cuotasAtrasadas: CarteraCuotaCredito[],
): number {
	if (!cuotasAtrasadas || cuotasAtrasadas.length === 0) {
		return 0;
	}

	// Encontrar la cuota con fecha de vencimiento más antigua
	const cuotaMasAntigua = cuotasAtrasadas.reduce((antigua, actual) => {
		const fechaAntigua = new Date(antigua.fecha_vencimiento);
		const fechaActual = new Date(actual.fecha_vencimiento);
		return fechaActual < fechaAntigua ? actual : antigua;
	});

	// Calcular días transcurridos desde la fecha de vencimiento
	const fechaVencimiento = new Date(cuotaMasAntigua.fecha_vencimiento);
	const hoy = new Date();
	const diffMs = hoy.getTime() - fechaVencimiento.getTime();
	const diasMora = Math.floor(diffMs / (1000 * 60 * 60 * 24));

	// Retornar 0 si el resultado es negativo (cuota aún no vence)
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
