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
