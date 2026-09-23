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
