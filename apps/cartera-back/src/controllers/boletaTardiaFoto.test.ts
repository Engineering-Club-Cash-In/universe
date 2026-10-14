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
    expect(r?.motivo).toBe("no_existe");
    expect(r?.llave).toBe(LLAVE);
    expect(r?.message).toContain("no se encontró");
  });
  test("vacía, sin tamaño, tipo inválido, vieja o sin fecha: 400 con su motivo y el detalle recibido", async () => {
    const malas: [Record<string, unknown>, string][] = [
      [{ ...buena, ContentLength: 0 }, "vacia"], [{ ...buena, ContentLength: undefined }, "vacia"], [{ ...buena, ContentType: "text/html" }, "tipo_invalido"],
      [{ ...buena, LastModified: horasAtras(24.01) }, "vieja"], [{ ...buena, LastModified: horasAtras(24 * 30) }, "vieja"], [{ ...buena, LastModified: undefined }, "vieja"],
    ];
    for (const [head, motivo] of malas) {
      const r = await verificarFotoBoleta(entrada(), arma(async () => head));
      expect([JSON.stringify(head), r?.status, r?.motivo]).toEqual([JSON.stringify(head), 400, motivo]);
      expect(r?.detalle).toHaveProperty("content_type");
    }
  });
  test("tipo octet-stream o ausente: solo vale si la llave termina en jpg/jpeg/png/pdf (sin importar mayúsculas)", async () => {
    for (const ContentType of ["application/octet-stream", undefined, ""]) {
      for (const ext of ["jpg", "jpeg", "png", "pdf", "JPG", "PdF"]) {
        const k = `00000000-0000-4000-8000-000000000001.${ext}`;
        expect(await verificarFotoBoleta(entrada([k]), arma(async () => ({ ...buena, ContentType })))).toBeNull();
      }
      for (const k of ["00000000-0000-4000-8000-000000000001.exe", "00000000-0000-4000-8000-000000000001.html", "00000000-0000-4000-8000-000000000001"]) {
        const r = await verificarFotoBoleta(entrada([k]), arma(async () => ({ ...buena, ContentType })));
        expect([k, r?.status, r?.motivo]).toEqual([k, 400, "tipo_invalido"]);
        expect(r?.message).toBe("La foto de la boleta debe ser una imagen (.jpg, .jpeg, .png) o un PDF.");
      }
    }
    // Un tipo explícito inválido no se salva por la extensión.
    expect((await verificarFotoBoleta(entrada(), arma(async () => ({ ...buena, ContentType: "text/html" }))))?.motivo).toBe("tipo_invalido");
  });
  test("justo en el límite de 24 h pasa", async () => {
    expect(await verificarFotoBoleta(entrada(), arma(async () => ({ ...buena, LastModified: horasAtras(24) })))).toBeNull();
  });
  test("error de red o de permisos de R2: falla cerrado con 503 y el mensaje de reintento", async () => {
    for (const error of [new Error("ECONNRESET"), Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } })]) {
      const r = await verificarFotoBoleta(entrada(), arma(async () => { throw error; }));
      expect(r?.status).toBe(503);
      expect(r?.motivo).toBe("error_r2");
      expect(r?.detalle).toEqual({ error_name: error.name, http_status: (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ?? null });
      expect(r?.message).toBe("No se pudo verificar la foto de la boleta; intente de nuevo o registre sin condonación");
    }
  });
  test("R2 colgado: el timeout corta y responde 503", async () => {
    const t0 = Date.now();
    const r = await verificarFotoBoleta(entrada(), arma((_k, signal) => new Promise((_res, rej) => signal.addEventListener("abort", () => rej(new Error("abortado")))), { timeoutMs: 30 }));
    expect(r?.status).toBe(503);
    expect(r?.motivo).toBe("timeout");
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
    expect(r?.message).toBe("Esta boleta ya está asociada a otro pago; verifique la boleta antes de condonar.");
    expect(r?.motivo).toBe("reusada");
    expect(r?.llave).toBe(LLAVE);
    expect(n).toBe(0);
  });
  test("la consulta de reuso recibe crédito, intento y llaves (para excluir al mismo intento)", async () => {
    const vistas: unknown[] = [];
    await verificarFotoBoleta(entrada(), arma(async () => buena, { llavesYaUsadas: async (...a) => { vistas.push(a); return []; } }));
    const a = vistas[0] as unknown[];
    expect(vistas).toHaveLength(1);
    expect(a.slice(0, 3)).toEqual([1, INTENTO, [LLAVE]]);
    expect(a[3]).toBeInstanceOf(AbortSignal);
  });
  test("si la consulta de reuso falla: falla cerrado con 503", async () => {
    const r = await verificarFotoBoleta(entrada(), arma(async () => buena, { llavesYaUsadas: async () => { throw new Error("db caída"); } }));
    expect(r?.status).toBe(503);
    expect(r?.motivo).toBe("error_base");
  });
  test("consulta de reuso colgada (p. ej. pool agotado): el tope corta y responde 503 timeout", async () => {
    const t0 = Date.now();
    const r = await verificarFotoBoleta(entrada(), arma(async () => buena, { llavesYaUsadas: () => new Promise(() => {}), timeoutMs: 30 }));
    expect([r?.status, r?.motivo]).toEqual([503, "timeout"]);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  test("el detalle de error nunca trae el mensaje del error (puede llevar URLs o credenciales)", async () => {
    const r = await verificarFotoBoleta(entrada(), arma(async () => { throw new Error("https://x.r2.cloudflarestorage.com/?X-Amz-Signature=SECRETO"); }));
    expect(JSON.stringify(r)).not.toContain("SECRETO");
  });
  const llaveN = (n: number) => `00000000-0000-4000-8000-00000000000${n}.jpg`;
  const contadores = () => {
    const c = { head: 0, reuso: 0 };
    return { c, deps: arma(async () => { c.head++; return buena; }, { llavesYaUsadas: async () => { c.reuso++; return []; } }) };
  };
  test("más de 3 llaves: 400 demasiadas sin consultar la base ni R2", async () => {
    const { c, deps } = contadores();
    const r = await verificarFotoBoleta(entrada([1, 2, 3, 4].map(llaveN)), deps);
    expect([r?.status, r?.motivo]).toEqual([400, "demasiadas"]);
    expect(r?.message).toContain("hasta 3 fotos");
    expect(c).toEqual({ head: 0, reuso: 0 });
  });
  test("4 copias de la misma llave también se rechazan (el tope cuenta las crudas)", async () => {
    const { c, deps } = contadores();
    const r = await verificarFotoBoleta(entrada([LLAVE, LLAVE, LLAVE, LLAVE]), deps);
    expect([r?.status, r?.motivo]).toEqual([400, "demasiadas"]);
    expect(c).toEqual({ head: 0, reuso: 0 });
  });
  test("borde: 3 llaves distintas y buenas pasan", async () => {
    const { deps } = contadores();
    expect(await verificarFotoBoleta(entrada([1, 2, 3].map(llaveN)), deps)).toBeNull();
  });
  test("al vencer el tope, la señal que recibió la consulta de reuso queda abortada", async () => {
    let señal: AbortSignal | undefined;
    const r = await verificarFotoBoleta(entrada(), arma(async () => buena, { llavesYaUsadas: (_c, _i, _l, s) => { señal = s; return new Promise(() => {}); }, timeoutMs: 30 }));
    expect([r?.status, r?.motivo]).toEqual([503, "timeout"]);
    expect(señal?.aborted).toBe(true);
  });
});
