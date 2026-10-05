import { expect, test } from "bun:test";

test("returnPendingInvestorsToCube locks every credit before its reads and transaction", async () => {
  const source = await Bun.file(
    new URL("./replaceInvestorCredit.ts", import.meta.url),
  ).text();
  const start = source.indexOf("export const returnPendingInvestorsToCube");
  const end = source.indexOf("export const manualReassignInvestor", start);
  const controller = source.slice(start, end);

  expect(controller.indexOf("withCreditoEspejoLocks")).toBeGreaterThan(-1);
  expect(controller.indexOf("locks.tryLock(creditoId)")).toBeGreaterThan(-1);
  expect(controller.indexOf("locks.tryLock(creditoId)")).toBeLessThan(
    controller.indexOf("await db\n      .select"),
  );
  expect(controller.indexOf("locks.tryLock(creditoId)")).toBeLessThan(
    controller.indexOf("await db.transaction"),
  );
});
