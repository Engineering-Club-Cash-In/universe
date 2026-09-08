import type { TokenTransaction } from "../nexa/schemas";
import type { CarteraPaymentClient } from "./cartera-client";
import type { PaymentTransactionRepository, TokenUserRepository } from "./repositories";

interface NexaPaymentClient {
  getPaymentTokenStatement(date: string): Promise<{ transactions: TokenTransaction[] }>;
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
    const stored = await options.transactions.upsertReceived({
      ...transaction,
      reference: String(transaction.reference),
    });
    if (stored.created) result.created++;
    else result.skipped++;
  }

  return result;
}
