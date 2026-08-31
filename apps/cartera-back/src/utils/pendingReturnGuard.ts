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

export function buildPendingReturnAuthorizationWarningFromErrors(
  errors: unknown,
): PendingReturnAuthorizationWarning | null {
  if (!Array.isArray(errors)) return null;

  const candidates: PendingReturnCandidate[] = [];
  for (const error of errors) {
    if (
      !error ||
      typeof error !== "object" ||
      (error as { code?: unknown }).code !== PENDING_RETURN_AUTHORIZATION_CODE
    ) {
      continue;
    }

    const blocked = (error as { creditos_bloqueados?: unknown }).creditos_bloqueados;
    if (!Array.isArray(blocked)) continue;

    for (const credit of blocked) {
      if (!credit || typeof credit !== "object") continue;
      const row = credit as {
        credito_id?: unknown;
        numero_credito_sifco?: unknown;
        estado_devolucion?: unknown;
      };
      if (
        typeof row.credito_id !== "number" ||
        typeof row.numero_credito_sifco !== "string"
      ) {
        continue;
      }
      candidates.push({
        creditoId: row.credito_id,
        numeroCreditoSifco: row.numero_credito_sifco,
        estadoDevolucion: row.estado_devolucion as string | null | undefined,
      });
    }
  }

  return buildPendingReturnAuthorizationWarning(candidates);
}

export function formatPendingReturnAuthorizationNote(
  warning: PendingReturnAuthorizationWarning,
): string {
  const sifcos = warning.creditos_bloqueados
    .map((credit) => credit.numero_credito_sifco)
    .join(", ");
  return `[BLOQUEO DEVOLUCIÓN CUBE] Créditos pendientes de autorización: ${sifcos}.`;
}
