/**
 * CB-032 — qué cuotas pueden entrar a un convenio, del lado del cliente.
 *
 * Vive acá y no dentro del modal porque la regla se aplica en dos lugares (la
 * ficha arma la lista, el modal la recorta) y porque tiene que decir lo MISMO
 * que el server (`lib/convenio-desde-ficha.ts` en apps/server), que a su vez
 * espeja lo que cartera considera elegible. Cuando los dos lados divergen, el
 * asesor elige una cuota que el server después rechaza — que es exactamente el
 * bug que reportó Codex en el PR #1570.
 */

import { estaVencidaGT } from "@/lib/date-utils";

export interface CuotaConvenio {
	cuotaId: number;
	numeroCuota: number;
	fechaVencimiento?: string | null;
	monto: number;
	/** Vencida en días calendario de Guatemala (la de HOY no lo está). */
	vencida: boolean;
}

/** Fila del historial de cuotas tal como la devuelve `getHistorialPagos`. */
export interface FilaHistorialCuota {
	id?: string | number;
	numeroCuota?: number;
	fechaVencimiento?: string | null;
	montoCuota?: string | number | null;
	estadoMora?: string | null;
	/** La cuota vino de `cuotasEnValidacion`: tiene un pago esperando a conta. */
	en_validacion?: boolean;
}

/**
 * Cuotas del crédito que pueden ofrecerse para un convenio.
 *
 * Dos filtros, y los dos importan:
 *
 * 1. `estadoMora === "pendiente"` — ni pagadas ni en validación completa.
 * 2. `en_validacion !== true` — la cuota NO tiene ningún pago esperando a
 *    contabilidad. El caso traicionero es el **abono parcial pending**: llega
 *    con `estadoMora: "pendiente"` (porque el pago no es completo) pero cartera
 *    la excluye de `cuotasPendientes`, así que el server la rechazaría como
 *    inexistente y el asesor vería un error sin saber por qué.
 *
 * `vencida` se calcula en días calendario GT (ver `estaVencidaGT`), igual que
 * el `fecha_vencimiento < hoy` con el que cartera arma `cuotasAtrasadas`.
 */
export function cuotasElegiblesParaConvenio(
	filas: FilaHistorialCuota[],
	cuotaMensualFallback: number,
	ahora: Date = new Date(),
): CuotaConvenio[] {
	return filas
		.filter((c) => c.estadoMora === "pendiente" && c.en_validacion !== true)
		.map((c) => ({
			cuotaId: Number(c.id),
			numeroCuota: Number(c.numeroCuota),
			fechaVencimiento: c.fechaVencimiento,
			monto: Number(c.montoCuota ?? cuotaMensualFallback ?? 0),
			vencida: estaVencidaGT(c.fechaVencimiento, ahora),
		}));
}

/**
 * Recorte final: al convenio entran las cuotas VENCIDAS y la ACTUAL (la
 * primera que todavía no vence). Las futuras no — un convenio reestructura
 * deuda exigible, no adelanta el calendario. Espeja `elegiblesParaConvenio`
 * del server.
 */
export function soloVencidasYActual(cuotas: CuotaConvenio[]): CuotaConvenio[] {
	const ordenadas = [...cuotas].sort((a, b) => a.numeroCuota - b.numeroCuota);
	const vencidas = ordenadas.filter((c) => c.vencida);
	const actual = ordenadas.find((c) => !c.vencida);
	return actual ? [...vencidas, actual] : vencidas;
}
