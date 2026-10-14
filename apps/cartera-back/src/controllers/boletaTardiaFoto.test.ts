import "../utils/baseFalsaParaPruebas";
import { describe, expect, test } from "bun:test";
import { verificarFotoBoleta, type DepsFotoBoleta, type HeadFoto } from "./boletaTardiaFoto";

const AHORA = new Date("2026-10-13T20:00:00Z");
const LLAVE = "00000000-0000-4000-8000-000000000001.jpg";
const INTENTO = "00000000-0000-4000-8000-0000000000aa";
const entrada = (llaves = [LLAVE]) => ({ credito_id: 1, intento_id: INTENTO, llaves });
const horasAtras = (h: number) => new Date(AHORA.getTime() - h * 3_600_000);
const buena = { ContentLength: 12345, ContentType: "image/jpeg", LastModified: horasAtras(1) };
const arma = (head: HeadFoto, extra: Partial<DepsFotoBoleta> = {}): DepsFotoBoleta => ({
  head, llavesYaUsadas: async () => [], ahora: () => AHORA, timeoutMs: 50, ...extra,
});
const noExiste = () => Object.assign(new Error("no key"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });

describe("verificarFotoBoleta", () => {
  test("foto reciente, con bytes y de tipo imagen/pdf: pasa", async () => {
    for (const ContentType of ["image/jpeg", "image/png", "application/pdf"]) {
      expect(await verificarFotoBoleta(entrada(), arma(async () => ({ ...buena, ContentType })))).toBeNull();
    }
  });
  test("pregunta por la llave tal cual (la misma que escribió la subida)", async () => {
    const vistas: string[] = [];
    await verificarFotoBoleta(entrada(), arma(async (k) => { vistas.push(k); return buena; }));
    expect(vistas).toEqual([LLAVE]);
  });
  test("no existe en R2: 400 pidiendo subirla de nuevo", async () => {
    const r = await verificarFotoBoleta(entrada(), arma(async () => { throw noExiste(); }));
    expect(r?.status).toBe(400);
    expect(r?.message).toContain("no se encontró");
  });
  test("vacía, sin tamaño, tipo inválido, sin tipo, vieja o sin fecha: 400", async () => {
    const malas = [
      { ...buena, ContentLength: 0 }, { ...buena, ContentLength: undefined }, { ...buena, ContentType: "text/html" },
      { ...buena, ContentType: "application/octet-stream" }, { ...buena, ContentType: undefined },
      { ...buena, LastModified: horasAtras(24.01) }, { ...buena, LastModified: horasAtras(24 * 30) }, { ...buena, LastModified: undefined },
    ];
    for (const head of malas) {
      const r = await verificarFotoBoleta(entrada(), arma(async () => head));
      expect([JSON.stringify(head), r?.status]).toEqual([JSON.stringify(head), 400]);
    }
  });
  test("justo en el límite de 24 h pasa", async () => {
    expect(await verificarFotoBoleta(entrada(), arma(async () => ({ ...buena, LastModified: horasAtras(24) })))).toBeNull();
  });
  test("error de red o de permisos de R2: falla cerrado con 503 y el mensaje de reintento", async () => {
    for (const error of [new Error("ECONNRESET"), Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } })]) {
      const r = await verificarFotoBoleta(entrada(), arma(async () => { throw error; }));
      expect(r?.status).toBe(503);
      expect(r?.message).toBe("No se pudo verificar la foto de la boleta; intente de nuevo o registre sin condonación");
    }
  });
  test("R2 colgado: el timeout corta y responde 503", async () => {
    const t0 = Date.now();
    const r = await verificarFotoBoleta(entrada(), arma((_k, signal) => new Promise((_res, rej) => signal.addEventListener("abort", () => rej(new Error("abortado")))), { timeoutMs: 30 }));
    expect(r?.status).toBe(503);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  test("con varias fotos TODAS deben pasar; una mala rechaza", async () => {
    const otra = "00000000-0000-4000-8000-000000000002.png";
    const r = await verificarFotoBoleta(entrada([LLAVE, otra]), arma(async (k) => (k === otra ? { ...buena, ContentLength: 0 } : buena)));
    expect(r?.status).toBe(400);
  });
  test("una llave repetida en el mismo pedido se consulta una sola vez", async () => {
    let n = 0;
    await verificarFotoBoleta(entrada([LLAVE, LLAVE]), arma(async () => { n++; return buena; }));
    expect(n).toBe(1);
  });
  test("llave ya usada por OTRO pago vivo: 400, y ni se consulta R2", async () => {
    let n = 0;
    const r = await verificarFotoBoleta(entrada(), arma(async () => { n++; return buena; }, { llavesYaUsadas: async () => [LLAVE] }));
    expect(r?.status).toBe(400);
    expect(r?.message).toContain("ya se usó");
    expect(n).toBe(0);
  });
  test("la consulta de reuso recibe crédito, intento y llaves (para excluir al mismo intento)", async () => {
    const vistas: unknown[] = [];
    await verificarFotoBoleta(entrada(), arma(async () => buena, { llavesYaUsadas: async (...a) => { vistas.push(a); return []; } }));
    expect(vistas).toEqual([[1, INTENTO, [LLAVE]]]);
  });
  test("si la consulta de reuso falla: falla cerrado con 503", async () => {
    const r = await verificarFotoBoleta(entrada(), arma(async () => buena, { llavesYaUsadas: async () => { throw new Error("db caída"); } }));
    expect(r?.status).toBe(503);
  });
});
