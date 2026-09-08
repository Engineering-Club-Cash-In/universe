import { beforeEach, describe, expect, it } from "bun:test";
import {
  CLAVE_DEL_ALTA,
  olvidarTipoDelAlta,
  recordarTipoDelAlta,
  tipoRecordadoDelAlta,
  type AlmacenDelAlta,
} from "./tipoDelAltaPersistido";

let datos: Record<string, string>;
const almacen = (): AlmacenDelAlta => ({
  getItem: (k) => datos[k] ?? null,
  setItem: (k, v) => {
    datos[k] = v;
  },
  removeItem: (k) => {
    delete datos[k];
  },
});

beforeEach(() => {
  datos = {};
});

describe("tipoRecordadoDelAlta", () => {
  // El caso que motiva el módulo: el alta salió, el registro externo creó la
  // fila de inversionista y falló antes de escribir la identidad; la persona
  // recarga /register y Formik vuelve a CLIENT.
  it("devuelve el tipo con el que se creó la cuenta de ese correo", () => {
    recordarTipoDelAlta({ correo: "Ana@Example.com", tipo: "INVESTOR" }, almacen());
    expect(tipoRecordadoDelAlta("ana@example.com", almacen())).toBe("INVESTOR");
  });

  it("no ata a otra persona: el correo tiene que ser el mismo", () => {
    recordarTipoDelAlta({ correo: "ana@example.com", tipo: "INVESTOR" }, almacen());
    expect(tipoRecordadoDelAlta("otro@example.com", almacen())).toBeNull();
  });

  it("se olvida cuando el registro termina", () => {
    recordarTipoDelAlta({ correo: "ana@example.com", tipo: "INVESTOR" }, almacen());
    olvidarTipoDelAlta(almacen());
    expect(tipoRecordadoDelAlta("ana@example.com", almacen())).toBeNull();
  });

  // Ante la duda se cae al comportamiento de antes: este valor solo sirve para
  // RESTRINGIR, así que inventarlo ataría a alguien a un tipo que no eligió.
  it("devuelve null ante cualquier cosa que no cuadre", () => {
    expect(tipoRecordadoDelAlta("ana@example.com", almacen())).toBeNull();

    datos[CLAVE_DEL_ALTA] = "{no es json";
    expect(tipoRecordadoDelAlta("ana@example.com", almacen())).toBeNull();

    datos[CLAVE_DEL_ALTA] = JSON.stringify({ correo: "ana@example.com", tipo: "ADMIN" });
    expect(tipoRecordadoDelAlta("ana@example.com", almacen())).toBeNull();

    datos[CLAVE_DEL_ALTA] = JSON.stringify({ tipo: "INVESTOR" });
    expect(tipoRecordadoDelAlta("ana@example.com", almacen())).toBeNull();

    expect(tipoRecordadoDelAlta("", almacen())).toBeNull();
  });

  it("sobrevive a un almacén que lanza", () => {
    const roto: AlmacenDelAlta = {
      getItem: () => {
        throw new Error("modo privado");
      },
      setItem: () => {
        throw new Error("modo privado");
      },
      removeItem: () => {
        throw new Error("modo privado");
      },
    };

    expect(() => recordarTipoDelAlta({ correo: "a@b.com", tipo: "CLIENT" }, roto)).not.toThrow();
    expect(() => olvidarTipoDelAlta(roto)).not.toThrow();
    expect(tipoRecordadoDelAlta("a@b.com", roto)).toBeNull();
  });
});
