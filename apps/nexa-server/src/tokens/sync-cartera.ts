import type { CarteraTokenClient } from "../payments/cartera-client";
import type { CarteraEventTokenUsers } from "../routes/cartera-events";
import { deactivateIfCreditCancelled } from "./credit-cancelled";

type SyncableTokenUser = {
  // Solo para el dry-run: identifican qué fila se registraría.
  id?: number;
  description?: string;
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
  // Solo con lista blanca: créditos pedidos que no tienen token user activo.
  notFound?: number[];
  // Solo en dry-run: lo que se registraría. Del token solo salen los últimos 4 dígitos.
  wouldRegister?: { id?: number; creditoId: number; tokenLast4: string; description?: string }[];
};

export async function syncTokensToCartera(options: {
  tokenUsers: { list(): Promise<SyncableTokenUser[]> };
  cartera: CarteraTokenClient;
  // Desactiva el token user local si cartera responde credit_cancelled.
  cancelledTokenUsers: CarteraEventTokenUsers;
  // Lista blanca: solo se sincronizan los token users de estos créditos.
  creditoIds?: number[];
  // No llama a cartera ni desactiva nada: solo informa qué registraría.
  dryRun?: boolean;
}): Promise<TokenSyncSummary> {
  const summary: TokenSyncSummary = {
    total: 0, created: 0, updated: 0, unchanged: 0, skippedInactive: 0, rejected: [], failed: [],
  };
  const whitelist = options.creditoIds ? new Set(options.creditoIds) : undefined;
  const synced = new Set<number>();
  if (options.dryRun) summary.wouldRegister = [];
  for (const user of await options.tokenUsers.list()) {
    if (whitelist && !whitelist.has(user.creditoId)) continue;
    if (!user.active || user.paymentTokenActive === false) {
      summary.skippedInactive += 1;
      continue;
    }
    summary.total += 1;
    synced.add(user.creditoId);
    const token = user.prefix ? `${user.prefix}${user.identifier}` : user.token;
    if (options.dryRun) {
      summary.wouldRegister!.push({
        ...(user.id !== undefined ? { id: user.id } : {}),
        creditoId: user.creditoId,
        tokenLast4: token.slice(-4),
        ...(user.description !== undefined ? { description: user.description } : {}),
      });
      continue;
    }
    try {
      const result = await options.cartera.registerNexaToken({
        creditoId: user.creditoId,
        token,
        identifier: user.identifier,
        nexaUserId: user.nexaUserId,
      });
      await deactivateIfCreditCancelled(result, user.creditoId, options.cancelledTokenUsers);
      if (result.status === "REJECTED") summary.rejected.push({ creditoId: user.creditoId, reason: result.reason });
      else if (result.status === "CREATED") summary.created += 1;
      else if (result.status === "UPDATED") summary.updated += 1;
      else summary.unchanged += 1;
    } catch {
      summary.failed.push({ creditoId: user.creditoId });
    }
  }
  if (whitelist) summary.notFound = [...whitelist].filter((creditoId) => !synced.has(creditoId));
  return summary;
}
