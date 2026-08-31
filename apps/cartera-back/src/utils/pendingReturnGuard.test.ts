import { describe, expect, it } from "bun:test";
import {
  buildPendingReturnAuthorizationWarning,
  buildPendingReturnAuthorizationWarningFromErrors,
  formatPendingReturnAuthorizationNote,
} from "./pendingReturnGuard";

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

describe("buildPendingReturnAuthorizationWarningFromErrors", () => {
  it("conserva warning y SIFCO aunque existan otros errores en liquidación masiva", () => {
    const result = buildPendingReturnAuthorizationWarningFromErrors([
      {
        code: "CREDIT_PENDING_RETURN_AUTHORIZATION",
        creditos_bloqueados: [
          {
            credito_id: 20,
            numero_credito_sifco: "SIFCO-20",
            estado_devolucion: "PENDIENTE_AUTORIZACION",
          },
        ],
      },
      { razon: "[CUADRE_CAPITAL] Crédito inconsistente" },
    ]);

    expect(result?.code).toBe("CREDIT_PENDING_RETURN_AUTHORIZATION");
    expect(result?.creditos_bloqueados).toEqual([
      {
        credito_id: 20,
        numero_credito_sifco: "SIFCO-20",
        estado_devolucion: "PENDIENTE_AUTORIZACION",
      },
    ]);
  });

  it("forma nota consultable para boleta bloqueada", () => {
    const warning = buildPendingReturnAuthorizationWarningFromErrors([
      {
        code: "CREDIT_PENDING_RETURN_AUTHORIZATION",
        creditos_bloqueados: [
          {
            credito_id: 20,
            numero_credito_sifco: "SIFCO-20",
            estado_devolucion: "PENDIENTE_AUTORIZACION",
          },
        ],
      },
    ]);

    expect(formatPendingReturnAuthorizationNote(warning!)).toBe(
      "[BLOQUEO DEVOLUCIÓN CUBE] Créditos pendientes de autorización: SIFCO-20.",
    );
  });
});
