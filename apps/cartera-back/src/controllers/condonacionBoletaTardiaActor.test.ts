import "../utils/baseFalsaParaPruebas";
import { describe, expect, test } from "bun:test";
import { condonarMoraDeCuotas } from "./latefee";

// Codex r1 #3: la boleta tardía no puede caer al usuario de sistema de Nexa.
// El guard corre antes de tocar la base (la URL falsa no escucha nada).
describe("condonarMoraDeCuotas — boleta tardía exige el actor", () => {
  const base = {
    credito_id: 1, montoMoraEsperado: "10", monto: "10",
    cuotas: [{ cuota_id: 1, monto: "10" }], motivo: "prueba",
    origen: "CONDONACION_BOLETA_TARDIA" as const, intento_id: "00000000-0000-4000-8000-000000000001",
  };

  test("sin usuario_email → lanza pidiendo el email del actor", async () => {
    await expect(condonarMoraDeCuotas(base as never)).rejects.toThrow(/usuario_email/);
  });

  test("usuario_email en blanco → lanza igual", async () => {
    await expect(condonarMoraDeCuotas({ ...base, usuario_email: "   " })).rejects.toThrow(/usuario_email/);
  });
});
