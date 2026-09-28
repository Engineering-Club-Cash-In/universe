import * as XLSX from "xlsx";
import { getLeadSourceLabel } from "@/lib/crm-formatters";

export type ClosedCreditExportRow = {
	fechaCierre: Date | string | null;
	clienteNombre: string | null;
	numeroSifco: string | null;
	cuotaSeguro: string | null;
	montoCredito: string | null;
	cuotaCredito: string | null;
	diaPago: number | null;
	marca: string | null;
	modelo: string | null;
	asesor: string | null;
	canalVenta: "autocompra" | "sobre_vehiculo";
	fuenteLead: string | null;
};

export function buildClosedCreditsWorksheet(
	rows: ClosedCreditExportRow[],
	formatDate: (value: string | Date | null) => string,
): XLSX.WorkSheet {
	const headers = [
		"Fecha de Cierre",
		"Nombre del Cliente",
		"SIFCO",
		"Cuota de Seguro",
		"Monto del Crédito",
		"Cuota del Crédito",
		"Día de Pago",
		"Marca del Vehículo",
		"Modelo",
		"Asesor",
		"Canal de Venta",
		"Fuente del Lead",
	];
	const data = rows.map((row) => [
		row.fechaCierre ? formatDate(row.fechaCierre) : "",
		row.clienteNombre || "",
		row.numeroSifco || "",
		Number(row.cuotaSeguro ?? 0),
		Number(row.montoCredito ?? 0),
		Number(row.cuotaCredito ?? 0),
		row.diaPago ?? "",
		row.marca || "",
		row.modelo || "",
		row.asesor || "",
		row.canalVenta === "sobre_vehiculo" ? "Sobre vehículo" : "Autocompra",
		getLeadSourceLabel(row.fuenteLead),
	]);
	return XLSX.utils.aoa_to_sheet([headers, ...data]);
}
