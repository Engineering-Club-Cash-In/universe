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
