import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const controllerFile = new URL("./abonosCapital.ts", import.meta.url);
const manifestFile = new URL(
  "../../../../packages/structured-logger/references/FOURTH_SLICE_DISPOSITIONS.json",
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
    ) calls += 1;
    ts.forEachChild(node, visit);
  };
  visit(file);
  return calls;
}

test("fourth structured-log slice reconciles both persistence traces", () => {
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
    readonly entries: readonly {
      readonly disposition: "remove" | "event";
      readonly event: string | null;
      readonly outcome: string | null;
    }[];
  };

  expect(manifest.entries).toHaveLength(2);
  expect(manifest.entries.filter(({ disposition }) => disposition === "remove")).toHaveLength(0);
  expect(manifest.entries.filter(({ disposition }) => disposition === "event")).toEqual([
    expect.objectContaining({ event: "credit.capital_contribution", outcome: "failed" }),
    expect.objectContaining({ event: "credit.capital_contribution", outcome: "failed" }),
  ]);
});

test("capital-contribution slice has no executable console calls", () => {
  expect(executableConsoleCalls(controllerFile)).toBe(0);
  const source = readFileSync(controllerFile, "utf8");
  expect(source).toContain("emitCreditCapitalContributionFailed");
  expect(source).not.toContain("logger.emit(");
});
