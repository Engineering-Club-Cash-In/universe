import { describe, expect, it } from "bun:test";
import {
  UNLIQUIDATED_DRAFTS_CODE,
  buildCreditUnliquidatedDraftsWarning,
  buildInvestorUnliquidatedDraftsWarning,
} from "./draftPaymentsGuard";

describe("buildCreditUnliquidatedDraftsWarning", () => {
  it("devuelve null cuando no hay inversionistas bloqueantes", () => {
    expect(buildCreditUnliquidatedDraftsWarning([])).toBeNull();
  });

  it("arma el mensaje con los nombres de los inversionistas bloqueantes", () => {
    const result = buildCreditUnliquidatedDraftsWarning([
      { inversionista_id: 10, nombre: "Ana Pérez" },
      { inversionista_id: 11, nombre: "Luis Gómez" },
    ]);

    expect(result?.code).toBe(UNLIQUIDATED_DRAFTS_CODE);
    expect(result?.message).toBe(
      "No se puede solicitar la devolución: este crédito tiene pagos sin liquidar de Ana Pérez, Luis Gómez. Liquidalos antes de enviarlo a devolución.",
    );
    expect(result?.inversionistas_bloqueantes).toEqual([
      { inversionista_id: 10, nombre: "Ana Pérez" },
      { inversionista_id: 11, nombre: "Luis Gómez" },
    ]);
  });

  it("corta la lista de nombres en 5 y resume el resto", () => {
    const bloqueantes = Array.from({ length: 7 }, (_, i) => ({
      inversionista_id: i + 1,
      nombre: `Inversionista ${i + 1}`,
    }));

    const result = buildCreditUnliquidatedDraftsWarning(bloqueantes);

    expect(result?.message).toContain(
      "Inversionista 1, Inversionista 2, Inversionista 3, Inversionista 4, Inversionista 5 y 2 más",
    );
  });
});

describe("buildInvestorUnliquidatedDraftsWarning", () => {
  it("devuelve null cuando no hay créditos bloqueantes", () => {
    expect(buildInvestorUnliquidatedDraftsWarning([])).toBeNull();
  });

  it("arma el mensaje con los números SIFCO de los créditos bloqueantes", () => {
    const result = buildInvestorUnliquidatedDraftsWarning([
      { credito_id: 20, numero_credito_sifco: "01010214120190" },
      { credito_id: 21, numero_credito_sifco: "01010214120191" },
    ]);

    expect(result?.code).toBe(UNLIQUIDATED_DRAFTS_CODE);
    expect(result?.message).toBe(
      "No se puede marcar al inversionista para devolución: tiene pagos sin liquidar en los créditos 01010214120190, 01010214120191. Liquidalos primero.",
    );
    expect(result?.creditos_bloqueantes).toEqual([
      { credito_id: 20, numero_credito_sifco: "01010214120190" },
      { credito_id: 21, numero_credito_sifco: "01010214120191" },
    ]);
  });

  it("corta la lista de SIFCOs en 5 y resume el resto", () => {
    const bloqueantes = Array.from({ length: 6 }, (_, i) => ({
      credito_id: i + 1,
      numero_credito_sifco: `SIFCO-${i + 1}`,
    }));

    const result = buildInvestorUnliquidatedDraftsWarning(bloqueantes);

    expect(result?.message).toContain(
      "SIFCO-1, SIFCO-2, SIFCO-3, SIFCO-4, SIFCO-5 y 1 más",
    );
  });
});
