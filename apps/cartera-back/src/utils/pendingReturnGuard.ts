export const PENDING_RETURN_AUTHORIZATION_CODE =
  "CREDIT_PENDING_RETURN_AUTHORIZATION" as const;

export const PENDING_RETURN_AUTHORIZATION_MESSAGE =
  "No se puede continuar porque hay créditos pendientes de autorización para devolución a CUBE.";

export type PendingReturnCandidate = {
  creditoId: number;
  numeroCreditoSifco: string;
  estadoDevolucion: string | null | undefined;
};

export type PendingReturnBlockedCredit = {
  credito_id: number;
  numero_credito_sifco: string;
  estado_devolucion: "PENDIENTE_AUTORIZACION";
};

export type PendingReturnAuthorizationWarning = {
  warning: true;
  code: typeof PENDING_RETURN_AUTHORIZATION_CODE;
  message: string;
  creditos_bloqueados: PendingReturnBlockedCredit[];
};

export class PendingReturnAuthorizationError extends Error {
  readonly warning = true as const;
  readonly code = PENDING_RETURN_AUTHORIZATION_CODE;
  readonly creditos_bloqueados: PendingReturnBlockedCredit[];

  constructor(warning: PendingReturnAuthorizationWarning) {
    super(warning.message);
    this.name = "PendingReturnAuthorizationError";
    this.creditos_bloqueados = warning.creditos_bloqueados;
  }
}

export function buildPendingReturnAuthorizationWarning(
  candidates: PendingReturnCandidate[],
): PendingReturnAuthorizationWarning | null {
  const blockedById = new Map<number, PendingReturnBlockedCredit>();

  for (const candidate of candidates) {
    if (candidate.estadoDevolucion !== "PENDIENTE_AUTORIZACION") continue;

    blockedById.set(candidate.creditoId, {
      credito_id: candidate.creditoId,
      numero_credito_sifco: candidate.numeroCreditoSifco,
      estado_devolucion: "PENDIENTE_AUTORIZACION",
    });
  }

  const creditos_bloqueados = [...blockedById.values()].sort(
    (a, b) => a.credito_id - b.credito_id,
  );

  if (creditos_bloqueados.length === 0) return null;

  return {
    warning: true,
    code: PENDING_RETURN_AUTHORIZATION_CODE,
    message: PENDING_RETURN_AUTHORIZATION_MESSAGE,
    creditos_bloqueados,
  };
}
