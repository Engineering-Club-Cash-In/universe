import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const controllerFile = new URL("./revertPaymentToPending.ts", import.meta.url);
const manifestFile = new URL(
  "../../../../packages/structured-logger/references/FIFTH_SLICE_DISPOSITIONS.json",
  import.meta.url,
);

function executableConsoleCalls(source: string): number {
  const file = ts.createSourceFile("revertPaymentToPending.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "console") count += 1;
    ts.forEachChild(node, visit);
  };
  visit(file);
  return count;
}

test("fifth structured-log slice reconciles all reversal traces", () => {
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
    entries: Array<{ disposition: string; event: string | null }>;
  };
  expect(manifest.entries).toHaveLength(26);
  expect(manifest.entries.filter(({ disposition }) => disposition === "remove")).toHaveLength(22);
  expect(manifest.entries.filter(({ disposition }) => disposition === "event")).toHaveLength(4);
  expect(manifest.entries.filter(({ disposition }) => disposition === "event").every(({ event }) => event === "payment.reversal_to_pending")).toBeTrue();
});

test("reversal-to-pending slice has no executable console calls", () => {
  expect(executableConsoleCalls(readFileSync(controllerFile, "utf8"))).toBe(0);
});

test("external invoice void evidence remains set until transaction commit", () => {
  const source = readFileSync(controllerFile, "utf8");
  expect(source.match(/hasExternalInvoiceVoid = false/g)).toHaveLength(2);
  expect(source.indexOf("hasExternalInvoiceVoid = true")).toBeLessThan(
    source.lastIndexOf("hasExternalInvoiceVoid = false"),
  );
  expect(source).toContain("if (localInvoiceStateFailureCount === 0) hasExternalInvoiceVoid = false");
});
