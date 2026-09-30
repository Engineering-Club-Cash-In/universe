import Big from "big.js";

type Row = { inversionista_id: number; abono_interes: string; abono_iva_12: string };
export function nexaPersistedInvoiceAmounts(rows: Row[], expected: {
  interest: string; vat: string; investorIds: number[];
}) {
  const result = new Map<number, {
    precioUnitario: number; precio: number; montoGravable: number;
    montoImpuesto: number; total: number;
  }>();
  let interest = new Big(0), vat = new Big(0);
  for (const row of rows) {
    const base = new Big(row.abono_interes), tax = new Big(row.abono_iva_12);
    if (result.has(row.inversionista_id) || !expected.investorIds.includes(row.inversionista_id)
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
  if (result.size !== new Set(expected.investorIds).size
    || !interest.eq(expected.interest) || !vat.eq(expected.vat)) {
    throw new Error("nexa_invoice_distribution_mismatch");
  }
  return result;
}
