import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const controllerFile = new URL("./migratePayments.ts", import.meta.url);
const manifestFile = new URL(
  "../../../../packages/structured-logger/references/TENTH_SLICE_DISPOSITIONS.json",
  import.meta.url,
);

function sourceFile(): ts.SourceFile {
  return ts.createSourceFile(
    "migratePayments.ts",
    readFileSync(controllerFile, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function callNames(file: ts.SourceFile): string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) names.push(node.expression.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

test("tenth structured-log slice reconciles exactly 39 SIFCO payment traces", () => {
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
    entries: Array<{ disposition: string; event: string | null }>;
  };
  expect(manifest.entries).toHaveLength(39);
  expect(manifest.entries.filter(({ disposition }) => disposition === "remove")).toHaveLength(37);
  expect(manifest.entries.filter(({ disposition }) => disposition === "event")).toHaveLength(2);
  expect(manifest.entries.filter(({ disposition }) => disposition === "event")
    .every(({ event }) => event === "payment.sifco_migration")).toBeTrue();
});

test("SIFCO payment slice has no executable console calls and exactly two terminals", () => {
  const names = callNames(sourceFile());
  expect(names.filter((name) => name.startsWith("console."))).toHaveLength(0);
  expect(names.filter((name) => name === "emitSifcoPaymentMigration")).toHaveLength(2);
});

test("SIFCO payment terminals expose only finite aggregate fields", () => {
  const file = sourceFile();
  const allowed = new Set([
    "outcome", "operation", "processedCount", "succeededCount", "failedCount",
    "skippedCount", "durationMs", "reasonCode",
  ]);
  let calls = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === "emitSifcoPaymentMigration") {
      calls += 1;
      const payloads = node.arguments[0] && ts.isConditionalExpression(node.arguments[0])
        ? [node.arguments[0].whenTrue, node.arguments[0].whenFalse]
        : [node.arguments[0]];
      for (const payload of payloads) {
        expect(ts.isObjectLiteralExpression(payload)).toBeTrue();
        if (payload && ts.isObjectLiteralExpression(payload)) {
          for (const property of payload.properties) {
            expect(ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)
              || ts.isSpreadAssignment(property)).toBeTrue();
            if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
              expect(allowed.has(property.name.getText(file))).toBeTrue();
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  expect(calls).toBe(2);
});

test("nested paid-installment helper does not emit a duplicate terminal", () => {
  const source = readFileSync(controllerFile, "utf8");
  const helperStart = source.indexOf("export const marcarCuotasPagadasHastaNumero");
  expect(helperStart).toBeGreaterThan(0);
  expect(source.slice(helperStart)).not.toContain("emitSifcoPaymentMigration");
});

test("migration preserves persistence evidence ordering and indirect SIFCO HTTP", () => {
  const source = readFileSync(controllerFile, "utf8");
  expect(source).toContain("consultarEstadoCuentaPrestamo(numero_credito_sifco)");
  expect(source).toContain(".returning({ cuota_id: cuotas_credito.cuota_id })");
  expect(source).toContain(".returning({ pago_id: pagos_credito.pago_id })");
  const transaction = source.indexOf("const persistedWriteCount = await db.transaction");
  const persisted = source.indexOf("onPersisted?.()", transaction);
  const installments = source.indexOf("await updateInstallments({", persisted);
  expect(transaction).toBeGreaterThan(0);
  expect(persisted).toBeGreaterThan(transaction);
  expect(installments).toBeGreaterThan(persisted);
});
