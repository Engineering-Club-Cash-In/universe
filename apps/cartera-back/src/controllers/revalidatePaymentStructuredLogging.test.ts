import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const sourceFile = new URL("./revalidatePayment.ts", import.meta.url);
const manifestFile = new URL(
  "../../../../packages/structured-logger/references/SECOND_SLICE_DISPOSITIONS.json",
  import.meta.url,
);

function executableConsoleCalls(source: string): number {
  const file = ts.createSourceFile(
    sourceFile.pathname,
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

test("second structured-log slice reconciles all revalidation traces", () => {
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
    readonly entries: readonly {
      readonly path: string;
      readonly disposition: "remove" | "event";
      readonly event: string | null;
      readonly outcome: string | null;
    }[];
  };

  expect(manifest.entries).toHaveLength(15);
  expect(
    manifest.entries.filter(({ disposition }) => disposition === "remove"),
  ).toHaveLength(13);
  expect(
    manifest.entries.filter(({ disposition }) => disposition === "event"),
  ).toEqual([
    expect.objectContaining({
      event: "payment.revalidation",
      outcome: "completed",
    }),
    expect.objectContaining({
      event: "payment.revalidation",
      outcome: "failed",
    }),
  ]);
});

test("revalidation slice has no executable console calls or arbitrary error response", () => {
  const source = readFileSync(sourceFile, "utf8");
  expect(executableConsoleCalls(source)).toBe(0);
  expect(source).not.toContain("catch (error: any)");
  expect(source).not.toContain(
    "error instanceof Error ? error.message : String(error)",
  );
  expect(source).toContain('"payment.revalidation"');
});
