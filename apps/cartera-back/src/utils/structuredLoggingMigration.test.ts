import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const sliceFiles = [
  new URL('../controllers/registerPayment.ts', import.meta.url),
  new URL('./functions/uploadsFiles.ts', import.meta.url),
];
const manifestFile = new URL(
  '../../../../packages/structured-logger/references/FIRST_SLICE_DISPOSITIONS.json',
  import.meta.url,
);
const dockerfile = new URL('../../Dockerfile', import.meta.url);

function executableConsoleCalls(source: string, path: string): number {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let calls = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'console') {
      calls += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return calls;
}

test('first structured-log slice has no executable console calls', () => {
  let total = 0;
  for (const file of sliceFiles) {
    const source = readFileSync(file, 'utf8');
    total += executableConsoleCalls(source, file.pathname);
  }
  expect(total).toBe(0);
});

test('reconciles every approved first-slice disposition', () => {
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as {
    readonly entries: readonly {
      readonly path: string;
      readonly disposition: 'remove' | 'event';
      readonly event: string | null;
      readonly outcome: string | null;
    }[];
  };
  expect(manifest.entries).toHaveLength(189);
  expect(manifest.entries.filter((entry) => entry.disposition === 'remove')).toHaveLength(188);
  expect(manifest.entries.filter((entry) => entry.disposition === 'event')).toEqual([
    expect.objectContaining({
      path: 'apps/cartera-back/src/controllers/registerPayment.ts',
      event: 'payment.integrity_anomaly',
      outcome: 'recovered',
    }),
  ]);
  expect(manifest.entries.filter((entry) => entry.path.endsWith('/registerPayment.ts'))).toHaveLength(187);
  expect(manifest.entries.filter((entry) => entry.path.endsWith('/uploadsFiles.ts'))).toHaveLength(2);
});

test('registerPayment emits the approved integrity anomaly event', () => {
  const source = readFileSync(sliceFiles[0]!, 'utf8');
  expect(source).toContain('emitRecoveredDuplicatePendingInstallment');
  expect(source).not.toContain('Crédito ${credito_id}: cuotas_credito DUPLICADAS');
});

test('the Cartera image includes the structured logger workspace package', () => {
  expect(readFileSync(dockerfile, 'utf8')).toContain(
    'COPY packages/structured-logger ./packages/structured-logger',
  );
});
