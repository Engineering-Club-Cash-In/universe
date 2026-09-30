import Big from "big.js";

type Row = { inversionista_id: number; abono_interes: string; abono_iva_12: string };
type Recipient = { inversionista_id: number; nombre: string; emite_factura: boolean };

export function oldestActivatedPendingPurchaseAtCutoff<T extends { id: number; updated_at: Date | null }>(
  operations: T[],
  cutoff: Date | null | undefined,
) {
  if (!cutoff) return undefined;
  return operations
    .filter((operation): operation is T & { updated_at: Date } =>
      operation.updated_at !== null && operation.updated_at <= cutoff
    )
    .sort((a, b) => a.updated_at.getTime() - b.updated_at.getTime() || a.id - b.id)[0];
}

export function nexaPersistedInvoiceAmounts(rows: Row[], expected: {
  interest: string;
  vat: string;
  recipients: Recipient[];
  absentCubeFullSale?: { investorIds: number[]; cube: Recipient | undefined };
}) {
  const result = new Map<number, {
    precioUnitario: number; precio: number; montoGravable: number;
    montoImpuesto: number; total: number;
  }>();
  let interest = new Big(0), vat = new Big(0);
  for (const row of rows) {
    const base = new Big(row.abono_interes), tax = new Big(row.abono_iva_12);
    if (!Number.isInteger(row.inversionista_id) || row.inversionista_id <= 0
      || result.has(row.inversionista_id)
      || base.lt(0) || tax.lt(0) || !base.eq(base.round(2)) || !tax.eq(tax.round(2))) {
      throw new Error("nexa_invoice_distribution_invalid");
    }
    const total = base.plus(tax).toNumber();
    result.set(row.inversionista_id, {
      precioUnitario: total, precio: total, montoGravable: base.toNumber(),
      montoImpuesto: tax.toNumber(), total,
    });
    interest = interest.plus(base); vat = vat.plus(tax);
  }
  const recipients = new Map(expected.recipients.map(recipient => [recipient.inversionista_id, recipient]));
  if (recipients.size !== expected.recipients.length
    || expected.recipients.some(recipient => !result.has(recipient.inversionista_id))) {
    throw new Error("nexa_invoice_distribution_invalid");
  }
  if (recipients.size !== result.size) {
    throw new Error("nexa_invoice_recipient_metadata_missing");
  }
  const cubeRecipients = expected.recipients.filter(recipient =>
    recipient.nombre.trim().toUpperCase().includes("CUBE INVESTMENTS")
  );
  if (cubeRecipients.length !== Number(result.has(86))
    || cubeRecipients.some(recipient => recipient.inversionista_id !== 86)) {
    throw new Error("nexa_invoice_distribution_invalid");
  }
  if (!interest.eq(expected.interest) || !vat.eq(expected.vat)) {
    const fullSale = expected.absentCubeFullSale;
    const investorIds = fullSale?.investorIds ?? [];
    const cube = fullSale?.cube;
    const expectedInterest = new Big(expected.interest);
    const expectedVat = new Big(expected.vat);
    const residualInterest = expectedInterest.minus(interest);
    const residualVat = expectedVat.minus(vat);
    if (result.has(86)
      || investorIds.length !== result.size
      || new Set(investorIds).size !== investorIds.length
      || investorIds.some(id => id === 86 || !result.has(id))
      || !cube
      || cube.inversionista_id !== 86
      || !cube.nombre.trim().toUpperCase().includes("CUBE INVESTMENTS")
      || expectedInterest.lt(0) || expectedVat.lt(0)
      || !expectedInterest.eq(expectedInterest.round(2)) || !expectedVat.eq(expectedVat.round(2))
      || residualInterest.lt(0) || residualVat.lt(0)
      || (residualInterest.eq(0) && residualVat.eq(0))) {
      throw new Error("nexa_invoice_distribution_mismatch");
    }
    const total = residualInterest.plus(residualVat).toNumber();
    result.set(86, {
      precioUnitario: total,
      precio: total,
      montoGravable: residualInterest.toNumber(),
      montoImpuesto: residualVat.toNumber(),
      total,
    });
  }
  return result;
}
