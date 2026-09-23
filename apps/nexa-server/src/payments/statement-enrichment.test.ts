import { expect, test } from "bun:test";
import { runStatementEnrichmentOnce } from "./statement-enrichment";
import type { TokenTransaction } from "../nexa/schemas";

const receipt = { reference: "test-reference", createdAt: new Date("2026-05-05T01:00:00Z") };
const transaction: TokenTransaction = {
  reference: receipt.reference, amount: 5, bank: "test-bank", comments: "", currency: "GTQ",
  account: "test-account", token: "12345100000000", tokenDate: "2026-05-04T00:00:00Z",
  tokenIdentifier: "100000000", tokenPrefix: "12345", tokenName: "test", wasReturn: 0, transactionId: " ",
};

test("enrichment automatically looks up missing receipts across the date boundary without importing other funds", async () => {
  const dates: string[] = [];
  const enriched: TokenTransaction[] = [];
  const count = await runStatementEnrichmentOnce({
    repository: {
      listMissingDateReceipts: async () => [receipt],
      enrichIncomingStatement: async (row) => { enriched.push(row); return true; },
    },
    nexa: { getPaymentTokenStatement: async (date) => {
      dates.push(date);
      return { transactions: date === "2026-05-04" ? [transaction, { ...transaction, reference: "unrelated" }] : [] };
    } },
  });
  expect(count).toBe(1);
  expect(dates).toContain("2026-05-04");
  expect(enriched).toEqual([transaction]);
});

test("does not query future bank dates", async () => {
  const dates: string[] = [];
  const createdAt = new Date();
  const today = createdAt.toISOString().slice(0, 10);
  await runStatementEnrichmentOnce({
    repository: { listMissingDateReceipts: async () => [{ reference: "today", createdAt }], enrichIncomingStatement: async () => false },
    nexa: { getPaymentTokenStatement: async (date) => { dates.push(date); return { transactions: [] }; } },
  });
  expect(dates.every((date) => date <= today)).toBe(true);
});

test("empty queue makes no bank request and conflicting duplicate references are not enriched", async () => {
  let reads = 0;
  let writes = 0;
  const options = {
    repository: {
      listMissingDateReceipts: async () => [] as typeof receipt[],
      enrichIncomingStatement: async () => { writes++; return true; },
    },
    nexa: { getPaymentTokenStatement: async () => {
      reads++;
      return { transactions: [transaction, { ...transaction, amount: 6 }] };
    } },
  };
  expect(await runStatementEnrichmentOnce(options)).toBe(0);
  expect(reads).toBe(0);
  options.repository.listMissingDateReceipts = async () => [receipt];
  expect(await runStatementEnrichmentOnce(options)).toBe(0);
  expect(writes).toBe(0);
});
