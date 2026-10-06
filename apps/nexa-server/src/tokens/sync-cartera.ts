import type { CarteraTokenClient } from "../payments/cartera-client";

type SyncableTokenUser = {
  creditoId: number;
  token: string;
  identifier: string;
  nexaUserId: number;
  active: boolean;
  // Estado del token de pago padre: si está retirado, cartera no debe recibir su binding.
  paymentTokenActive?: boolean;
  // Prefijo del token de pago: cartera compara prefix + identifier, no el token de Nexa.
  prefix?: string;
};

export type TokenSyncSummary = {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  skippedInactive: number;
  rejected: { creditoId: number; reason: string }[];
  failed: { creditoId: number }[];
};

export async function syncTokensToCartera(options: {
  tokenUsers: { list(): Promise<SyncableTokenUser[]> };
  cartera: CarteraTokenClient;
}): Promise<TokenSyncSummary> {
  const summary: TokenSyncSummary = {
    total: 0, created: 0, updated: 0, unchanged: 0, skippedInactive: 0, rejected: [], failed: [],
  };
  for (const user of await options.tokenUsers.list()) {
    if (!user.active || user.paymentTokenActive === false) {
      summary.skippedInactive += 1;
      continue;
    }
    summary.total += 1;
    try {
      const result = await options.cartera.registerNexaToken({
        creditoId: user.creditoId,
        token: user.prefix ? `${user.prefix}${user.identifier}` : user.token,
        identifier: user.identifier,
        nexaUserId: user.nexaUserId,
      });
      if (result.status === "REJECTED") summary.rejected.push({ creditoId: user.creditoId, reason: result.reason });
      else if (result.status === "CREATED") summary.created += 1;
      else if (result.status === "UPDATED") summary.updated += 1;
      else summary.unchanged += 1;
    } catch {
      summary.failed.push({ creditoId: user.creditoId });
    }
  }
  return summary;
}
