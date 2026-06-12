import type { ReviewTransferStatus, TokenTransaction } from "../nexa/schemas";
import type { CarteraPaymentClient } from "./cartera-client";
import type { PaymentTransactionRepository, TokenUserRepository } from "./repositories";

interface NexaPaymentClient {
  getPaymentTokenStatement(date: string): Promise<{ transactions: TokenTransaction[] }>;
  reviewTransfer(payload: { id: string; reference: string | number; status: ReviewTransferStatus }): Promise<unknown>;
}

export async function pollPaymentTokenDate(options: {
  date: string;
  nexa: NexaPaymentClient;
  cartera: CarteraPaymentClient;
  transactions: PaymentTransactionRepository;
  tokenUsers: TokenUserRepository;
}) {
  const result = { found: 0, created: 0, applied: 0, rejected: 0, skipped: 0, failed: 0 };
  const statement = await options.nexa.getPaymentTokenStatement(options.date);
  result.found = statement.transactions.length;

  for (const transaction of statement.transactions) {
    const reference = String(transaction.reference);
    if (await options.transactions.existsByReference(reference)) {
      result.skipped++;
      continue;
    }

    if (transaction.wasReturn === 1 || transaction.amount <= 0) {
      result.skipped++;
      continue;
    }

    const tokenUser = await options.tokenUsers.findByToken(transaction.token);
    const stored = await options.transactions.createPending({ ...transaction, reference });
    result.created++;

    if (!tokenUser) {
      await options.transactions.markRejected(stored.id, "Token no asociado a credito");
      await options.nexa.reviewTransfer({ id: reference, reference, status: "REJECTED" });
      result.rejected++;
      continue;
    }

    try {
      const carteraResult = await options.cartera.applyNexaPayment({ creditoId: tokenUser.creditoId, transaction });
      if (carteraResult.status === "APPLIED") {
        await options.transactions.markApplied(stored.id, carteraResult.paymentId);
        await options.nexa.reviewTransfer({ id: reference, reference, status: "APPROVED" });
        result.applied++;
      } else {
        await options.transactions.markRejected(stored.id, carteraResult.reason);
        await options.nexa.reviewTransfer({ id: reference, reference, status: "REJECTED" });
        result.rejected++;
      }
    } catch (error) {
      await options.transactions.markFailed(stored.id, error instanceof Error ? error.message : String(error));
      result.failed++;
    }
  }

  return result;
}
