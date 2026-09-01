import { beforeEach, expect, mock, test } from "bun:test";
import { createCarteraStructuredLogger } from "../utils/structuredLogger";

let selectResults: unknown[][] = [];
let deleteCalls = 0;
let quotaPersistenceMode: "success" | "persisted_then_failed" | "noop_then_failed" = "success";

const dbMock = {
  select: mock(() => ({
    from: () => ({
      where: () => {
        const rows = selectResults.shift() ?? [];
        return Object.assign(Promise.resolve(rows), {
          limit: () => Promise.resolve(rows),
        });
      },
    }),
  })),
  delete: mock(() => ({
    where: () => {
      deleteCalls += 1;
      if (deleteCalls === 2) return Promise.reject(new Error("nested delete failed"));
      return Promise.resolve();
    },
  })),
};

mock.module("../database", () => ({ db: dbMock, client: {}, lockPool: {} }));
mock.module("./investor", () => ({
  findOrCreateInvestor: mock(() => Promise.resolve({ inversionista_id: 1 })),
}));
mock.module("./updateCredit", () => ({
  updateInstallments: mock(() => Promise.resolve()),
}));
mock.module("./migratePayments", () => ({
  marcarCuotasPagadasHastaNumero: mock(async (input: { onPersisted?: () => void }) => {
    if (quotaPersistenceMode === "persisted_then_failed") input.onPersisted?.();
    if (quotaPersistenceMode !== "success") throw new Error("schedule update failed");
  }),
}));

const { processPoolsRaros } = await import("./recalculateFromJson");

beforeEach(() => {
  selectResults = [
    [{ credito_id: 77 }],
    [],
    [],
  ];
  deleteCalls = 0;
  quotaPersistenceMode = "success";
});

test("process pools normal return retains nested persistence evidence after a later nested failure", async () => {
  const lines: string[] = [];
  const logger = createCarteraStructuredLogger({
    clock: () => new Date("2026-08-25T12:00:00.000Z"),
    sink: (line) => { lines.push(line); },
  });

  const result = await processPoolsRaros([{
    nombre: "pool",
    numeroCredito: "POOL_1",
    numeroCuota: "0",
    creditos: [{
      numeroCredito: "DELETE_1",
      inversionista: "Investor",
      capitalRestante: "100",
    }],
  }], { logger, startedAt: Date.now() });

  expect(result.eliminacion).toMatchObject({ exitosos: 0, errores: 1 });
  expect(result.recalculo).toMatchObject({ exitosos: 0, noEncontrados: 1 });
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]!)).toMatchObject({
    event: "credit.schedule_recalculation",
    outcome: "partially_persisted",
    recalculation_operation: "process_pools",
    succeeded_count: 0,
    failed_count: 1,
    skipped_count: 1,
    manual_action_required: true,
    error_code: "persistence_failed",
  });
});

test("process pools reports durable quota writes when their later schedule update fails", async () => {
  quotaPersistenceMode = "persisted_then_failed";
  const lines: string[] = [];
  const logger = createCarteraStructuredLogger({
    clock: () => new Date("2026-08-25T12:00:00.000Z"),
    sink: (line) => { lines.push(line); },
  });

  await processPoolsRaros([{
    nombre: "pool",
    numeroCredito: "POOL_1",
    numeroCuota: "2",
    creditos: [],
  }], { logger, startedAt: Date.now() });

  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]!)).toMatchObject({
    event: "credit.schedule_recalculation",
    outcome: "partially_persisted",
    recalculation_operation: "process_pools",
    succeeded_count: 0,
    failed_count: 1,
    skipped_count: 0,
    manual_action_required: true,
    error_code: "persistence_failed",
  });
});

test("process pools does not report persistence when quota marking confirms no durable write", async () => {
  quotaPersistenceMode = "noop_then_failed";
  const lines: string[] = [];
  const logger = createCarteraStructuredLogger({
    clock: () => new Date("2026-08-25T12:00:00.000Z"),
    sink: (line) => { lines.push(line); },
  });

  await processPoolsRaros([{
    nombre: "pool",
    numeroCredito: "POOL_1",
    numeroCuota: "2",
    creditos: [],
  }], { logger, startedAt: Date.now() });

  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]!)).toMatchObject({
    outcome: "failed",
    failed_count: 1,
    manual_action_required: false,
  });
});
