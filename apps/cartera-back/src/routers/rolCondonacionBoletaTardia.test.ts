import "../utils/baseFalsaParaPruebas";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { rechazoSiNoEsRolActivo } from "./midleware";

const ROLES = ["ASESOR", "ADMIN"] as const;
const vigente = (o: Record<string, unknown> = {}) =>
  (async () => ({ id: 7, email: "db@clubcashin.com", role: "ASESOR", is_active: true, ...o })) as never;
const nuncaSeLlama = (async () => { throw new Error("no debía consultarse la base"); }) as never;
const nuevoSet = () => ({ status: 200 as number | undefined });

describe("rechazoSiNoEsRolActivo", () => {
  test("ASESOR y ADMIN vigentes pasan, y el email sale de la BASE aunque el token traiga otro", async () => {
    for (const role of ROLES) {
      const set = nuevoSet();
      const r = await rechazoSiNoEsRolActivo({ id: 7, role, email: "token@falso.com" }, set, ROLES, vigente({ role }));
      expect(r).toEqual({ ok: true, email: "db@clubcashin.com", role });
      expect(set.status).toBe(200);
    }
  });

  test("CONTA, INVESTOR, rol vacío o sin usuario → 403 sin consultar la base", async () => {
    for (const user of [{ id: 7, role: "CONTA" }, { id: 7, role: "INVESTOR" }, { id: 7, role: "" }, { id: 7 }, null, undefined]) {
      const set = nuevoSet();
      const r = await rechazoSiNoEsRolActivo(user, set, ROLES, nuncaSeLlama);
      expect(r.ok).toBe(false);
      expect(set.status).toBe(403);
      if (!r.ok) expect(r.body.success).toBe(false);
    }
  });

  test("token ASESOR pero la base ya no lo tiene o está inactivo → 401", async () => {
    for (const buscar of [async () => null, vigente({ is_active: false })]) {
      const set = nuevoSet();
      const r = await rechazoSiNoEsRolActivo({ id: 7, role: "ASESOR" }, set, ROLES, buscar as never);
      expect(r.ok).toBe(false);
      expect(set.status).toBe(401);
    }
  });

  test("token ASESOR pero en la base ahora es CONTA → 403; si ahora es ADMIN, pasa como ADMIN", async () => {
    const set = nuevoSet();
    expect((await rechazoSiNoEsRolActivo({ id: 7, role: "ASESOR" }, set, ROLES, vigente({ role: "CONTA" }))).ok).toBe(false);
    expect(set.status).toBe(403);
    const r = await rechazoSiNoEsRolActivo({ id: 7, role: "ASESOR" }, nuevoSet(), ROLES, vigente({ role: "ADMIN" }));
    expect(r).toEqual({ ok: true, email: "db@clubcashin.com", role: "ADMIN" });
  });

  test("token ADMIN pero la base lo bajó a CONTA, o lo desactivó → no pasa", async () => {
    const set = nuevoSet();
    expect((await rechazoSiNoEsRolActivo({ id: 7, role: "ADMIN" }, set, ROLES, vigente({ role: "CONTA" }))).ok).toBe(false);
    expect(set.status).toBe(403);
    const set2 = nuevoSet();
    expect((await rechazoSiNoEsRolActivo({ id: 7, role: "ADMIN" }, set2, ROLES, vigente({ role: "ADMIN", is_active: false }))).ok).toBe(false);
    expect(set2.status).toBe(401);
  });

  test("una fila de la base sin email utilizable no firma nada (falla cerrado con 401)", async () => {
    for (const email of ["", null, undefined, 5]) {
      const set = nuevoSet();
      const r = await rechazoSiNoEsRolActivo({ id: 7, role: "ASESOR" }, set, ROLES, vigente({ email }));
      expect(r.ok).toBe(false);
      expect(set.status).toBe(401);
    }
  });

  test("si la base falla, falla CERRADO (lanza; la ruta responde 500, nunca deja pasar)", async () => {
    const rota = (async () => { throw new Error("db caída"); }) as never;
    await expect(rechazoSiNoEsRolActivo({ id: 7, role: "ASESOR" }, nuevoSet(), ROLES, rota)).rejects.toThrow("db caída");
  });

  test("el id que se consulta es el del TOKEN verificado (no un campo ajeno)", async () => {
    const vistos: unknown[] = [];
    const buscar = (async (id: unknown) => { vistos.push(id); return { id: 7, email: "db@clubcashin.com", role: "ASESOR", is_active: true }; }) as never;
    await rechazoSiNoEsRolActivo({ id: 7, role: "ASESOR", email: "x@y.com" }, nuevoSet(), ROLES, buscar);
    expect(vistos).toEqual([7]);
  });
});

describe("cableado en payments.ts (contrato sobre el fuente, regiones acotadas)", () => {
  const src = readFileSync(new URL("./payments.ts", import.meta.url), "utf8");
  const desde = (ancla: string) => {
    const i = src.indexOf(ancla);
    if (i < 0) throw new Error(`Ancla no encontrada: ${ancla}`);
    return src.slice(i, i + 1100);
  };

  test("/newPayment: sin el bloque va directo a insertPayment; con el bloque pasa por el gate ANTES de registrar", () => {
    const ruta = desde('.post("/newPayment"');
    const sinBloque = ruta.indexOf("if (!traeCondonacionBoletaTardia(ctx.body)) return insertPayment(ctx);");
    const gate = ruta.indexOf('rechazoSiNoEsRolActivo(ctx.user, ctx.set, ["ASESOR", "ADMIN"])');
    const registro = ruta.indexOf("registrarPagoConBoletaTardia(ctx, { usuarioEmail: sesion.email })");
    expect(sinBloque).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(sinBloque);
    expect(registro).toBeGreaterThan(gate);
    expect(ruta).toContain("if (!sesion.ok) return sesion.body;");
  });

  test("/newPayment: la identidad nunca sale del token ni del body", () => {
    const ruta = desde('.post("/newPayment"');
    expect(ruta).not.toContain("ctx.user?.email");
    expect(ruta).not.toContain("registerBy");
  });

  test("la vista previa también exige el gate (token + base) y ya no confía solo en el token", () => {
    const ruta = desde('.post("/pagos/boleta-tardia/preview"');
    expect(ruta).toContain('rechazoSiNoEsRolActivo(user, set, ["ASESOR", "ADMIN"])');
    expect(ruta).toContain("if (!sesion.ok) return sesion.body;");
    expect(ruta).not.toContain('["ADMIN", "ASESOR"].includes(user?.role)');
  });
});
