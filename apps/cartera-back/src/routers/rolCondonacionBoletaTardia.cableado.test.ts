// La base se fija ANTES de cargarla (con `=`, no `??=`): este archivo prueba el "base caída", así que NUNCA puede
// apuntar a una base real aunque el .env traiga una. Si `../database` ya estaba cargado con OTRA URL (otro archivo
// de la suite lo cargó primero), no se puede cambiar: se aborta (skip ruidoso) en vez de consultar esa base.
import { describe, expect, test } from "bun:test";
import jwt from "jsonwebtoken";

const URL_FALSA = "postgres://x:x@127.0.0.1:1/x";
const URL_PREVIA = process.env.SUPABASE_DB_URL;
process.env.SUPABASE_DB_URL = URL_FALSA;
process.env.RESEND_API_KEY ??= "re_falsa_para_pruebas";
process.env.EMAIL_DOMAIN ??= "example.invalid";
const { client } = await import("../database");
// La conexión ya quedó fijada con la URL falsa: se devuelve el valor previo para no dejarla en el proceso de la suite.
if (URL_PREVIA === undefined) delete process.env.SUPABASE_DB_URL;
else process.env.SUPABASE_DB_URL = URL_PREVIA;
// Otros archivos hacen mock.module("../database") (sin `options`): tampoco es nuestra base falsa → se salta.
const baseInalcanzable = (client as unknown as { options?: { connectionString?: string } })?.options?.connectionString === URL_FALSA;
if (!baseInalcanzable) console.warn("⚠️ rolCondonacionBoletaTardia.cableado: ../database ya estaba cargado con otra URL; se SALTA para no tocar esa base");
const describeSiInalcanzable = baseInalcanzable ? describe : describe.skip;

// ───────────────────────────── Cableado real en el router (base inalcanzable) ─────────────────────────────
describeSiInalcanzable("router real con base INALCANZABLE: 403 sin tocar la base; permitido + base caída → 500 (nunca pasa)", () => {
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
