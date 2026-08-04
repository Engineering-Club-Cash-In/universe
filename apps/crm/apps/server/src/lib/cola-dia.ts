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
	// CB-029: promesa aún NO vencida cuya alerta programada (fecha_alerta, default
	// D-1) ya cayó. Baja prioridad (aparece, pero no salta la fila).
	"promesa_proxima",
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
		// CB-029: alerta programada (default D-1). Define cuándo una promesa futura
		// entra a la cola como "promesa_proxima". null = usar D-1.
		fechaAlerta?: Date | null;
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
	promesaProxima: boolean;
	sinContacto: boolean;
	/**
	 * CB-030: ¿tiene AL MENOS una promesa vigente (pendiente y con fecha >= hoy
	 * GT)? Es independiente de `incumplida`: un crédito puede arrastrar una
	 * promesa incumplida vieja Y tener una nueva vigente al mismo tiempo, y en
	 * ese caso el bucket SÍ está congelado por la nueva.
	 *
	 * Se expone explícito porque la UI no puede derivarlo de los otros flags:
	 * usar `!incumplida` como proxy suprimía el badge justo en ese escenario
	 * mixto, dejando la cola en contradicción con el detalle y el listado, que
	 * usan el predicado de vigencia real (Codex PR #1238).
	 */
	promesaActiva: boolean;
}

export function clasificarCreditoColaDia(
	credito: CreditoParaClasificar,
	hoy: Date = new Date(),
): ClasificacionColaDia {
	const hoyStr = toDateStrGT(hoy);

	const slaHoy = credito.fechaLimiteSla === hoyStr && !credito.contactadoHoy;

	let promesaHoy = false;
	let incumplida = false;
	let promesaProxima = false;
	// CB-030: vigente = pendiente Y fecha >= hoy GT. Mismo criterio que
	// condicionesPromesaVigente (server) y esPromesaActiva (front). Se acumula
	// aparte de `incumplida` a propósito: los dos pueden ser true a la vez
	// cuando el crédito arrastra una promesa fallida vieja y tiene otra nueva.
	let promesaActiva = false;
	for (const promesa of credito.promesas) {
		const fechaStr = toDateStrGT(promesa.fechaPrometida);
		if (promesa.estadoPromesa === "incumplida") {
			incumplida = true;
			continue;
		}
		// pendiente
		if (fechaStr === hoyStr) {
			promesaHoy = true;
			promesaActiva = true; // vence hoy pero sigue vigente el día entero
		} else if (fechaStr < hoyStr)
			incumplida = true; // vencida, aún no marcada por el job nocturno
		else {
			promesaActiva = true; // futura y pendiente
			// CB-029: futura → "próxima" si su alerta programada (o D-1 por
			// default) ya cayó. Entra a la cola sin urgencia hasta que sea hoy.
			const alertaEf =
				promesa.fechaAlerta ??
				new Date(promesa.fechaPrometida.getTime() - 24 * 60 * 60 * 1000);
			if (toDateStrGT(alertaEf) <= hoyStr) promesaProxima = true;
		}
	}

	const sinContacto =
		credito.diasSinContacto != null &&
		credito.diasSinContacto > UMBRAL_DIAS_SIN_CONTACTO;

	return {
		slaHoy,
		promesaHoy,
		incumplida,
		promesaProxima,
		sinContacto,
		promesaActiva,
	};
}

/** true si el crédito califica para AL MENOS una categoría (entra a la cola sin filtro). */
export function calificaParaColaDia(c: ClasificacionColaDia): boolean {
	return (
		c.slaHoy ||
		c.promesaHoy ||
		c.incumplida ||
		c.promesaProxima ||
		c.sinContacto
	);
}

/** true si el crédito califica para la categoría pedida (cola CON filtro). */
export function calificaParaFiltro(
	c: ClasificacionColaDia,
	filtro: CategoriaColaDia,
): boolean {
	if (filtro === "sla_hoy") return c.slaHoy;
	if (filtro === "promesa_hoy") return c.promesaHoy;
	if (filtro === "incumplida") return c.incumplida;
	if (filtro === "promesa_proxima") return c.promesaProxima;
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
	// CB-029: promesa próxima va DEBAJO de las urgentes (aún no vence), pero
	// arriba de "sin contacto" — es un compromiso puntual, no inactividad.
	if (c.promesaProxima) return 3;
	return 4; // sinContacto
}
