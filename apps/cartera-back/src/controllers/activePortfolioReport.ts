import ExcelJS from "exceljs";
import { sql, type SQL } from "drizzle-orm";
import { creditos, usuarios } from "../database/db/schema";

export const ACTIVE_PORTFOLIO_STATUSES = ["ACTIVO", "MOROSO", "EN_CONVENIO"] as const;

export type ActivePortfolioCredit = {
  numero_credito_sifco: string;
  seguro_10_cuotas: string | number;
  cliente_nombre: string;
};

export type ActivePortfolioVehicle = {
  licensePlate?: string | null;
  vinNumber?: string | null;
};

export type ActivePortfolioRow = {
  placa: string;
  chasis: string;
  cuotaInterna: number;
  clienteNombre: string;
  numeroCredito: string;
};

type DbExecutor = {
  execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }>;
};

function toText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toNumber(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function buildActivePortfolioRows(
  credits: ActivePortfolioCredit[],
  vehiclesBySifco: Map<string, ActivePortfolioVehicle>,
): ActivePortfolioRow[] {
  return [...credits]
    .sort((a, b) => a.numero_credito_sifco.localeCompare(b.numero_credito_sifco))
    .map((credit) => {
      const vehicle = vehiclesBySifco.get(credit.numero_credito_sifco);
      return {
        placa: vehicle?.licensePlate || "-",
        chasis: vehicle?.vinNumber || "-",
        cuotaInterna: toNumber(credit.seguro_10_cuotas),
        clienteNombre: credit.cliente_nombre,
        numeroCredito: credit.numero_credito_sifco,
      };
    });
}

export async function getActivePortfolioCredits(executor: DbExecutor): Promise<ActivePortfolioCredit[]> {
  const activeStatusSql = sql.join(ACTIVE_PORTFOLIO_STATUSES.map((status) => sql`${status}`), sql`, `);
  const result = await executor.execute(sql`
    SELECT
      c.numero_credito_sifco,
      c.seguro_10_cuotas,
      u.nombre AS cliente_nombre
    FROM ${creditos} c
    JOIN ${usuarios} u ON u.usuario_id = c.usuario_id
    WHERE c."statusCredit" IN (${activeStatusSql})
    ORDER BY c.numero_credito_sifco
  `);
  return result.rows.map((row) => ({
    numero_credito_sifco: toText(row.numero_credito_sifco),
    seguro_10_cuotas: toNumber(row.seguro_10_cuotas),
    cliente_nombre: toText(row.cliente_nombre),
  }));
}

export async function buildActivePortfolioWorkbook(rows: ActivePortfolioRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Cartera Activa");

  ws.columns = [
    { header: "Placa", key: "placa", width: 16 },
    { header: "Chasis", key: "chasis", width: 26 },
    { header: "Cuota Interna", key: "cuotaInterna", width: 16 },
    { header: "Nombre del Cliente", key: "clienteNombre", width: 34 },
    { header: "Número de Crédito", key: "numeroCredito", width: 22 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = "A1:E1";

  for (const row of rows) {
    ws.addRow(row);
  }
  ws.getColumn("cuotaInterna").numFmt = "#,##0.00";

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
