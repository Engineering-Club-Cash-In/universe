import "../utils/baseFalsaParaPruebas";
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import jwt from "jsonwebtoken";
import { rechazoSiNoEsRolActivo } from "./midleware";
import { registrarPagoConBoletaTardia, traeCondonacionBoletaTardia, type DepsBoletaTardia } from "../controllers/boletaTardia";

/**
 * Pruebas exhaustivas (caja negra) de la Tarea 7: el gate `rechazoSiNoEsRolActivo` y su cableado.
 * Sin base real y sin mock.module: la base se inyecta (`buscarSesion`) o es la URL falsa e inalcanzable
 * (una consulta real FALLA con connection refused, que es justo el "base caída" que se quiere probar).
 */

const ROLES = ["ASESOR", "ADMIN"] as const;
type Fila = { id?: number; email?: unknown; role?: unknown; is_active?: unknown };
const nuevoSet = () => ({ status: 200 as number | undefined });
const contador = (devuelve: Fila | null | undefined | (() => unknown)) => {
  const llamadas: unknown[][] = [];
  const f = (async (...args: unknown[]) => {
    llamadas.push(args);
    return typeof devuelve === "function" ? devuelve() : devuelve;
  }) as never;
  return { f, llamadas };
};

// ───────────────────────────── Matriz rol del token × fila de la base ─────────────────────────────
// Oráculo independiente, escrito desde la spec (reglas 1-3), no desde el código.
const ROLES_TOKEN: unknown[] = ["ADMIN", "ASESOR", "CONTA", "INVESTOR", "asesor", "Admin", " ASESOR", "ASESOR ", "ASESOR\n", "", "ROOT", "ADMIN,ASESOR", null, undefined, 5, true, ["ASESOR"], { toString: () => "ASESOR" }];
const FILAS_BASE: (Fila | null | undefined)[] = [
  null, undefined,
  ...["ADMIN", "ASESOR", "CONTA", "INVESTOR", "asesor", "ASESOR ", "", null, undefined, 7].flatMap((role) =>
    [true, false, null, undefined, 0].map((is_active) => ({ id: 7, email: "db@clubcashin.com", role, is_active }))),
];
const oraculo = (tokenRole: unknown, fila: Fila | null | undefined) => {
  const permitido = (r: unknown) => typeof r === "string" && (ROLES as readonly string[]).includes(r);
  if (!permitido(tokenRole)) return { status: 403, consulta: false, ok: false };
  if (!fila || fila.is_active !== true) return { status: 401, consulta: true, ok: false };
  if (!permitido(fila.role)) return { status: 403, consulta: true, ok: false };
  return { status: 200, consulta: true, ok: true };
};

describe("matriz: rol del token × fila de la base × activo", () => {
  test(`${ROLES_TOKEN.length} roles de token × ${FILAS_BASE.length} filas: solo pasa token ASESOR/ADMIN + base activa con ASESOR/ADMIN`, async () => {
    let casos = 0;
    let pasan = 0;
    for (const tokenRole of ROLES_TOKEN) {
      for (const fila of FILAS_BASE) {
        const { f, llamadas } = contador(fila);
        const set = nuevoSet();
        const r = await rechazoSiNoEsRolActivo({ id: 7, role: tokenRole, email: "token@falso.com" }, set, ROLES, f);
        const esperado = oraculo(tokenRole, fila);
        const ctx = JSON.stringify({ tokenRole: String(tokenRole), fila });
        expect([ctx, r.ok]).toEqual([ctx, esperado.ok]);
        expect([ctx, set.status]).toEqual([ctx, esperado.status]);
        expect([ctx, llamadas.length]).toEqual([ctx, esperado.consulta ? 1 : 0]);
        if (r.ok) {
          pasan++;
          expect([ctx, r.email]).toEqual([ctx, "db@clubcashin.com"]);
          expect([ctx, r.role]).toEqual([ctx, (fila as Fila).role as string]);
        } else {
          expect(r.body.success).toBe(false);
          expect(typeof r.body.message).toBe("string");
          expect(Object.keys(r)).toEqual(["ok", "body"]); // un rechazo no filtra email ni rol
        }
        casos++;
      }
    }
    expect(casos).toBe(ROLES_TOKEN.length * FILAS_BASE.length);
    expect(pasan).toBe(2 * 2); // token {ADMIN,ASESOR} × base activa con rol permitido {ADMIN,ASESOR}
  });

  test("el rol que devuelve es el de la BASE (token ASESOR, base ADMIN → role ADMIN; token ADMIN, base ASESOR → role ASESOR)", async () => {
    const a = await rechazoSiNoEsRolActivo({ id: 1, role: "ASESOR" }, nuevoSet(), ROLES, contador({ email: "a@x.com", role: "ADMIN", is_active: true }).f);
    expect(a).toEqual({ ok: true, email: "a@x.com", role: "ADMIN" });
    const b = await rechazoSiNoEsRolActivo({ id: 1, role: "ADMIN" }, nuevoSet(), ROLES, contador({ email: "a@x.com", role: "ASESOR", is_active: true }).f);
    expect(b).toEqual({ ok: true, email: "a@x.com", role: "ASESOR" });
  });

  test("un rechazo tampoco 'pasa' con ok:true aunque el set ya traiga un status previo; en éxito no se toca el status", async () => {
    const set = { status: 418 as number | undefined };
    const r = await rechazoSiNoEsRolActivo({ id: 1, role: "ASESOR" }, set, ROLES, contador({ email: "a@x.com", role: "ASESOR", is_active: true }).f);
    expect(r.ok).toBe(true);
    expect(set.status).toBe(418);
    const set2 = { status: 200 as number | undefined };
    const r2 = await rechazoSiNoEsRolActivo({ id: 1, role: "CONTA" }, set2, ROLES, contador(null).f);
    expect(r2.ok).toBe(false);
    expect(set2.status).toBe(403);
  });

  test("user: no-objetos y objetos raros → 403 sin consultar la base", async () => {
    for (const user of [undefined, null, 0, "", "ASESOR", "ADMIN", true, [], ["ASESOR"], () => 1, Symbol.iterator as unknown]) {
      const { f, llamadas } = contador({ email: "a@x.com", role: "ADMIN", is_active: true });
      const set = nuevoSet();
      const r = await rechazoSiNoEsRolActivo(user, set, ROLES, f);
      expect(r.ok).toBe(false);
      expect(set.status).toBe(403);
      expect(llamadas.length).toBe(0);
    }
  });

  test("lista de roles vacía: nadie pasa (no es un 'permitir todo')", async () => {
    const { f } = contador({ email: "a@x.com", role: "ADMIN", is_active: true });
    const r = await rechazoSiNoEsRolActivo({ id: 1, role: "ADMIN" }, nuevoSet(), [], f);
    expect(r.ok).toBe(false);
  });
});

describe("respuesta anómala de la base: nunca deja pasar", () => {
  test("la búsqueda devuelve basura (sin is_active, cadena, número, array, true…) → 401", async () => {
    for (const basura of [{}, "x", 0, false, true, [], [{ role: "ADMIN", is_active: true, email: "a@x.com" }], { role: "ADMIN", email: "a@x.com" }]  as unknown[]) {
      const set = nuevoSet();
      const r = await rechazoSiNoEsRolActivo({ id: 1, role: "ADMIN" }, set, ROLES, (async () => basura) as never);
      expect([JSON.stringify(basura), r.ok]).toEqual([JSON.stringify(basura), false]);
      expect([JSON.stringify(basura), set.status]).toEqual([JSON.stringify(basura), 401]);
    }
  });

  test("la base falla (async, síncrona, no-Error, rechazo tardío) → LANZA y el set no queda en un status de éxito engañoso", async () => {
    const modos: Array<[string, () => Promise<never>]> = [
      ["async Error", async () => { throw new Error("db caída"); }],
      ["síncrona", (() => { throw new Error("sync"); }) as never],
      ["no-Error", async () => { throw "cadena"; }],
      ["rechazo tardío", () => new Promise<never>((_, rej) => setTimeout(() => rej(new Error("tarde")), 10))],
      ["undefined", async () => { throw undefined; }],
    ];
    for (const [nombre, buscar] of modos) {
      const set = nuevoSet();
      let lanzo = false;
      let r: unknown;
      try { r = await rechazoSiNoEsRolActivo({ id: 1, role: "ADMIN" }, set, ROLES, buscar as never); } catch { lanzo = true; }
      expect([nombre, lanzo, r]).toEqual([nombre, true, undefined]);
    }
  });

  test("la base falla con token NO permitido: ni se consulta (403, no 500)", async () => {
    const { f, llamadas } = contador(() => { throw new Error("no debía llamarse"); });
    const set = nuevoSet();
    const r = await rechazoSiNoEsRolActivo({ id: 1, role: "CONTA" }, set, ROLES, f);
    expect(r.ok).toBe(false);
    expect(set.status).toBe(403);
    expect(llamadas.length).toBe(0);
  });
});

describe("identidad: el email/rol salen de la BASE, nunca del token ni del body", () => {
  test("token con email distinto en mayúsculas/espacios/otro dominio: devuelve el de la base TAL CUAL (sin normalizar)", async () => {
    for (const emailBase of ["db@clubcashin.com", "DB@ClubCashin.COM", "Db@clubcashin.com", "  espacios@x.com ", "ñandú@x.com"]) {
      for (const emailToken of ["db@clubcashin.com", "DB@CLUBCASHIN.COM", " db@clubcashin.com ", "otro@x.com", "", null, undefined, 5]) {
        const r = await rechazoSiNoEsRolActivo({ id: 3, role: "ASESOR", email: emailToken }, nuevoSet(), ROLES, contador({ email: emailBase, role: "ASESOR", is_active: true }).f);
        expect(r).toEqual({ ok: true, email: emailBase, role: "ASESOR" });
      }
    }
  });

  test("email de la base vacío / solo espacios / no-string → 401 (nadie firma sin nombre)", async () => {
    for (const email of ["", " ", "\t\n", null, undefined, 5, {}, []] as unknown[]) {
      const set = nuevoSet();
      const r = await rechazoSiNoEsRolActivo({ id: 3, role: "ASESOR" }, set, ROLES, contador({ email, role: "ASESOR", is_active: true }).f);
      expect([String(email), r.ok, set.status]).toEqual([String(email), false, 401]);
    }
  });

  test("campos del token que podrían confundirse con identidad (registerBy, usuario_id, email, user, asesor_id) no cambian a quién consulta ni qué devuelve", async () => {
    const fila = { id: 7, email: "db@clubcashin.com", role: "ASESOR", is_active: true };
    const vistos: unknown[] = [];
    const buscar = (async (id: unknown) => { vistos.push(id); return fila; }) as never;
    const user = { id: 7, role: "ASESOR", email: "x@x.com", registerBy: "otro@x.com", usuario_id: 99, user: { id: 1, email: "root@x.com", role: "ADMIN" }, asesor_id: 123, admin_id: 1 };
    const r = await rechazoSiNoEsRolActivo(user, nuevoSet(), ROLES, buscar);
    expect(r).toEqual({ ok: true, email: "db@clubcashin.com", role: "ASESOR" });
    expect(vistos).toEqual([7]);
  });

  test("dos filas con el mismo email salvo mayúsculas (el UNIQUE es sensible a mayúsculas): cada id obtiene SU fila, nunca la hermana", async () => {
    const tabla: Record<number, Fila> = {
      10: { email: "Ana@clubcashin.com", role: "ASESOR", is_active: true },
      11: { email: "ana@clubcashin.com", role: "CONTA", is_active: true },
      12: { email: "ana@clubcashin.com ", role: "ADMIN", is_active: false },
    };
    const buscar = (async (id: unknown) => tabla[Number(id)] ?? null) as never;
    expect(await rechazoSiNoEsRolActivo({ id: 10, role: "ASESOR" }, nuevoSet(), ROLES, buscar)).toEqual({ ok: true, email: "Ana@clubcashin.com", role: "ASESOR" });
    const s11 = nuevoSet();
    expect((await rechazoSiNoEsRolActivo({ id: 11, role: "ASESOR" }, s11, ROLES, buscar)).ok).toBe(false); // token viejo ASESOR, base CONTA
    expect(s11.status).toBe(403);
    const s12 = nuevoSet();
    expect((await rechazoSiNoEsRolActivo({ id: 12, role: "ADMIN" }, s12, ROLES, buscar)).ok).toBe(false); // desactivado
    expect(s12.status).toBe(401);
  });

  test("se consulta exactamente UNA vez, con el id del token sin transformar", async () => {
    for (const id of [7, "7", 0, -1, 7.5, NaN, null, undefined, "abc", [7], true]) {
      const { f, llamadas } = contador(null);
      await rechazoSiNoEsRolActivo({ id, role: "ADMIN" }, nuevoSet(), ROLES, f);
      expect(llamadas.length).toBe(1);
      expect(llamadas[0]!.length).toBe(1);
      expect(Object.is(llamadas[0]![0], id)).toBe(true);
    }
  });

  test("el gate es reutilizable: roles distintos a [ASESOR, ADMIN] (p. ej. solo ADMIN) se respetan en ambas capas", async () => {
    const fila = { email: "a@x.com", role: "ASESOR", is_active: true };
    const s = nuevoSet();
    expect((await rechazoSiNoEsRolActivo({ id: 1, role: "ASESOR" }, s, ["ADMIN"], contador(fila).f)).ok).toBe(false);
    expect(s.status).toBe(403);
    const s2 = nuevoSet();
    expect((await rechazoSiNoEsRolActivo({ id: 1, role: "ADMIN" }, s2, ["ADMIN"], contador(fila).f)).ok).toBe(false); // base ya es ASESOR
    expect(s2.status).toBe(403);
  });
});

// ───────────────────────────── traeCondonacionBoletaTardia vs gate ─────────────────────────────
describe("traeCondonacionBoletaTardia decide coherente con el gate", () => {
  const VALORES: Array<[string, unknown]> = [
    ["{}", {}], ["[]", []], ["0", 0], ["false", false], ['""', ""], ['" "', " "], ["null", null], ["undefined", undefined],
    ["NaN", NaN], ["'null'", "null"], ["'undefined'", "undefined"], ["{intentoId}", { intentoId: "x" }], ["true", true], ["función", () => 1],
  ];

  test("solo null/undefined van al camino normal; TODO lo demás (incluidos falsy) bifurca y por lo tanto pasa por el gate", () => {
    for (const [nombre, valor] of VALORES) {
      const esperado = !(valor === null || valor === undefined);
      expect([nombre, traeCondonacionBoletaTardia({ condonacionBoletaTardia: valor })]).toEqual([nombre, esperado]);
    }
  });

  test("clave ausente y cuerpos raros (undefined, null, [], '', 'str', 5, true) → camino normal sin tirar", () => {
    for (const body of [undefined, null, [], "", "condonacionBoletaTardia", 5, true, {}, { otra: 1 }, { CondonacionBoletaTardia: {} }, { condonacionboletatardia: {} }, { " condonacionBoletaTardia": {} }]) {
      expect(traeCondonacionBoletaTardia(body)).toBe(false);
    }
  });

  test("la clave heredada por prototipo cuenta (el gate y el registro leen el MISMO objeto)", () => {
    const body = Object.create({ condonacionBoletaTardia: {} });
    expect(traeCondonacionBoletaTardia(body)).toBe(true);
  });

  test("el registro lee el bloque del MISMO ctx.body: un valor que bifurca pero es inválido → 400 SIN lock ni escritura ni condonación", async () => {
    for (const [nombre, valor] of VALORES) {
      if (valor === null || valor === undefined) continue;
      const n = { conLock: 0, insert: 0, condonar: 0, anular: 0, decidir: 0 };
      const deps = {
        conLock: async () => { n.conLock++; throw new Error("no debía tomar lock"); },
        insertPayment: async () => { n.insert++; return {}; },
        condonar: async () => { n.condonar++; throw new Error("no debía condonar"); },
        anular: async () => { n.anular++; },
        decidir: async () => { n.decidir++; throw new Error("no debía decidir"); },
      } as unknown as DepsBoletaTardia;
      const set: { status?: number } = {};
      const r: any = await registrarPagoConBoletaTardia({ body: { condonacionBoletaTardia: valor, credito_id: 1 }, set }, { usuarioEmail: "db@x.com" }, deps);
      expect([nombre, set.status, r?.success]).toEqual([nombre, 400, false]);
      expect([nombre, n]).toEqual([nombre, { conLock: 0, insert: 0, condonar: 0, anular: 0, decidir: 0 }]);
    }
  });
});

// ───────────────────────────── Identidad en el registro ─────────────────────────────
describe("un body con registerBy / usuario_id / email / user / usuario_email NO cambia la identidad que firma", () => {
  const ACTOR = "Verificado@Base.com";
  const INTENTO = "00000000-0000-4000-8000-000000000042";
  const cuerpo = (extra: Record<string, unknown>) => ({
    credito_id: 5, usuario_id: 1, monto_boleta: 1000, fecha_pago: "2026-10-03", cuotaApagar: 5, url_boletas: ["b.jpg"], banco_id: 1,
    numeroAutorizacion: "A-1", registerBy: "intruso@x.com", fecha_boleta: "2026-09-30", origen_pago: "boleta",
    condonacionBoletaTardia: { intentoId: INTENTO, montoAceptado: "7.47" }, ...extra,
  });

  test("condonar() y insertPayment() reciben SOLO el email verificado, con todos los intentos de forja en el body y en ctx.user", async () => {
    const forjas = { usuario_email: "forja1@x.com", usuarioEmail: "forja2@x.com", email: "forja3@x.com", user: { email: "forja4@x.com", id: 1, role: "ADMIN" }, usuario_id_actor: 9, actor: "forja5@x.com", registerBy: "forja6@x.com" };
    const condonaciones: any[] = [];
    const inserts: any[] = [];
    const anulaciones: any[] = [];
    let filas = 0;
    const deps = {
      conLock: async (_id: number, fn: any) => fn({} as never),
      filasVivas: async () => (filas === 0 ? [] : [1]),
      condonacionViva: async () => null,
      condonacionDelIntento: async () => null,
      decidir: async () => ({ aplica: true, razon: null, fechaVencimiento: "2026-09-30", fechaBoleta: "2026-09-30", fechaRegistro: "2026-10-03", diasRetraso: 3, montoCondonar: "7.47", moraACobrar: "1.00", porCuota: [{ cuota_id: 55, numero_cuota: 5, fecha_vencimiento: "2026-09-30", monto: "7.47" }], moraActiva: "100.00" }),
      condonar: async (p: any) => { condonaciones.push(p); return { kind: "condonada", condonacion_id: 1, monto: "7.47" }; },
      insertPayment: async (c: any) => { inserts.push(c.body); filas = 1; return { success: true }; },
      evaluarAlDia: async () => ({ desactivarMora: true }),
      anular: async (p: any) => { anulaciones.push(p); },
    } as unknown as DepsBoletaTardia;
    const set: { status?: number } = {};
    const ctx: any = { body: cuerpo(forjas), set, user: { id: 1, email: "token@x.com", role: "ADMIN" } };
    const r: any = await registrarPagoConBoletaTardia(ctx, { usuarioEmail: ACTOR }, deps);
    expect(r.success).toBe(true);
    expect(condonaciones.length).toBe(1);
    expect(condonaciones[0].usuario_email).toBe(ACTOR);
    expect(condonaciones[0].motivo).toContain(ACTOR);
    for (const forja of ["forja1", "forja2", "forja3", "forja4", "forja5", "forja6", "intruso", "token@x.com"]) {
      expect(condonaciones[0].motivo).not.toContain(forja);
      expect(JSON.stringify(condonaciones[0])).not.toContain(forja);
    }
    expect(inserts.length).toBe(1);
    expect(inserts[0].registerBy).toBe(ACTOR);
    expect(anulaciones.length).toBe(0);
  });

  test("si el cuerpo no trae registerBy (obligatorio en el esquema) NO se completa con el token: 400 antes de lock y de condonar", async () => {
    const n = { conLock: 0, condonar: 0 };
    const deps = { conLock: async () => { n.conLock++; throw new Error("x"); }, condonar: async () => { n.condonar++; throw new Error("x"); } } as unknown as DepsBoletaTardia;
    const { registerBy: _quitado, ...sinRegisterBy } = cuerpo({}) as any;
    const set: { status?: number } = {};
    const r: any = await registrarPagoConBoletaTardia({ body: sinRegisterBy, set, user: { email: "token@x.com" } } as any, { usuarioEmail: ACTOR }, deps);
    expect(set.status).toBe(400);
    expect(r.success).toBe(false);
    expect(n).toEqual({ conLock: 0, condonar: 0 });
  });

  test("registerBy 'NEXA' en el body (esquema lo rechaza) no consigue firmar como el usuario de sistema: 400 sin condonar", async () => {
    for (const rb of ["NEXA", "nexa", " NEXA ", "NEXA:123"]) {
      const n = { conLock: 0, condonar: 0 };
      const deps = { conLock: async () => { n.conLock++; throw new Error("x"); }, condonar: async () => { n.condonar++; throw new Error("x"); } } as unknown as DepsBoletaTardia;
      const set: { status?: number } = {};
      await registrarPagoConBoletaTardia({ body: cuerpo({ registerBy: rb }), set } as any, { usuarioEmail: ACTOR }, deps);
      expect([rb, set.status, n.conLock, n.condonar]).toEqual([rb, 400, 0, 0]);
    }
  });
});

// ───────────────────────────── Cableado real en el router (base inalcanzable) ─────────────────────────────
describe("router real con base INALCANZABLE: 403 sin tocar la base; permitido + base caída → 500 (nunca pasa)", () => {
  process.env.JWT_SECRET ||= "supersecreto";
  const SECRET = process.env.JWT_SECRET!;
  const firmar = (payload: Record<string, unknown>, opciones: jwt.SignOptions = {}) => jwt.sign(payload, SECRET, opciones);
  const BLOQUE_VALIDO = { intentoId: "00000000-0000-4000-8000-000000000001", montoAceptado: "1.00" };
  const post = async (ruta: string, body: unknown, token?: string, headers: Record<string, string> = {}) => {
    const { paymentRouter } = await import("./payments");
    const res = await paymentRouter.handle(new Request(`http://localhost${ruta}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }));
    return { status: res.status, texto: await res.text() };
  };

  test("sin token / token basura / firmado con otro secreto / alg none / expirado → 401 en /newPayment con bloque y en preview", async () => {
    const otro = jwt.sign({ id: 7, role: "ADMIN" }, "otro-secreto");
    const sinFirma = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from('{"id":7,"role":"ADMIN","email":"x@x.com"}').toString("base64url")}.`;
    const expirado = firmar({ id: 7, role: "ADMIN" }, { expiresIn: -10 });
    for (const t of [undefined, "basura", otro, sinFirma, expirado]) {
      for (const ruta of ["/newPayment", "/pagos/boleta-tardia/preview"]) {
        const r = await post(ruta, { condonacionBoletaTardia: BLOQUE_VALIDO, credito_id: 1 }, t);
        expect([ruta, String(t).slice(0, 12), r.status]).toEqual([ruta, String(t).slice(0, 12), 401]);
      }
    }
  });

  test("CONTA / INVESTOR / sin rol con CUALQUIER valor no-null de la casilla → 403 (la base inalcanzable no se toca: si se tocara sería 500)", async () => {
    const valores: unknown[] = [{}, [], 0, false, "", " ", true, "x", BLOQUE_VALIDO, { intentoId: 5 }];
    for (const role of ["CONTA", "INVESTOR", "", undefined, "asesor", "ROOT"]) {
      const t = firmar({ id: 7, role, email: "token@x.com" });
      for (const v of valores) {
        const r = await post("/newPayment", { condonacionBoletaTardia: v, credito_id: 1 }, t);
        expect([String(role), JSON.stringify(v), r.status]).toEqual([String(role), JSON.stringify(v), 403]);
      }
      const p = await post("/pagos/boleta-tardia/preview", { credito_id: 1, monto_boleta: 1, fecha_boleta: "2026-10-01" }, t);
      expect([String(role), p.status]).toEqual([String(role), 403]);
    }
  });

  test("ASESOR/ADMIN por token + base caída → 500 en las dos rutas (falla CERRADO: ni 200, ni 400 de validación, ni 409)", async () => {
    for (const role of ["ASESOR", "ADMIN"]) {
      const t = firmar({ id: 7, role, email: "token@x.com" });
      for (const v of [BLOQUE_VALIDO, {}, "x", false, 0, ""]) {
        const r = await post("/newPayment", { condonacionBoletaTardia: v, credito_id: 1 }, t);
        expect([role, JSON.stringify(v), r.status]).toEqual([role, JSON.stringify(v), 500]);
      }
      const p = await post("/pagos/boleta-tardia/preview", { credito_id: 1, monto_boleta: 1, fecha_boleta: "2026-10-01" }, t);
      expect([role, p.status]).toEqual([role, 500]);
    }
  });

  test("preview: CONTA con body válido → 403; con body inválido Elysia valida el esquema antes del handler (422): no revela nada, pero tampoco pasa", async () => {
    const t = firmar({ id: 7, role: "CONTA" });
    const valido = await post("/pagos/boleta-tardia/preview", { credito_id: 1, monto_boleta: 1, fecha_boleta: "2026-10-01" }, t);
    expect(valido.status).toBe(403);
    const invalido = await post("/pagos/boleta-tardia/preview", { basura: true }, t);
    expect([403, 422]).toContain(invalido.status);
    expect(invalido.texto).not.toContain("success\":true");
  });

  test("content-types raros no esquivan el gate: la clave que Elysia ve con CONTA siempre da 403; si no la ve, no hay condonación posible", async () => {
    const t = firmar({ id: 7, role: "CONTA" });
    const urlenc = await post("/newPayment", "condonacionBoletaTardia=x&credito_id=1", t, { "content-type": "application/x-www-form-urlencoded" });
    const proto = await post("/newPayment", '{"__proto__":{"condonacionBoletaTardia":{}},"credito_id":1}', t);
    const dup = await post("/newPayment", '{"condonacionBoletaTardia":null,"condonacionBoletaTardia":{}}', t);
    // 403 si el parser entregó la clave; si no la entregó, cae al camino normal (no condona; la base inalcanzable → 4xx/5xx). Nunca 200.
    for (const r of [urlenc, proto, dup]) expect(r.status).not.toBe(200);
    expect(dup.status).toBe(403); // JSON.parse: gana la última, es un objeto → bifurca y exige rol
    expect(urlenc.status).toBe(403);
  });
});

// ───────────────────────────── Contratos sobre el fuente: no hay otra puerta ─────────────────────────────
describe("no existe otra ruta que llegue a condonar por boleta tardía sin pasar por el gate", () => {
  const SRC = new URL("../", import.meta.url).pathname;
  const archivos = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) return n === "node_modules" ? [] : archivos(p);
      return p.endsWith(".ts") ? [p] : [];
    });
  const todos = archivos(SRC).filter((p) => !/\.(test|exhaustivo\.test|integration\.test)\.ts$/.test(p) && !p.endsWith(".probe.ts"));
  const quienes = (re: RegExp) => todos.filter((p) => re.test(readFileSync(p, "utf8"))).map((p) => relative(SRC, p)).sort();

  test("registrarPagoConBoletaTardia: solo su definición y el router de pagos", () => {
    expect(quienes(/registrarPagoConBoletaTardia/)).toEqual(["controllers/boletaTardia.ts", "routers/payments.ts"]);
  });

  test("el origen CONDONACION_BOLETA_TARDIA solo lo emiten latefee (mecanismo), el schema, el helper de pruebas y boletaTardia; Nexa y los routers no", () => {
    const f = quienes(/CONDONACION_BOLETA_TARDIA/);
    expect(f).toEqual(["controllers/boletaTardia.ts", "controllers/boletaTardiaTestDb.ts", "controllers/latefee.ts", "database/db/schema.ts"]);
  });

  test("condonarMoraDeCuotas: ningún router ni script lo llama; el único llamador con intento_id es boletaTardia", () => {
    const f = quienes(/condonarMoraDeCuotas/);
    expect(f.filter((x) => x.startsWith("routers/") || x.startsWith("scripts/"))).toEqual([]);
    expect(f).toEqual(["controllers/boletaTardia.ts", "controllers/boletaTardiaTestDb.ts", "controllers/latefee.ts", "controllers/nexaPaymentRuntime.ts"]);
    expect(readFileSync(join(SRC, "controllers/nexaPaymentRuntime.ts"), "utf8")).not.toMatch(/intento_id|BOLETA_TARDIA/);
  });

  test("boletaTardiaIntentoId (la opción que hace que insertPayment marque filas) solo la pasa boletaTardia; el cuerpo HTTP nunca llega ahí", () => {
    expect(quienes(/boletaTardiaIntentoId/)).toEqual(["controllers/boletaTardia.ts", "controllers/registerPayment.ts", "database/db/schema.ts"]);
    const rp = readFileSync(join(SRC, "controllers/registerPayment.ts"), "utf8");
    const i = rp.indexOf("boletaTardiaIntentoId", rp.indexOf("export async function insertPayment"));
    const firma = rp.slice(i - 400, i + 300);
    expect(firma).not.toMatch(/body\??\.boletaTardiaIntentoId|body\??\.condonacionBoletaTardia/);
  });

  test("ningún lugar fuera de boletaTardia y de la política de campos obligatorios lee el bloque 'condonacionBoletaTardia' del cuerpo", () => {
    const f = quienes(/condonacionBoletaTardia/);
    expect(f).toEqual(["controllers/boletaTardia.ts", "controllers/registerPaymentPolicy.ts"]);
    const rp = readFileSync(join(SRC, "controllers/registerPaymentPolicy.ts"), "utf8");
    const lecturas = [...rp.matchAll(/.*condonacionBoletaTardia.*/g)].map((m) => m[0]);
    expect(lecturas.every((l) => l.trim().startsWith("/**") || l.trim().startsWith("*") || l.trim().startsWith("//"))).toBe(true);
    const ip = readFileSync(join(SRC, "controllers/registerPayment.ts"), "utf8");
    expect(ip).not.toContain("condonacionBoletaTardia");
  });

  test("el handler de /newPayment: traeCondonacion → gate → registro, en ese orden, y el gate no depende de ningún dato del body", () => {
    const src = readFileSync(join(SRC, "routers/payments.ts"), "utf8");
    const i = src.indexOf('.post("/newPayment"');
    const ruta = src.slice(i, src.indexOf('.post("/pagos/boleta-tardia/preview"'));
    const a = ruta.indexOf("traeCondonacionBoletaTardia(ctx.body)");
    const g = ruta.indexOf("rechazoSiNoEsRolActivo(");
    const r = ruta.indexOf("registrarPagoConBoletaTardia(");
    expect(a).toBeGreaterThan(-1);
    expect(g).toBeGreaterThan(a);
    expect(r).toBeGreaterThan(g);
    const llamadaGate = ruta.slice(g, ruta.indexOf(")", g) + 1);
    expect(llamadaGate).toBe('rechazoSiNoEsRolActivo(ctx.user, ctx.set, ["ASESOR", "ADMIN"])');
    // El único return antes del gate es el camino normal; el único camino que invoca registrar es el que sigue al `if (!sesion.ok)`.
    expect(ruta.slice(0, g).match(/return /g)!.length).toBe(1);
    expect(ruta.slice(g, r)).toContain("if (!sesion.ok) return sesion.body;");
    expect(ruta.match(/registrarPagoConBoletaTardia\(/g)!.length).toBe(1);
    // gate sin try/catch que se trague un fallo de base
    expect(ruta).not.toMatch(/catch/);
  });

  test("el preview: el gate precede a cualquier lectura del body y a vistaPreviaBoletaTardia", () => {
    const src = readFileSync(join(SRC, "routers/payments.ts"), "utf8");
    const i = src.indexOf('.post("/pagos/boleta-tardia/preview"');
    const ruta = src.slice(i, i + 700);
    const cuerpoHandler = ruta.slice(ruta.indexOf("=> {") + 4);
    const g = cuerpoHandler.indexOf("rechazoSiNoEsRolActivo(");
    expect(g).toBeGreaterThan(-1);
    expect(g).toBeLessThan(cuerpoHandler.indexOf("vistaPreviaBoletaTardia("));
    expect(cuerpoHandler.slice(0, g)).not.toMatch(/\bbody\b/);
  });

  test("midleware: el gate no tiene try/catch que convierta un fallo de base en 'permitido', y su única consulta es findSessionUser por defecto", () => {
    const src = readFileSync(join(SRC, "routers/midleware.ts"), "utf8");
    const i = src.indexOf("export async function rechazoSiNoEsRolActivo");
    const cuerpo = src.slice(i);
    expect(cuerpo).not.toMatch(/catch\s*[({]/);
    expect(cuerpo).toContain("= findSessionUser");
    expect(cuerpo.match(/return \{ ok: true/g)!.length).toBe(1);
  });
});
