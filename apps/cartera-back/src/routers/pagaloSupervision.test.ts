import { describe, expect, it, mock } from "bun:test";
import jwt from "jsonwebtoken";

const getPagaloSupervision = mock(async () => ({
  success: true,
  grupos: [],
  total: 0,
  conteoPorEstado: {},
}));

mock.module("../services/crm.service", () => ({ getPagaloSupervision }));

const { pagaloSupervisionRouter } = await import("./pagaloSupervision");

const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";

const pedir = (url: string, role?: string) =>
  pagaloSupervisionRouter.handle(
    new Request(`http://localhost${url}`, {
      headers: role
        ? { authorization: `Bearer ${jwt.sign({ role }, JWT_SECRET)}` }
        : {},
    }),
  );

describe("GET /pagalo/supervision", () => {
  it("deja pasar a ADMIN y a CONTA", async () => {
    for (const role of ["ADMIN", "CONTA"]) {
      const res = await pedir("/pagalo/supervision", role);
      expect(res.status).toBe(200);
    }
  });

  it("responde 403 a un ASESOR sin consultar el CRM", async () => {
    getPagaloSupervision.mockClear();
    const res = await pedir("/pagalo/supervision", "ASESOR");

    expect(res.status).toBe(403);
    expect(getPagaloSupervision).not.toHaveBeenCalled();
  });

  it("responde 401 sin token", async () => {
    const res = await pedir("/pagalo/supervision");
    expect(res.status).toBe(401);
  });

  it("rechaza una fecha mal formada antes de salir al CRM", async () => {
    getPagaloSupervision.mockClear();
    const res = await pedir("/pagalo/supervision?fechaDesde=01-2026", "ADMIN");

    expect(res.status).toBe(400);
    expect(getPagaloSupervision).not.toHaveBeenCalled();
  });

  it("rechaza un rango invertido", async () => {
    const res = await pedir(
      "/pagalo/supervision?fechaDesde=2026-03-05&fechaHasta=2026-03-01",
      "ADMIN",
    );
    expect(res.status).toBe(400);
  });

  it("rechaza un sortBy fuera de la whitelist", async () => {
    getPagaloSupervision.mockClear();
    const res = await pedir("/pagalo/supervision?sortBy=totalAmount;DROP", "ADMIN");

    expect(res.status).toBe(400);
    expect(getPagaloSupervision).not.toHaveBeenCalled();
  });

  // Sin validar acá, estos llegaban al CRM, volvían como 400 y el usuario veía
  // un 502 "no se pudo consultar" que no decía qué estaba mal.
  it.each([
    ["antiguedadMinDias", "abc"],
    ["antiguedadMinDias", "-5"],
    ["antiguedadMinDias", "0"],
    ["limit", "abc"],
    ["offset", "-1"],
  ])("responde 400 para %s=%s sin salir al CRM", async (campo, valor) => {
    getPagaloSupervision.mockClear();
    const res = await pedir(`/pagalo/supervision?${campo}=${valor}`, "ADMIN");

    expect(res.status).toBe(400);
    expect(getPagaloSupervision).not.toHaveBeenCalled();
  });

  it("responde 400 para un estado que no existe", async () => {
    getPagaloSupervision.mockClear();
    const res = await pedir("/pagalo/supervision?estados=NO_EXISTE", "ADMIN");

    expect(res.status).toBe(400);
    expect(getPagaloSupervision).not.toHaveBeenCalled();
  });

  it("acepta varios estados válidos separados por coma", async () => {
    const res = await pedir(
      "/pagalo/supervision?estados=COMPLETED,CANCELLED&problemasLink=EXPIRED",
      "ADMIN",
    );
    expect(res.status).toBe(200);
  });

  it("acepta offset=0, que es la primera página", async () => {
    const res = await pedir("/pagalo/supervision?offset=0&limit=25", "ADMIN");
    expect(res.status).toBe(200);
  });
});
