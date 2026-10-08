import { describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import jwt from "jsonwebtoken";
import { lockPoolMock } from "../utils/testMocks";

// Gate de rol del dashboard Nexa. Misma técnica que moraGuards.test.ts: BD que
// siempre rechaza, así un rol permitido pasa el gate y cae en 500 del controlador.
const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";

// Encadenable (db.select().from().where()…, como hace findSessionUser al resolver el alcance):
// rechaza recién al esperarla, así no queda una promesa rechazada sin manejar a mitad de cadena.
const sinBd: any = new Proxy(() => {}, {
  get: (_t, prop) => (prop === "then" ? (_ok: unknown, ko: (e: Error) => void) => ko(new Error("sin BD en tests")) : sinBd),
  apply: () => sinBd,
});

mock.module("../database", () => ({
  db: sinBd,
  client: {},
  lockPool: lockPoolMock,
}));

const { nexaDashboardRouter } = await import("./nexaDashboard");
const app = new Elysia().use(nexaDashboardRouter);

const get = (path: string, role: string) =>
  app.handle(new Request(`http://localhost${path}`, {
    headers: { Authorization: `Bearer ${jwt.sign({ id: 1, email: "a@b.c", role }, JWT_SECRET)}` },
  }));

const RUTAS = ["/nexa/dashboard", "/nexa/dashboard/10/pagos", "/nexa/credito/10/pagos-nexa"];

describe("dashboard Nexa: gate de rol", () => {
  for (const ruta of RUTAS) {
    it(`INVESTOR recibe 403 en ${ruta}`, async () => {
      expect((await get(ruta, "INVESTOR")).status).toBe(403);
    });
    for (const rol of ["ADMIN", "ASESOR", "CONTA"]) {
      it(`${rol} pasa el gate en ${ruta}`, async () => {
        expect((await get(ruta, rol)).status).not.toBe(403);
      });
    }
  }
  it("sin token recibe 401", async () => {
    expect((await app.handle(new Request("http://localhost/nexa/dashboard"))).status).toBe(401);
  });
});

describe("dashboard Nexa: id de crédito", () => {
  it("un id decimal se rechaza con 422 antes de llegar a la BD", async () => {
    expect((await get("/nexa/dashboard/1.5/pagos", "ADMIN")).status).toBe(422);
  });
});
