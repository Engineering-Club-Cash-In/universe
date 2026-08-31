import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const temp = mkdtempSync(join(tmpdir(), 'structured-logger-generated-'));

function run(script: string, args: string[]): void {
  const result = Bun.spawnSync([process.execPath, script, ...args], {
    cwd: root,
    stdout: 'ignore',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(`${script} failed with exit ${result.exitCode}`);
  }
}

function assertSame(expected: string, actual: string): void {
  const expectedBytes = readFileSync(join(root, expected));
  const actualBytes = readFileSync(actual);
  if (!expectedBytes.equals(actualBytes)) throw new Error(`generated artifact drift: ${expected}`);
}

try {
  const historical = join(temp, 'historical.csv');
  const target = join(temp, 'target.csv');
  const catalog = join(temp, 'catalog.md');
  run('scripts/build-cartera-log-inventory.ts', [
    'b97fdb9a31ea7a5ecea8b203afa3884fc30965df', historical,
  ]);
  run('scripts/build-cartera-log-inventory.ts', [
    '56717ddef8f0bbd8c8633172c8ca2c85c248dfd7', target,
  ]);
  run('scripts/build-catalog-doc.ts', [catalog]);
  assertSame('references/CARTERA_LOG_CALLS_b97fdb9.csv', historical);
  assertSame('references/CARTERA_LOG_CALLS_56717dde.csv', target);
  assertSame('CATALOG.generated.md', catalog);
  console.log('generated artifacts: PASS');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
