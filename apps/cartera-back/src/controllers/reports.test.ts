import { describe, expect, it, mock } from "bun:test";

mock.module("../database", () => ({
  db: {},
}));

mock.module("./credits", () => ({
  getCreditosWithUserByMesAnio: mock(() => Promise.resolve({ data: [] })),
}));

mock.module("./payments", () => ({
  getAllPagosWithCreditAndInversionistas: mock(() => Promise.resolve([])),
  getPagosConInversionistas: mock(() => Promise.resolve([])),
}));

mock.module("@cci/email", () => ({
  sendEmail: mock(() => Promise.resolve()),
  sendLiquidationEmail: mock(() => Promise.resolve()),
  sendPlainEmail: mock(() => Promise.resolve()),
  sendSimpleEmail: mock(() => Promise.resolve()),
  sendInvestorAddedToCreditsNotification: mock(() => Promise.resolve()),
}));

const { buildEstadoCuentaTableHeader, renderEstadoCuentaPaymentRow } = await import("./reports");

describe("estado de cuenta PDF", () => {
  it("incluye la columna de fecha de aplicacion del pago", () => {
    expect(buildEstadoCuentaTableHeader()).toContain("Fecha Aplicación");
  });

  it("muestra fecha_aplicado en el renglon del pago", () => {
    const row = renderEstadoCuentaPaymentRow(
      {
        pago_id: 78303,
        numero_cuota: 17,
        cuota: "2445.18",
        abono_capital: "841.50",
        abono_interes: "812.53",
        abono_iva_12: "97.50",
        abono_seguro: "260.93",
        abono_gps: "0.00",
        membresias_pago: "432.72",
        mora: "0.00",
        monto_aplicado: "2445.18",
        total_restante: "53327.49",
        fecha_vencimiento: new Date("2026-05-15T06:00:00.000Z"),
        fecha_aplicado: new Date("2026-05-19T16:36:25.000Z"),
      },
      0,
    );

    expect(row).toContain("19/05/2026");
    expect(row).toContain("15/05/2026");
  });

  it("muestra guion cuando el pago no tiene fecha_aplicado", () => {
    const row = renderEstadoCuentaPaymentRow(
      {
        pago_id: 78304,
        numero_cuota: 18,
        cuota: "2445.18",
        abono_capital: "0.00",
        abono_interes: "0.00",
        abono_iva_12: "0.00",
        abono_seguro: "0.00",
        abono_gps: "0.00",
        membresias_pago: "0.00",
        mora: "0.00",
        monto_aplicado: "0.00",
        total_restante: "54168.99",
        fecha_vencimiento: new Date("2026-06-15T06:00:00.000Z"),
        fecha_aplicado: null,
      },
      0,
    );

    expect(row).toContain("<td>-</td>");
  });
});
