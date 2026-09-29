import { describe, it, expect } from "bun:test";
import { aumentoRubroBloqueado } from "./estadoCredito";

/**
 * Los cuatro casos salen de medir el backend contra una copia de producción:
 * SUBIR vuelve a correr la política de creación; BAJAR no.
 */
describe("aumentoRubroBloqueado", () => {
  const tipoVivo = { obligatorio: false, activo: true };

  it("🔴 crédito CANCELADO: subir se rechaza", () => {
    expect(aumentoRubroBloqueado("CANCELADO", tipoVivo)).toContain("CANCELADO");
  });

  it("🔴 crédito INCOBRABLE: subir se rechaza", () => {
    expect(aumentoRubroBloqueado("INCOBRABLE", tipoVivo)).toBeTruthy();
  });

  it("🔴 MOROSO con tipo OPCIONAL: subir se rechaza", () => {
    expect(aumentoRubroBloqueado("MOROSO", { obligatorio: false, activo: true })).toBeTruthy();
  });

  it("MOROSO con tipo OBLIGATORIO: subir SÍ se puede (medido: aceptado)", () => {
    expect(aumentoRubroBloqueado("MOROSO", { obligatorio: true, activo: true })).toBeNull();
  });

  it("🔴 tipo DESACTIVADO: subir se rechaza aunque el crédito esté sano", () => {
    expect(aumentoRubroBloqueado("ACTIVO", { obligatorio: false, activo: false })).toContain("inactivo");
  });

  it("crédito ACTIVO con tipo vivo: se puede", () => {
    expect(aumentoRubroBloqueado("ACTIVO", tipoVivo)).toBeNull();
  });

  it("sin datos del tipo no se gatea nada: manda el backend", () => {
    // La lista de tipos puede no estar cargada. Bloquear a ciegas sería peor que
    // dejar pasar: le impediría al admin una edición legítima.
    expect(aumentoRubroBloqueado("ACTIVO", undefined)).toBeNull();
  });

  it("sin statusCredit tampoco se gatea el estado, pero el tipo inactivo sigue valiendo", () => {
    expect(aumentoRubroBloqueado(null, tipoVivo)).toBeNull();
    expect(aumentoRubroBloqueado(null, { obligatorio: false, activo: false })).toBeTruthy();
  });
});
