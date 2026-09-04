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
  // El mínimo se valida en el cuerpo, no en el schema: un crédito CANCELADO
  // se persiste con capital 0 y el modal lo reenvía en cada guardado.
  expect(controller).toContain("capital: z.number().nonnegative()");
  expect(controller).toContain(
    "if (new Big(fieldsToUpdate.capital).lt(1) && !capitalActualEnCero)",
  );
  // Vaciar la lista se rechaza: `[]` entraba al rebuild y updateInvestors
  // retornaba temprano, devolviendo 200 sin borrar ni auditar la baja.
  expect(controller).toContain(
    "if (inversionistas?.length === 0 || inversionistas_espejo?.length === 0)",
  );
  expect(controller).toContain(
    "Un crédito no puede quedarse sin inversionistas",
  );
  expect(controller).toContain("if (!inversionistas) return new Map();");
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
  expect(migration).toContain("NULLIF(\n      current_setting(");
  expect(migration).toContain("ix_hist_mont_origen_cred_fecha");
});

test("rebuild audit only records investor IDs whose amount changed", () => {
  const controller = readFileSync(controllerFile, "utf8");
  const auditSettings = readFileSync(auditSettingsFile, "utf8");
  const migration = readParentAuditMigration();

  expect(controller).toContain("montoAportadoPadreCambiados");
  expect(controller).toContain("montoAportadoEspejoCambiados");
  expect(controller).toContain("getChangedExistingInvestorIds");
  expect(controller).toContain("if (!inversionistas) return new Map();");
  expect(controller).toContain("inversionistas !== undefined");
  expect(auditSettings).toContain("app.monto_aportado_rebuild_${sufijo}");
  expect(auditSettings).toContain("app.monto_aportado_ids_${sufijo}");
  expect(migration).toContain("v_rebuild");
  expect(migration).toContain("v_ids");
  expect(migration).toContain("v_es_monto_cambiado");
  expect(migration).toContain("TG_OP IN ('INSERT', 'DELETE')");
  expect(migration).toContain("v_rebuild AND NOT v_es_monto_cambiado");
});

test("cuota-only rebuild has an empty audit context", () => {
  const controller = readFileSync(controllerFile, "utf8");

  expect(controller).toContain("if (!bodyTraeInversionistas) {");
  expect(controller).toContain("const suppressTechnicalMontoAudit = async () =>");
  expect(controller).toContain("await suppressTechnicalMontoAudit();");
});

test("omitted investor list stays undefined through the rebuild guards", () => {
  const controller = readFileSync(controllerFile, "utf8");

  // El default `inversionistas = []` hacía que un body sin la lista se leyera
  // como baja de todas las participaciones: exigía motivo y, si se daba, el
  // rebuild borraba las filas del padre sin reinsertarlas.
  expect(controller).not.toContain("inversionistas = [],");
  expect(controller).toContain("(inversionistas ?? []).some(");
  expect(controller).toContain("if (!inversionistas) return new Map();");
});
