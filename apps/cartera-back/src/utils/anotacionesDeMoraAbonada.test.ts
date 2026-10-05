import { describe, expect, test } from "bun:test";
import Big from "big.js";
import { anotacionesDeMoraAbonada } from "./anotacionesDeMoraAbonada";
import { moraPendientePorCuota } from "./moraPendiente";

const CUOTAS = [
  { cuota_id: 1, diasAtraso: 40, pagado: "0" },
  { cuota_id: 2, diasAtraso: 10, pagado: "0" },
];
const P = moraPendientePorCuota({ capital: "10000", cuotas: CUOTAS });
const primera = new Big(P.porCuota[0].pendiente);

describe("anotacionesDeMoraAbonada — una sola regla para pago y condonación", () => {
  test("PAGO: lleva el pago, la cuota más vieja primero", () => {
    const f = anotacionesDeMoraAbonada({ credito_id: 7, monto: primera.plus(3), capital: "10000", cuotas: CUOTAS, tipo: "PAGO", pago_id: 900 });
    expect(f.map((x) => [x.cuota_id, x.tipo, x.pago_id])).toEqual([[1, "PAGO", 900], [2, "PAGO", 900]]);
    expect(new Big(f[0].monto).eq(primera)).toBe(true);
    expect(new Big(f[1].monto).eq(3)).toBe(true);
  });
  test("CONDONACION: sin pago, con usuario y motivo", () => {
    const f = anotacionesDeMoraAbonada({ credito_id: 7, monto: 1, capital: "10000", cuotas: CUOTAS, tipo: "CONDONACION", usuario_id: 5, motivo: "m" });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ cuota_id: 1, tipo: "CONDONACION", pago_id: null, usuario_id: 5, motivo: "m" });
  });
  test("lo que excede lo pendiente no se anota", () => {
    const f = anotacionesDeMoraAbonada({ credito_id: 7, monto: new Big(P.total).plus(500), capital: "10000", cuotas: CUOTAS, tipo: "PAGO", pago_id: 1 });
    expect(f.reduce((a, x) => a.plus(x.monto), new Big(0)).eq(P.total)).toBe(true);
  });
  test("sin cuotas no hay filas", () => {
    expect(anotacionesDeMoraAbonada({ credito_id: 7, monto: 50, capital: "10000", cuotas: [], tipo: "PAGO", pago_id: 1 })).toEqual([]);
  });
});
