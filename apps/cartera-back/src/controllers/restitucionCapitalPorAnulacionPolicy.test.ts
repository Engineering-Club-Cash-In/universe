import { describe, expect, it } from "bun:test";
import {
  planRestitucionCapital,
  precheckAnulacionConCapital,
  recalcularMontosInversionista,
} from "./restitucionCapitalPorAnulacionPolicy";

// Crédito 9507 en prod20261014: capital 86,619.26 = Σ monto_aportado (86 + 161).
// Pago 164747 validated, abono_capital 1,005.44, PCI {86: 1,005.44}.
const CREDITO_9507 = {
  capital: "86619.26",
  statusCredit: "ACTIVO",
  porcentaje_interes: "1.50",
  seguro_10_cuotas: "271.66",
  gps: "0.00",
  membresias_pago: "570.84",
};
const ROSTER_9507 = [
  {
    id: 24933,
    inversionista_id: 86,
    monto_aportado: "86192.78000000",
    porcentaje_participacion_inversionista: "0",
    porcentaje_cash_in: "100",
  },
  {
    id: 24934,
    inversionista_id: 161,
    monto_aportado: "426.48000000",
    porcentaje_participacion_inversionista: "53",
    porcentaje_cash_in: "47",
  },
];
const PCI = (inversionista_id: number, abono_capital: string, extra: object = {}) => ({
  inversionista_id,
  abono_capital,
  estado_liquidacion: "NO_LIQUIDADO",
  liquidacion_id: null,
  ...extra,
});
const PAGO_9507 = { validationStatus: "validated", abono_capital: "1005.44", registerBy: "asesor@x" };

const plan9507 = (cambios: Partial<Parameters<typeof planRestitucionCapital>[0]> = {}) =>
  planRestitucionCapital({
    pago: PAGO_9507,
    credito: CREDITO_9507,
    filasPci: [PCI(86, "1005.44")],
    roster: ROSTER_9507,
    cuotaCerrada: true,
    ...cambios,
  });

describe("recalcularMontosInversionista (fórmula de processAndReplaceCreditInvestors)", () => {
  it("recalcula cuota, montos e IVAs desde el monto aportado", () => {
    expect(
      recalcularMontosInversionista({
        montoAportado: "426.48",
        porcentajeInversion: "53",
        porcentajeCashIn: "47",
        porcentajeInteres: "1.50",
      }),
    ).toEqual({
      monto_aportado: "426.48000000",
      monto_inversionista: "3.39",
      monto_cash_in: "3.01",
      iva_inversionista: "0.41",
      iva_cash_in: "0.36",
    });
  });

  it("monto en cero no genera IVA", () => {
    expect(
      recalcularMontosInversionista({
        montoAportado: "100",
        porcentajeInversion: "0",
        porcentajeCashIn: "100",
        porcentajeInteres: "1.5",
      }),
    ).toMatchObject({ monto_inversionista: "0.00", iva_inversionista: "0.00", monto_cash_in: "1.50", iva_cash_in: "0.18" });
  });
});

describe("planRestitucionCapital: cuándo no hay capital que reponer", () => {
  it("pending: SIN_CAPITAL (nunca movió capital)", () => {
    expect(plan9507({ pago: { ...PAGO_9507, validationStatus: "pending" } })).toEqual({ tipo: "SIN_CAPITAL" });
  });

  it("validated con abono_capital 0: SIN_CAPITAL", () => {
    expect(plan9507({ pago: { ...PAGO_9507, abono_capital: "0.00" } })).toEqual({ tipo: "SIN_CAPITAL" });
  });
});

describe("planRestitucionCapital: reponer", () => {
  it("9507: capital 87,624.70 y el inversionista 86 recupera exactamente su PCI", () => {
    const plan = plan9507();
    expect(plan).toEqual({
      tipo: "REPONER",
      credito: { capital: "87624.70", cuotaInteres: "1314.37", iva: "157.72", deudaTotal: "89939.29" },
      inversionistas: [
        {
          id: 24933,
          inversionista_id: 86,
          monto_aportado: "87198.22000000",
          monto_inversionista: "0.00",
          monto_cash_in: "1307.97",
          iva_inversionista: "0.00",
          iva_cash_in: "156.96",
        },
      ],
      borrarPci: true,
    });
  });

  it("rama A (la cuota nunca cerró, sin PCI): solo se repone el capital", () => {
    const plan = plan9507({ filasPci: [], cuotaCerrada: false });
    expect(plan).toMatchObject({ tipo: "REPONER", credito: { capital: "87624.70" }, inversionistas: [] });
  });

  it("redondeo: 333.33 × 3 contra abono 1,000.00 → el centavo va al de mayor abono", () => {
    const roster = [1, 2, 3].map((n) => ({
      id: n,
      inversionista_id: n,
      monto_aportado: "1000",
      porcentaje_participacion_inversionista: "50",
      porcentaje_cash_in: "50",
    }));
    const plan = planRestitucionCapital({
      pago: { validationStatus: "validated", abono_capital: "1000.00", registerBy: "x" },
      credito: { ...CREDITO_9507, capital: "2000.00" },
      filasPci: [PCI(2, "333.33"), PCI(1, "333.33"), PCI(3, "333.33")],
      roster,
      cuotaCerrada: true,
    });
    if (plan.tipo !== "REPONER") throw new Error(plan.tipo);
    expect(plan.credito.capital).toBe("3000.00");
    expect(plan.inversionistas.map((i) => [i.inversionista_id, i.monto_aportado])).toEqual([
      [1, "1333.34000000"],
      [2, "1333.33000000"],
      [3, "1333.33000000"],
    ]);
  });


  it("INCOBRABLE con pago de recuperación: repone capital sin revivir interés ni IVA", () => {
    const plan = plan9507({ credito: { ...CREDITO_9507, statusCredit: "INCOBRABLE" } });
    expect(plan).toMatchObject({
      tipo: "REPONER",
      credito: { capital: "87624.70", cuotaInteres: "0.00", iva: "0.00", deudaTotal: "88467.20" },
    });
  });
});

describe("planRestitucionCapital: rechazos (409, no se anula nada)", () => {
  it("(a) crédito CANCELADO: CREDITO_NO_REVERSIBLE", () => {
    expect(plan9507({ credito: { ...CREDITO_9507, statusCredit: "CANCELADO" } })).toEqual({
      tipo: "RECHAZAR",
      codigo: "CREDITO_NO_REVERSIBLE",
    });
  });

  it("(b) fila estructural SIFCO_SYNC en INCOBRABLE: FILA_ESTRUCTURAL_INCOBRABLE", () => {
    expect(
      plan9507({
        credito: { ...CREDITO_9507, statusCredit: "INCOBRABLE" },
        pago: { ...PAGO_9507, registerBy: "SIFCO_SYNC" },
      }),
    ).toEqual({ tipo: "RECHAZAR", codigo: "FILA_ESTRUCTURAL_INCOBRABLE" });
  });

  it("(c) PCI liquidado o con liquidación: PCI_LIQUIDADO", () => {
    expect(plan9507({ filasPci: [PCI(86, "1005.44", { estado_liquidacion: "LIQUIDADO" })] })).toEqual({
      tipo: "RECHAZAR",
      codigo: "PCI_LIQUIDADO",
    });
    expect(plan9507({ filasPci: [PCI(86, "1005.44", { estado_liquidacion: "POR_LIQUIDAR" })] })).toEqual({
      tipo: "RECHAZAR",
      codigo: "PCI_LIQUIDADO",
    });
    expect(plan9507({ filasPci: [PCI(86, "1005.44", { liquidacion_id: 7 })] })).toEqual({
      tipo: "RECHAZAR",
      codigo: "PCI_LIQUIDADO",
    });
  });

  it("abono directo a capital (capital_validated): ABONO_DIRECTO_NO_SOPORTADO por ahora", () => {
    expect(plan9507({ pago: { ...PAGO_9507, validationStatus: "capital_validated" } })).toEqual({
      tipo: "RECHAZAR",
      codigo: "ABONO_DIRECTO_NO_SOPORTADO",
    });
  });

  it("validated en una cuota CERRADA sin ninguna PCI (histórico): CUOTA_CERRADA_SIN_REPARTO", () => {
    expect(plan9507({ filasPci: [] })).toEqual({ tipo: "RECHAZAR", codigo: "CUOTA_CERRADA_SIN_REPARTO" });
  });

  it("(e) PCI con capital de un inversionista que ya no está en el crédito: INVERSIONISTA_YA_NO_ESTA", () => {
    expect(plan9507({ filasPci: [PCI(999, "1005.44")] })).toEqual({
      tipo: "RECHAZAR",
      codigo: "INVERSIONISTA_YA_NO_ESTA",
    });
  });

  it("(e) no aplica a una PCI sin capital (solo interés) de alguien que ya no está", () => {
    expect(plan9507({ filasPci: [PCI(86, "1005.44"), PCI(999, "0.00")] })).toMatchObject({ tipo: "REPONER" });
  });

  it("(f2) PCI todas en capital 0 (cuota cerrada): REPARTO_INCONSISTENTE, no repone sin inversionista", () => {
    const rechazo = { tipo: "RECHAZAR", codigo: "REPARTO_INCONSISTENTE" } as const;
    // redondeo a cero: abono de 0.01 y tres PCI en 0.00
    expect(
      plan9507({
        pago: { ...PAGO_9507, abono_capital: "0.01" },
        filasPci: [PCI(86, "0.00"), PCI(87, "0.00"), PCI(88, "0.00")],
      }),
    ).toEqual(rechazo);
    // caso real (crédito 16): abono 20000 y una PCI con capital 0 (solo interés)
    expect(
      plan9507({
        pago: { ...PAGO_9507, abono_capital: "20000" },
        filasPci: [PCI(86, "0", { abono_interes: "1951.25" })],
      }),
    ).toEqual(rechazo);
  });

  it("(f) el reparto no cuadra con el abono más allá de la tolerancia: REPARTO_INCONSISTENTE", () => {
    expect(plan9507({ filasPci: [PCI(86, "1000.00")] })).toEqual({
      tipo: "RECHAZAR",
      codigo: "REPARTO_INCONSISTENTE",
    });
  });
});

describe("residuo negativo que dejaría negativa la restitución", () => {
  const rosterN = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      inversionista_id: i + 1,
      monto_aportado: "1000",
      porcentaje_participacion_inversionista: "50",
      porcentaje_cash_in: "50",
    }));
  const planN = (n: number, abono: string) =>
    planRestitucionCapital({
      pago: { validationStatus: "validated", abono_capital: abono, registerBy: "x" },
      credito: { ...CREDITO_9507, capital: "2000.00" },
      filasPci: Array.from({ length: n }, (_, i) => PCI(i + 1, "0.01")),
      roster: rosterN(n),
      cuotaCerrada: true,
    });
  const rechazo = { tipo: "RECHAZAR", codigo: "REPARTO_INCONSISTENTE" } as const;

  it("abono 0.02 entre 4 PCI de 0.01: REPARTO_INCONSISTENTE", () => {
    expect(planN(4, "0.02")).toEqual(rechazo);
  });

  it("abono 0.03 entre 5 PCI de 0.01: REPARTO_INCONSISTENTE", () => {
    expect(planN(5, "0.03")).toEqual(rechazo);
  });

  it("abono 0.04 con PCI [0.01, 0, 0, 0] y roster de 4: la tolerancia cuenta inversionistas con capital, no filas", () => {
    const plan = planRestitucionCapital({
      pago: { validationStatus: "validated", abono_capital: "0.04", registerBy: "x" },
      credito: { ...CREDITO_9507, capital: "2000.00" },
      filasPci: [PCI(1, "0.01"), PCI(2, "0"), PCI(3, "0"), PCI(4, "0")],
      roster: rosterN(4),
      cuotaCerrada: true,
    });
    expect(plan).toEqual(rechazo);
  });

  it("caso real: PCI 1120.41 con abono 1120.40 repone y suma 1120.40", () => {
    const plan = planRestitucionCapital({
      pago: { validationStatus: "validated", abono_capital: "1120.40", registerBy: "x" },
      credito: { ...CREDITO_9507, capital: "2000.00" },
      filasPci: [PCI(1, "1120.41")],
      roster: rosterN(1),
      cuotaCerrada: true,
    });
    if (plan.tipo !== "REPONER") throw new Error(plan.tipo);
    expect(plan.inversionistas.map((i) => i.monto_aportado)).toEqual(["2120.40000000"]);
  });

  it("residuo positivo chico: sigue en REPONER y el residuo va al mayor", () => {
    const plan = planN(3, "0.04");
    if (plan.tipo !== "REPONER") throw new Error(plan.tipo);
    expect(plan.inversionistas.map((i) => i.monto_aportado)).toEqual(["1000.02000000", "1000.01000000", "1000.01000000"]);
  });
});

describe("precheckAnulacionConCapital (antes de tocar la fila)", () => {
  const base = { validationStatus: "validated", abono_capital: "100", registerBy: "asesor", statusCredit: "ACTIVO" };

  it("ACTIVO con capital: pasa", () => {
    expect(precheckAnulacionConCapital(base)).toBeNull();
  });

  it("(a) CANCELADO con capital: CREDITO_NO_REVERSIBLE", () => {
    expect(precheckAnulacionConCapital({ ...base, statusCredit: "CANCELADO" })).toBe("CREDITO_NO_REVERSIBLE");
  });

  it("capital_validated: ABONO_DIRECTO_NO_SOPORTADO antes de tocar la fila", () => {
    expect(precheckAnulacionConCapital({ ...base, validationStatus: "capital_validated" })).toBe(
      "ABONO_DIRECTO_NO_SOPORTADO",
    );
  });

  it("(b) INCOBRABLE con fila SIFCO_SYNC: FILA_ESTRUCTURAL_INCOBRABLE", () => {
    expect(precheckAnulacionConCapital({ ...base, statusCredit: "INCOBRABLE", registerBy: "SIFCO_SYNC" })).toBe(
      "FILA_ESTRUCTURAL_INCOBRABLE",
    );
  });

  it("sin capital que reponer no bloquea nada (un pending de un CANCELADO se sigue anulando)", () => {
    expect(precheckAnulacionConCapital({ ...base, statusCredit: "CANCELADO", validationStatus: "pending" })).toBeNull();
    expect(precheckAnulacionConCapital({ ...base, statusCredit: "CANCELADO", abono_capital: "0" })).toBeNull();
  });
});
