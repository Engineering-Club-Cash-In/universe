import "../utils/baseFalsaParaPruebas";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { verificarFotoBoleta, type DepsFotoBoleta } from "./boletaTardiaFoto";
import { motivoCondonacionBoletaTardia } from "../utils/motivoCondonacionBoletaTardia";
import { condonacionBoletaTardiaSchema, registrarPagoConBoletaTardia, traeCondonacionBoletaTardia, type DepsBoletaTardia } from "./boletaTardia";
process.env.URL_PUBLIC_R2 = "https://pub-test.r2.dev/payments-receipts/"; // la condonación exige que la boleta sea una llave del bucket

const explota = (nombre: string) => (() => { throw new Error(`no debía llamarse: ${nombre}`); }) as never;
const depsQueNoSeUsan: DepsBoletaTardia = {
  conLock: explota("conLock"), insertPayment: explota("insertPayment"), decidir: explota("decidir"), condonar: explota("condonar"),
  anular: explota("anular"), verificarFoto: explota("verificarFoto"), condonacionDelIntento: explota("condonacionDelIntento"), evaluarAlDia: explota("evaluarAlDia"), filasVivas: explota("filasVivas"), condonacionViva: explota("condonacionViva"),
};
const INTENTO = "00000000-0000-4000-8000-000000000001";
const cuerpo = (extra: Record<string, unknown> = {}) => ({
  credito_id: 1, usuario_id: 1, monto_boleta: 1000, fecha_pago: "2026-10-03", cuotaApagar: 5, url_boletas: ["00000000-0000-4000-8000-000000000001.jpg"],
  banco_id: 1, numeroAutorizacion: "A-1", registerBy: "asesor@x.com", fecha_boleta: "2026-09-30", origen_pago: "boleta",
  condonacionBoletaTardia: { intentoId: INTENTO, montoAceptado: "11.20" }, ...extra,
});
const correr = async (body: unknown) => {
  const set: { status?: number } = {};
  const r = await registrarPagoConBoletaTardia({ body, set }, { usuarioEmail: "asesor@x.com" }, depsQueNoSeUsan);
  return { r: r as { success?: boolean; code?: string; errors?: Record<string, string[]> }, status: set.status };
};

describe("condonacionBoletaTardiaSchema", () => {
  test("exige UUID y monto con dos decimales", () => {
    expect(condonacionBoletaTardiaSchema.safeParse({ intentoId: INTENTO, montoAceptado: "11.20" }).success).toBe(true);
    for (const malo of [
      { intentoId: "no-uuid", montoAceptado: "11.20" }, { intentoId: INTENTO, montoAceptado: "11.2" },
      { intentoId: INTENTO, montoAceptado: 11.2 }, { intentoId: INTENTO, montoAceptado: "-1.00" }, { intentoId: INTENTO },
    ]) expect(condonacionBoletaTardiaSchema.safeParse(malo).success).toBe(false);
  });
});

describe("validaciones 400 antes de tocar candados ni base", () => {
  test("bloque inválido", async () => {
    const { status } = await correr(cuerpo({ condonacionBoletaTardia: { intentoId: "x", montoAceptado: "1.00" } }));
    expect(status).toBe(400);
  });
  test("falta la boleta, el número de autorización o el banco", async () => {
    for (const faltante of [{ url_boletas: [] }, { url_boletas: ["  "] }, { numeroAutorizacion: "" }, { numeroAutorizacion: "   " }, { banco_id: undefined }]) {
      const { r, status } = await correr(cuerpo(faltante));
      expect(status).toBe(400);
      expect(r.success).toBe(false);
    }
  });
  test("la boleta debe ser una llave del bucket (no 'x', ni un enlace), y el bucket debe estar configurado", async () => {
    for (const url_boletas of [["x"], ["https://evil.example/a.jpg"], ["00000000-0000-4000-8000-000000000001.jpg", "x"]]) {
      const { r, status } = await correr(cuerpo({ url_boletas }));
      expect(status).toBe(400);
      expect(r.errors?.url_boletas?.[0]).toContain("foto de la boleta");
    }
    const previo = process.env.URL_PUBLIC_R2;
    try {
      delete process.env.URL_PUBLIC_R2;
      const { r, status } = await correr(cuerpo());
      expect(status).toBe(400);
      expect(r.errors?.url_boletas?.[0]).toContain("URL_PUBLIC_R2");
    } finally { process.env.URL_PUBLIC_R2 = previo; }
  });
  test("fecha_boleta inválida o futura (la boleta futura nunca llega a condonar)", async () => {
    for (const fecha_boleta of ["basura", "2999-01-01"]) expect((await correr(cuerpo({ fecha_boleta }))).status).toBe(400);
  });
  test("pagoSchema inválido (sin credito_id)", async () => {
    expect((await correr(cuerpo({ credito_id: undefined }))).status).toBe(400);
  });
});

describe("motivoCondonacionBoletaTardia", () => {
  test("una cuota y varias", () => {
    expect(motivoCondonacionBoletaTardia({ fechaBoleta: "2026-09-30", fechaRegistro: "2026-10-03", numerosCuota: [12], email: "a@x.com" }))
      .toBe("Boleta del 30-sep registrada el 03-oct, cuota 12, aceptada por a@x.com");
    expect(motivoCondonacionBoletaTardia({ fechaBoleta: "2026-12-01", fechaRegistro: "2027-01-02", numerosCuota: [13, 12], email: "a@x.com" }))
      .toBe("Boleta del 01-dic registrada el 02-ene, cuotas 12, 13, aceptada por a@x.com");
  });
});

describe("traeCondonacionBoletaTardia (decide si /newPayment bifurca)", () => {
  test("null o ausente = pago normal; cualquier otro valor = camino de boleta tardía", () => {
    expect(traeCondonacionBoletaTardia({})).toBe(false);
    expect(traeCondonacionBoletaTardia({ condonacionBoletaTardia: null })).toBe(false);
    expect(traeCondonacionBoletaTardia(undefined)).toBe(false);
    expect(traeCondonacionBoletaTardia({ condonacionBoletaTardia: {} })).toBe(true);
    expect(traeCondonacionBoletaTardia({ condonacionBoletaTardia: "x" })).toBe(true);
  });
});

describe("identidad del pago: registerBy sale del actor verificado, no del body", () => {
  test("body con registerBy ajeno -> insertPayment recibe el email verificado; condonación y pago a nombre del mismo actor", async () => {
    let llamadas = 0;
    const vistos: { registerBy?: unknown; actorCondonar?: unknown; actorAnular?: unknown } = {};
    const deps: DepsBoletaTardia = {
      ...depsQueNoSeUsan,
      verificarFoto: (async () => null) as never,
      conLock: (async (_id: number, fn: (l: unknown) => unknown) => fn({})) as never,
      filasVivas: (async () => (++llamadas === 1 ? [] : [99])) as never,
      condonacionViva: (async () => null) as never,
      decidir: (async () => ({ aplica: true, montoCondonar: "11.20", moraActiva: "20.00", porCuota: [{ cuota_id: 1, numero_cuota: 5, monto: "11.20" }], fechaRegistro: "2026-10-13" })) as never,
      condonar: (async (p: { usuario_email: string }) => { vistos.actorCondonar = p.usuario_email; return { kind: "condonada", condonacion_id: 3, monto: "11.20" }; }) as never,
      insertPayment: (async (ctx: { body: { registerBy?: unknown } }) => { vistos.registerBy = ctx.body.registerBy; return { success: true }; }) as never,
      evaluarAlDia: (async () => ({ desactivarMora: true })) as never,
    };
    const body = cuerpo({ registerBy: "otro@x.com" });
    const set: { status?: number } = {};
    await registrarPagoConBoletaTardia({ body, set }, { usuarioEmail: "db@clubcashin.com" }, deps);
    expect(vistos.registerBy).toBe("db@clubcashin.com");
    expect(vistos.actorCondonar).toBe("db@clubcashin.com");
  });
});

describe("500 al condonar: no filtra el detalle del error (Drizzle trae consulta y parámetros)", () => {
  test("el cliente recibe un mensaje genérico; el detalle va solo al log", async () => {
    const secreto = 'Failed query: select "x" from cartera.creditos params: 12345,secreto@x.com';
    const deps: DepsBoletaTardia = {
      ...depsQueNoSeUsan,
      verificarFoto: (async () => null) as never,
      conLock: (async (_id: number, fn: (l: unknown) => unknown) => fn({})) as never,
      filasVivas: (async () => []) as never,
      condonacionViva: (async () => null) as never,
      decidir: (async () => { throw new Error(secreto); }) as never,
    };
    const logs: string[] = [];
    const origError = console.error, origWarn = console.warn, origLog = console.log;
    console.error = console.warn = console.log = ((...a: unknown[]) => { logs.push(a.map(String).join(" ")); }) as never;
    const set: { status?: number } = {};
    let r: unknown;
    try {
      r = await registrarPagoConBoletaTardia({ body: cuerpo(), set }, { usuarioEmail: "asesor@x.com" }, deps);
    } finally {
      console.error = origError; console.warn = origWarn; console.log = origLog;
    }
    expect(set.status).toBe(500);
    expect((r as { success: boolean }).success).toBe(false);
    expect(JSON.stringify(r)).not.toContain("secreto");
    expect(JSON.stringify(r)).not.toContain("Failed query");
    expect(logs.join("\n")).toContain("Failed query");
  });
});

describe("la foto de la boleta se verifica en R2 ANTES del candado", () => {
  const sinLock = (verificarFoto: DepsBoletaTardia["verificarFoto"], vistos: unknown[] = []): DepsBoletaTardia => ({
    ...depsQueNoSeUsan, verificarFoto: (async (e: unknown) => { vistos.push(e); return verificarFoto(e as never); }) as never,
  });
  test("foto rechazada (400): validación en url_boletas, sin tomar el lock ni condonar", async () => {
    const set: { status?: number } = {};
    const r: any = await registrarPagoConBoletaTardia({ body: cuerpo(), set }, { usuarioEmail: "a@x.com" }, sinLock(async () => ({ status: 400, message: "La foto de la boleta ya se usó en otro pago.", motivo: "reusada" })));
    expect(set.status).toBe(400);
    expect(r.errors.url_boletas).toEqual(["La foto de la boleta ya se usó en otro pago."]);
  });
  test("R2 sin responder (503): mensaje claro y nada se escribe", async () => {
    const set: { status?: number } = {};
    const r: any = await registrarPagoConBoletaTardia({ body: cuerpo(), set }, { usuarioEmail: "a@x.com" }, sinLock(async () => ({ status: 503, message: "No se pudo verificar la foto de la boleta; intente de nuevo o registre sin condonación", motivo: "error_r2" })));
    expect(set.status).toBe(503);
    expect(r).toEqual({ success: false, code: "foto_no_verificada", message: "No se pudo verificar la foto de la boleta; intente de nuevo o registre sin condonación" });
  });
  test("recibe crédito, intento y las llaves tal cual llegaron", async () => {
    const vistos: unknown[] = [];
    await registrarPagoConBoletaTardia({ body: cuerpo(), set: {} }, { usuarioEmail: "a@x.com" }, sinLock(async () => ({ status: 400, message: "x", motivo: "reusada" }), vistos));
    expect(vistos).toEqual([{ credito_id: 1, intento_id: INTENTO, llaves: ["00000000-0000-4000-8000-000000000001.jpg"] }]);
  });
  test("las validaciones de forma (400) corren antes y no gastan una llamada a R2", async () => {
    const vistos: unknown[] = [];
    await registrarPagoConBoletaTardia({ body: cuerpo({ url_boletas: ["x"] }), set: {} }, { usuarioEmail: "a@x.com" }, sinLock(async () => null, vistos));
    expect(vistos).toEqual([]);
  });
  test("todo rechazo (400) y todo 503 deja un log estructurado con el motivo, sin secretos", async () => {
    const LLAVE = "00000000-0000-4000-8000-000000000001.jpg";
    const ahora = new Date("2026-10-13T20:00:00Z");
    const buena = { ContentLength: 10, ContentType: "image/jpeg", LastModified: new Date(ahora.getTime() - 3_600_000) };
    const noExiste = Object.assign(new Error("https://x?X-Amz-Signature=SECRETO"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
    const casos: [string, Partial<DepsFotoBoleta>, number, string, string][] = [
      ["no_existe", { head: async () => { throw noExiste; } }, 400, "foto_rechazada", "NotFound"],
      ["vacia", { head: async () => ({ ...buena, ContentLength: 0 }) }, 400, "foto_rechazada", "image/jpeg"],
      ["tipo_invalido", { head: async () => ({ ...buena, ContentType: "text/html" }) }, 400, "foto_rechazada", "text/html"],
      ["vieja", { head: async () => ({ ...buena, LastModified: new Date("2026-01-01T00:00:00Z") }) }, 400, "foto_rechazada", "2026-01-01"],
      ["reusada", { llavesYaUsadas: async () => [LLAVE] }, 400, "foto_rechazada", LLAVE],
      ["error_r2", { head: async () => { throw Object.assign(new Error("SECRETO"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } }); } }, 503, "foto_no_verificada", "AccessDenied"],
      ["timeout", { head: (_k, signal) => new Promise((_r, rej) => signal.addEventListener("abort", () => rej(new Error("SECRETO")))), timeoutMs: 20 }, 503, "foto_no_verificada", "SECRETO"],
      ["error_base", { llavesYaUsadas: async () => { throw new Error("SECRETO"); } }, 503, "foto_no_verificada", "SECRETO"],
    ];
    const original = console.error;
    try {
      for (const [motivo, ajuste, status, evento, pista] of casos) {
        const logs: string[] = [];
        console.error = (m: string) => { logs.push(String(m)); };
        const fotoDeps: DepsFotoBoleta = { head: async () => buena, llavesYaUsadas: async () => [], ahora: () => ahora, ...ajuste };
        const set: { status?: number } = {};
        await registrarPagoConBoletaTardia({ body: cuerpo(), set }, { usuarioEmail: "a@x.com" }, sinLock((e) => verificarFotoBoleta(e, fotoDeps)));
        expect([motivo, set.status]).toEqual([motivo, status]);
        expect(logs).toHaveLength(1);
        const l = JSON.parse(logs[0]);
        expect(l).toMatchObject({ level: "error", event: `boleta_tardia.${evento}`, credito_id: 1, intento_id: INTENTO, motivo });
        if (motivo !== "error_base") expect(l.llave).toBe(LLAVE);
        if (motivo === "timeout" || motivo === "error_base") expect(pista === "SECRETO").toBe(true);
        else expect(logs[0]).toContain(pista);
        expect(logs[0]).not.toContain("SECRETO");
        expect(logs[0]).not.toContain("X-Amz");
      }
    } finally { console.error = original; }
  });
  test("un pago SIN el bloque no pasa por esta ruta: la verificación vive solo en boletaTardia.ts", () => {
    expect(traeCondonacionBoletaTardia({ url_boletas: ["x"] })).toBe(false);
    expect(traeCondonacionBoletaTardia({ condonacionBoletaTardia: null })).toBe(false);
    const quienes = ["registerPayment.ts", "registerPaymentPolicy.ts", "../routers/payments.ts"].filter((f) => /boletaTardiaFoto/.test(readFileSync(new URL(f, import.meta.url), "utf8")));
    expect(quienes).toEqual([]);
  });
});
