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
const productionDeploy = new URL('../../deploy.sh', import.meta.url);
const developmentDeploy = new URL('../../deploy-dev.sh', import.meta.url);
const developmentWorkflow = new URL('../../../../.github/workflows/deploy-cartera-dev.yaml', import.meta.url);
const productionWorkflow = new URL('../../../../.github/workflows/deploy-prod.yaml', import.meta.url);

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
  expect(manifest.entries.filter((entry) => entry.disposition === 'remove')).toHaveLength(187);
  expect(manifest.entries.filter((entry) => entry.disposition === 'event')).toEqual([
    expect.objectContaining({
      path: 'apps/cartera-back/src/controllers/registerPayment.ts',
      event: 'payment.integrity_anomaly',
      outcome: 'recovered',
    }),
    expect.objectContaining({
      path: 'apps/cartera-back/src/utils/functions/uploadsFiles.ts',
      event: 'payment.upload',
      outcome: 'failed',
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
  const source = readFileSync(dockerfile, 'utf8');
  expect(source).toContain(
    'COPY packages/structured-logger ./packages/structured-logger',
  );
  expect(source).toContain('ARG CARTERA_LOG_ENVIRONMENT=production');
  expect(source).toContain('ENV LOG_ENVIRONMENT=${CARTERA_LOG_ENVIRONMENT}');
  expect(readFileSync(productionDeploy, 'utf8')).toContain(
    '--build-arg CARTERA_LOG_ENVIRONMENT=production',
  );
  expect(readFileSync(developmentDeploy, 'utf8')).toContain(
    '--build-arg CARTERA_LOG_ENVIRONMENT=development',
  );
});

test('Cartera workflows rebuild logger changes with the correct environment', () => {
  const development = readFileSync(developmentWorkflow, 'utf8');
  const production = readFileSync(productionWorkflow, 'utf8');
  expect(development.match(/packages\/structured-logger\/\*\*/g)).toHaveLength(2);
  expect(development).toContain('--build-arg CARTERA_LOG_ENVIRONMENT=development');
  expect(production).toContain("- 'packages/structured-logger/**'");
  expect(production).toContain('--build-arg CARTERA_LOG_ENVIRONMENT=production');
});
