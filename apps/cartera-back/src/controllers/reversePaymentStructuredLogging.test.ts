import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const controllerFile = new URL("./reversePayment.ts", import.meta.url);
const manifestFile = new URL(
  "../../../../packages/structured-logger/references/EIGHTH_SLICE_DISPOSITIONS.json",
  import.meta.url,
);

function executableConsoleCalls(source: string): number {
  const file = ts.createSourceFile("reversePayment.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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

function completedTerminalFollowsResponseConstruction(source: string): boolean {
  const file = ts.createSourceFile("reversePayment.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let responseDeclaration = -1;
  let completedTerminal = -1;
  let responseReturn = -1;
  let completedTerminalCount = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "response") {
      responseDeclaration = node.getStart(file);
    }
    const payload = ts.isCallExpression(node) ? node.arguments[0] : undefined;
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "emitPaymentReversal"
      && payload
      && ts.isObjectLiteralExpression(payload)
    ) {
      const outcome = payload.properties.find((property) =>
        ts.isPropertyAssignment(property)
        && property.name.getText(file) === "outcome"
        && ts.isStringLiteral(property.initializer)
        && property.initializer.text === "completed");
      if (outcome) {
        completedTerminalCount += 1;
        completedTerminal = node.getStart(file);
      }
    }
    if (ts.isReturnStatement(node)) {
      const expression = node.expression;
      if (expression && ts.isIdentifier(expression) && expression.text === "response") {
        responseReturn = node.getStart(file);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return completedTerminalCount === 1
    && responseDeclaration >= 0
    && responseDeclaration < completedTerminal
    && completedTerminal < responseReturn;
}

test("eighth structured-log slice reconciles all payment-reversal traces", () => {
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
    entries: Array<{ disposition: string; event: string | null }>;
  };
  expect(manifest.entries).toHaveLength(83);
  expect(manifest.entries.filter(({ disposition }) => disposition === "remove")).toHaveLength(79);
  expect(manifest.entries.filter(({ disposition }) => disposition === "event")).toHaveLength(4);
  expect(new Set(
    manifest.entries.filter(({ disposition }) => disposition === "event").map(({ event }) => event),
  )).toEqual(new Set(["payment.reversal", "invoice.voiding"]));
});

test("payment-reversal slice has no executable console calls", () => {
  expect(executableConsoleCalls(readFileSync(controllerFile, "utf8"))).toBe(0);
});

test("payment-reversal callsites use only finite safe application payloads", () => {
  const source = readFileSync(controllerFile, "utf8");
  const file = ts.createSourceFile("reversePayment.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const allowedByEmitter: Readonly<Record<string, ReadonlySet<string>>> = {
    emitPaymentReversal: new Set([
      "outcome", "previousPaymentState", "creditUpdated", "investmentsReversed",
      "manualActionRequired", "durationMs", "reasonCode", "errorCode",
    ]),
    emitInvoiceVoiding: new Set([
      "outcome", "processedCount", "succeededCount", "failedCount",
      "manualActionRequired", "durationMs", "reasonCode", "errorCode",
    ]),
  };
  let calls = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const allowed = allowedByEmitter[node.expression.text];
      if (allowed) {
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
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  expect(calls).toBeGreaterThan(0);
});

test("payment completion is emitted once only after the historical response is constructible", () => {
  expect(completedTerminalFollowsResponseConstruction(readFileSync(controllerFile, "utf8"))).toBeTrue();
  expect(completedTerminalFollowsResponseConstruction(`
    emitPaymentReversal({ outcome: "completed" });
    const response = buildHistoricalResponse();
    return response;
  `)).toBeFalse();
});
