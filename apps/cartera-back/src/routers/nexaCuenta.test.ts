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

// platform_users VIGENTE por id: el router revalida contra esto, no contra el token.
const USUARIOS: Record<number, { role: string; is_active: boolean }> = {
  1: { role: "ADMIN", is_active: true },
  2: { role: "CONTA", is_active: true },
  3: { role: "ADMIN", is_active: false }, // desactivado con el token vivo
  4: { role: "ASESOR", is_active: true }, // le quitaron el rol ADMIN
};
mock.module("../controllers/auth", () => ({
  findSessionUser: async (id: unknown) => USUARIOS[Number(id)] ?? null,
}));

const { nexaCuentaRouter } = await import("./nexaCuenta");

const pedir = (ruta: string, role: string, id = role === "CONTA" ? 2 : 1) =>
  nexaCuentaRouter.handle(
    new Request(`http://localhost${ruta}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt.sign({ id, role }, JWT_SECRET)}`,
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

describe("cuenta Nexa — sesión vigente en la base", () => {
  it("un ADMIN desactivado o que ya no existe recibe 401 y no se toca nada", async () => {
    llamadas.length = 0;
    for (const id of [3, 99]) {
      expect((await pedir("/creditos/cuenta-nexa", "ADMIN", id)).status).toBe(401);
      expect((await pedir("/creditos/cuenta-nexa/notificada", "ADMIN", id)).status).toBe(401);
    }
    expect(llamadas).toEqual([]);
  });

  it("un token ADMIN de alguien que ya no tiene el rol recibe 403", async () => {
    llamadas.length = 0;
    expect((await pedir("/creditos/cuenta-nexa", "ADMIN", 4)).status).toBe(403);
    expect((await pedir("/creditos/cuenta-nexa/notificada", "ADMIN", 4)).status).toBe(403);
    expect(llamadas).toEqual([]);
  });
});
