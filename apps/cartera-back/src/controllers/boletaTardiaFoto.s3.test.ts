import "../utils/baseFalsaParaPruebas";
import { describe, expect, mock, test } from "bun:test";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

// Las dependencias REALES (headReal/inicioReal) contra un `s3.send` falso que contesta según el comando: así se prueba
// qué se le pide a R2 (Range, misma llave, misma señal) sin red. Archivo aparte porque `mock.module` es global al proceso.
type Respuesta = { head?: () => unknown; get?: () => unknown };
let respuesta: Respuesta = {};
const enviados: { comando: string; input: Record<string, unknown>; signal?: AbortSignal }[] = [];
mock.module("../utils/functions/uploadsFiles", () => ({
  s3: {
    send: async (cmd: { input: Record<string, unknown> }, opts?: { abortSignal?: AbortSignal }) => {
      const comando = cmd instanceof HeadObjectCommand ? "head" : cmd instanceof GetObjectCommand ? "get" : "otro";
      enviados.push({ comando, input: cmd.input, signal: opts?.abortSignal });
      const r = comando === "head" ? respuesta.head : comando === "get" ? respuesta.get : undefined;
      if (!r) throw new Error(`comando inesperado: ${comando}`);
      return r();
    },
  },
}));

const { depsFotoReales, verificarFotoBoleta } = await import("./boletaTardiaFoto");

const AHORA = new Date("2026-10-13T20:00:00Z");
const LLAVE = "00000000-0000-4000-8000-000000000001.jpg";
const buena = { ContentLength: 12345, ContentType: "image/jpeg", LastModified: new Date(AHORA.getTime() - 3_600_000) };
const cuerpo = (b: number[] | string) => ({ Body: { transformToByteArray: async () => new Uint8Array(typeof b === "string" ? Buffer.from(b, "latin1") : b) } });
const verificar = () => {
  enviados.length = 0;
  return verificarFotoBoleta({ credito_id: 1, intento_id: "00000000-0000-4000-8000-0000000000aa", llaves: [LLAVE] },
    { ...depsFotoReales(), llavesYaUsadas: async () => [], ahora: () => AHORA, timeoutMs: 50 });
};

describe("verificarFotoBoleta con el cliente S3 real (send falso por comando)", () => {
  test("JPEG, PNG y PDF válidos pasan; pide solo el primer KB de la misma llave y con la señal del tope", async () => {
    for (const b of [[0xff, 0xd8, 0xff, 0xe1], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "%PDF-1.5"]) {
      respuesta = { head: () => buena, get: () => cuerpo(b) };
      expect(await verificar()).toBeNull();
      expect(enviados.map((e) => e.comando)).toEqual(["head", "get"]);
      expect(enviados[1].input).toMatchObject({ Key: LLAVE, Range: "bytes=0-1023" });
      expect(enviados[1].signal).toBe(enviados[0].signal!);
    }
  });
  test("texto o ejecutable con ContentType image/jpeg: 400 contenido_invalido", async () => {
    for (const b of ["hola, no soy una foto", "MZ\x90\x00\x03\x00", "\x7fELF\x02\x01"]) {
      respuesta = { head: () => buena, get: () => cuerpo(b) };
      const r = await verificar();
      expect([r?.status, r?.motivo]).toEqual([400, "contenido_invalido"]);
    }
  });
  test("el GET falla: 503 (falla cerrado)", async () => {
    respuesta = { head: () => buena, get: () => { throw Object.assign(new Error("boom"), { name: "InternalError", $metadata: { httpStatusCode: 500 } }); } };
    const r = await verificar();
    expect([r?.status, r?.motivo]).toEqual([503, "error_r2"]);
  });
  test("el GET no trae cuerpo: 503", async () => {
    respuesta = { head: () => buena, get: () => ({}) };
    expect((await verificar())?.status).toBe(503);
  });
});
