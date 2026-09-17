import { sumaQ } from "../../../lib/moneda";

/**
 * Por qué este monto NO se puede guardar al editar un rubro, o `null` si sí.
 *
 * El backend (`puedeEditarMonto`) rechaza con 409 cuando el monto nuevo es MENOR
 * a lo ya abonado: bajarlo por debajo dejaría el rubro debiendo negativo. El
 * formulario sólo exigía "mayor a cero", así que el admin llenaba el motivo,
 * enviaba, y se comía el rechazo con el formulario lleno — el mismo patrón que
 * el desplegable de tipos, y con el dato ya en la mano: `abonado` viene del GET
 * de la lista.
 *
 * Se compara al CENTAVO porque el backend redondea antes de comparar: sin eso,
 * el veredicto hablaría de un monto que nunca se va a guardar.
 *
 * ⚠️ Un `abonado` ausente se trata como cero y NO bloquea. Ante la duda se
 * ofrece: el backend es la autoridad y su 409 viene redactado, mientras que
 * bloquear con un dato que no tenemos deja al ADMIN sin salida desde la
 * pantalla.
 */
export function motivoMontoNoEditable(entrada: {
  monto: string | number;
  abonado: string | number | undefined | null;
}): string | null {
  const monto = Number(entrada.monto);
  if (!String(entrada.monto).trim() || !Number.isFinite(monto) || monto <= 0) {
    return "El monto debe ser un número mayor a cero";
  }

  // `sumaQ` redondea al centavo igual que el backend.
  const montoAlCentavo = sumaQ([monto]);
  const abonado = Number(entrada.abonado ?? 0) || 0;

  if (montoAlCentavo < abonado) {
    return `El monto no puede ser menor a lo ya abonado (Q${abonado.toFixed(2)}).`;
  }

  return null;
}
