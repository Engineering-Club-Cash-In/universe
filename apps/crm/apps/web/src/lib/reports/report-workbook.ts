import * as XLSX from "xlsx";
import {
	getMontoACobrarViewRow,
	type MontoACobrarParticipacionRow,
} from "./monto-a-cobrar";
import {
	buildInvestorExportRows,
	buildReinvestmentReportModel,
	getBillingModeLabel,
	getPurchaseClassificationLabel,
	getReinvestmentModeLabel,
} from "./reinvestment-report";

export function buildAdminReportsWorkbook(input: {
	cobranza: { rows: MontoACobrarParticipacionRow[]; acumulado: boolean };
	reinvestment: unknown;
	metadata: {
		cobranzaPeriodo: string;
		inversionPeriodo: string;
		generatedAt: string;
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
	const append = (name: string, rows: Record<string, unknown>[]) =>
		XLSX.utils.book_append_sheet(
			workbook,
			XLSX.utils.json_to_sheet(rows),
			name,
		);
	const cobranzaRows = input.cobranza.rows.map((row) => {
		const view = getMontoACobrarViewRow(row, input.cobranza.acumulado);
		return {
			Período: row.bucket,
			"Cantidad de cuotas": row.cuotas_count,
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
		const last =
			cobranzaRows.findLast((row) => row["Cantidad de cuotas"] > 0) ??
			cobranzaRows.at(-1);
		if (!last) throw new Error("No fue posible totalizar Cobranza.");
		const total = { Período: "Total" } as Record<string, string | number>;
		for (const key of Object.keys(last).slice(1)) {
			total[key] = input.cobranza.acumulado
				? Number(last[key as keyof typeof last])
				: Math.round(
						cobranzaRows.reduce(
							(sum, row) => sum + Number(row[key as keyof typeof row]),
							0,
						) * 100,
					) / 100;
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
			"Compras",
			model.data.detalleComprasMes.map((row) => ({
				Fecha: row.fecha,
				Inversionista: row.inversionista,
				"Modalidad de facturación": getBillingModeLabel(
					row.modalidad_facturacion,
				),
				"Tipo de reinversión": getReinvestmentModeLabel(row.tipo_reinversion),
				"Tipo de compra": getPurchaseClassificationLabel(row.tipo_compra),
				Monto: Number(row.monto),
				"Ticket promedio del período": model.summary.ticket.amount,
				"Nuevas posiciones del período": model.summary.ticket.count,
			})),
		);
		append(
			"Interés",
			model.data.detalleInteresNeto.map((row) => ({
				Inversionista: row.inversionista,
				Referencia: row.referencia,
				"Tratamiento fiscal": row.tratamiento_fiscal,
				Interés: Number(row.interes),
				IVA: Number(row.iva),
				ISR: Number(row.isr),
				Neto: row.tratamiento_fiscal === "cube" ? Number(row.neto) : null,
			})),
		);
	} else {
		for (const sheet of ["Modalidades", "Inversionistas", "Compras", "Interés"])
			append(sheet, [{ Estado: "Contrato incompatible" }]);
	}

	append("Metadatos", [
		{ Campo: "Período Cobranza", Valor: input.metadata.cobranzaPeriodo },
		{ Campo: "Período Inversión", Valor: input.metadata.inversionPeriodo },
		{ Campo: "Generado", Valor: input.metadata.generatedAt },
		{
			Campo: "Contrato Inversión",
			Valor: model.compatible ? 3 : "Incompatible",
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
