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
    expect(target.filter(({ disposition }) => disposition === 'unresolved')).toHaveLength(2_518);
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

  test('has no unresolved call in the payment reversal-to-pending slice', async () => {
    const target = await loadInventory('CARTERA_LOG_CALLS_56717dde.csv');
    const fifthSlice = target.filter(({ path }) =>
      path.endsWith('/src/controllers/revertPaymentToPending.ts'));
    expect(fifthSlice).toHaveLength(26);
    expect(fifthSlice.filter(({ disposition }) => disposition === 'unresolved')).toHaveLength(0);
    expect(fifthSlice.filter(({ disposition }) => disposition === 'remove')).toHaveLength(22);
    expect(fifthSlice.filter(({ disposition }) => disposition === 'event')).toHaveLength(4);
  });

  test('has no unresolved call in the late-fee domain slice', async () => {
    const target = await loadInventory('CARTERA_LOG_CALLS_56717dde.csv');
    const sixthSlice = target.filter(({ path }) => path.endsWith('/src/controllers/latefee.ts'));
    expect(sixthSlice).toHaveLength(54);
    expect(sixthSlice.filter(({ disposition }) => disposition === 'unresolved')).toHaveLength(0);
    expect(sixthSlice.filter(({ disposition }) => disposition === 'remove')).toHaveLength(36);
    expect(sixthSlice.filter(({ disposition }) => disposition === 'event')).toHaveLength(18);
  });

  test('has no unresolved call in the due-date domain slice', async () => {
    const target = await loadInventory('CARTERA_LOG_CALLS_56717dde.csv');
    const seventhSlice = target.filter(({ path }) => path.endsWith('/src/controllers/updateDueDate.ts'));
    expect(seventhSlice).toHaveLength(52);
    expect(seventhSlice.filter(({ disposition }) => disposition === 'unresolved')).toHaveLength(0);
    expect(seventhSlice.filter(({ disposition }) => disposition === 'remove')).toHaveLength(44);
    expect(seventhSlice.filter(({ disposition }) => disposition === 'event')).toHaveLength(8);
  });

  test('has no unresolved call in the payment-reversal domain slice', async () => {
    const target = await loadInventory('CARTERA_LOG_CALLS_56717dde.csv');
    const eighthSlice = target.filter(({ path }) => path.endsWith('/src/controllers/reversePayment.ts'));
    expect(eighthSlice).toHaveLength(83);
    expect(eighthSlice.filter(({ disposition }) => disposition === 'unresolved')).toHaveLength(0);
    expect(eighthSlice.filter(({ disposition }) => disposition === 'remove')).toHaveLength(79);
    expect(eighthSlice.filter(({ disposition }) => disposition === 'event')).toHaveLength(4);
  });

  test('has no unresolved call in the JSON-recalculation domain slice', async () => {
    const target = await loadInventory('CARTERA_LOG_CALLS_56717dde.csv');
    const ninthSlice = target.filter(({ path }) =>
      path.endsWith('/src/controllers/recalculateFromJson.ts')
      || path.endsWith('/src/routers/recalculateFromJson.ts'));
    expect(ninthSlice).toHaveLength(85);
    expect(ninthSlice.filter(({ disposition }) => disposition === 'unresolved')).toHaveLength(0);
    expect(ninthSlice.filter(({ disposition }) => disposition === 'remove')).toHaveLength(73);
    expect(ninthSlice.filter(({ disposition }) => disposition === 'event')).toHaveLength(12);
  });

  test('has no unresolved call in the SIFCO payment-migration slice', async () => {
    const target = await loadInventory('CARTERA_LOG_CALLS_56717dde.csv');
    const tenthSlice = target.filter(({ path }) =>
      path.endsWith('/src/controllers/migratePayments.ts'));
    expect(tenthSlice).toHaveLength(39);
    expect(tenthSlice.filter(({ disposition }) => disposition === 'unresolved')).toHaveLength(0);
    expect(tenthSlice.filter(({ disposition }) => disposition === 'remove')).toHaveLength(37);
    expect(tenthSlice.filter(({ disposition }) => disposition === 'event')).toHaveLength(2);
  });

  test('has no unresolved call in the scheduled-jobs slice', async () => {
    const target = await loadInventory('CARTERA_LOG_CALLS_56717dde.csv');
    const eleventhSlice = target.filter(({ path }) => path.endsWith('/schedule.ts'));
    expect(eleventhSlice).toHaveLength(22);
    expect(eleventhSlice.filter(({ disposition }) => disposition === 'unresolved')).toHaveLength(0);
    expect(eleventhSlice.filter(({ disposition }) => disposition === 'remove')).toHaveLength(8);
    expect(eleventhSlice.filter(({ disposition }) => disposition === 'event')).toHaveLength(14);
  });
});
