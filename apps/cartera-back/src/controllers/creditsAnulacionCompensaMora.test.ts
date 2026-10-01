import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Pasar un crédito a INCOBRABLE y resetearlo anulan en bloque los pagos no
 * pagados (paymentFalse, mora = 0). Lo que esas boletas habían abonado a mora
 * tiene que salir del ledger en la misma transacción, o el cron seguiría
 * descontando mora de boletas que ya no valen.
 */
const fuente = readFileSync(new URL("./credits.ts", import.meta.url), "utf8");

describe("anulación masiva de pagos pendientes compensa el ledger", () => {
  const bloques = fuente.split(".returning({ pago_id: pagos_credito.pago_id, paymentFalse: pagos_credito.paymentFalse });").slice(1);

  test("los dos lugares (INCOBRABLE y reset) compensan", () => {
    expect(bloques).toHaveLength(2);
    expect((fuente.match(/compensarAnotacionesVivas\(/g) ?? []).length).toBe(2);
  });

  test("cada uno compensa SOLO lo que quedó anulado, como ANULACION y dentro de la tx", () => {
    for (const b of bloques) {
      const tramo = b.slice(0, b.indexOf("compensarAnotacionesVivas(") + 400);
      expect(tramo).toMatch(/\.filter\(\(p\) => p\.paymentFalse\)/);
      expect(tramo).toContain('eq(mora_pagada_cuota.tipo, "PAGO")');
      expect(tramo).toContain('tipo: "ANULACION"');
      expect(tramo).toContain("tx as unknown as typeof db");
    }
  });
});
