import { describe, expect, it, beforeAll } from "bun:test";
import { z } from "zod";
import { zodErrorMapEspanol } from "./zodErrorMap";

beforeAll(() => {
  z.setErrorMap(zodErrorMapEspanol);
});

/** Devuelve el mensaje del primer issue del campo indicado. */
function mensajeDe(schema: z.ZodSchema<unknown>, valor: unknown, campo?: string): string {
  const result = schema.safeParse(valor);
  if (result.success) throw new Error("se esperaba un error de validación");
  const issue = campo
    ? result.error.issues.find((i) => i.path.join(".") === campo)
    : result.error.issues[0];
  if (!issue) throw new Error(`no hay issue para "${campo}"`);
  return issue.message;
}

describe("zodErrorMapEspanol", () => {
  it("traduce el caso reportado: number que recibe string", () => {
    const schema = z.object({ otros: z.number().min(0).optional() });
    expect(mensajeDe(schema, { otros: "" }, "otros")).toBe("Debe ser un número válido");
  });

  it("un campo ausente se reporta como obligatorio", () => {
    const schema = z.object({ monto_boleta: z.number() });
    expect(mensajeDe(schema, {}, "monto_boleta")).toBe("Este campo es obligatorio");
  });

  it("string vacío con min(1) se reporta como obligatorio", () => {
    const schema = z.object({ registerBy: z.string().min(1) });
    expect(mensajeDe(schema, { registerBy: "" }, "registerBy")).toBe("Este campo es obligatorio");
  });

  it("traduce los límites numéricos", () => {
    expect(mensajeDe(z.number().min(0), -1)).toBe("Debe ser mayor o igual a 0");
    expect(mensajeDe(z.number().max(100), 101)).toBe("No puede ser mayor a 100");
    expect(mensajeDe(z.number().int().positive(), 0)).toBe("Debe ser mayor a 0");
  });

  it("traduce el máximo de caracteres", () => {
    expect(mensajeDe(z.string().max(3), "abcd")).toBe("Máximo 3 caracteres");
  });

  it("traduce un enum inválido", () => {
    const schema = z.enum(["transferencia", "cheque", "boleta"]);
    expect(mensajeDe(schema, "efectivo")).toBe("Debe seleccionar una opción válida");
  });

  it("el mensaje propio del schema gana sobre el mapa global", () => {
    const schema = z.object({
      credito_id: z.number().int().positive({ message: "Debe seleccionar un crédito" }),
    });
    expect(mensajeDe(schema, { credito_id: 0 }, "credito_id")).toBe("Debe seleccionar un crédito");
  });

  it("el errorMap propio del schema también gana", () => {
    const schema = z.enum(["transferencia", "cheque"], {
      errorMap: () => ({ message: "Debe seleccionar un origen de pago" }),
    });
    expect(mensajeDe(schema, "")).toBe("Debe seleccionar un origen de pago");
  });

  it("no deja pasar ningún mensaje en inglés del schema de pagos", () => {
    const pagoSchema = z.object({
      credito_id: z.number().int().positive(),
      monto_boleta: z.number().min(0.01),
      otros: z.number().min(0).optional(),
      observaciones: z.string().max(500).optional(),
      url_boletas: z.array(z.string().max(500)),
      origen_pago: z.enum(["transferencia", "cheque", "boleta"]),
    });

    const result = pagoSchema.safeParse({
      credito_id: 0,
      monto_boleta: "",
      otros: "",
      observaciones: 123,
      url_boletas: "no-es-array",
      origen_pago: "efectivo",
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    for (const issue of result.error.issues) {
      expect(issue.message).not.toMatch(/Expected|Required|Invalid|must contain|Number must/i);
    }
  });
});
