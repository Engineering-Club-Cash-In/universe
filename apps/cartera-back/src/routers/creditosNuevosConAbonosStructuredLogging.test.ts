import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const sourceFiles = [
  new URL("../controllers/creditosNuevosConAbonos.ts", import.meta.url),
  new URL("./creditosNuevosConAbonos.ts", import.meta.url),
];
const manifestFile = new URL(
  "../../../../packages/structured-logger/references/THIRD_SLICE_DISPOSITIONS.json",
  import.meta.url,
);

function executableConsoleCalls(fileUrl: URL): number {
  const source = readFileSync(fileUrl, "utf8");
  const file = ts.createSourceFile(
    fileUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let calls = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "console"
    ) {
      calls += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return calls;
}

test("third structured-log slice reconciles all six audit traces", () => {
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
    readonly entries: readonly {
      readonly disposition: "remove" | "event";
      readonly event: string | null;
      readonly outcome: string | null;
    }[];
  };

  expect(manifest.entries).toHaveLength(6);
  expect(manifest.entries.filter(({ disposition }) => disposition === "remove")).toHaveLength(2);
  expect(manifest.entries.filter(({ disposition }) => disposition === "event")).toEqual([
    expect.objectContaining({ event: "credit.capital_payment_audit", outcome: "partially_completed" }),
    expect.objectContaining({ event: "credit.capital_payment_audit", outcome: "completed" }),
    expect.objectContaining({ event: "credit.capital_payment_audit", outcome: "failed" }),
    expect.objectContaining({ event: "credit.capital_payment_audit", outcome: "failed" }),
  ]);
});

test("third slice has no executable console calls and emits only finite audit events", () => {
  for (const sourceFile of sourceFiles) {
    expect(executableConsoleCalls(sourceFile)).toBe(0);
  }
  const sources = sourceFiles.map((file) => readFileSync(file, "utf8")).join("\n");
  expect(sources).toContain("emitCreditCapitalPaymentAuditCompleted");
  expect(sources).toContain("emitCreditCapitalPaymentAuditDiagnosticCompleted");
  expect(sources).toContain("emitCreditCapitalPaymentAuditFailed");
  expect(sources).toContain("emitCreditCapitalPaymentAuditRejected");
  expect(sources).not.toContain("logger.emit(");
});
