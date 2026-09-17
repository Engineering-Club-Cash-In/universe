import { describe, expect, it } from "bun:test";
import {
  elegirAsesorConMenorCarga,
  type AsesorCarga,
} from "./advisorLoadBalancing";

const asesor = (
  asesor_id: number,
  total_creditos: number,
  capital_total: string,
): AsesorCarga => ({
  asesor_id,
  nombre: `Asesor ${asesor_id}`,
  total_creditos,
  capital_total,
});

describe("elegirAsesorConMenorCarga", () => {
  it("gana el de menos créditos aunque tenga más capital colocado", () => {
    const elegido = elegirAsesorConMenorCarga([
      asesor(1, 20, "100000.00"),
      asesor(2, 3, "900000.00"),
      asesor(3, 12, "450000.00"),
    ]);

    expect(elegido.asesor_id).toBe(2);
  });

  it("desempata por menor capital cuando el número de créditos es igual", () => {
    const elegido = elegirAsesorConMenorCarga([
      asesor(1, 12, "450000.00"),
      asesor(2, 12, "310000.00"),
      asesor(3, 12, "520000.00"),
    ]);

    expect(elegido.asesor_id).toBe(2);
  });

  it("desempata por menor asesor_id cuando créditos y capital son iguales", () => {
    const elegido = elegirAsesorConMenorCarga([
      asesor(9, 12, "310000.00"),
      asesor(3, 12, "310000.00"),
      asesor(7, 12, "310000.00"),
    ]);

    expect(elegido.asesor_id).toBe(3);
  });

  it("un asesor sin créditos asignados gana sobre todos los demás", () => {
    const elegido = elegirAsesorConMenorCarga([
      asesor(1, 5, "50000.00"),
      asesor(2, 0, "0"),
      asesor(3, 1, "10000.00"),
    ]);

    expect(elegido.asesor_id).toBe(2);
  });

  it("compara el capital como número y no como texto", () => {
    // "9000" > "10000" al comparar cadenas; el desempate debe usar el valor numérico.
    const elegido = elegirAsesorConMenorCarga([
      asesor(1, 4, "9000.00"),
      asesor(2, 4, "10000.00"),
    ]);

    expect(elegido.asesor_id).toBe(1);
  });

  it("lanza error cuando no hay asesores elegibles", () => {
    expect(() => elegirAsesorConMenorCarga([])).toThrow(
      "No hay asesores activos disponibles",
    );
  });

  it("no muta el arreglo que recibe", () => {
    const entrada = [asesor(1, 20, "100000.00"), asesor(2, 3, "900000.00")];
    const copia = [...entrada];

    elegirAsesorConMenorCarga(entrada);

    expect(entrada).toEqual(copia);
  });
});
