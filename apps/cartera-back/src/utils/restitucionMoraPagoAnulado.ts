import { motivoAnulacionMora } from "./motivoReversaMora";

/** Lo que `falsePayment` necesita saber del pago para decidir la restitución. */
export type PagoParaAnular = {
	/** La mora que ESA boleta había cobrado. `null` si no cobró ninguna. */
	mora?: string | number | null;
	/** ¿La boleta YA estaba marcada como falsa? */
	paymentFalse?: boolean | null;
};

/** El ajuste de mora que deja una boleta anulada, o `null` si no deja ninguno. */
export type RestitucionMora = { monto_cambio: number; motivo: string };

/**
 * ¿Qué mora hay que devolverle al crédito cuando su boleta resulta falsa?
 *
 * Anular un pago significa que el cliente NO pagó: la mora que esa boleta
 * cubrió le vuelve a deberse. `falsePayment` no escribía nada, así que el
 * crédito se quedaba sin esa mora y —peor— el `DECREMENTO` del pago quedaba
 * HUÉRFANO en `moras_historial`: el pago desaparecía de las consultas por
 * `paymentFalse`, pero su evento seguía ahí. El reporte de recuperación veía
 * una bajada sin contrapartida y contaba la reposición del cron de la mañana
 * siguiente como mora NUEVA (Q100 de foto terminaban en Q200 de esperado).
 *
 * Las dos reglas que el monto tiene que cumplir:
 *
 *   * Se restituye la MORA del pago, no el monto de la boleta: la boleta traía
 *     capital, interés e IVA además de la mora, y devolver el total le
 *     inventaría al cliente una deuda de mora que nunca tuvo.
 *   * Una boleta que YA estaba falsa no restituye nada. El UPDATE que marca el
 *     pago pasa igual sobre una fila ya falsa y su `rowCount` no distingue los
 *     dos casos, así que lo único que corta la repetición es haber leído
 *     `paymentFalse` ANTES.
 *
 * Vive fuera de `payments.ts` —y sin tocar la base— para que la regla se pueda
 * probar de verdad: varios tests de la suite registran un `mock.module` global
 * de `./payments`, y cualquier prueba que entrara por ahí sería rehén de cuál
 * de esos mocks gane la corrida.
 */
export function restitucionMoraDePagoAnulado(
	pago: PagoParaAnular | undefined | null,
	pagoId: number | string,
): RestitucionMora | null {
	if (!pago) return null;
	if (pago.paymentFalse) return null;
	const mora = Number(pago.mora ?? 0);
	if (!Number.isFinite(mora) || mora <= 0) return null;
	return { monto_cambio: mora, motivo: motivoAnulacionMora(pagoId) };
}
