import { describe, expect, it } from "bun:test";
import { calcularVentanaProporcional } from "./diasParticipacion";

// El llamador (insertPagosCreditoInversionistas) parsea la columna `date` como
// medianoche LOCAL; replicamos eso acá para que el test refleje el uso real.
const fecha = (iso: string) => new Date(`${iso}T00:00:00`);

describe("calcularVentanaProporcional", () => {
  it("entrada a mitad de mes: cobra los días restantes", () => {
    const { diasDelMes, diasProporcionales } = calcularVentanaProporcional(
      fecha("2026-01-07")
    );

    expect(diasDelMes).toBe(31);
    expect(diasProporcionales).toBe(24); // 31 - 7
  });

  it("entrada el ÚLTIMO día del mes: 1 día, nunca 0", () => {
    // Sin el piso, 31 - 31 = 0 → el inversionista cobraba cero interés del mes.
    const { diasDelMes, diasProporcionales } = calcularVentanaProporcional(
      fecha("2026-01-31")
    );

    expect(diasDelMes).toBe(31);
    expect(diasProporcionales).toBe(1);
  });

  it("último día de un mes de 30: también cae en el piso", () => {
    const { diasDelMes, diasProporcionales } = calcularVentanaProporcional(
      fecha("2026-04-30")
    );

    expect(diasDelMes).toBe(30);
    expect(diasProporcionales).toBe(1);
  });

  it("febrero: distingue año normal de bisiesto", () => {
    expect(calcularVentanaProporcional(fecha("2026-02-28"))).toMatchObject({
      diasDelMes: 28,
      diasProporcionales: 1, // 28 es el último día en 2026
    });
    expect(calcularVentanaProporcional(fecha("2028-02-28"))).toMatchObject({
      diasDelMes: 29,
      diasProporcionales: 1, // 2028 es bisiesto: el 28 ya no es el último, queda 1 día
    });
    expect(calcularVentanaProporcional(fecha("2028-02-29"))).toMatchObject({
      diasDelMes: 29,
      diasProporcionales: 1,
    });
  });

  it("nunca devuelve 0 ni negativo en ningún día de ningún mes del año", () => {
    for (let mes = 0; mes < 12; mes++) {
      const ultimo = new Date(2026, mes + 1, 0).getDate();
      for (let dia = 1; dia <= ultimo; dia++) {
        const { diasProporcionales } = calcularVentanaProporcional(
          new Date(2026, mes, dia)
        );
        expect(diasProporcionales).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("día 1 devuelve mes-menos-un-día (el llamador lo excluye antes de llegar acá)", () => {
    // Documenta el off-by-one que `esMesAnterior` tapa con `getDate() !== 1`:
    // el helper NO cuenta el día de inicio, por eso el día 1 da 30 y no 31.
    expect(calcularVentanaProporcional(fecha("2026-01-01"))).toMatchObject({
      diasDelMes: 31,
      diasProporcionales: 30,
    });
  });
});
