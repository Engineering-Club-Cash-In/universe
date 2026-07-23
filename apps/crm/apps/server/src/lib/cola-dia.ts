/**
 * CB-020 — Cola del Día (función pura, sin DB ni red). Clasifica un crédito
 * en las 4 categorías de la cola priorizada:
 *
 *  1. slaHoy: el límite de SLA (fecha_entrada_bucket + dias_sla del bucket,
 *     calculado en cartera-back, día GT) cae HOY — y el asesor NO registró
 *     contacto hoy (si ya llamó hoy, el crédito ya no urge por SLA).
 *  2. promesaHoy: hay una promesa de pago pendiente (contactos_cobros,
 *     estado_promesa='pendiente') cuya fecha prometida es HOY.
 *  3. incumplida: hay una promesa incumplida (estado_promesa='incumplida'),
 *     o pendiente cuya fecha prometida ya pasó (venció antes de hoy y el job
 *     nocturno / getEstadoPromesasPago aún no la marcó incumplida).
 *  4. sinContacto: lleva más de UMBRAL_SIN_CONTACTO días sin que NADIE lo
 *     contacte (MAX(fecha_contacto) por caso), sin importar bucket ni SLA —
 *     un crédito puede llevar meses en el mismo bucket sin que nadie lo
 *     toque, y SLA no lo detecta porque solo mira la entrada al bucket, no
 *     la actividad real. Un crédito SIN NINGÚN contacto (nunca se le llamó)
 *     no tiene fecha base para medir días → NO califica (decisión explícita:
 *     mejor omitir que inventar una fecha de referencia).
 *
 * Un crédito puede tener varias banderas a la vez — sale una sola vez en la
 * cola con todas las que aplican. Sin filtro, el orden priorizado es
 * slaHoy → promesaHoy → incumplida → sinContacto (ver ordenColaDia).
 */

import { toDateStrGT } from "./guatemala-month-window";

// Única fuente de verdad de las categorías — el input zod de getColaDia
// (routers/cobros.ts) usa z.enum(CATEGORIAS_COLA_DIA) directo sobre este
// array, así el tipo inferido por zod y CategoriaColaDia son el MISMO tipo
// (no dos declaraciones estructuralmente iguales pero nominalmente distintas)
// y no hace falta castear el input validado al pasarlo a calificaParaFiltro.
export const CATEGORIAS_COLA_DIA = [
	"sla_hoy",
	"promesa_hoy",
	"incumplida",
	"sin_contacto",
] as const;

export type CategoriaColaDia = (typeof CATEGORIAS_COLA_DIA)[number];

/** Días sin contacto a partir de los cuales un crédito entra a la categoría "sin_contacto". */
export const UMBRAL_DIAS_SIN_CONTACTO = 5;

export interface CreditoParaClasificar {
	/** YYYY-MM-DD (día GT), ya calculado por cartera-back. null = sin SLA (crédito sin fila en buckets_historial, o B0). */
	fechaLimiteSla: string | null;
	/** true si ya se registró un contacto (cualquier tipo) HOY para este crédito. */
	contactadoHoy: boolean;
	/** Promesas activas del crédito (pendiente o incumplida; 'cumplida' es terminal, se excluye antes de llamar). */
	promesas: Array<{
		estadoPromesa: "pendiente" | "incumplida";
		fechaPrometida: Date;
	}>;
	/**
	 * Días transcurridos desde el ÚLTIMO contacto registrado (cualquier tipo),
	 * ya calculados en día GT. null = nunca se registró ningún contacto para
	 * este crédito — sin fecha base, no califica para "sin_contacto".
	 */
	diasSinContacto: number | null;
}

export interface ClasificacionColaDia {
	slaHoy: boolean;
	promesaHoy: boolean;
	incumplida: boolean;
	sinContacto: boolean;
}

export function clasificarCreditoColaDia(
	credito: CreditoParaClasificar,
	hoy: Date = new Date(),
): ClasificacionColaDia {
	const hoyStr = toDateStrGT(hoy);

	const slaHoy = credito.fechaLimiteSla === hoyStr && !credito.contactadoHoy;

	let promesaHoy = false;
	let incumplida = false;
	for (const promesa of credito.promesas) {
		const fechaStr = toDateStrGT(promesa.fechaPrometida);
		if (promesa.estadoPromesa === "incumplida") {
			incumplida = true;
			continue;
		}
		// pendiente
		if (fechaStr === hoyStr) promesaHoy = true;
		else if (fechaStr < hoyStr) incumplida = true; // vencida, aún no marcada por el job nocturno
	}

	const sinContacto =
		credito.diasSinContacto != null &&
		credito.diasSinContacto > UMBRAL_DIAS_SIN_CONTACTO;

	return { slaHoy, promesaHoy, incumplida, sinContacto };
}

/** true si el crédito califica para AL MENOS una categoría (entra a la cola sin filtro). */
export function calificaParaColaDia(c: ClasificacionColaDia): boolean {
	return c.slaHoy || c.promesaHoy || c.incumplida || c.sinContacto;
}

/** true si el crédito califica para la categoría pedida (cola CON filtro). */
export function calificaParaFiltro(
	c: ClasificacionColaDia,
	filtro: CategoriaColaDia,
): boolean {
	if (filtro === "sla_hoy") return c.slaHoy;
	if (filtro === "promesa_hoy") return c.promesaHoy;
	if (filtro === "incumplida") return c.incumplida;
	return c.sinContacto;
}

/**
 * Orden priorizado (sin filtro): SLA hoy primero, luego promesa hoy, luego
 * incumplida, luego sin contacto (la menos urgente — no vencimiento puntual,
 * sino inactividad acumulada). Un crédito con varias banderas gana por la de
 * mayor prioridad.
 */
export function ordenColaDia(c: ClasificacionColaDia): number {
	if (c.slaHoy) return 0;
	if (c.promesaHoy) return 1;
	if (c.incumplida) return 2;
	return 3; // sinContacto (única forma de calificar si llegamos aquí)
}
