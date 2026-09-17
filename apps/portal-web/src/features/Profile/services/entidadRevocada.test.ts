import { describe, expect, it } from "bun:test";
import {
  esEntidadNoAutorizada,
  hayQueRefrescarEntidades,
} from "./entidadRevocada";

describe("esEntidadNoAutorizada", () => {
  it("reconoce el 403, venga en el error o en la respuesta", () => {
    expect(esEntidadNoAutorizada({ response: { status: 403 } })).toBeTrue();
    expect(esEntidadNoAutorizada({ status: 403 })).toBeTrue();
  });

  // Refrescar por cualquier fallo convertiría una caída del backend en una
  // tormenta de consultas, y el 401 ya lo resuelve el guard yendo al login.
  it("ignora todo lo que no sea un 403", () => {
    expect(esEntidadNoAutorizada({ response: { status: 401 } })).toBeFalse();
    expect(esEntidadNoAutorizada({ response: { status: 404 } })).toBeFalse();
    expect(esEntidadNoAutorizada({ response: { status: 500 } })).toBeFalse();
    expect(esEntidadNoAutorizada(new Error("sin red"))).toBeFalse();
    expect(esEntidadNoAutorizada(null)).toBeFalse();
    expect(esEntidadNoAutorizada("403")).toBeFalse();
  });
});

describe("hayQueRefrescarEntidades", () => {
  it("refresca cuando el 403 vino de una consulta con alcance de entidad", () => {
    expect(
      hayQueRefrescarEntidades({ response: { status: 403 } }, ["perfil", 86]),
    ).toBeTrue();
  });

  // Sin esto, el 403 del propio refresco pediría otro refresco, y ese otro.
  it("nunca se dispara con la propia lista de entidades", () => {
    expect(
      hayQueRefrescarEntidades({ response: { status: 403 } }, ["entidades", "u1"]),
    ).toBeFalse();
  });
});
