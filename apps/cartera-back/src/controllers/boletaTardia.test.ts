import "../utils/baseFalsaParaPruebas";
import { describe, expect, test } from "bun:test";
import { motivoCondonacionBoletaTardia } from "../utils/motivoCondonacionBoletaTardia";
import { condonacionBoletaTardiaSchema, registrarPagoConBoletaTardia, traeCondonacionBoletaTardia, type DepsBoletaTardia } from "./boletaTardia";

const explota = (nombre: string) => (() => { throw new Error(`no debía llamarse: ${nombre}`); }) as never;
const depsQueNoSeUsan: DepsBoletaTardia = {
  conLock: explota("conLock"), insertPayment: explota("insertPayment"), decidir: explota("decidir"), condonar: explota("condonar"),
  anular: explota("anular"), condonacionDelIntento: explota("condonacionDelIntento"), evaluarAlDia: explota("evaluarAlDia"), filasVivas: explota("filasVivas"), condonacionViva: explota("condonacionViva"),
};
const INTENTO = "00000000-0000-4000-8000-000000000001";
const cuerpo = (extra: Record<string, unknown> = {}) => ({
  credito_id: 1, usuario_id: 1, monto_boleta: 1000, fecha_pago: "2026-10-03", cuotaApagar: 5, url_boletas: ["b.jpg"],
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
