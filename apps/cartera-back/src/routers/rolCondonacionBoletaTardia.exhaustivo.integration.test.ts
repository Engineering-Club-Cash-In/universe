import { afterAll, beforeAll, describe, expect, spyOn } from "bun:test";
import jwt from "jsonwebtoken";
import {
  cerrarEsquemaBoletaTardia, integrationTest as it, levantarEsquemaBoletaTardia, uuidIntento, type Entorno,
} from "../controllers/boletaTardiaTestDb";
process.env.URL_PUBLIC_R2 = "https://pub-test.r2.dev/payments-receipts/"; // la condonación exige que la boleta sea una llave del bucket

/**
 * Tarea 7, caja negra contra Postgres real (fixture de boletaTardia): el router REAL (`paymentRouter.handle`) con
 * tokens firmados y filas reales de platform_users. Cada `*.integration.test.ts` va en su PROPIO `bun test`.
 */
process.env.JWT_SECRET ||= "supersecreto";
const SECRET = process.env.JWT_SECRET!;
afterAll(cerrarEsquemaBoletaTardia);

let env: Entorno;
let router: typeof import("./payments")["paymentRouter"];
const ids: Record<string, number> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const firmar = (p: Record<string, unknown>) => jwt.sign(p, SECRET);
const BLOQUE_INVALIDO = {}; // bifurca (≠ null) pero no valida: si el gate PASA → 400; si rechaza → 401/403
const CUERPO_COMPLETO = (credito: number, intento = uuidIntento(900 + credito)) => ({
  credito_id: credito, usuario_id: 1, monto_boleta: 1000, fecha_pago: "2020-01-05", cuotaApagar: 5, url_boletas: ["00000000-0000-4000-8000-000000000001.jpg"], banco_id: 1,
  numeroAutorizacion: `A-${credito}`, registerBy: "intruso@x.com", fecha_boleta: "2020-01-01", origen_pago: "boleta",
  condonacionBoletaTardia: { intentoId: intento, montoAceptado: "1.00" },
});

const llamar = async (ruta: string, body: unknown, token?: string) => {
  const res = await router.handle(new Request(`http://localhost${ruta}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }));
  return { status: res.status, texto: await res.text() };
};
const tokenDe = (clave: string, extra: Record<string, unknown> = {}) =>
  firmar({ id: ids[clave], email: "token-ignorado@x.com", role: "ASESOR", ...extra });

const conteos = async () => {
  const { sql } = env;
  const [p] = await sql`SELECT count(*)::int AS n FROM cartera.pagos_credito`;
  const [c] = await sql`SELECT count(*)::int AS n FROM cartera.moras_condonaciones`;
  const [h] = await sql`SELECT count(*)::int AS n FROM cartera.moras_historial`;
  const [l] = await sql`SELECT count(*)::int AS n FROM cartera.mora_pagada_cuota`;
  const moras = await sql`SELECT credito_id, monto_mora::text FROM cartera.moras_credito ORDER BY credito_id`;
  return JSON.stringify({ pagos: p!.n, condonaciones: c!.n, historial: h!.n, ledger: l!.n, moras });
};

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) return;
  env = await levantarEsquemaBoletaTardia();
  router = (await import("./payments")).paymentRouter;
  const { sql } = env;
  // El esquema mínimo del fixture no trae las columnas que `findSessionUser` proyecta: se agregan (solo en esta base de pruebas).
  await sql`ALTER TABLE cartera.platform_users ADD COLUMN IF NOT EXISTS admin_id integer, ADD COLUMN IF NOT EXISTS asesor_id integer, ADD COLUMN IF NOT EXISTS conta_id integer`;
  const filas: Array<[string, string, string, boolean]> = [
    ["asesor", "asesor.vigente@clubcashin.test", "ASESOR", true],
    ["admin", "admin.vigente@clubcashin.test", "ADMIN", true],
    ["conta", "conta@clubcashin.test", "CONTA", true],
    ["inversionista", "inv@clubcashin.test", "INVESTOR", true],
    ["asesorInactivo", "asesor.inactivo@clubcashin.test", "ASESOR", false],
    ["adminInactivo", "admin.inactivo@clubcashin.test", "ADMIN", false],
    ["rolMinuscula", "minuscula@clubcashin.test", "asesor", true],
    ["rolConEspacio", "espacio@clubcashin.test", "ASESOR ", true],
    ["mixtoA", "Mixto@ClubCashin.test", "ASESOR", true],
    ["mixtoB", "mixto@clubcashin.test", "CONTA", true],
    ["conEspacios", "  pad@clubcashin.test ", "ASESOR", true],
  ];
  for (const [clave, email, role, activo] of filas) {
    const [r] = await sql`INSERT INTO cartera.platform_users (email, password_hash, role, is_active) VALUES (${email}, '!sin-login', ${role}, ${activo}) RETURNING id`;
    ids[clave] = r!.id;
  }
});

describe("router real + platform_users real", () => {
  it("matriz token × base: solo ASESOR/ADMIN activos (por token Y por base) llegan a validar el bloque (400); el resto 401/403; NADA se escribe", async () => {
    const antes = await conteos();
    // [clave de la fila, rol que dice el token, status esperado]
    const casos: Array<[string, string, number]> = [
      ["asesor", "ASESOR", 400], ["admin", "ADMIN", 400], ["asesor", "ADMIN", 400], ["admin", "ASESOR", 400], // el token puede estar viejo pero la base manda
      ["asesor", "CONTA", 403], ["conta", "CONTA", 403], ["conta", "ASESOR", 403], ["conta", "ADMIN", 403], // token viejo ASESOR, base ya CONTA
      ["inversionista", "ASESOR", 403], ["inversionista", "INVESTOR", 403],
      ["asesorInactivo", "ASESOR", 401], ["adminInactivo", "ADMIN", 401],
      ["rolMinuscula", "ASESOR", 403], ["rolConEspacio", "ASESOR", 403], ["asesor", "asesor", 403], ["asesor", "", 403],
    ];
    for (const [clave, rolToken, esperado] of casos) {
      const r = await llamar("/newPayment", { condonacionBoletaTardia: BLOQUE_INVALIDO, credito_id: 3 }, tokenDe(clave, { role: rolToken }));
      expect([clave, rolToken, r.status]).toEqual([clave, rolToken, esperado]);
      if (esperado !== 400) expect(r.texto).not.toContain('"success":true');
    }
    expect(await conteos()).toBe(antes);
  });

  it("usuario inexistente / id inválido en el token → 401 (o 403 si el rol ni siquiera es permitido); nunca pasa", async () => {
    const antes = await conteos();
    for (const id of [999999, 0, -1, 7.5, "abc", "7abc", null, undefined, NaN, {}, [], "", " ", "1e9", Number.MAX_SAFE_INTEGER]) {
      const r = await llamar("/newPayment", { condonacionBoletaTardia: BLOQUE_INVALIDO, credito_id: 3 }, firmar({ id, role: "ASESOR", email: "asesor.vigente@clubcashin.test" }));
      // Un id fuera del rango de int4 lo rechaza Postgres: 500 también es falla CERRADA (no pasa); el resto, 401.
      expect([String(id), id === Number.MAX_SAFE_INTEGER ? [401, 500].includes(r.status) : r.status]).toEqual([String(id), id === Number.MAX_SAFE_INTEGER ? true : 401]);
    }
    expect(await conteos()).toBe(antes);
  });

  it("id del token como string numérico ('7') o array [7] resuelve a esa fila real (el id lo firma el servidor; solo se documenta)", async () => {
    const id = ids.asesor!;
    for (const forma of [String(id), ` ${id} `, [id]]) {
      const r = await llamar("/newPayment", { condonacionBoletaTardia: BLOQUE_INVALIDO, credito_id: 3 }, firmar({ id: forma, role: "ASESOR" }));
      expect([JSON.stringify(forma), r.status]).toEqual([JSON.stringify(forma), 400]);
    }
  });

  it("la base manda en cada petición: desactivar, bajar a CONTA, subir a ADMIN y reactivar se reflejan sin renovar el token", async () => {
    const { sql } = env;
    const t = tokenDe("asesor");
    const estado = async () => (await llamar("/newPayment", { condonacionBoletaTardia: BLOQUE_INVALIDO, credito_id: 3 }, t)).status;
    expect(await estado()).toBe(400);
    await sql`UPDATE cartera.platform_users SET is_active = false WHERE id = ${ids.asesor!}`;
    expect(await estado()).toBe(401);
    await sql`UPDATE cartera.platform_users SET is_active = true, role = 'CONTA' WHERE id = ${ids.asesor!}`;
    expect(await estado()).toBe(403);
    await sql`UPDATE cartera.platform_users SET role = 'ADMIN' WHERE id = ${ids.asesor!}`;
    expect(await estado()).toBe(400);
    await sql`UPDATE cartera.platform_users SET role = 'ASESOR' WHERE id = ${ids.asesor!}`;
    expect(await estado()).toBe(400);
    // borrar al usuario (sin FKs que lo impidan): su token deja de valer
    const [tmp] = await sql`INSERT INTO cartera.platform_users (email, password_hash, role, is_active) VALUES ('temporal@clubcashin.test', '!', 'ASESOR', true) RETURNING id`;
    const tt = firmar({ id: tmp!.id, role: "ASESOR" });
    expect((await llamar("/newPayment", { condonacionBoletaTardia: BLOQUE_INVALIDO, credito_id: 3 }, tt)).status).toBe(400);
    await sql`DELETE FROM cartera.platform_users WHERE id = ${tmp!.id}`;
    expect((await llamar("/newPayment", { condonacionBoletaTardia: BLOQUE_INVALIDO, credito_id: 3 }, tt)).status).toBe(401);
  });

  it("preview: misma matriz de permiso (revalidado contra la base) y sin escrituras", async () => {
    const antes = await conteos();
    const cuerpo = { credito_id: 3, monto_boleta: 1000, fecha_boleta: "2020-01-01" };
    for (const [clave, rol, no] of [["conta", "ASESOR", 403], ["asesorInactivo", "ASESOR", 401], ["inversionista", "ADMIN", 403], ["asesor", "CONTA", 403]] as Array<[string, string, number]>) {
      const r = await llamar("/pagos/boleta-tardia/preview", cuerpo, tokenDe(clave, { role: rol }));
      expect([clave, rol, r.status]).toEqual([clave, rol, no]);
    }
    for (const clave of ["asesor", "admin"]) {
      const r = await llamar("/pagos/boleta-tardia/preview", cuerpo, tokenDe(clave));
      expect([clave, [401, 403].includes(r.status)]).toEqual([clave, false]);
    }
    expect(await conteos()).toBe(antes);
  });

  it("401/403 NO toman el candado del crédito ni escriben: con el advisory lock del crédito ocupado responden al instante; la foto no verificada (503) tampoco; el permitido SÍ espera (control positivo)", async () => {
    const CRED = 5;
    const antes = await conteos();
    // La foto se verifica en R2 ANTES del candado. Sin R2 en local, se reemplaza el `send` del MISMO cliente que usa
    // la verificación real (no `mock.module`): rechazando → 503; aprobando → la petición sigue hasta el lock.
    const { s3 } = await import("../utils/functions/uploadsFiles");
    const r2 = spyOn(s3, "send");
    const r2Rechaza = () => r2.mockImplementation((async () => { throw Object.assign(new Error("R2 caído"), { name: "Error" }); }) as never);
    const r2Aprueba = () => r2.mockImplementation((async () => ({ ContentLength: 1234, ContentType: "image/jpeg", LastModified: new Date() })) as never);
    try {
      let pendiente: Promise<{ status: number; texto: string }> | undefined;
      let soltar!: () => void;
      const retenido = new Promise<void>((r) => (soltar = r));
      const dueno = env.lock.withPaymentAdvisoryLock(CRED, async () => {
        const tiempo = async (token: string | undefined, cuerpo: unknown = CUERPO_COMPLETO(CRED)) => {
          const t0 = Date.now();
          const r = await Promise.race([llamar("/newPayment", cuerpo, token), sleep(2500).then(() => "colgado" as const)]);
          return { r, ms: Date.now() - t0 };
        };
        const rechazados: Array<[string, string | undefined, number]> = [
          ["sin token", undefined, 401],
          ["CONTA", tokenDe("conta", { role: "CONTA" }), 403],
          ["CONTA con token ASESOR viejo", tokenDe("conta"), 403],
          ["INVESTOR", tokenDe("inversionista", { role: "INVESTOR" }), 403],
          ["ASESOR inactivo", tokenDe("asesorInactivo"), 401],
          ["ADMIN inactivo", tokenDe("adminInactivo", { role: "ADMIN" }), 401],
          ["id inexistente", firmar({ id: 999999, role: "ADMIN" }), 401],
        ];
        for (const [nombre, token, esperado] of rechazados) {
          const { r } = await tiempo(token);
          expect([nombre, r === "colgado" ? "colgado" : r.status]).toEqual([nombre, esperado]);
        }
        // los rechazados por rol ni siquiera llegan a verificar la foto en R2
        expect(r2).not.toHaveBeenCalled();
        // foto no verificada (R2 caído): 503 al instante con el lock ocupado → no lo pidió
        r2Rechaza();
        const foto = await tiempo(tokenDe("admin", { role: "ADMIN" }));
        expect(["foto no verificada", foto.r === "colgado" ? "colgado" : foto.r.status]).toEqual(["foto no verificada", 503]);
        if (foto.r !== "colgado") expect(foto.r.texto).toContain('"code":"foto_no_verificada"');
        // control positivo: con la foto aprobada, el permitido con cuerpo completo llega a pedir el lock y se queda esperando
        r2Aprueba();
        pendiente = llamar("/newPayment", CUERPO_COMPLETO(CRED), tokenDe("admin", { role: "ADMIN" }));
        const r = await Promise.race([pendiente, sleep(1200).then(() => "esperando" as const)]);
        expect(r).toBe("esperando");
        await retenido;
      });
      await sleep(2800);
      expect(await conteos()).toBe(antes); // durante el bloqueo nada se escribió
      soltar();
      await dueno;
      await pendiente; // el permitido termina (con lo que sea que diga el esquema mínimo); no importa el resultado
      expect(r2).toHaveBeenCalled();
    } finally {
      r2.mockRestore();
    }
  }, 30_000);

  it("20 peticiones paralelas con el mismo token revocado en medio: antes 400, después 401, nunca un 'pasó' tardío incoherente con la base", async () => {
    const { sql } = env;
    const [u] = await sql`INSERT INTO cartera.platform_users (email, password_hash, role, is_active) VALUES ('paralelo@clubcashin.test', '!', 'ASESOR', true) RETURNING id`;
    const t = firmar({ id: u!.id, role: "ASESOR" });
    const ronda = () => Promise.all(Array.from({ length: 20 }, () => llamar("/newPayment", { condonacionBoletaTardia: BLOQUE_INVALIDO, credito_id: 3 }, t).then((r) => r.status)));
    expect(new Set(await ronda())).toEqual(new Set([400]));
    await sql`UPDATE cartera.platform_users SET is_active = false WHERE id = ${u!.id}`;
    expect(new Set(await ronda())).toEqual(new Set([401]));
  });

  it("content-type no JSON / casillas falsy con un CONTA: nunca 200 y nada escrito", async () => {
    const antes = await conteos();
    const t = tokenDe("conta", { role: "CONTA" });
    const res = [
      await router.handle(new Request("http://localhost/newPayment", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "text/plain" }, body: JSON.stringify(CUERPO_COMPLETO(7)) })),
      await router.handle(new Request("http://localhost/newPayment", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/x-www-form-urlencoded" }, body: "condonacionBoletaTardia=x&credito_id=7" })),
      ...(await Promise.all([0, false, "", " ", []].map((v) => router.handle(new Request("http://localhost/newPayment", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify({ ...CUERPO_COMPLETO(7), condonacionBoletaTardia: v }) }))))),
    ];
    const estados = res.map((r) => r.status);
    for (const e of estados) expect(e).not.toBe(200);
    expect(estados.slice(1)).toEqual([403, 403, 403, 403, 403, 403]);
    expect(await conteos()).toBe(antes);
  });
});

describe("la identidad que firma: gate → condonarMoraDeCuotas resuelve la MISMA fila (emails casi iguales)", () => {
  it("el email de la base, tal cual (mayúsculas/espacios), resuelve usuario_id exacto: nunca la fila hermana", async () => {
    const { sql, latefee } = env;
    const gate = (await import("./midleware")).rechazoSiNoEsRolActivo;
    let n = 0;
    for (const clave of ["mixtoA", "conEspacios", "asesor", "admin"]) {
      const credito = 10 + ++n;
      const set = { status: 200 as number | undefined };
      const r = await gate({ id: ids[clave], role: "ASESOR", email: "otro@falso.com" }, set, ["ASESOR", "ADMIN"]);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const [fila] = await sql`SELECT email FROM cartera.platform_users WHERE id = ${ids[clave]!}`;
      expect(r.email).toBe(fila!.email); // byte a byte, sin trim ni lowercase
      const res = await latefee.condonarMoraDeCuotas({
        credito_id: credito, montoMoraEsperado: "119.47", monto: "7.47", cuotas: [{ cuota_id: credito * 10 + 5, monto: "7.466667" }],
        origen: "CONDONACION_BOLETA_TARDIA", intento_id: uuidIntento(500 + n), usuario_email: r.email, motivo: `prueba identidad ${clave}`,
      });
      expect(res.kind).toBe("condonada");
      const [c] = await sql`SELECT usuario_id FROM cartera.moras_condonaciones WHERE credito_id = ${credito}`;
      expect(c!.usuario_id).toBe(ids[clave]!);
    }
  });

  it("la base no admite dos filas con el MISMO email exacto (UNIQUE); las que difieren en mayúsculas/espacios son filas distintas y el gate no las confunde", async () => {
    const { sql } = env;
    let duplicado = false;
    try { await sql`INSERT INTO cartera.platform_users (email, password_hash, role, is_active) VALUES ('Mixto@ClubCashin.test', '!', 'ADMIN', true)`; } catch { duplicado = true; }
    expect(duplicado).toBe(true);
    const gate = (await import("./midleware")).rechazoSiNoEsRolActivo;
    const a = await gate({ id: ids.mixtoA, role: "ASESOR" }, { status: 200 }, ["ASESOR", "ADMIN"]);
    expect(a).toEqual({ ok: true, email: "Mixto@ClubCashin.test", role: "ASESOR" });
    const set = { status: 200 as number | undefined };
    const b = await gate({ id: ids.mixtoB, role: "ASESOR" }, set, ["ASESOR", "ADMIN"]); // hermana en minúsculas: es CONTA
    expect(b.ok).toBe(false);
    expect(set.status).toBe(403);
  });

  it("con un email que NO existe exacto en la base (p. ej. normalizado a minúsculas por un llamador) condonar LANZA y no escribe: nadie firma como otra fila", async () => {
    const { sql, latefee } = env;
    const antes = await sql`SELECT count(*)::int AS n FROM cartera.moras_condonaciones`;
    await expect(latefee.condonarMoraDeCuotas({
      credito_id: 20, montoMoraEsperado: "119.47", monto: "7.47", cuotas: [{ cuota_id: 205, monto: "7.466667" }],
      origen: "CONDONACION_BOLETA_TARDIA", intento_id: uuidIntento(600), usuario_email: "PAD@clubcashin.test", motivo: "x",
    })).rejects.toThrow();
    const despues = await sql`SELECT count(*)::int AS n FROM cartera.moras_condonaciones`;
    expect(despues[0]!.n).toBe(antes[0]!.n);
    const [m] = await sql`SELECT monto_mora::text FROM cartera.moras_credito WHERE credito_id = 20`;
    expect(m!.monto_mora).toBe("119.47");
  });
});
