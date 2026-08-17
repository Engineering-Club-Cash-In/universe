import { describe, expect, it } from "bun:test";
import { AxiosError } from "axios";
import { getApiErrorMessage, getPendingReturnWarningMessage } from "./apiError";

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
});
