import type { TokenTransaction } from "../nexa/schemas";

type MissingDateReceipt = { reference: string; createdAt: Date };
type EnrichmentOptions = {
  repository: {
    listMissingDateReceipts(): Promise<MissingDateReceipt[]>;
    enrichIncomingStatement(transaction: TokenTransaction): Promise<boolean>;
  };
  nexa: { getPaymentTokenStatement(date: string): Promise<{ transactions: TokenTransaction[] }> };
};

export async function runStatementEnrichmentOnce(options: EnrichmentOptions) {
  const receipts = await options.repository.listMissingDateReceipts();
  const references = new Set(receipts.map((row) => row.reference));
  const dates = new Set<string>();
  for (const receipt of receipts) {
    // UTC and bank-local day boundaries can differ; never invent a payment date.
    for (const offset of [-1, 0, 1]) {
      const date = new Date(receipt.createdAt.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
      if (date <= new Date().toISOString().slice(0, 10)) dates.add(date);
    }
  }
  const matches = new Map<string, TokenTransaction[]>();
  for (const date of dates) {
    const statement = await options.nexa.getPaymentTokenStatement(date);
    for (const row of statement.transactions) {
      const reference = String(row.reference);
      if (!references.has(reference)) continue;
      const candidates = matches.get(reference) ?? [];
      candidates.push(row);
      matches.set(reference, candidates);
    }
  }
  let enriched = 0;
  for (const candidates of matches.values()) {
    if (candidates.length !== 1) continue;
    if (await options.repository.enrichIncomingStatement(candidates[0]!)) enriched++;
  }
  return enriched;
}
