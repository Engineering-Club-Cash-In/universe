import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const controllerFile = new URL("./updateCredit.ts", import.meta.url);
const auditContextFile = new URL("../utils/withAuditContext.ts", import.meta.url);
const schemaFile = new URL("../database/db/schema.ts", import.meta.url);
const migrationFile = new URL("../../drizzle/0032_add_motivo_historico_monto_aportado_espejo.sql", import.meta.url);

test("credit monetary adjustments keep capital and investor reasons separate", () => {
  const controller = readFileSync(controllerFile, "utf8");
  const auditContext = readFileSync(auditContextFile, "utf8");

  expect(controller).toContain("motivo_ajuste_capital");
  expect(controller).toContain("motivo_ajuste_monto_aportado");
  expect(controller).toContain("El motivo del ajuste de capital es obligatorio");
  expect(controller).toContain("El motivo del ajuste de monto aportado es obligatorio");
  expect(controller).toContain("capital: z.number().min(1)");
  expect(auditContext).toContain("app.monto_aportado_motivo");
});

test("investor contribution audit migration persists its own reason", () => {
  expect(existsSync(migrationFile)).toBeTrue();

  const schema = readFileSync(schemaFile, "utf8");
  const migration = readFileSync(migrationFile, "utf8");

  expect(schema).toContain('motivo: text("motivo")');
  expect(migration).toContain("ADD COLUMN IF NOT EXISTS motivo TEXT");
  expect(migration).toContain("app.monto_aportado_motivo");
  expect(migration).toContain("motivo");
});
