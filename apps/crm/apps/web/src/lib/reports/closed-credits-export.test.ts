import { expect, test } from "bun:test";
import * as XLSX from "xlsx";
import { buildClosedCreditsWorksheet } from "./closed-credits-export";

test("closed credit workbook preserves existing columns and appends vehicle, owner and lead source in order", () => {
	const sheet = buildClosedCreditsWorksheet(
		[
			{
				fechaCierre: new Date("2026-03-01T06:00:00Z"),
				clienteNombre: "Cliente Prueba",
				numeroSifco: "S-1",
				cuotaSeguro: "125.50",
				montoCredito: "12000.00",
				cuotaCredito: "500.25",
				diaPago: 15,
				marca: "Toyota",
				modelo: "Yaris",
				asesor: "Asesora Prueba",
				canalVenta: "sobre_vehiculo",
				fuenteLead: "instagram",
			},
		],
		() => "01 mar 2026",
	);
	const workbook = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(workbook, sheet, "Créditos cerrados");
	const output = XLSX.read(
		XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
		{ type: "buffer" },
	);
	expect(
		XLSX.utils.sheet_to_json(output.Sheets["Créditos cerrados"], { header: 1 }),
	).toEqual([
		[
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
		],
		[
			"01 mar 2026",
			"Cliente Prueba",
			"S-1",
			125.5,
			12000,
			500.25,
			15,
			"Toyota",
			"Yaris",
			"Asesora Prueba",
			"Sobre vehículo",
			"Instagram",
		],
	]);
});
