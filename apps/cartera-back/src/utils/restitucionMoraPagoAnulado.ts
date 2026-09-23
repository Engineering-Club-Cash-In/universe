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
 * Lo que pasó con la mora del crédito DESPUÉS de que este pago la bajara.
 *
 * `moraRepuestaPorElCron` es cierto cuando, desde que el pago aplicó su
 * DECREMENTO, el cron volvió a fijar la mora desde cero (un `CREACION` o un
 * `RECALCULO` con `origen: "PROCESO_AUTO"` en `moras_historial`).
 */
export type EstadoMoraTrasElPago = { moraRepuestaPorElCron: boolean };

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
 *   * Si el cron ya repuso la mora, no se restituye NADA. La cadena del
 *     sobrecobro: registrar un pago baja la mora en el acto, pero el criterio
 *     de cobertura del cron solo cuenta pagos `validated`/`no_required`
 *     (`procesarMoras`, el EXISTS de `hasPaidPayment`), así que un pago
 *     todavía `pending` que sobrevive una corrida nocturna deja la cuota
 *     contada como vencida y el cron VUELVE A FIJAR la mora completa desde la
 *     fórmula —no acumula: REEMPLAZA—. Ahí la bajada del pago ya está
 *     deshecha. Sumarle otra vez `pagos_credito.mora` al anular dejaba el
 *     doble (Q100 → Q0 → Q100 del cron → Q200). Por eso la restitución se
 *     reconcilia contra lo que de verdad falta en vez de sumar siempre.
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
	estado: EstadoMoraTrasElPago = { moraRepuestaPorElCron: false },
): RestitucionMora | null {
	if (!pago) return null;
	if (pago.paymentFalse) return null;
	// El cron ya repuso la mora entera: restituir encima sería cobrarla dos
	// veces (ver el bloque de arriba).
	if (estado.moraRepuestaPorElCron) return null;
	const mora = Number(pago.mora ?? 0);
	if (!Number.isFinite(mora) || mora <= 0) return null;
	return { monto_cambio: mora, motivo: motivoAnulacionMora(pagoId) };
}
