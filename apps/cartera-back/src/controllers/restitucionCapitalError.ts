import type { CodigoAnulacionCapital } from "./restitucionCapitalPorAnulacionPolicy";

/**
 * 409 al anular un pago que ya bajó capital y ese capital no se puede reponer solo. Sin
 * dependencias (lo importa `anularPagoMora.ts`, que no puede arrastrar la base). Se tira dentro de
 * la transacción de la anulación, así que no queda nada escrito.
 */
const RAZON: Record<CodigoAnulacionCapital, string> = {
  CREDITO_NO_REVERSIBLE: "el crédito está en un estado que no admite reponer capital",
  FILA_ESTRUCTURAL_INCOBRABLE: "es una fila del sistema de un crédito incobrable, no una recuperación",
  PCI_LIQUIDADO: "el reparto a inversionistas de este pago ya se liquidó",
  ABONO_CAPITAL_LIQUIDADO: "el abono a capital ya se liquidó o entró en un cálculo de pagos",
  INVERSIONISTA_YA_NO_ESTA: "un inversionista que recibió capital de este pago ya no está en el crédito",
  REPARTO_INCONSISTENTE: "el reparto a inversionistas no cuadra con el abono a capital del pago",
};

export class AnulacionCapitalNoRestituibleError extends Error {
  readonly status = 409 as const;
  constructor(readonly code: CodigoAnulacionCapital) {
    super(
      `No se puede anular este pago: ya bajó capital y ${RAZON[code]}. ` +
        "Contabilidad lo resuelve con un ajuste manual o revirtiendo el pago; no se anuló nada.",
    );
  }
}
