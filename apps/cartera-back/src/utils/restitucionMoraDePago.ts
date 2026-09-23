import { motivoAnulacionMora, motivoReversaMora } from "./motivoReversaMora";

/** Lo que la regla necesita saber del pago para decidir la restitución. */
export type PagoParaRestituir = {
	/** La mora que ESA boleta había cobrado. `null` si no cobró ninguna. */
	mora?: string | number | null;
	/** ¿La boleta YA estaba marcada como falsa? */
	paymentFalse?: boolean | null;
};

/** El ajuste de mora que deja un pago invalidado, o `null` si no deja ninguno. */
export type RestitucionMora = { monto_cambio: number; motivo: string };

/**
 * Los dos hechos que invalidan un pago y le devuelven su mora al crédito.
 *
 * Son hechos DISTINTOS —anular declara que la boleta nunca entró, revertir
 * deshace un pago que sí existió— y cada uno deja su propio prefijo en
 * `moras_historial`. Pero la pregunta "¿cuánta mora hay que devolver?" es la
 * MISMA para los dos, y por eso la responde una sola función: dos reglas que
 * hacen lo mismo se separan con el tiempo, y la que se quedara atrás volvería
 * a sobrecobrarle al cliente.
 */
export type CausaRestitucionMora = "ANULACION" | "REVERSA";

const MOTIVO_POR_CAUSA: Record<
	CausaRestitucionMora,
	(pagoId: number | string) => string
> = {
	ANULACION: motivoAnulacionMora,
	REVERSA: motivoReversaMora,
};

/**
 * Lo que pasó con la mora del crédito DESPUÉS de que este pago la bajara.
 *
 * `moraRepuestaPorElCron` es cierto cuando, desde que el pago aplicó su
 * DECREMENTO, el cron volvió a fijar la mora desde cero (un `CREACION` o un
 * `RECALCULO` con `origen: "PROCESO_AUTO"` en `moras_historial`). Quien lo
 * averigua es `elCronYaRepusoLaMora` (`controllers/moraRepuestaPorElCron.ts`),
 * también una sola vez para los dos caminos.
 */
export type EstadoMoraTrasElPago = { moraRepuestaPorElCron: boolean };

/**
 * ¿Qué mora hay que devolverle al crédito cuando su pago deja de valer?
 *
 * Invalidar un pago —anularlo por boleta falsa o revertirlo— significa que el
 * cliente NO pagó: la mora que esa boleta cubrió le vuelve a deberse. Si nadie
 * la restituye, el crédito se queda sin esa mora y —peor— el `DECREMENTO` del
 * pago queda HUÉRFANO en `moras_historial`: el reporte de recuperación ve una
 * bajada sin contrapartida y cuenta la reposición del cron de la mañana
 * siguiente como mora NUEVA (Q100 de foto terminaban en Q200 de esperado).
 *
 * Las reglas que el monto tiene que cumplir:
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
 *     deshecha. Sumarle otra vez `pagos_credito.mora` dejaba el doble
 *     (Q100 → Q0 → Q100 del cron → Q200). Medido sobre el dump: 32 de 33 pagos
 *     `pending` con mora > 0 sobrevivieron una corrida que volvió a fijar el
 *     monto, así que el caso raro es el otro.
 *   * Una boleta que YA estaba falsa no restituye nada, venga la invalidación
 *     por donde venga. Al anular, porque el UPDATE que marca el pago pasa igual
 *     sobre una fila ya falsa y su `rowCount` no distingue los dos casos, así
 *     que lo único que corta la repetición es haber leído `paymentFalse` ANTES.
 *     Al revertir, porque esa anulación YA le devolvió su mora al crédito:
 *     revertir encima la cobraría dos veces.
 *
 * Vive fuera de `payments.ts` —y sin tocar la base— para que la regla se pueda
 * probar de verdad: varios tests de la suite registran un `mock.module` global
 * de `./payments`, y cualquier prueba que entrara por ahí sería rehén de cuál
 * de esos mocks gane la corrida.
 */
export function restitucionMoraDePago(
	pago: PagoParaRestituir | undefined | null,
	pagoId: number | string,
	causa: CausaRestitucionMora,
	estado: EstadoMoraTrasElPago = { moraRepuestaPorElCron: false },
): RestitucionMora | null {
	if (!pago) return null;
	if (pago.paymentFalse) return null;
	// El cron ya repuso la mora entera: restituir encima sería cobrarla dos
	// veces (ver el bloque de arriba).
	if (estado.moraRepuestaPorElCron) return null;
	const mora = Number(pago.mora ?? 0);
	if (!Number.isFinite(mora) || mora <= 0) return null;
	return { monto_cambio: mora, motivo: MOTIVO_POR_CAUSA[causa](pagoId) };
}
