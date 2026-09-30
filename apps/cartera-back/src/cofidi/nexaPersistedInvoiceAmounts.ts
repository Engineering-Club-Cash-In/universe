import Big from "big.js";

type Row = { inversionista_id: number; abono_interes: string; abono_iva_12: string };

export function oldestPendingPurchaseAtCutoff<T extends { id: number; created_at: Date }>(
  operations: T[],
  cutoff: Date | null | undefined,
) {
  if (!cutoff) return undefined;
  return operations
    .filter(operation => operation.created_at <= cutoff)
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id - b.id)[0];
}

export function nexaPersistedInvoiceAmounts(rows: Row[], expected: {
  interest: string;
  vat: string;
  recipients: { inversionista_id: number; nombre: string; emite_factura: boolean }[];
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
  if (!result.has(86)) {
    throw new Error("nexa_invoice_distribution_invalid");
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
  if (cubeRecipients.length !== 1 || cubeRecipients[0]?.inversionista_id !== 86) {
    throw new Error("nexa_invoice_distribution_invalid");
  }
  if (!interest.eq(expected.interest) || !vat.eq(expected.vat)) {
    throw new Error("nexa_invoice_distribution_mismatch");
  }
  return result;
}
