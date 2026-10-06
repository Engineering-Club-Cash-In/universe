import { describe, expect, it, mock } from "bun:test";
import jwt from "jsonwebtoken";

// Mismo secreto que captura midleware.ts al cargarse (ver moraGuards.test.ts).
const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";

const llamadas: string[] = [];
mock.module("../controllers/nexaCuentaCliente", () => ({
  cuentaNexaDeps: {},
  solicitarCuentaNexa: async () => {
    llamadas.push("solicitar");
    return { estado: "deshabilitada" };
  },
  marcarCuentaNexaNotificada: async () => {
    llamadas.push("marcar");
    return true;
  },
}));

const { nexaCuentaRouter } = await import("./nexaCuenta");

const pedir = (ruta: string, role: string) =>
  nexaCuentaRouter.handle(
    new Request(`http://localhost${ruta}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt.sign({ id: 1, role }, JWT_SECRET)}`,
      },
      body: JSON.stringify({ numero_credito_sifco: "01010214100000", dpi: null }),
    }),
  );

describe("cuenta Nexa — gate de rol", () => {
  it("un INVESTOR o un ASESOR reciben 403 y no se toca nada", async () => {
    llamadas.length = 0;
    for (const role of ["INVESTOR", "ASESOR"]) {
      expect((await pedir("/creditos/cuenta-nexa", role)).status).toBe(403);
      expect((await pedir("/creditos/cuenta-nexa/notificada", role)).status).toBe(403);
    }
    expect(llamadas).toEqual([]);
  });

  it("ADMIN (la cuenta de servicio del CRM) y CONTA pasan", async () => {
    llamadas.length = 0;
    expect((await pedir("/creditos/cuenta-nexa", "ADMIN")).status).toBe(200);
    expect((await pedir("/creditos/cuenta-nexa/notificada", "CONTA")).status).toBe(200);
    expect(llamadas).toEqual(["solicitar", "marcar"]);
  });
});
