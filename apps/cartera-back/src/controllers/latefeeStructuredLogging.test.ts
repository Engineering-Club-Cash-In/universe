import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const controllerFile = new URL("./latefee.ts", import.meta.url);
const manifestFile = new URL(
  "../../../../packages/structured-logger/references/SIXTH_SLICE_DISPOSITIONS.json",
  import.meta.url,
);

function executableConsoleCalls(source: string): number {
  const file = ts.createSourceFile("latefee.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === "console"
    ) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(file);
  return count;
}

test("sixth structured-log slice reconciles all late-fee traces", () => {
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
    entries: Array<{ disposition: string; event: string | null }>;
  };
  expect(manifest.entries).toHaveLength(54);
  expect(manifest.entries.filter(({ disposition }) => disposition === "remove")).toHaveLength(36);
  expect(manifest.entries.filter(({ disposition }) => disposition === "event")).toHaveLength(18);
  expect(
    manifest.entries
      .filter(({ disposition }) => disposition === "event")
      .every(({ event }) => event === "credit.late_fee"),
  ).toBeTrue();
});

test("late-fee slice has no executable console calls", () => {
  expect(executableConsoleCalls(readFileSync(controllerFile, "utf8"))).toBe(0);
});

test("late-fee callsites use only the finite safe application payload", () => {
  const source = readFileSync(controllerFile, "utf8");
  const file = ts.createSourceFile("latefee.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const allowed = new Set([
    "outcome", "operation", "durationMs", "reasonCode", "errorCode",
    "processedCount", "succeededCount", "failedCount", "skippedCount",
  ]);
  let calls = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "emitCreditLateFee"
    ) {
      calls += 1;
      const payload = node.arguments[0];
      expect(ts.isObjectLiteralExpression(payload)).toBeTrue();
      if (payload && ts.isObjectLiteralExpression(payload)) {
        for (const property of payload.properties) {
          expect(ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)).toBeTrue();
          if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
            expect(allowed.has(property.name.getText(file))).toBeTrue();
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  expect(calls).toBe(36);
});

test("late-fee guards cover credit lookup and lock acquisition failures", () => {
  const source = readFileSync(controllerFile, "utf8");
  const updateStart = source.indexOf("export async function updateMora");
  const updateTry = source.indexOf("try {", updateStart);
  const creditLookup = source.indexOf("const [credito] = await db", updateStart);
  expect(updateStart).toBeGreaterThanOrEqual(0);
  expect(updateTry).toBeGreaterThan(updateStart);
  expect(updateTry).toBeLessThan(creditLookup);

  const processStart = source.indexOf("export async function procesarMoras");
  const processTry = source.indexOf("try {", processStart);
  const connect = source.indexOf("await client.connect()", processStart);
  expect(processTry).toBeGreaterThan(processStart);
  expect(processTry).toBeLessThan(connect);
  expect(source.slice(processStart, source.indexOf("export async function condonarMora")))
    .toContain("if (lockConn)");
});

test("late-fee deactivation has a finite terminal for every normal result", () => {
  const source = readFileSync(controllerFile, "utf8");
  const start = source.indexOf("export async function desactivarMoraSiCreditoAlDia");
  const end = source.indexOf("export async function createMora", start);
  const body = source.slice(start, end);
  expect(body).toContain('outcome: "skipped", operation: "deactivate"');
  expect(body).toContain('reasonCode: "active_late_fee_not_found"');
  expect(body).toContain('reasonCode: "overdue_installments_remain"');
  expect(body).toContain('reasonCode: "concurrent_run"');
  expect(body).toContain('outcome: "completed", operation: "deactivate"');
});
