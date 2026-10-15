/**
 * El asunto del correo de "Compra de Cartera aceptada".
 *
 * Lleva el monto y la fecha y hora de la aceptación para que cada compra sea su
 * propia conversación. Gmail agrupa en una sola los correos con el mismo asunto
 * y el mismo remitente: con "Compra de Cartera aceptada - {inversionista}" a
 * secas, la segunda compra del mismo inversionista caía en la conversación de
 * la primera (Boca-Terra, 14-oct-2026: Q130,000 y Q15,000 el mismo día), y los
 * contratos que jurídico contesta en el hilo de cada compra quedaban mezclados.
 *
 * Vive fuera de `index.ts` por lo mismo que `asuntoLiquidacion.ts`: ese módulo
 * tira al importarse sin las variables de Resend, y así el asunto se prueba solo.
 */
export const asuntoCompraCarteraAceptada = ({
  etiqueta,
  monto,
  aceptadaEn,
  currencySymbol = "Q",
}: {
  /** El inversionista, o el cliente / la cantidad de créditos si no hay uno. */
  etiqueta: string;
  /** El monto de la compra, si se conoce ("15000.00"). */
  monto?: string | null;
  aceptadaEn: Date;
  currencySymbol?: string;
}): string => {
  const partes = [`Compra de Cartera aceptada - ${etiqueta}`];
  const montoNumero = monto?.trim() ? Number(monto) : Number.NaN;
  if (Number.isFinite(montoNumero)) {
    partes.push(
      `${currencySymbol}${montoNumero.toLocaleString("es-GT", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`,
    );
  }
  partes.push(fechaHoraGT(aceptadaEn));
  return partes.join(" - ");
};

/** "14/10/2026 12:15", en hora de Guatemala. */
function fechaHoraGT(fecha: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("es-GT", {
      timeZone: "America/Guatemala",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(fecha)
      .map((parte) => [parte.type, parte.value]),
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}
