type PagoEditable = {
  canal?: string | null;
  entroPorNexa?: boolean | null;
  monto_boleta?: string | number | null;
};

export const pagoEntroPorNexa = (pago: PagoEditable | null | undefined) =>
  pago?.canal === "NEXA" || pago?.entroPorNexa === true;

/** Texto de la advertencia al guardar la edición; null si el pago no es de Nexa. */
export function textoAdvertenciaEditarPagoNexa(
  pago: PagoEditable | null | undefined,
): string | null {
  if (!pagoEntroPorNexa(pago)) return null;
  const n = Number(pago?.monto_boleta);
  const monto = (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `Este pago entró por Nexa. Nexa ya aprobó esa transferencia por Q${monto} y no se puede cambiar allá. Si editás los montos, cartera y Nexa van a quedar distintos. ¿Guardar igual?`;
}
