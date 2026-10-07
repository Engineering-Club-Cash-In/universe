/**
 * Decisión de negocio: un pago que entró por Nexa NO se puede anular ni
 * revertir. Nexa ya aprobó la transferencia y su API no permite deshacerla.
 * El back lo rechaza con 409 (`nexa_payment_not_reversible`); acá se
 * deshabilita el botón para que ni se intente.
 *
 * Excepción: si Nexa rechazó la transferencia y devolvió el dinero (evento
 * `failed`, `nexaEventoFallido`), las filas que alcanzaron a crearse SÍ se
 * anulan; el back las deja pasar con la misma regla.
 */
export const MENSAJE_PAGO_NEXA_NO_ANULABLE =
  "Este pago entró por Nexa y no se puede anular.";

type PagoConCanal = {
  canal?: string | null;
  entroPorNexa?: boolean | null;
  nexaEventoFallido?: boolean | null;
};

export function puedeAnularPago(pago: PagoConCanal | null | undefined): boolean {
  if (pago?.nexaEventoFallido === true) return true;
  return !(pago?.canal === "NEXA" || pago?.entroPorNexa === true);
}

/** Texto del tooltip (`title`) del botón de anular/revertir; undefined si no hay motivo. */
export function motivoNoAnularPago(
  pago: PagoConCanal | null | undefined,
): string | undefined {
  return puedeAnularPago(pago) ? undefined : MENSAJE_PAGO_NEXA_NO_ANULABLE;
}
