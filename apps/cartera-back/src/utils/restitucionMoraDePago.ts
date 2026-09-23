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
 * Tiene DOS formas porque hay dos mundos, y no se pueden mezclar:
 *
 *   * `decrementoIdentificado: true` — el `DECREMENTO` del pago lleva su marca
 *     (`marcaPagoDelDecremento`) y se pudo encontrar. Entonces se sabe con
 *     exactitud cuánto bajó (`bajadoPorElPago`) y cuánto de eso ya se repuso
 *     DESPUÉS de ese evento (`yaRepuesto`), y la restitución es la DIFERENCIA.
 *     Sin esto la pregunta era "¿hubo algún evento del cron después?", que
 *     decía que sí aunque el cron hubiera repuesto la mitad —o hubiera
 *     recalculado por otras cuotas y no repuesto nada de esto—, y la
 *     restitución legítima quedaba salteada: el error CONTRARIO al sobrecobro.
 *
 *   * `decrementoIdentificado: false` — decremento VIEJO, anterior a la marca,
 *     o un pago que nunca bajó mora. No hay nada que comparar, así que se cae
 *     al criterio de antes: `moraRepuestaPorElCron`, el proxy grueso anclado en
 *     `pagos_credito.createdat`. Se conserva TAL CUAL y no se endurece: es el
 *     comportamiento que ya se midió contra el dump (crédito 980, pago 152172)
 *     y el único que no le devuelve el doble a un crédito cuyo decremento no se
 *     puede ubicar. Los decrementos viejos se van agotando solos; los nuevos
 *     nacen todos marcados.
 */
export type EstadoMoraTrasElPago =
	| {
			decrementoIdentificado: true;
			/** Cuánto bajó la mora ESE decremento (`monto_anterior - monto_nuevo`). */
			bajadoPorElPago: number;
			/** Cuánto de esa bajada ya volvió a subir DESPUÉS de ese evento. */
			yaRepuesto: number;
	  }
	| { decrementoIdentificado?: false; moraRepuestaPorElCron: boolean };

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
 *   * Se restituye lo que FALTA, no todo. Si el cron ya repuso la bajada de
 *     este pago, no se restituye nada; si repuso solo una parte, se restituye
 *     la diferencia. Cuánto se repuso sale de comparar contra el `DECREMENTO`
 *     de ESTE pago, identificado por su marca (ver `moraDecrementoDePago.ts`);
 *     para los decrementos viejos, sin marca, sigue valiendo el criterio de
 *     todo-o-nada de abajo. La cadena del
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
	const mora = Number(pago.mora ?? 0);
	if (!Number.isFinite(mora) || mora <= 0) return null;

	const monto = estado.decrementoIdentificado
		? // Se sabe qué bajó y cuánto volvió: se restituye la DIFERENCIA.
			//
			// El tope es `bajadoPorElPago` y no `pago.mora` a secas porque son
			// cosas distintas: `pago.mora` es lo que la boleta COBRÓ, y el
			// decremento es lo que de verdad se le bajó al saldo (`updateMora`
			// nunca deja la mora bajo cero, así que un cobro mayor que el saldo
			// baja menos). Devolver el cobro entero le inventaría al crédito una
			// mora que nunca tuvo.
			Math.max(
				0,
				Math.min(mora, estado.bajadoPorElPago) - estado.yaRepuesto,
			)
		: // Decremento no identificable: el criterio viejo, todo o nada.
			estado.moraRepuestaPorElCron
			? 0
			: mora;

	if (!(monto > 0)) return null;
	return {
		monto_cambio: redondearCentavos(monto),
		motivo: MOTIVO_POR_CAUSA[causa](pagoId),
	};
}

/**
 * La resta de dos montos con decimales binarios deja colas
 * (`333.95 - 333.94999999` → `1.0000000287e-8`). El saldo de mora vive en
 * `numeric(18,2)`, así que cualquier cola por debajo del centavo es ruido: se
 * corta acá, en el único lugar donde nace el monto a restituir.
 */
function redondearCentavos(monto: number): number {
	return Math.round(monto * 100) / 100;
}
