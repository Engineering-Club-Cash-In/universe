/**
 * Un crédito sin espejo de inversionistas no puede anular boletas.
 *
 * ── Por qué existe este error y no un 400 genérico ─────────────────────────
 * `insertPagosCreditoInversionistas` tira «No hay inversionistas registrados
 * para este crédito» cuando `creditos_inversionistas_espejo` no tiene ni una
 * fila para el crédito. Ese throw sale del fondo del reparto, y el router lo
 * empaqueta como «Failed to mark payment as false» + el mensaje crudo: al
 * operador le llega un 400 que suena a error del sistema, cuando en realidad
 * es un dato faltante del crédito que alguien tiene que ir a cargar.
 *
 * Peor: con la anulación corriendo ANTES de los espejos, ese throw llega
 * cuando la boleta YA está commiteada como falsa. El 400 miente dos veces —no
 * es culpa del sistema, y sí pasó algo—. Por eso la precondición se chequea
 * antes de escribir nada, y cuando falla habla con la misma voz que
 * `PendingReturnAuthorizationError`: un `code` que el router reconoce y un 422,
 * que es lo que corresponde a «tu petición está bien formada, el estado del
 * dato no la admite».
 */
export const CREDIT_WITHOUT_INVESTOR_MIRROR_CODE =
  "CREDIT_WITHOUT_INVESTOR_MIRROR" as const;

export const buildCreditWithoutInvestorMirrorMessage = (credito_id: number) =>
  `El crédito ${credito_id} no tiene inversionistas en el espejo ` +
  `(cartera.creditos_inversionistas_espejo), así que no se le pueden generar ` +
  `los pagos espejo que toda anulación tiene que escribir. No se anuló nada. ` +
  `Cargá la participación de los inversionistas de este crédito y volvé a ` +
  `intentar; si el crédito no debería tener inversionistas, avisá a Cartera ` +
  `antes de forzar la anulación.`;

export class CreditWithoutInvestorMirrorError extends Error {
  readonly warning = true as const;
  readonly code = CREDIT_WITHOUT_INVESTOR_MIRROR_CODE;
  readonly credito_id: number;

  constructor(credito_id: number) {
    super(buildCreditWithoutInvestorMirrorMessage(credito_id));
    this.name = "CreditWithoutInvestorMirrorError";
    this.credito_id = credito_id;
  }
}
