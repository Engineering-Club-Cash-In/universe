/**
 * Helpers de visibilidad de las acciones de un crédito.
 *
 * Vivían duplicados dentro de `CreditsPaymentsData.tsx`. Se sacaron acá para
 * que la barra de acciones (`CreditoAcciones.tsx`) y la pantalla que la
 * contiene compartan LA MISMA definición: cada condición se escribe una vez.
 *
 * Las reglas son exactamente las que había antes; no se cambió ninguna.
 */

export type CreditStatus =
  | "ACTIVO"
  | "PENDIENTE_CANCELACION"
  | "CANCELADO"
  | "INCOBRABLE"
  | "MOROSO"
  | "EN_CONVENIO"
  | "CAIDO";

// Reciben el estado aunque hoy no lo miren: así todas las condiciones se
// escriben igual y agregar una regla no obliga a tocar los llamadores.
export const canEdit = (s: CreditStatus) => {
  void s;
  return true;
};
export const canCancel = (s: CreditStatus) => ["ACTIVO", "MOROSO"].includes(s);
export const canActivate = (s: CreditStatus) => s === "PENDIENTE_CANCELACION";
export const canViewPayments = (s: CreditStatus) => {
  void s;
  return true;
};
export const canCreateConvenio = (s: CreditStatus) =>
  ["ACTIVO", "MOROSO"].includes(s);
export const canMarkCaido = (s: CreditStatus) =>
  ["ACTIVO", "MOROSO"].includes(s);
export const canViewReports = (s: CreditStatus) =>
  s === "PENDIENTE_CANCELACION" || s === "CANCELADO";
