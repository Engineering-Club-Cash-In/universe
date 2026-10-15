import { describe, expect, test } from "bun:test";
import { decidirAltaAsesor } from "./alta-asesor";

const junior = [0, 1];

describe("decidirAltaAsesor", () => {
  test("sin asesor con ese correo: se crea", () => {
    expect(decidirAltaAsesor({ candidatos: [], buckets: junior })).toEqual({ accion: "crear" });
  });

  test("reintento: activo con el mismo pool no escribe nada", () => {
    expect(
      decidirAltaAsesor({
        candidatos: [{ asesor_id: 7, activo: true, poolActivo: [1, 0], poolInactivo: [] }],
        buckets: junior,
      }),
    ).toEqual({ accion: "existente", asesorId: 7 });
  });

  test("activo con otro pool: conflicto que nombra su pool", () => {
    const d = decidirAltaAsesor({
      candidatos: [{ asesor_id: 7, activo: null, poolActivo: [3, 2], poolInactivo: [] }],
      buckets: junior,
    });
    expect(d.accion).toBe("conflicto");
    expect(d.accion === "conflicto" && d.mensaje).toContain("B2, B3");
  });

  test("activo con el pool pausado (ausente): no se le da pool", () => {
    const d = decidirAltaAsesor({
      candidatos: [{ asesor_id: 7, activo: true, poolActivo: [], poolInactivo: [0, 1] }],
      buckets: junior,
    });
    expect(d.accion).toBe("conflicto");
  });

  test("activo sin pool: se vincula", () => {
    expect(
      decidirAltaAsesor({
        candidatos: [{ asesor_id: 7, activo: true, poolActivo: [], poolInactivo: [] }],
        buckets: junior,
      }),
    ).toEqual({ accion: "vincular", asesorId: 7 });
  });

  test("dado de baja: se reactiva aunque tenga otro pool viejo", () => {
    expect(
      decidirAltaAsesor({
        candidatos: [{ asesor_id: 9, activo: false, poolActivo: [], poolInactivo: [2, 3] }],
        buckets: junior,
      }),
    ).toEqual({ accion: "reactivar", asesorId: 9 });
  });

  test("un activo gana sobre filas dadas de baja con el mismo correo", () => {
    expect(
      decidirAltaAsesor({
        candidatos: [
          { asesor_id: 3, activo: false, poolActivo: [], poolInactivo: [] },
          { asesor_id: 4, activo: true, poolActivo: [0, 1], poolInactivo: [] },
        ],
        buckets: junior,
      }),
    ).toEqual({ accion: "existente", asesorId: 4 });
  });

  test("correo repetido en varios activos o varios dados de baja: conflicto", () => {
    expect(
      decidirAltaAsesor({
        candidatos: [
          { asesor_id: 3, activo: true, poolActivo: [], poolInactivo: [] },
          { asesor_id: 4, activo: true, poolActivo: [], poolInactivo: [] },
        ],
        buckets: junior,
      }).accion,
    ).toBe("conflicto");
    expect(
      decidirAltaAsesor({
        candidatos: [
          { asesor_id: 3, activo: false, poolActivo: [], poolInactivo: [] },
          { asesor_id: 4, activo: false, poolActivo: [], poolInactivo: [] },
        ],
        buckets: junior,
      }).accion,
    ).toBe("conflicto");
  });
});
