import { describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Mock the database module so the env check in database/index.ts doesn't run.
// The controller accepts an optional executor argument for testing, but the
// module-level `db` import still triggers the connection check at load time.
// ---------------------------------------------------------------------------
mock.module("../database", () => ({
  db: {
    select: () => ({ from: () => ({ orderBy: () => Promise.resolve([]) }) }),
  },
}));

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

// Import AFTER mock.module() so the mocked db is used.
const { listAseguradoras } = await import("./aseguradoras");

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
