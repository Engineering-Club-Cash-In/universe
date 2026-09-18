import { describe, expect, it } from "bun:test";
import { fmtQ, sumaQ } from "./moneda";

// Definición única del formato de quetzales. Vivía copiada en Latefee.tsx,
// ModalHistorialMora.tsx y MoraHistorial.tsx; este test fija el contrato para
// que las pantallas que la comparten no puedan divergir en decimales.
describe("fmtQ", () => {
  it("siempre lleva dos decimales", () => {
    expect(fmtQ(1234.5)).toBe("Q 1,234.50");
    expect(fmtQ(1000)).toBe("Q 1,000.00");
    expect(fmtQ(0.5)).toBe("Q 0.50");
  });

  it("redondea a dos decimales", () => {
    expect(fmtQ(1234.567)).toBe("Q 1,234.57");
  });

  it("acepta el string que manda la base (numeric de Postgres)", () => {
    expect(fmtQ("1234.56")).toBe("Q 1,234.56");
  });

  it("null, undefined y vacío son cero, no 'NaN'", () => {
    expect(fmtQ(null)).toBe("Q 0.00");
    expect(fmtQ(undefined)).toBe("Q 0.00");
  });

  it("negativos y cero", () => {
    expect(fmtQ(0)).toBe("Q 0.00");
    expect(fmtQ(-250.4)).toBe("Q -250.40");
  });
});

// El total de una pantalla de dinero tiene que dar lo mismo que el backend, que
// suma con `Big`. Sumar con `+` nativo no lo lograba.
describe("sumaQ", () => {
  it("no arrastra el error del binario", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // el motivo de que esta función exista
    expect(sumaQ([0.1, 0.2])).toBe(0.3);
    expect(sumaQ([0.7, 0.1, 0.2])).toBe(1);
  });

  it("suma los strings que manda la base (numeric de Postgres)", () => {
    expect(sumaQ(["1234.56", "0.44", "10"])).toBe(1245);
  });

  it("cien centavos sueltos dan exactamente un quetzal", () => {
    expect(sumaQ(Array.from({ length: 100 }, () => "0.01"))).toBe(1);
  });

  it("lista vacía, nulos y negativos", () => {
    expect(sumaQ([])).toBe(0);
    expect(sumaQ([null, undefined, "1.50"])).toBe(1.5);
    expect(sumaQ(["100.00", "-40.25"])).toBe(59.75);
  });

  // Un valor que no es número descarta ESE valor, no el total: antes un solo
  // string con formato dejaba el encabezado entero en "Q NaN" y escondía
  // también los montos sanos.
  it("un valor no numérico no envenena la suma", () => {
    expect(Number("1,234.56")).toBeNaN(); // el motivo de este caso
    expect(sumaQ(["1,234.56", "10.00", "5.50"])).toBe(15.5);
    expect(sumaQ(["abc", {}, NaN, Infinity, "-Infinity", "2.25"])).toBe(2.25);
    expect(sumaQ(["no-es-un-numero"])).toBe(0);
  });

  // El backend redondea con `Big` (ROUND_HALF_UP). `Math.round(v * 100)` no lo
  // reproduce: el producto binario deja 1.005 * 100 en 100.49999999999999 y el
  // centavo se pierde en cada ítem.
  it("el borde .xx5 redondea como el Big del backend", () => {
    expect(1.005 * 100).toBeLessThan(100.5); // el motivo de este caso
    expect(sumaQ([1.005])).toBe(1.01);
    expect(sumaQ([2.675])).toBe(2.68);
    expect(sumaQ([8.165])).toBe(8.17);
    // HALF_UP se aleja del cero también en los negativos (`Math.round` subiría
    // a -1.00).
    expect(sumaQ([-1.005])).toBe(-1.01);
  });
});

describe("sumaQ con montos de muchos dígitos", () => {
  it("🔴 un `numeric(18,2)` grande NO pierde los centavos", () => {
    // `toPrecision(15)` recorta dígitos basura del double, pero con más de 15
    // significativos recorta centavos REALES: `12345678901234.56` salía
    // `12345678901234.6` y discrepaba con el `Big` del backend, que los conserva.
    // La columna admite 18 dígitos, así que el caso cabe en la base.
    expect(sumaQ(["12345678901234.56"])).toBe(12345678901234.56);
  });

  it("y sumarlos tampoco los pierde", () => {
    expect(sumaQ(["12345678901234.56", "0.44"])).toBe(12345678901235);
  });

  it("el techo es el del `number`, no el del parseo: ~Q90 billones", () => {
    // Medido: exacto hasta 15 significativos (Q12,345,678,901,234.56 sale
    // exacto), y de ahí para arriba el valor ya no CABE en un double —
    // Q123,456,789,012,345.67 vuelve como .69. Ningún parseo lo arregla: haría
    // falta una librería decimal. `numeric(18,2)` admite más que eso, así que el
    // techo queda documentado y no tapado.
    expect(sumaQ(["12345678901234.56"])).toBe(12345678901234.56);
    expect(sumaQ(["123456789012345.67"])).not.toBe(123456789012345.67);
  });

  it("sigue arreglando el `.xx5` que era el motivo original del helper", () => {
    expect(sumaQ(["1.005"])).toBe(1.01);
    expect(sumaQ([1.005])).toBe(1.01);
  });

  it("y el empate negativo sigue alejándose del cero como `big.js`", () => {
    expect(sumaQ(["-1.005"])).toBe(-1.01);
  });
});
