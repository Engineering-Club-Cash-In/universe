// Estado de un pago Nexa según cartera (`nexa_payment_events.status`), en español.
export type TonoEstadoNexa = "ok" | "espera" | "error" | "neutro";

const ESTADOS: Record<string, { etiqueta: string; tono: TonoEstadoNexa }> = {
  processing: { etiqueta: "Procesando", tono: "espera" },
  applied: { etiqueta: "Aplicado", tono: "ok" },
  billing_pending: { etiqueta: "Aplicado · factura pendiente", tono: "espera" },
  billing_running: { etiqueta: "Aplicado · facturando", tono: "espera" },
  billed: { etiqueta: "Aplicado y facturado", tono: "ok" },
  billing_failed: { etiqueta: "Aplicado · factura fallida", tono: "error" },
  billing_unknown: { etiqueta: "Aplicado · factura incierta", tono: "error" },
  failed: { etiqueta: "Rechazado", tono: "error" },
  manual_review: { etiqueta: "En revisión manual", tono: "espera" },
};

export const estadoNexa = (estado: string | null | undefined) =>
  (estado && ESTADOS[estado]) || { etiqueta: estado || "Sin estado", tono: "neutro" as const };

export const CLASES_TONO_NEXA: Record<TonoEstadoNexa, string> = {
  ok: "bg-green-50 text-green-700 border-green-300",
  espera: "bg-amber-50 text-amber-700 border-amber-300",
  error: "bg-red-50 text-red-700 border-red-300",
  neutro: "bg-gray-100 text-gray-700 border-gray-300",
};

// Por qué cartera no aplicó un pago de Nexa, dicho para quien atiende al cliente.
const MOTIVOS: Record<string, string> = {
  token_mismatch: "El token es de otro crédito",
  token_missing: "El pago llegó sin token",
  binding_token_missing: "El crédito no tiene token registrado en cartera",
  binding_missing: "El crédito no está habilitado para Nexa",
  binding_inactive: "Crédito cancelado",
  credit_cancelled: "Crédito cancelado",
  binding_expired: "La habilitación de Nexa del crédito venció",
  amount_exceeds_binding: "El monto supera el tope permitido para Nexa",
  credit_not_payable: "El crédito no admite pagos en su estado",
  credit_not_found: "El crédito no existe en cartera",
  payment_date_required: "El pago llegó sin fecha bancaria",
  payment_outcome_uncertain: "No se pudo confirmar si el pago quedó aplicado",
  payment_not_applied: "Cartera no pudo aplicar el pago",
};

// Algunos códigos llegan con detalle ("payment_outcome_uncertain:condonacion_anulada"): se traduce el código y se deja el detalle.
export const motivoRechazoNexa = (codigo: string | null | undefined) => {
  if (!codigo) return "Otro motivo (sin código)";
  const [base, ...resto] = codigo.split(":");
  const texto = MOTIVOS[base];
  if (!texto) return `Otro motivo (${codigo})`;
  return resto.length ? `${texto} (${resto.join(":")})` : texto;
};
