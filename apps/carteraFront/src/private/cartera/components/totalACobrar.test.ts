import { describe, expect, it } from "bun:test";
import { calcularTotalACobrar } from "./totalACobrar";

// ─────────────────────────────────────────────────────────────────────────────
// El "Total a Cobrar" de la tarjeta es UNA cifra que le dice al asesor cuánto
// pedirle al cliente. Si le falta un término, el asesor cobra de menos y la
// cuota queda corta — y el cliente ya se fue.
//
// El motor arranca con `boleta − otros − abono directo` y de ese resto salen
// mora, rubros y la cuota. O sea que los dos campos del FORMULARIO salen de la
// misma línea y los dos hay que sumarlos: con cuota Q1,000, rubros Q300 y otros
// Q100, cobrar Q1,300 deja Q900 para una cuota de Q1,000.
//
// El convenio se suma aunque NO consuma la boleta. Es herencia deliberada: la
// tarjeta viene pidiendo cuota + convenio desde antes de este módulo y el umbral
// de excedente del hook lo espeja a propósito. Queda anotado como decisión de
// producto pendiente, no se cambia acá.
// ─────────────────────────────────────────────────────────────────────────────

const base = {
  mora: 0,
  rubros: 0,
  convenio: 0,
  cuota: 0,
  abonosParciales: 0,
  otros: 0,
  abonoDirectoCapital: 0,
};

describe("calcularTotalACobrar", () => {
  it("suma mora, rubros, convenio y cuota, y resta los abonos parciales", () => {
    expect(
      calcularTotalACobrar({
        ...base,
        mora: 120.5,
        rubros: 300,
        convenio: 200,
        cuota: 1000,
        abonosParciales: 50,
      })
    ).toBe(1570.5);
  });

  it("🔴 suma el `otros` que tipea el asesor", () => {
    // El caso del hallazgo: cuota 1000 + rubros 300 y el asesor agrega 100 de
    // otros. Cobrar 1300 deja 900 para la cuota.
    expect(
      calcularTotalACobrar({ ...base, cuota: 1000, rubros: 300, otros: 100 })
    ).toBe(1400);
  });

  it("🔴 y el abono directo a capital, que es el hermano del `otros`", () => {
    // Los dos salen de la MISMA línea del backend
    // (`boleta − otros − abonoDirectoCapital`). Sumar sólo uno deja el otro
    // abierto, con el mismo faltante.
    expect(
      calcularTotalACobrar({ ...base, cuota: 1000, rubros: 300, abonoDirectoCapital: 400 })
    ).toBe(1700);
  });

  it("los dos campos del formulario a la vez", () => {
    expect(
      calcularTotalACobrar({
        ...base,
        cuota: 1000,
        rubros: 300,
        otros: 100,
        abonoDirectoCapital: 400,
      })
    ).toBe(1800);
  });

  it("nunca devuelve negativo", () => {
    // Un abono parcial mayor que la cuota no puede pedirle plata al cliente.
    expect(calcularTotalACobrar({ ...base, cuota: 500, abonosParciales: 900 })).toBe(0);
  });

  it("suma en centavos: no arrastra la cola del punto flotante", () => {
    // `sumaQ` suma en centavos enteros para no descuadrar contra el `Big` del
    // backend.
    expect(calcularTotalACobrar({ ...base, cuota: 0.1, rubros: 0.2 })).toBe(0.3);
  });

  it("tolera lo que el endpoint manda como string", () => {
    // `mora` llega como STRING cuando hay mora y como number 0 cuando no; la
    // prop está declarada `number` y TypeScript no avisa.
    expect(
      calcularTotalACobrar({ ...base, mora: "120.50" as unknown as number, cuota: 1000 })
    ).toBe(1120.5);
  });

  it("descarta la basura en vez de envenenar el total", () => {
    // Antes un solo valor no numérico convertía el total entero en NaN.
    expect(
      calcularTotalACobrar({ ...base, cuota: 1000, otros: "no soy número" as unknown as number })
    ).toBe(1000);
  });
});
