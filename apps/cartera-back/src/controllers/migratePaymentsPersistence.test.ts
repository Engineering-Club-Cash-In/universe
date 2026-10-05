import { expect, test } from "bun:test";
import { countPersistedRows } from "./persistenceEvidence";

test("persisted row evidence counts returned quota and payment writes", () => {
  expect(countPersistedRows([[{ cuota_id: 10 }], [{ pago_id: 20 }]])).toBe(2);
});

test("persisted row evidence remains empty when every update is a no-op", () => {
  expect(countPersistedRows([[], []])).toBe(0);
});
