import { describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Mock the database module so the env check in database/index.ts doesn't run.
// The controller accepts an optional executor argument for testing, but the
// module-level `db` import still triggers the connection check at load time.
// ---------------------------------------------------------------------------
mock.module("../database", () => ({
  db: {
    select: () => ({ from: () => ({ orderBy: () => Promise.resolve([]) }) }),
    execute: () => Promise.resolve({ rows: [] }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
  },
}));

// Also mock ExcelJS to avoid needing the real library in unit tests
mock.module("exceljs", () => {
  class MockWorkbook {
    addWorksheet(_name: string) {
      return {
        columns: [] as any[],
        getRow: () => ({ font: {} }),
        addRow: () => {},
      };
    }
    xlsx = {
      writeBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    };
  }
  return { default: MockWorkbook };
});

// ---------------------------------------------------------------------------
// Chainable mock executor — mirrors the drizzle .select().from().orderBy() chain
// ---------------------------------------------------------------------------
const makeMockExecutor = (rows: { id: number; nombre: string }[]) => ({
  select: (_fields?: unknown) => ({
    from: (_table?: unknown) => ({
      orderBy: (_col?: unknown) => Promise.resolve(rows),
    }),
  }),
});

// A mock executor for execute-based controllers.
// `executeResponses` is a queue: each call pops the first entry.
const makeExecuteExecutor = (executeResponses: Array<{ rows: any[] }>) => {
  let callIndex = 0;
  return {
    execute: (_query?: unknown) => {
      const response = executeResponses[callIndex] ?? { rows: [] };
      callIndex++;
      return Promise.resolve(response);
    },
    insert: (_table?: unknown) => ({
      values: (_vals?: unknown) => ({
        returning: () => Promise.resolve([]),
      }),
    }),
    update: (_table?: unknown) => ({
      set: (_vals?: unknown) => ({
        where: () => Promise.resolve([]),
      }),
    }),
  };
};

// Import AFTER mock.module() so the mocked db is used.
const { listAseguradoras, resumenAseguradoras, crearAseguradora, cambiarAseguradoraCredito } = await import("./aseguradoras");

// ---------------------------------------------------------------------------
describe("listAseguradoras", () => {
  it("returns { data: [] } when the table is empty", async () => {
    const result = await listAseguradoras(makeMockExecutor([]) as any);
    expect(result).toEqual({ data: [] });
  });

  it("returns rows exactly as the executor returns them", async () => {
    const rows = [
      { id: 2, nombre: "Beta Seguros" },
      { id: 1, nombre: "Alpha Seguros" },
    ];
    const result = await listAseguradoras(makeMockExecutor(rows) as any);
    expect(result).toEqual({ data: rows });
  });

  it("passes id and nombre fields through without modification", async () => {
    const rows = [{ id: 42, nombre: "Gamma Seguros SA" }];
    const { data } = await listAseguradoras(makeMockExecutor(rows) as any);
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe(42);
    expect(data[0].nombre).toBe("Gamma Seguros SA");
  });
});

// ---------------------------------------------------------------------------
describe("resumenAseguradoras", () => {
  it("returns { data: [] } when no aseguradoras exist", async () => {
    const executor = makeExecuteExecutor([{ rows: [] }]);
    const result = await resumenAseguradoras(executor as any);
    expect(result).toEqual({ data: [] });
  });

  it("returns aseguradora with 0 credits when there are none (LEFT JOIN shape)", async () => {
    const rows = [
      { id: 1, nombre: "Aseguradora Sin Créditos", cantidad_creditos: 0, monto_seguro: "0" },
    ];
    const executor = makeExecuteExecutor([{ rows }]);
    const { data } = await resumenAseguradoras(executor as any);
    expect(data).toHaveLength(1);
    expect(data[0].cantidad_creditos).toBe(0);
    expect(data[0].monto_seguro).toBe("0");
  });

  it("returns correct shape for aseguradora with credits", async () => {
    const rows = [
      { id: 2, nombre: "Seguros GT", cantidad_creditos: 5, monto_seguro: "12500.00" },
      { id: 1, nombre: "Seguros MX", cantidad_creditos: 0, monto_seguro: "0" },
    ];
    const executor = makeExecuteExecutor([{ rows }]);
    const { data } = await resumenAseguradoras(executor as any);
    expect(data).toHaveLength(2);
    expect(data[0].id).toBe(2);
    expect(data[0].nombre).toBe("Seguros GT");
    expect(data[0].cantidad_creditos).toBe(5);
    expect(data[0].monto_seguro).toBe("12500.00");
    // Aseguradora con 0 créditos también aparece
    expect(data[1].cantidad_creditos).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("crearAseguradora", () => {
  it("returns 400 error when nombre is empty string", async () => {
    const executor = makeExecuteExecutor([]);
    const result = await crearAseguradora("", executor as any);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/obligatorio/i);
    }
  });

  it("returns 400 error when nombre is whitespace only", async () => {
    const executor = makeExecuteExecutor([]);
    const result = await crearAseguradora("   ", executor as any);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(400);
    }
  });

  it("returns existing aseguradora when found (find-or-create)", async () => {
    const existing = { id: 5, nombre: "Seguros Existente" };
    const executor = makeExecuteExecutor([{ rows: [existing] }]);
    const result = await crearAseguradora("Seguros Existente", executor as any);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(5);
      expect(result.data.nombre).toBe("Seguros Existente");
    }
  });

  it("inserts and returns new aseguradora when not found", async () => {
    const newRow = { id: 10, nombre: "Nueva Aseguradora" };
    // First execute: SELECT returns empty (not found)
    // Second execute: INSERT returns new row
    const executor = makeExecuteExecutor([{ rows: [] }, { rows: [newRow] }]);
    const result = await crearAseguradora("Nueva Aseguradora", executor as any);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(10);
      expect(result.data.nombre).toBe("Nueva Aseguradora");
    }
  });
});

// ---------------------------------------------------------------------------
describe("cambiarAseguradoraCredito", () => {
  it("returns 400 when aseguradora does not exist", async () => {
    // First execute: aseguradora SELECT returns empty
    const executor = makeExecuteExecutor([{ rows: [] }]);
    const result = await cambiarAseguradoraCredito(1, 99, executor as any);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/aseguradora/i);
    }
  });

  it("returns 404 when credit does not exist", async () => {
    // First execute: aseguradora found; second: credito not found
    const executor = makeExecuteExecutor([{ rows: [{ id: 1 }] }, { rows: [] }]);
    const result = await cambiarAseguradoraCredito(999, 1, executor as any);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(404);
      expect(result.error).toMatch(/crédito/i);
    }
  });

  it("returns { success: true } when both aseguradora and credito exist", async () => {
    // execute calls: 1=aseguradora found, 2=credito found, 3=UPDATE
    const executor = makeExecuteExecutor([
      { rows: [{ id: 1 }] },
      { rows: [{ credito_id: 42 }] },
      { rows: [] },
    ]);
    const result = await cambiarAseguradoraCredito(42, 1, executor as any);
    expect(result.success).toBe(true);
  });
});
