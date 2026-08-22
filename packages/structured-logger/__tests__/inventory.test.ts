import { describe, expect, test } from 'bun:test';

interface InventoryRow {
  readonly commit: string;
  readonly path: string;
  readonly line: string;
  readonly method: string;
  readonly normalized_template: string;
  readonly classification: string;
  readonly disposition: string;
  readonly event: string;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

async function loadInventory(name: string): Promise<InventoryRow[]> {
  const text = await Bun.file(new URL(`../references/${name}`, import.meta.url)).text();
  const [headerLine, ...lines] = text.trim().split('\n');
  if (!headerLine) throw new Error('inventory header is missing');
  const headers = parseCsvLine(headerLine);
  return lines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])) as unknown as InventoryRow;
  });
}

describe('Cartera log-call inventory', () => {
  test('reconciles the historical and target TypeScript counts', async () => {
    const historical = await loadInventory('CARTERA_LOG_CALLS_b97fdb9.csv');
    const target = await loadInventory('CARTERA_LOG_CALLS_56717dde.csv');
    expect(historical).toHaveLength(3_078);
    expect(target).toHaveLength(3_091);
  });

  test('has no unresolved call in the first payment slice', async () => {
    const target = await loadInventory('CARTERA_LOG_CALLS_56717dde.csv');
    const firstSlice = target.filter(({ path }) =>
      path.endsWith('/src/controllers/registerPayment.ts') ||
      path.endsWith('/src/utils/functions/uploadsFiles.ts'));
    expect(firstSlice).toHaveLength(189);
    expect(firstSlice.filter(({ disposition }) => disposition === 'unresolved')).toHaveLength(0);
  });

  test('keeps all non-slice calls explicitly unresolved until reviewed', async () => {
    const target = await loadInventory('CARTERA_LOG_CALLS_56717dde.csv');
    expect(target.filter(({ disposition }) => disposition === 'unresolved')).toHaveLength(2_879);
  });

  test('has no unresolved call in the payment revalidation slice', async () => {
    const target = await loadInventory('CARTERA_LOG_CALLS_56717dde.csv');
    const secondSlice = target.filter(({ path }) =>
      path.endsWith('/src/controllers/revalidatePayment.ts'));
    expect(secondSlice).toHaveLength(15);
    expect(secondSlice.filter(({ disposition }) => disposition === 'unresolved')).toHaveLength(0);
    expect(secondSlice.filter(({ disposition }) => disposition === 'remove')).toHaveLength(13);
    expect(secondSlice.filter(({ disposition }) => disposition === 'event')).toHaveLength(2);
  });

  test('has no unresolved call in the new-credit capital-payment audit slice', async () => {
    const target = await loadInventory('CARTERA_LOG_CALLS_56717dde.csv');
    const thirdSlice = target.filter(({ path }) =>
      path.endsWith('/src/controllers/creditosNuevosConAbonos.ts') ||
      path.endsWith('/src/routers/creditosNuevosConAbonos.ts'));
    expect(thirdSlice).toHaveLength(6);
    expect(thirdSlice.filter(({ disposition }) => disposition === 'unresolved')).toHaveLength(0);
    expect(thirdSlice.filter(({ disposition }) => disposition === 'remove')).toHaveLength(2);
    expect(thirdSlice.filter(({ disposition }) => disposition === 'event')).toHaveLength(4);
  });

  test('has no unresolved call in the capital-contribution persistence slice', async () => {
    const target = await loadInventory('CARTERA_LOG_CALLS_56717dde.csv');
    const fourthSlice = target.filter(({ path }) =>
      path.endsWith('/src/controllers/abonosCapital.ts'));
    expect(fourthSlice).toHaveLength(2);
    expect(fourthSlice.filter(({ disposition }) => disposition === 'unresolved')).toHaveLength(0);
    expect(fourthSlice.filter(({ disposition }) => disposition === 'remove')).toHaveLength(0);
    expect(fourthSlice.filter(({ disposition }) => disposition === 'event')).toHaveLength(2);
  });
});
