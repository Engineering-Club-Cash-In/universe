import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  ERROR_CODES,
  ERROR_MESSAGES,
  errorResponse,
  validationFailed,
} from "./errorCodes";

describe("validationFailed", () => {
  it("devuelve la forma única con código estable y detalle por campo", () => {
    const schema = z.object({ otros: z.number().min(0).optional() });
    const parsed = schema.safeParse({ otros: "" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const respuesta = validationFailed(parsed.error.flatten().fieldErrors);

    expect(respuesta.success).toBe(false);
    expect(respuesta.code).toBe("VALIDATION_FAILED");
    expect(respuesta.message).toBe(ERROR_MESSAGES.VALIDATION_FAILED);
    expect(respuesta.errors?.otros).toEqual(["Expected number, received string"]);
  });

  it("el mensaje no queda en inglés", () => {
    const respuesta = validationFailed({});
    expect(respuesta.message).not.toMatch(/validation failed/i);
  });
});

describe("errorResponse", () => {
  it("usa el mensaje por defecto del código", () => {
    expect(errorResponse(ERROR_CODES.INTERNAL_ERROR)).toEqual({
      success: false,
      code: "INTERNAL_ERROR",
      message: ERROR_MESSAGES.INTERNAL_ERROR,
    });
  });

  it("permite sobrescribir el mensaje", () => {
    expect(errorResponse(ERROR_CODES.CREDIT_NOT_FOUND, "No existe ese crédito").message).toBe(
      "No existe ese crédito",
    );
  });

  it("nunca expone un crudo técnico en el mensaje por defecto", () => {
    for (const mensaje of Object.values(ERROR_MESSAGES)) {
      expect(mensaje).not.toMatch(/Error:|ECONN|stack|at \w+ \(/i);
    }
  });
});
