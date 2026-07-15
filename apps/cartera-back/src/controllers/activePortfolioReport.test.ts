import { describe, expect, it } from "bun:test";
import ExcelJS from "exceljs";

import {
  ACTIVE_PORTFOLIO_STATUSES,
  buildActivePortfolioRows,
  buildActivePortfolioWorkbook,
} from "./activePortfolioReport";

describe("active portfolio report", () => {
  it("uses all live cartera statuses", () => {
    expect(ACTIVE_PORTFOLIO_STATUSES).toEqual(["ACTIVO", "MOROSO", "EN_CONVENIO"]);
  });

  it("maps report rows with vehicle fallback and preserves SIFCO order", () => {
    const rows = buildActivePortfolioRows(
      [
        {
          numero_credito_sifco: "1002",
          seguro_10_cuotas: "1200.50",
          cliente_nombre: "Cliente B",
        },
        {
          numero_credito_sifco: "1001",
          seguro_10_cuotas: "980",
          cliente_nombre: "Cliente A",
        },
      ],
      new Map([
        ["1001", { licensePlate: "P123ABC", vinNumber: "VIN123" }],
      ]),
    );

    expect(rows).toEqual([
      {
        placa: "P123ABC",
        chasis: "VIN123",
        cuotaInterna: 980,
        clienteNombre: "Cliente A",
        numeroCredito: "1001",
      },
      {
        placa: "-",
        chasis: "-",
        cuotaInterna: 1200.5,
        clienteNombre: "Cliente B",
        numeroCredito: "1002",
      },
    ]);
  });

  it("builds the expected Excel worksheet", async () => {
    const buffer = await buildActivePortfolioWorkbook([
      {
        placa: "P123ABC",
        chasis: "VIN123",
        cuotaInterna: 980,
        clienteNombre: "Cliente A",
        numeroCredito: "1001",
      },
    ]);

    const workbook = new ExcelJS.Workbook();
    const workbookPayload = buffer as unknown as Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(workbookPayload);
    const worksheet = workbook.getWorksheet("Cartera Activa");

    expect(worksheet?.getRow(1).values).toEqual([
      undefined,
      "Placa",
      "Chasis",
      "Cuota Interna",
      "Nombre del Cliente",
      "Número de Crédito",
    ]);
    expect(worksheet?.rowCount).toBe(2);
    expect(worksheet?.getRow(2).values).toEqual([
      undefined,
      "P123ABC",
      "VIN123",
      980,
      "Cliente A",
      "1001",
    ]);
  });
});
