import * as XLSX from "xlsx";
import {
	getMontoACobrarViewRow,
	type MontoACobrarParticipacionRow,
} from "./monto-a-cobrar";
import {
	buildInvestorExportRows,
	buildReinvestmentReportModel,
	getBillingModeLabel,
	getFundingOriginLabel,
	getReinvestmentModeLabel,
} from "./reinvestment-report";

// Estilos en formato xlsx-js-style (`cell.s`). El workbook se arma con `xlsx`,
// pero hay que escribirlo con xlsx-js-style para que los estilos lleguen al
// archivo: `xlsx` los descarta al escribir. Misma paleta que el export SAT.
const COLOR_ENCABEZADO = "1F4E78";
const COLOR_ALTERNO = "F3F8FC";
const COLOR_TOTAL = "DDEBF7";
const COLOR_BORDE = "D9D9D9";
const FORMATO_MONEDA = '"Q"#,##0.00;[Red]-"Q"#,##0.00';
const FORMATO_PORCENTAJE = '0.00"%";[Red]-0.00"%"';
const FORMATO_ENTERO = "#,##0";
// Porcentajes vienen ya en puntos (34.84 = 34.84 %), no como fracción.
const esColumnaPorcentaje = (header: string) =>
	header === "Porcentaje" || header.startsWith("%");
const COLUMNAS_ENTERAS = new Set([
	"Cantidad de cuotas",
	"Base",
	"Compras nuevas del período",
]);

const bordeFino = {
	top: { style: "thin", color: { rgb: COLOR_BORDE } },
	bottom: { style: "thin", color: { rgb: COLOR_BORDE } },
	left: { style: "thin", color: { rgb: COLOR_BORDE } },
	right: { style: "thin", color: { rgb: COLOR_BORDE } },
};

// Cada hoja declara lo que es: así un número de una hoja que no es de montos
// (p. ej. la versión de contrato en Metadatos) no sale como Q, y una fila
// "Total" solo se trata como total en la hoja que de verdad lo agrega.
type EstiloHoja = {
	// Los números que no son porcentaje ni entero son montos (Q).
	moneda?: boolean;
	// La última fila con "Total" en la primera columna es el total agregado.
	filaTotal?: boolean;
};

function formatoDeColumna(header: string, moneda: boolean) {
	if (esColumnaPorcentaje(header)) return FORMATO_PORCENTAJE;
	if (COLUMNAS_ENTERAS.has(header)) return FORMATO_ENTERO;
	return moneda ? FORMATO_MONEDA : undefined;
}

function textoVisible(value: unknown, header: string, moneda: boolean) {
	if (typeof value !== "number") return String(value ?? "");
	if (esColumnaPorcentaje(header)) return `${value.toFixed(2)}%`;
	if (COLUMNAS_ENTERAS.has(header)) return value.toLocaleString("en-US");
	if (!moneda) return String(value);
	return `Q${value.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

function aplicarEstilo(
	sheet: XLSX.WorkSheet,
	rows: Record<string, unknown>[],
	{ moneda = false, filaTotal = false }: EstiloHoja,
) {
	if (!sheet["!ref"] || rows.length === 0) return;
	const range = XLSX.utils.decode_range(sheet["!ref"]);
	// json_to_sheet ya dejó los encabezados en la fila 0.
	const headers = Array.from({ length: range.e.c + 1 }, (_, c) =>
		String(sheet[XLSX.utils.encode_cell({ r: 0, c })]?.v ?? ""),
	);
	const ultimaFila = range.e.r;
	// La fila de total y la columna de etiqueta (Métrica/Campo) van en negrita
	// para que se lean como encabezado de fila. Solo la última fila puede ser el
	// total agregado; una fila de datos que diga "Total" sigue siendo un dato.
	const esTotal = (r: number) =>
		filaTotal &&
		r > 0 &&
		r === ultimaFila &&
		sheet[XLSX.utils.encode_cell({ r, c: 0 })]?.v === "Total";
	const columnaEtiqueta = ["Métrica", "Campo"].includes(headers[0] ?? "");

	for (let r = 0; r <= ultimaFila; r++) {
		for (let c = range.s.c; c <= range.e.c; c++) {
			const ref = XLSX.utils.encode_cell({ r, c });
			const header = headers[c] ?? "";
			// Celdas vacías también llevan borde/relleno para que la tabla se vea pareja.
			if (!sheet[ref]) sheet[ref] = { t: "s", v: "" };
			const cell = sheet[ref] as XLSX.CellObject & { s?: unknown };
			if (r === 0) {
				cell.s = {
					font: { bold: true, color: { rgb: "FFFFFF" } },
					fill: { patternType: "solid", fgColor: { rgb: COLOR_ENCABEZADO } },
					alignment: {
						horizontal: "center",
						vertical: "center",
						wrapText: true,
					},
					border: bordeFino,
				};
				continue;
			}
			const total = esTotal(r);
			const fill = total
				? { patternType: "solid", fgColor: { rgb: COLOR_TOTAL } }
				: r % 2 === 0
					? { patternType: "solid", fgColor: { rgb: COLOR_ALTERNO } }
					: undefined;
			const color =
				cell.v === "No" ? "C00000" : cell.v === "Sí" ? "2E7D32" : undefined;
			const formato =
				cell.t === "n" ? formatoDeColumna(header, moneda) : undefined;
			if (formato) cell.z = formato;
			cell.s = {
				font: {
					bold: total || (columnaEtiqueta && c === 0),
					...(color && { color: { rgb: color } }),
				},
				...(fill && { fill }),
				alignment: {
					vertical: "center",
					horizontal: cell.t === "n" ? "right" : "left",
				},
				border: total
					? {
							...bordeFino,
							top: { style: "medium", color: { rgb: COLOR_ENCABEZADO } },
						}
					: bordeFino,
			};
		}
	}

	sheet["!cols"] = headers.map((header) => ({
		// reduce y no Math.max(...rows): el spread tiene tope de argumentos.
		wch: Math.min(
			50,
			rows.reduce(
				(max, row) =>
					Math.max(max, textoVisible(row[header], header, moneda).length + 2),
				Math.max(12, header.length + 2),
			),
		),
	}));
	sheet["!rows"] = [{ hpt: 30 }];
	// El filtro deja fuera la fila Total: si no, ordenar la mezcla con los datos.
	const finFiltro = esTotal(ultimaFila) ? ultimaFila - 1 : ultimaFila;
	sheet["!autofilter"] = {
		ref: XLSX.utils.encode_range({
			s: range.s,
			e: { r: finFiltro, c: range.e.c },
		}),
	};
}

export async function writeAdminReportsWorkbook(
	workbook: XLSX.WorkBook,
	fileName: string,
) {
	// Import diferido: la librería con estilos solo se baja al exportar.
	const XLSXStyle = await import("xlsx-js-style");
	XLSXStyle.writeFile(workbook as never, fileName);
}

// Hojas de montos: todo número que no sea porcentaje ni entero es Q. Las que
// no están (Metadatos) quedan en formato General.
const ESTILO_POR_HOJA: Record<string, EstiloHoja> = {
	Resumen: { moneda: true },
	Cobranza: { moneda: true, filaTotal: true },
	Modalidades: { moneda: true },
	Inversionistas: { moneda: true },
	Movimientos: { moneda: true },
	Interés: { moneda: true },
};

export function buildAdminReportsWorkbook(input: {
	cobranza: { rows: MontoACobrarParticipacionRow[]; acumulado: boolean };
	reinvestment: unknown;
	metadata: {
		cobranzaPeriodo: string;
		inversionPeriodo: string;
		generatedAt: string;
		avisoMoraMes?: string;
	};
}) {
	const model = buildReinvestmentReportModel(input.reinvestment);
	if (
		!model.compatible ||
		!model.reconciled ||
		!model.data.detalle_estado.disponible
	) {
		throw new Error(
			"La exportación requiere un reporte de inversión completo y conciliado.",
		);
	}
	const workbook = XLSX.utils.book_new();
	const append = (name: string, rows: Record<string, unknown>[]) => {
		const sheet = XLSX.utils.json_to_sheet(rows);
		aplicarEstilo(sheet, rows, ESTILO_POR_HOJA[name] ?? {});
		XLSX.utils.book_append_sheet(workbook, sheet, name);
	};
	const cobranzaRows = input.cobranza.rows.map((row) => {
		const view = getMontoACobrarViewRow(row, input.cobranza.acumulado);
		return {
			Período: row.bucket,
			"Cantidad de cuotas": view.cuotas,
			Capital: view.capital,
			"Interés + IVA": view.interesIva,
			Servicios: view.servicios,
			Membresías: view.membresias,
			"Total mora": view.totalMora,
			Total: view.total,
			"Capital CUBE": view.capitalCube,
			"Interés + IVA CUBE": view.interesIvaCube,
			Facturación: view.facturacion,
		};
	});
	if (cobranzaRows.length > 0) {
		const last = cobranzaRows.at(-1);
		if (!last) throw new Error("No fue posible totalizar Cobranza.");
		const total = { Período: "Total" } as Record<string, string | number>;
		for (const key of Object.keys(last).slice(1)) {
			total[key] = !input.cobranza.acumulado
				? Math.round(
						cobranzaRows.reduce(
							(sum, row) => sum + Number(row[key as keyof typeof row]),
							0,
						) * 100,
					) / 100
				: Number(last[key as keyof typeof last]);
		}
		cobranzaRows.push(total as (typeof cobranzaRows)[number]);
	}

	if (model.compatible) {
		append("Resumen", [
			{
				Métrica: "Pagado a inversionistas",
				Valor: model.summary.paid.total,
				Porcentaje: model.summary.paid.percentage,
				Capital: model.summary.paid.capital,
				Resto: model.summary.paid.rest,
				"Sin clasificar": model.summary.paid.unclassified,
			},
			{
				Métrica: "Reinvertido",
				Valor: model.summary.reinvested.total,
				Porcentaje: model.summary.reinvested.percentage,
				Capital: model.summary.reinvested.capital,
				Resto: model.summary.reinvested.rest,
				"Sin clasificar": model.summary.reinvested.unclassified,
			},
			{
				Métrica: "Flujo liquidado",
				Valor: model.summary.flow.total,
				Porcentaje: model.summary.flow.percentage,
				Capital: model.summary.flow.capital,
				Resto: model.summary.flow.rest,
			},
			{
				Métrica: "Ticket promedio",
				Valor: model.summary.ticket.amount,
				Porcentaje: model.summary.ticket.variationPercentage,
				Base: model.summary.ticket.count,
			},
			{
				Métrica: "Interés registrado",
				Valor: model.summary.interest.total,
				"Interés inversionistas": model.summary.interest.investors.amount,
				"% inversionistas": model.summary.interest.investors.percentage,
				"Interés CUBE": model.summary.interest.cube.amount,
				"% CUBE": model.summary.interest.cube.percentage,
			},
		]);
	} else {
		append("Resumen", [{ Estado: "Contrato incompatible" }]);
	}
	append("Cobranza", cobranzaRows);

	if (model.compatible) {
		append(
			"Modalidades",
			model.rows.map((row) => ({
				Modalidad: row.label,
				"Pagado capital": row.destinationComposition.paid.capital,
				"Pagado resto": row.destinationComposition.paid.rest,
				"Pagado sin clasificar": row.destinationComposition.paid.unclassified,
				Pagado: row.paid,
				"Reinvertido capital": row.destinationComposition.reinvested.capital,
				"Reinvertido resto": row.destinationComposition.reinvested.rest,
				"Reinvertido sin clasificar":
					row.destinationComposition.reinvested.unclassified,
				Reinvertido: row.reinvested,
				"Flujo capital": row.destinationComposition.flow.capital,
				"Flujo resto": row.destinationComposition.flow.rest,
				"Flujo total": row.distributed,
				Conciliado: row.reconciled ? "Sí" : "No",
			})),
		);
		append("Inversionistas", buildInvestorExportRows(model.data));
		append(
			"Movimientos",
			model.data.detalleComprasMes.map((row) => ({
				Fecha: row.fecha,
				Inversionista: row.inversionista,
				"Modalidad de facturación": getBillingModeLabel(
					row.modalidad_facturacion,
				),
				"Tipo de reinversión": getReinvestmentModeLabel(row.tipo_reinversion),
				"Origen del dinero": getFundingOriginLabel(row.origen_dinero),
				Monto: Number(row.monto),
				"Ticket promedio del período": model.summary.ticket.amount,
				"Compras nuevas del período": model.summary.ticket.count,
			})),
		);
		append(
			"Interés",
			model.data.detalleInteresNeto.map((row) => ({
				Inversionista: row.inversionista,
				Referencia: row.referencia,
				"Tratamiento fiscal":
					row.tratamiento_fiscal === "cube" ? "CUBE" : "No verificado",
				Interés: Number(row.interes),
				IVA: Number(row.iva),
				ISR: Number(row.isr),
				Neto: row.tratamiento_fiscal === "cube" ? Number(row.neto) : null,
			})),
		);
	} else {
		for (const sheet of [
			"Modalidades",
			"Inversionistas",
			"Movimientos",
			"Interés",
		])
			append(sheet, [{ Estado: "Contrato incompatible" }]);
	}

	append("Metadatos", [
		{ Campo: "Período Cobranza", Valor: input.metadata.cobranzaPeriodo },
		{ Campo: "Período Inversión", Valor: input.metadata.inversionPeriodo },
		{ Campo: "Generado", Valor: input.metadata.generatedAt },
		...(input.metadata.avisoMoraMes
			? [{ Campo: "Mora del mes", Valor: input.metadata.avisoMoraMes }]
			: []),
		{
			Campo: "Contrato Inversión",
			Valor: model.compatible ? model.data.contrato_version : "Incompatible",
		},
		{
			Campo: "Advertencia legacy",
			Valor:
				model.compatible &&
				model.rows.some((row) => row.compositionStatus === "unavailable")
					? "Existen montos históricos sin clasificación."
					: "Ninguna",
		},
	]);
	return workbook;
}
