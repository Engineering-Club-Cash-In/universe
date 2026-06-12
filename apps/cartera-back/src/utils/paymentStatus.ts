// Estados de `validation_status` que representan un pago APLICADO/real (cuenta
// como plata en reportes, reversa, revalidación, estado de cuenta).
//
// Incluye `capital_validated` (abono directo a capital ya aplicado), que es
// dinero real pero NO es pago de cuota. Por eso NO se usa este grupo en la
// lógica de cuota (sibling query, cuotaCompleta, saldo vigente), que sigue
// filtrando solo por `validated`/`pending` y así deja fuera a los abonos a
// capital.
export const ESTADOS_PAGO_APLICADO = ["validated", "capital_validated"] as const;

export type EstadoPagoAplicado = (typeof ESTADOS_PAGO_APLICADO)[number];

/** ¿El pago está aplicado/validado (incluye abono a capital aplicado)? */
export const esPagoAplicado = (
  status?: string | null
): boolean =>
  status === "validated" || status === "capital_validated";
