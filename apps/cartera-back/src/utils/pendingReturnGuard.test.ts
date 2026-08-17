import { describe, expect, it } from "bun:test";
import { buildPendingReturnAuthorizationWarning } from "./pendingReturnGuard";

describe("buildPendingReturnAuthorizationWarning", () => {
  it("deduplica el mismo crédito cuando tiene varios pagos pendientes", () => {
    const result = buildPendingReturnAuthorizationWarning([
      {
        creditoId: 20,
        numeroCreditoSifco: "SIFCO-20",
        estadoDevolucion: "PENDIENTE_AUTORIZACION",
      },
      {
        creditoId: 20,
        numeroCreditoSifco: "SIFCO-20",
        estadoDevolucion: "PENDIENTE_AUTORIZACION",
      },
    ]);

    expect(result?.creditos_bloqueados).toEqual([
      {
        credito_id: 20,
        numero_credito_sifco: "SIFCO-20",
        estado_devolucion: "PENDIENTE_AUTORIZACION",
      },
    ]);
  });

  it("no bloquea estados distintos de PENDIENTE_AUTORIZACION", () => {
    const result = buildPendingReturnAuthorizationWarning([
      {
        creditoId: 20,
        numeroCreditoSifco: "SIFCO-20",
        estadoDevolucion: "VERIFICADO",
      },
    ]);

    expect(result).toBeNull();
  });
});
