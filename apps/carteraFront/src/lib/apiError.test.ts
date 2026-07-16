import { describe, expect, it } from "bun:test";
import { AxiosError } from "axios";
import { getApiErrorMessage } from "./apiError";

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
});
