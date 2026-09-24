/**
 * Marca con la que una REVERSA DE PAGO deja su rastro en `moras_historial`.
 *
 * Cuando se revierte un pago que incluía mora, `reversePayment` no escribe un
 * evento propio: llama a `updateMora` con `tipo: "INCREMENTO"` para RESTITUIR
 * el saldo que ese pago había cubierto. El evento que queda es indistinguible
 * —mismo `tipo_evento`, mismo `origen: API_MANUAL`— de un incremento manual
 * hecho por un analista desde `POST /mora/update`. Lo único que los separa es
 * el `motivo`, así que el texto deja de ser decorativo y pasa a ser CONTRATO:
 * el reporte de recuperación lo lee para no contar la restitución como mora
 * nueva (ver `moraRecuperacion.ts`).
 *
 * Vive en su propio módulo, sin dependencias, para que el que escribe la marca
 * y el que la lee compartan la MISMA constante y no puedan separarse con un
 * cambio de redacción.
 */
export const MOTIVO_REVERSA_MORA_PREFIJO = "Reversa de pago #";

/** El motivo completo que guarda la reversa del pago `pagoId`. */
export function motivoReversaMora(pagoId: number | string): string {
	return `${MOTIVO_REVERSA_MORA_PREFIJO}${pagoId}: se restituye la mora que ese pago había cubierto`;
}

/**
 * Marca con la que una ANULACIÓN de pago (`falsePayment`) deja su rastro.
 *
 * Anular NO es revertir: la reversa deshace un pago que existió, la anulación
 * declara que ese pago NUNCA entró (boleta falsa). El efecto sobre la mora es
 * el mismo —el cliente vuelve a deber lo que esa boleta había cubierto— pero
 * son hechos distintos y el historial tiene que poder distinguirlos, así que
 * cada uno lleva su PROPIO prefijo.
 *
 * Antes `falsePayment` no escribía nada: el `DECREMENTO` del pago quedaba
 * huérfano —el pago desaparecía de las consultas por `paymentFalse`, pero su
 * evento seguía en `moras_historial`—, el crédito se quedaba sin la mora que
 * nunca le pagaron, y el reporte de recuperación veía una bajada sin
 * contrapartida y cobraba la restitución del cron como mora NUEVA.
 */
export const MOTIVO_ANULACION_MORA_PREFIJO = "Anulación de pago #";

/** El motivo completo que guarda la anulación del pago `pagoId`. */
export function motivoAnulacionMora(pagoId: number | string): string {
	return `${MOTIVO_ANULACION_MORA_PREFIJO}${pagoId}: la boleta resultó falsa, se restituye la mora que había cubierto`;
}

/**
 * Los prefijos que marcan una RESTITUCIÓN de mora: un `INCREMENTO` que no es
 * deuda nueva sino la devolución del saldo que un pago había cubierto y que
 * dejó de valer (revertido o anulado).
 *
 * La lista vive acá, junto a las constantes, para que el lector
 * (`moraRecuperacion.ts`) no tenga que enumerarlas y no se pueda agregar un
 * escritor nuevo sin que el reporte lo reconozca.
 */
export const MOTIVOS_RESTITUCION_MORA_PREFIJOS = [
	MOTIVO_REVERSA_MORA_PREFIJO,
	MOTIVO_ANULACION_MORA_PREFIJO,
] as const;

/**
 * ── EL LAZO ENTRE UN `DECREMENTO` DE MORA Y EL PAGO QUE LO CAUSÓ ────────────
 *
 * Cuando se registra un pago, la mora baja EN EL ACTO (`procesarPagoMora` →
 * `updateMora` DECREMENTO) y queda un evento en `moras_historial`. Ese evento
 * NO decía de qué pago venía, y las dos rutas que invalidan un pago —anularlo
 * y revertirlo— tenían que ADIVINARLO:
 *
 *   * por FECHA, comparando contra `pagos_credito.createdat`. Pero el
 *     decremento se aplica ANTES de que la fila del pago exista (el
 *     `procesarPagoMora` de `registerPayment` corre mucho antes del INSERT),
 *     así que el `createdat` es POSTERIOR al evento que pretendía anclar: una
 *     corrida del cron en ese hueco caía del lado equivocado del ancla.
 *   * por PROXY, preguntando "¿hubo algún CREACION/RECALCULO del cron
 *     después?". Cualquiera servía, aunque no hubiera repuesto ESTE
 *     decremento, y una restitución legítima quedaba salteada.
 *
 * La marca lo vuelve identificable. Va en el `motivo` —y no en una columna
 * nueva— porque el `motivo` YA es el canal de contrato de este módulo (los
 * prefijos de restitución de arriba viven de lo mismo) y porque una columna
 * exigiría una migración en una cadena de despliegue que ya tiene su propio
 * orden.
 *
 * Se ESTAMPA DESPUÉS: cuando el decremento se escribe todavía no hay `pago_id`
 * —esa es justamente la causa de que el `createdat` sea posterior—, así que
 * `registerPayment` guarda el `historial_id` del evento y le agrega la marca en
 * cuanto la fila del pago existe. Reservar el id de antemano (un `nextval` de
 * la secuencia) NO sirve: la mora no siempre aterriza en una fila NUEVA —la
 * rama de "cierre sobre fila desechable" la escribe con un UPDATE sobre una
 * fila que ya existía, con un id ya asignado—, así que un id reservado sería
 * el de otra fila.
 */
export const MARCA_PAGO_DEL_DECREMENTO_PREFIJO = " [pago #";

/** La marca que liga el decremento de mora al pago `pagoId`. */
export function marcaPagoDelDecremento(pagoId: number | string): string {
	return `${MARCA_PAGO_DEL_DECREMENTO_PREFIJO}${pagoId}]`;
}

/**
 * Marca que declara que un `DECREMENTO` de mora YA NO VALE: el pago que lo
 * causó se anuló o se revirtió.
 *
 * Sin ella el reporte de recuperación seguía viendo la bajada y contaba la
 * reposición del cron como mora NUEVA (una foto de Q100 terminaba en Q200 de
 * esperado), incluso cuando la reconciliación decidía —con razón— que no había
 * nada que restituir porque el cron ya lo había hecho. El monto no alcanzaba
 * para contarlo: lo que hacía falta era que el HECHO quedara anotado.
 *
 * El lector es `moraRecuperacion.ts`: un decremento anulado no baja el nivel de
 * referencia ni puede ser el ancla de la siembra, porque ese pago nunca existió.
 */
export const MARCA_DECREMENTO_ANULADO = " [decremento anulado]";
