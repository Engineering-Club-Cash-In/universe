import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import jwt from "jsonwebtoken";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { lockPoolMock } from "../utils/testMocks";

// El router decide el alcance con la fila VIGENTE de platform_users (findSessionUser), no con lo
// que el token o la URL digan. La BD es un doble que guarda cada consulta y no devuelve filas.
const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";

const consultas: { sql: string; params: unknown[] }[] = [];
const dialect = new PgDialect();
mock.module("../database", () => ({
  db: {
    execute: async (q: SQL) => {
      consultas.push(dialect.sqlToQuery(q));
      return { rows: [] };
    },
  },
  client: {},
  lockPool: lockPoolMock,
}));

// platform_users de prueba, por id.
const USUARIOS: Record<number, { id: number; role: string; is_active: boolean; asesor_id: number | null }> = {
  1: { id: 1, role: "ADMIN", is_active: true, asesor_id: null },
  2: { id: 2, role: "ASESOR", is_active: true, asesor_id: 7 },
  3: { id: 3, role: "ASESOR", is_active: true, asesor_id: null },
  4: { id: 4, role: "CONTA", is_active: true, asesor_id: null },
  5: { id: 5, role: "ASESOR", is_active: false, asesor_id: 7 },
  6: { id: 6, role: "ADMIN", is_active: false, asesor_id: null },
  7: { id: 7, role: "CONTA", is_active: false, asesor_id: null },
  8: { id: 8, role: "INVESTOR", is_active: true, asesor_id: null },
};
mock.module("../controllers/auth", () => ({
  findSessionUser: async (id: unknown) => USUARIOS[Number(id)] ?? null,
}));

const { nexaDashboardRouter } = await import("./nexaDashboard");
const app = new Elysia().use(nexaDashboardRouter);

// El token puede decir lo que quiera del asesor: el router no lo usa.
const get = (path: string, id: number, role: string, extra: Record<string, unknown> = {}) =>
  app.handle(new Request(`http://localhost${path}`, {
    headers: { Authorization: `Bearer ${jwt.sign({ id, email: "a@b.c", role, ...extra }, JWT_SECRET)}` },
  }));

const filtroAsesor = (q: { sql: string; params: unknown[] }) => {
  if (q.sql.includes("c.asesor_id = $")) {
    const n = Number(/c\.asesor_id = \$(\d+)/.exec(q.sql)![1]);
    return { asesor: q.params[n - 1] };
  }
  return q.sql.includes("WHERE false") ? { ninguno: true } : { todos: true };
};

beforeEach(() => { consultas.length = 0; });

describe("dashboard Nexa: alcance por asesor en el router", () => {
  it("ASESOR: su asesor de la base aunque mande ?asesor= de otro y un claim falso", async () => {
    const res = await get("/nexa/dashboard?asesor=99", 2, "ASESOR", { asesor_id: 99 });
    expect(res.status).toBe(200);
    expect(consultas).toHaveLength(1);
    expect(filtroAsesor(consultas[0]!)).toEqual({ asesor: 7 });
    expect(consultas[0]!.params).not.toContain(99);
  });

  it("ASESOR sin vínculo: 200 vacío, la consulta lleva WHERE false", async () => {
    const res = await get("/nexa/dashboard?asesor=7", 3, "ASESOR");
    expect(res.status).toBe(200);
    expect((await res.json()).creditos).toEqual([]);
    expect(filtroAsesor(consultas[0]!)).toEqual({ ninguno: true });
  });

  it("ASESOR desactivado o sin fila: ninguno", async () => {
    await get("/nexa/dashboard", 5, "ASESOR");
    await get("/nexa/dashboard", 404, "ASESOR");
    expect(consultas.map(filtroAsesor)).toEqual([{ ninguno: true }, { ninguno: true }]);
  });

  it("ADMIN y CONTA: sin filtro todos, con ?asesor= ese asesor (como parámetro)", async () => {
    await get("/nexa/dashboard", 1, "ADMIN");
    await get("/nexa/dashboard?asesor=3", 1, "ADMIN");
    await get("/nexa/dashboard?asesor=5", 4, "CONTA");
    expect(consultas.map(filtroAsesor)).toEqual([{ todos: true }, { asesor: 3 }, { asesor: 5 }]);
  });

  it("ADMIN con ?asesor= inválido: se ignora, nada se interpola", async () => {
    await get("/nexa/dashboard?asesor=1%20OR%201%3D1", 1, "ADMIN");
    expect(filtroAsesor(consultas[0]!)).toEqual({ todos: true });
    expect(consultas[0]!.sql).not.toContain("OR 1=1");
  });

  it("detalle: ASESOR con un crédito ajeno recibe 404 sin datos y no se consultan los pagos", async () => {
    const res = await get("/nexa/dashboard/10/pagos", 2, "ASESOR");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.pagos).toBeUndefined();
    // Solo la verificación de pertenencia, con su asesor.
    expect(consultas).toHaveLength(1);
    expect(filtroAsesor(consultas[0]!)).toEqual({ asesor: 7 });
  });

  it("detalle: ASESOR sin vínculo recibe 404", async () => {
    expect((await get("/nexa/dashboard/10/pagos", 3, "ASESOR")).status).toBe(404);
  });

  it("detalle: ADMIN no pasa por la verificación y ?asesor= no lo acota", async () => {
    const res = await get("/nexa/dashboard/10/pagos?asesor=3", 1, "ADMIN");
    expect(res.status).toBe(200);
    expect(consultas.every((q) => !q.sql.includes("c.asesor_id"))).toBe(true);
  });

  // Token firmado como ADMIN/CONTA, pero la fila vigente no existe, está inactiva o ya no es de operación.
  const SESIONES_MALAS: [string, number, string][] = [
    ["ADMIN sin fila", 404, "ADMIN"], ["ADMIN inactivo", 6, "ADMIN"], ["CONTA inactivo", 7, "CONTA"],
    ["ADMIN degradado a ASESOR sin vínculo", 3, "ADMIN"], ["ADMIN degradado a otro rol", 8, "ADMIN"],
  ];
  for (const [nombre, id, rol] of SESIONES_MALAS) {
    it(`listado: ${nombre} no ve nada (WHERE false), ni con ?asesor=`, async () => {
      const res = await get("/nexa/dashboard?asesor=3", id, rol);
      expect(res.status).toBe(200);
      expect(consultas.map(filtroAsesor)).toEqual([{ ninguno: true }]);
    });
    it(`detalle: ${nombre} recibe 404 y no se consultan pagos`, async () => {
      const res = await get("/nexa/dashboard/10/pagos", id, rol);
      expect(res.status).toBe(404);
      expect(consultas.every((q) => !q.sql.includes("filas_boleta"))).toBe(true);
    });
    it(`pagos-nexa: ${nombre} recibe 403 sin consultar`, async () => {
      expect((await get("/nexa/credito/10/pagos-nexa", id, rol)).status).toBe(403);
      expect(consultas).toHaveLength(0);
    });
  }

  it("pagos-nexa: ADMIN y CONTA vigentes siguen pasando", async () => {
    expect((await get("/nexa/credito/10/pagos-nexa", 1, "ADMIN")).status).toBe(200);
    expect((await get("/nexa/credito/10/pagos-nexa", 4, "CONTA")).status).toBe(200);
  });
});
