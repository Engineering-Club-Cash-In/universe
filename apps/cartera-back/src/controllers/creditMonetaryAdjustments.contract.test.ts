import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const controllerFile = new URL("./updateCredit.ts", import.meta.url);
const auditSettingsFile = new URL("../utils/montoAportadoAuditContext.ts", import.meta.url);
const schemaFile = new URL("../database/db/schema.ts", import.meta.url);
const legacyMotivoMigrationFile = new URL(
  "../../drizzle/0032_add_motivo_historico_monto_aportado_espejo.sql",
  import.meta.url,
);
const migrationsDirectory = new URL("../../drizzle/", import.meta.url);
const parentAuditMigrationName = readdirSync(migrationsDirectory).find((file) =>
  file.endsWith("_add_origen_historico_monto_aportado.sql"),
);

function readParentAuditMigration() {
  if (!parentAuditMigrationName) {
    throw new Error("No se encontró la migración de origen del historial de monto aportado");
  }

  return readFileSync(
    new URL(`../../drizzle/${parentAuditMigrationName}`, import.meta.url),
    "utf8",
  );
}

test("credit monetary adjustments keep capital and investor reasons separate", () => {
  const controller = readFileSync(controllerFile, "utf8");
  const auditSettings = readFileSync(auditSettingsFile, "utf8");

  expect(controller).toContain("motivo_ajuste_capital");
  expect(controller).toContain("motivo_ajuste_monto_aportado");
  expect(controller).toContain("motivo_ajuste_monto_aportado_padre");
  expect(controller).toContain("motivo_ajuste_monto_aportado_espejo");
  expect(controller).toContain("El motivo del ajuste de capital es obligatorio");
  expect(controller).toContain("El motivo del ajuste de monto aportado del padre es obligatorio");
  expect(controller).toContain("El motivo del ajuste de monto aportado del espejo es obligatorio");
  expect(controller).toContain("capital: z.number().min(1)");
  expect(auditSettings).toContain("app.monto_aportado_motivo_${sufijo}");
});

test("consolidated investor audit migration persists its own reason", () => {
  const schema = readFileSync(schemaFile, "utf8");
  const migration = readParentAuditMigration();

  expect(existsSync(legacyMotivoMigrationFile)).toBeFalse();
  expect(schema).toContain('motivo: text("motivo")');
  expect(migration).toContain("ADD COLUMN IF NOT EXISTS motivo TEXT");
  expect(migration).toContain("app.monto_aportado_motivo");
  expect(migration).toContain("motivo");
});

test("shared investor amount history distinguishes parent from mirror", () => {
  const schema = readFileSync(schemaFile, "utf8");
  const migration = readParentAuditMigration();

  expect(schema).toContain('origen: text("origen")');
  expect(migration).toContain("origen TEXT NOT NULL DEFAULT 'ESPEJO'");
  expect(migration).toContain("trg_audit_monto_aportado_padre");
  expect(migration).toContain("app.monto_aportado_motivo_padre");
  expect(migration).toContain("app.monto_aportado_motivo_espejo");
  expect(migration).toContain("app.monto_aportado_motivo', true");
  expect(migration).toContain("ix_hist_mont_origen_cred_fecha");
});

test("rebuild audit only records investor IDs whose amount changed", () => {
  const controller = readFileSync(controllerFile, "utf8");
  const auditSettings = readFileSync(auditSettingsFile, "utf8");
  const migration = readParentAuditMigration();

  expect(controller).toContain("montoAportadoPadreCambiados");
  expect(controller).toContain("montoAportadoEspejoCambiados");
  expect(auditSettings).toContain("app.monto_aportado_rebuild_${sufijo}");
  expect(auditSettings).toContain("app.monto_aportado_ids_${sufijo}");
  expect(migration).toContain("v_rebuild");
  expect(migration).toContain("v_ids");
  expect(migration).toContain("v_es_monto_cambiado");
  expect(migration).toContain("TG_OP IN ('INSERT', 'DELETE')");
  expect(migration).toContain("v_rebuild AND NOT v_es_monto_cambiado");
});

test("audit context is set only for the final investor rebuild", () => {
  const controller = readFileSync(controllerFile, "utf8");

  expect(controller.indexOf("await setMontoAportadoAuditContext(")).toBeGreaterThan(
    controller.indexOf("const runInvestorRebuild"),
  );
});
