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
// El borrado de créditos corre bajo el advisory lock del crédito (cierra el
// TOCTOU contra `crearRubro`). Acá no hay concurrencia que serializar y el real
// abriría conexión al `lockPool`, así que se pasa de largo.
mock.module("../utils/paymentAdvisoryLock", () => ({
  withPaymentAdvisoryLock: (_creditoId: number, fn: () => Promise<unknown>) => fn(),
}));
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
    creditos: [
      // Este SÍ es del pool, así que se recalcula pase lo que pase con el otro.
      // Antes el pool traía sólo el traspaso, y el test daba por buena una
      // conducta que era el defecto: que el recálculo corriera igual sobre un
      // crédito cuyo borrado había FALLADO, sumándole al principal tenencias de
      // un crédito que quedaba en pie. Ahora ese traspaso se excluye, así que
      // hace falta un crédito propio para que el recálculo tenga qué hacer y el
      // test siga midiendo lo suyo: que la evidencia de escritura sobreviva a un
      // fallo posterior.
      {
        numeroCredito: "POOL_1",
        inversionista: "Investor",
        capitalRestante: "100",
      },
      {
        numeroCredito: "DELETE_1",
        inversionista: "Investor",
        capitalRestante: "100",
      },
    ],
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

test("un traspaso cuyo borrado rechaza el guard de rubros NO se recalcula", async () => {
  // El agujero que esto fija: `/pools-raros` borra el crédito que no coincide
  // con el número del pool y le pasa su inversionista y su capital al crédito
  // principal. Son dos pasos, y mientras el borrado era incondicional dar por
  // hecho el segundo funcionaba.
  //
  // El guard de rubros lo rompió: ahora el borrado puede RECHAZARSE —crédito con
  // un cobro adicional con deuda viva— y el rechazo quedaba anotado en el
  // detalle y nada más. El recálculo le sumaba igual al principal las tenencias
  // de un crédito que quedaba en pie: el mismo capital contado DOS veces, con el
  // inversionista cobrando interés y cuota por los dos lados.
  //
  // La cola de `selectResults` es posicional: primero la búsqueda del crédito
  // por número, después la consulta de rubros del guard. Devolver una fila acá es
  // lo que lo hace disparar.
  selectResults = [
    [{ credito_id: 77 }],
    [{ rubro_id: 1, descripcion: "GPS" }],
  ];

  const result = await processPoolsRaros([{
    nombre: "pool",
    numeroCredito: "POOL_1",
    numeroCuota: "0",
    creditos: [{
      numeroCredito: "DELETE_1",
      inversionista: "Investor",
      capitalRestante: "100",
    }],
  }], { startedAt: Date.now() });

  // El borrado se rechaza, nombrando el rubro.
  expect(result.eliminacion).toMatchObject({ exitosos: 0, errores: 1 });
  expect(result.eliminacion?.detalles?.[0]?.message ?? "").toContain("GPS");

  // Y el recálculo no tiene NADA que hacer: el único crédito del pool era el
  // traspaso, y se excluyó. Sin el filtro, acá llegaría 1 y el capital quedaría
  // duplicado.
  expect(result.recalculo).toMatchObject({ total: 0, exitosos: 0 });
});
