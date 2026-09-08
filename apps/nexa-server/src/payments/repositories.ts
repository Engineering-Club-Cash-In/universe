import type { TokenTransaction } from "../nexa/schemas";

export type StoredPaymentTransaction = {
  id: number;
  reference: string;
  processingStatus: "PENDING" | "RECEIVED" | "APPLYING" | "APPLIED" | "REVIEW_PENDING" | "COMPLETED" | "REJECTED" | "FAILED" | "MANUAL_REVIEW";
  created: boolean;
};

export interface PaymentTransactionRepository {
  upsertReceived(transaction: TokenTransaction): Promise<StoredPaymentTransaction>;
  markApplied(id: number, paymentId: number): Promise<void>;
  markRejected(id: number, reason: string): Promise<void>;
  markFailed(id: number, reason: string): Promise<void>;
}

export interface TokenUserRepository {
  findByToken(token: string): Promise<{ creditoId: number } | null>;
}
