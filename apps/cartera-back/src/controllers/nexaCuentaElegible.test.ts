import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// La cuenta Nexa solo se le ofrece al cliente si cartera aceptaría su pago. Las
// dos listas de estados viven en archivos distintos: este contrato evita que se
// separen en silencio (si una cambia, el aviso mandaría a una cuenta inservible).
const pagos = readFileSync(new URL("./nexaPayments.ts", import.meta.url), "utf8");
const creditos = readFileSync(new URL("./credits.ts", import.meta.url), "utf8");

function estados(fuente: string, ancla: RegExp): string[] {
  const m = ancla.exec(fuente);
  expect(m, `no se encontró ${ancla}`).not.toBeNull();
  return [...(m?.[1] ?? "").matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]).sort();
}

describe("cuenta Nexa elegible: mismos estados que acepta el pago", () => {
  test("NEXA_PAYABLE_CREDIT_STATUSES coincide con credit_not_payable", () => {
    const enPagos = estados(pagos, /if \(!\[([^\]]+)\]\.includes\(credit\.statusCredit\)\)/);
    const enCreditos = estados(creditos, /NEXA_PAYABLE_CREDIT_STATUSES = \[([^\]]+)\] as const/);
    expect(enCreditos).toEqual(enPagos);
  });

  test("el filtro y el detalle usan la misma lista y el mismo predicado de vigencia", () => {
    expect(creditos).toContain("inArray(creditos.statusCredit, [...NEXA_PAYABLE_CREDIT_STATUSES])");
    expect(creditos).toContain("(NEXA_PAYABLE_CREDIT_STATUSES as readonly string[]).includes(");
    expect(creditos).toContain("nb.expires_at IS NULL OR nb.expires_at > NOW()");
  });
});
