import type { TokenTransaction } from "../nexa/schemas";

export type StoredPaymentTransaction = TokenTransaction & { id: number };

export interface PaymentTransactionRepository {
  existsByReference(reference: string): Promise<boolean>;
  createPending(transaction: TokenTransaction): Promise<StoredPaymentTransaction>;
  markApplied(id: number, paymentId: number): Promise<void>;
  markRejected(id: number, reason: string): Promise<void>;
  markFailed(id: number, reason: string): Promise<void>;
}

export interface TokenUserRepository {
  findByToken(token: string): Promise<{ creditoId: number } | null>;
}
