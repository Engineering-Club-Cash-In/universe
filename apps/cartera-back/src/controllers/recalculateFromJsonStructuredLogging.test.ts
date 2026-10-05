import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const controllerFile = new URL("./recalculateFromJson.ts", import.meta.url);
const routerFile = new URL("../routers/recalculateFromJson.ts", import.meta.url);
const manifestFile = new URL(
  "../../../../packages/structured-logger/references/NINTH_SLICE_DISPOSITIONS.json",
  import.meta.url,
);

function executableConsoleCalls(source: string, name: string): number {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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

test("ninth structured-log slice reconciles exactly 85 JSON-recalculation traces", () => {
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
    entries: Array<{ disposition: string; event: string | null }>;
  };
  expect(manifest.entries).toHaveLength(85);
  expect(manifest.entries.filter(({ disposition }) => disposition === "remove")).toHaveLength(73);
  expect(manifest.entries.filter(({ disposition }) => disposition === "event")).toHaveLength(12);
  expect(manifest.entries.filter(({ disposition }) => disposition === "event")
    .every(({ event }) => event === "credit.schedule_recalculation")).toBeTrue();
});

test("JSON-recalculation slice has no executable console calls", () => {
  expect(executableConsoleCalls(readFileSync(controllerFile, "utf8"), "controller.ts")).toBe(0);
  expect(executableConsoleCalls(readFileSync(routerFile, "utf8"), "router.ts")).toBe(0);
});

test("JSON-recalculation callsites use only finite safe application payloads", () => {
  const allowed = new Set([
    "outcome", "operation", "processedCount", "succeededCount", "failedCount",
    "skippedCount", "manualActionRequired", "durationMs", "reasonCode", "errorCode",
  ]);
  let calls = 0;
  for (const [name, source] of [
    ["controller.ts", readFileSync(controllerFile, "utf8")],
    ["router.ts", readFileSync(routerFile, "utf8")],
  ] as const) {
    const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && node.expression.text === "emitCreditScheduleRecalculation") {
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
  }
  expect(calls).toBeGreaterThan(0);
});
