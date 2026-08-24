import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const controllerFile = new URL("./updateDueDate.ts", import.meta.url);
const manifestFile = new URL(
  "../../../../packages/structured-logger/references/SEVENTH_SLICE_DISPOSITIONS.json",
  import.meta.url,
);

function executableConsoleCalls(source: string): number {
  const file = ts.createSourceFile("updateDueDate.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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

test("seventh structured-log slice reconciles all due-date traces", () => {
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
    entries: Array<{ disposition: string; event: string | null }>;
  };
  expect(manifest.entries).toHaveLength(52);
  expect(manifest.entries.filter(({ disposition }) => disposition === "remove")).toHaveLength(44);
  expect(manifest.entries.filter(({ disposition }) => disposition === "event")).toHaveLength(8);
  expect(
    manifest.entries
      .filter(({ disposition }) => disposition === "event")
      .every(({ event }) => event === "credit.due_date"),
  ).toBeTrue();
});

test("due-date slice has no executable console calls", () => {
  expect(executableConsoleCalls(readFileSync(controllerFile, "utf8"))).toBe(0);
});

test("due-date callsites use only the finite safe application payload", () => {
  const source = readFileSync(controllerFile, "utf8");
  const file = ts.createSourceFile("updateDueDate.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const allowed = new Set([
    "outcome", "operation", "durationMs", "reasonCode", "errorCode",
    "processedCount", "succeededCount", "failedCount", "skippedCount",
  ]);
  let calls = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "emitCreditDueDate"
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
  expect(calls).toBeGreaterThan(0);
});
