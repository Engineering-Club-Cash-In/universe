import { describe, expect, it } from "bun:test";
import { AxiosError } from "axios";
import {
  getApiErrorMessage,
  getBatchFailedCredits,
  getPendingReturnWarningMessage,
} from "./apiError";

describe("getApiErrorMessage", () => {
  it("presenta en español el bloqueo por cancelación pendiente", () => {
    const error = new AxiosError(
      "Request failed with status code 409",
      "ERR_BAD_REQUEST",
      undefined,
      undefined,
      {
        status: 409,
        statusText: "Conflict",
        headers: {},
        config: {} as never,
        data: {
          code: "CREDIT_PENDING_CANCELLATION",
          message: "Internal server error",
        },
      },
    );

    expect(getApiErrorMessage(error, "No se pudo registrar el pago")).toBe(
      "No se pudo registrar el pago: No se puede registrar el pago porque el crédito está pendiente de cancelación.",
    );
  });

  it("presenta el warning por devolución pendiente sin mostrar error técnico", () => {
    const error = new AxiosError(
      "Request failed with status code 422",
      "ERR_BAD_REQUEST",
      undefined,
      undefined,
      {
        status: 422,
        statusText: "Unprocessable Content",
        headers: {},
        config: {} as never,
        data: {
          code: "CREDIT_PENDING_RETURN_AUTHORIZATION",
          message: "Internal server error",
        },
      },
    );

    expect(getApiErrorMessage(error, "No se pudo continuar")).toBe(
      "No se pudo continuar: Hay créditos pendientes de autorización para devolución a CUBE.",
    );
  });

  it("incluye SIFCO bloqueantes en el warning de devolución", () => {
    const error = new AxiosError(
      "Request failed with status code 422",
      "ERR_BAD_REQUEST",
      undefined,
      undefined,
      {
        status: 422,
        statusText: "Unprocessable Content",
        headers: {},
        config: {} as never,
        data: {
          code: "CREDIT_PENDING_RETURN_AUTHORIZATION",
          creditos_bloqueados: [
            { numero_credito_sifco: "01010214119070" },
            { numero_credito_sifco: "CRM-123" },
          ],
        },
      },
    );

    expect(getPendingReturnWarningMessage(error)).toBe(
      "Hay créditos pendientes de autorización para devolución a CUBE. Créditos: 01010214119070, CRM-123.",
    );
    expect(getApiErrorMessage(error, "No se pudo continuar")).toBe(
      "No se pudo continuar: Hay créditos pendientes de autorización para devolución a CUBE. Créditos: 01010214119070, CRM-123.",
    );
  });

  it("incluye fallas ajenas a devolución en una liquidación masiva bloqueada", () => {
    const error = new AxiosError(
      "Request failed with status code 422",
      "ERR_BAD_REQUEST",
      undefined,
      undefined,
      {
        status: 422,
        statusText: "Unprocessable Content",
        headers: {},
        config: {} as never,
        data: {
          code: "CREDIT_PENDING_RETURN_AUTHORIZATION",
          creditos_bloqueados: [
            { numero_credito_sifco: "01010214119070" },
          ],
          errores: [
            {
              code: "CREDIT_PENDING_RETURN_AUTHORIZATION",
              razon: "Pendiente de autorización para devolución a CUBE",
            },
            {
              razon: "[CUADRE_CAPITAL] Crédito 01010101010101 inconsistente",
            },
          ],
        },
      },
    );

    expect(getPendingReturnWarningMessage(error)).toBe(
      "Hay créditos pendientes de autorización para devolución a CUBE. Créditos: 01010214119070. Otras inconsistencias: [CUADRE_CAPITAL] Crédito 01010101010101 inconsistente.",
    );
  });

  it("omite razones técnicas de liquidación masiva del warning de devolución", () => {
    const error = new AxiosError(
      "Request failed with status code 422",
      "ERR_BAD_REQUEST",
      undefined,
      undefined,
      {
        status: 422,
        statusText: "Unprocessable Content",
        headers: {},
        config: {} as never,
        data: {
          code: "CREDIT_PENDING_RETURN_AUTHORIZATION",
          creditos_bloqueados: [
            { numero_credito_sifco: "01010214119070" },
          ],
          errores: [
            {
              razon: "PostgresError: duplicate key violates unique constraint pagos_credito_inversionistas_espejo_pkey",
            },
            {
              razon: "[CUADRE_CAPITAL] Crédito 01010101010101 inconsistente",
            },
          ],
        },
      },
    );

    expect(getPendingReturnWarningMessage(error)).toBe(
      "Hay créditos pendientes de autorización para devolución a CUBE. Créditos: 01010214119070. Otras inconsistencias: [CUADRE_CAPITAL] Crédito 01010101010101 inconsistente.",
    );
  });

  it("extrae SIFCO y razón cuando todo lote de pagos espejo falla", () => {
    const error = new AxiosError(
      "Request failed with status code 500",
      "ERR_BAD_RESPONSE",
      undefined,
      undefined,
      {
        status: 500,
        statusText: "Internal Server Error",
        headers: {},
        config: {} as never,
        data: {
          success: false,
          error: "No se pudo generar ningún pago espejo del lote.",
          fallidos: [
            {
              creditoId: 101,
              numeroCreditoSifco: "01010214119070",
              mensaje: "[CUADRE_CAPITAL] Crédito inconsistente",
            },
          ],
        },
      },
    );

    expect(getBatchFailedCredits(error)).toEqual([
      {
        creditoId: 101,
        numeroCreditoSifco: "01010214119070",
        mensaje: "[CUADRE_CAPITAL] Crédito inconsistente",
      },
    ]);
  });
});

describe("getApiErrorMessage — detalle por campo del backend", () => {
  /** Arma el AxiosError como lo entrega axios ante un 400 del backend. */
  function errorCon(data: unknown, status = 400) {
    return new AxiosError(
      `Request failed with status code ${status}`,
      "ERR_BAD_REQUEST",
      undefined,
      undefined,
      { status, statusText: "Bad Request", headers: {}, config: {} as never, data },
    );
  }

  it("muestra qué campo falló en vez del genérico de 'Validation failed'", () => {
    const error = errorCon({
      message: "Validation failed",
      errors: { otros: ["Expected number, received string"] },
    });

    expect(getApiErrorMessage(error, "No se pudo registrar el pago")).toBe(
      "No se pudo registrar el pago:\n• Otros: Debe ser un número válido",
    );
  });

  it("lista varios campos con sus etiquetas amigables", () => {
    const error = errorCon({
      message: "Validation failed",
      errors: {
        banco_id: ["Required"],
        monto_boleta: ["Number must be greater than or equal to 0.01"],
      },
    });

    expect(getApiErrorMessage(error, "No se pudo registrar el pago")).toBe(
      "No se pudo registrar el pago:\n" +
        "• Banco: Este campo es obligatorio\n" +
        "• Monto Boleta: Debe ser mayor o igual a 0.01",
    );
  });

  it("entiende la forma flatten() completa bajo 'issues'", () => {
    const error = errorCon({
      message: "[ERROR] Parámetros inválidos",
      issues: { formErrors: [], fieldErrors: { creditId: ["Expected number, received nan"] } },
    });

    expect(getApiErrorMessage(error, "No se pudo actualizar el crédito")).toBe(
      "No se pudo actualizar el crédito:\n• Credit Id: Debe ser un número válido",
    );
  });

  it("descarta los crudos técnicos que vengan dentro de errors", () => {
    const error = errorCon({
      message: "Validation failed",
      errors: { _db: ["PostgresError: duplicate key violates constraint"] },
    });

    expect(getApiErrorMessage(error, "No se pudo registrar el pago")).toBe(
      "No se pudo registrar el pago: Los datos enviados no son válidos, revisa los campos e intenta de nuevo",
    );
  });

  it("un 'errors' vacío cae al mensaje traducido de siempre", () => {
    const error = errorCon({ message: "Validation failed", errors: {} });

    expect(getApiErrorMessage(error, "No se pudo registrar el pago")).toBe(
      "No se pudo registrar el pago: Los datos enviados no son válidos, revisa los campos e intenta de nuevo",
    );
  });

  it("ignora un `errors` que trae un crudo en string, no un mapa de campos", () => {
    // updateDueDate.ts:283 y :390 responden así; el guard de tipo debe dejarlos
    // pasar por el camino de siempre en vez de intentar formatearlos.
    const error = errorCon(
      {
        message: "Error interno del servidor",
        errors: "TypeError: cannot read properties of undefined",
      },
      500,
    );

    expect(getApiErrorMessage(error, "No se pudo actualizar la fecha")).toBe(
      "No se pudo actualizar la fecha: Error interno del servidor",
    );
  });

  it("el código de negocio sigue ganando sobre el detalle por campo", () => {
    const error = errorCon(
      {
        code: "CREDIT_PENDING_CANCELLATION",
        message: "Validation failed",
        errors: { otros: ["Required"] },
      },
      409,
    );

    expect(getApiErrorMessage(error, "No se pudo registrar el pago")).toBe(
      "No se pudo registrar el pago: No se puede registrar el pago porque el crédito está pendiente de cancelación.",
    );
  });
});
