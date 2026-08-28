import type { ReinversionLiquidacionesResponse } from "./scenario";

const cents = (value: number | string) => Math.round(Number(value) * 100);
const sumCents = (values: (number | string)[]) =>
	values.reduce<number>((total, value) => total + cents(value), 0);
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const isMoney = (value: unknown): value is string =>
	typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value);
const hasMoneyFields = (value: unknown, fields: string[]) =>
	isRecord(value) && fields.every((field) => isMoney(value[field]));
const hasStringFields = (value: unknown, fields: string[]) =>
	isRecord(value) && fields.every((field) => typeof value[field] === "string");
const isNonnegativeInteger = (value: unknown) =>
	typeof value === "number" && Number.isInteger(value) && value >= 0;
const MODES = new Set([
	"sin_reinversion",
	"reinversion_capital",
	"reinversion_interes",
	"reinversion_total",
	"reinversion_variable",
	"reinversion_excedente",
	"reinversion_combinada",
	"sin_clasificar",
]);
const BILLING_MODES = new Set([
	"p2p_directa",
	"factura_cube",
	"factura_cube_pequeno",
	"sin_modalidad",
]);
const PURCHASE_CLASSIFICATIONS = new Set([
	"nueva_posicion",
	"ampliacion_posicion",
	"sin_clasificar",
]);

const MODE_MONEY_FIELDS = [
	"reinversion_capital",
	"reinversion_interes",
	"reinversion_total",
	"total_capital",
	"total_interes",
	"total_iva",
	"iva_facturado",
	"total_isr",
	"total_cuota",
	"total_distribuido",
];

const isCompositionDestination = (value: unknown, unclassified = false) =>
	hasMoneyFields(value, [
		"capital",
		"resto",
		"total",
		...(unclassified ? ["sin_clasificar"] : []),
	]);

const isLiquidationComposition = (value: unknown) =>
	isRecord(value) &&
	isCompositionDestination(value.pagado, true) &&
	isCompositionDestination(value.reinvertido, true) &&
	isCompositionDestination(value.flujo) &&
	(value.estado === "exacto" || value.estado === "sin_clasificar");

export function getCompatibleReportData(
	input: unknown,
): ReinversionLiquidacionesResponse | undefined {
	if (!isRecord(input) || input.contrato_version !== 3) return undefined;
	if (!isRecord(input.porTipo)) return undefined;
	if (
		!Object.keys(input.porTipo).every((key) => MODES.has(key)) ||
		!Object.values(input.porTipo).every(
			(row) =>
				isRecord(row) &&
				hasMoneyFields(row, MODE_MONEY_FIELDS) &&
				isNonnegativeInteger(row.cantidad_liquidaciones) &&
				isLiquidationComposition(row.composicion),
		)
	)
		return undefined;
	if (
		!Array.isArray(input.porInversionista) ||
		!input.porInversionista.every(
			(row) =>
				isRecord(row) &&
				isNonnegativeInteger(row.inversionista_id) &&
				typeof row.nombre === "string" &&
				row.nombre.trim().length > 0 &&
				MODES.has(String(row.tipo_reinversion)) &&
				hasStringFields(row, ["nombre", "tipo_reinversion"]) &&
				hasMoneyFields(row, [
					"reinversion_capital",
					"reinversion_interes",
					"reinversion",
					"a_recibir",
					"capital_activo",
				]) &&
				isLiquidationComposition(row.composicion),
		)
	)
		return undefined;
	if (
		!isRecord(input.interesNeto) ||
		!hasMoneyFields(input.interesNeto.noVerificado, ["interes"]) ||
		!hasMoneyFields(input.interesNeto.cube, ["interes", "iva", "neto"])
	)
		return undefined;
	if (
		!hasMoneyFields(input.pagosExtras, ["abonos_capital", "cancelaciones"]) ||
		!Array.isArray(input.comprasMes) ||
		!input.comprasMes.every(
			(row) =>
				isRecord(row) &&
				BILLING_MODES.has(String(row.modalidad_facturacion)) &&
				MODES.has(String(row.tipo_reinversion)) &&
				PURCHASE_CLASSIFICATIONS.has(String(row.tipo_compra)) &&
				isNonnegativeInteger(row.cantidad) &&
				isMoney(row.monto),
		)
	)
		return undefined;
	if (
		!isRecord(input.ticketInversion) ||
		!isRecord(input.ticketInversion.actual) ||
		!/^\d{4}-\d{2}$/.test(String(input.ticketInversion.actual.periodo)) ||
		!isNonnegativeInteger(input.ticketInversion.actual.cantidad) ||
		!hasMoneyFields(input.ticketInversion.actual, [
			"monto_total",
			"ticket_promedio",
		]) ||
		!(
			input.ticketInversion.actual.variacion_porcentual === null ||
			(typeof input.ticketInversion.actual.variacion_porcentual === "string" &&
				/^-?\d+(?:\.\d+)?$/.test(
					input.ticketInversion.actual.variacion_porcentual,
				))
		) ||
		!Array.isArray(input.ticketInversion.historico) ||
		!input.ticketInversion.historico.every(
			(row) =>
				isRecord(row) &&
				/^\d{4}-\d{2}$/.test(String(row.periodo)) &&
				isNonnegativeInteger(row.cantidad) &&
				hasMoneyFields(row, ["monto_total", "ticket_promedio"]),
		)
	)
		return undefined;
	if (
		!Array.isArray(input.detalleInteresNeto) ||
		!input.detalleInteresNeto.every(
			(row) =>
				isRecord(row) &&
				isNonnegativeInteger(row.inversionista_id) &&
				hasStringFields(row, [
					"inversionista",
					"referencia",
					"tratamiento_fiscal",
				]) &&
				((row.tratamiento_fiscal === "no_verificado" &&
					hasMoneyFields(row, ["interes", "iva", "isr"]) &&
					!("neto" in row)) ||
					(row.tratamiento_fiscal === "cube" &&
						hasMoneyFields(row, ["interes", "iva", "isr", "neto"]))),
		)
	)
		return undefined;
	if (
		!Array.isArray(input.detallePagosExtras) ||
		!input.detallePagosExtras.every(
			(row) =>
				hasStringFields(row, ["fecha", "credito"]) &&
				isRecord(row) &&
				(row.tipo === "abono_capital" || row.tipo === "cancelacion") &&
				isMoney(row.monto),
		) ||
		!Array.isArray(input.detalleComprasMes) ||
		!input.detalleComprasMes.every(
			(row) =>
				hasStringFields(row, ["fecha", "inversionista"]) &&
				isRecord(row) &&
				BILLING_MODES.has(String(row.modalidad_facturacion)) &&
				MODES.has(String(row.tipo_reinversion)) &&
				PURCHASE_CLASSIFICATIONS.has(String(row.tipo_compra)) &&
				isMoney(row.monto),
		)
	)
		return undefined;
	if (
		!isRecord(input.detalle_estado) ||
		typeof input.detalle_estado.disponible !== "boolean" ||
		!(
			(input.detalle_estado.disponible === true &&
				input.detalle_estado.error === null) ||
			(input.detalle_estado.disponible === false &&
				typeof input.detalle_estado.error === "string" &&
				input.detalle_estado.error.trim().length > 0)
		) ||
		!isNonnegativeInteger(input.cantidad_liquidaciones)
	)
		return undefined;
	return input as ReinversionLiquidacionesResponse;
}

const labels: Record<string, string> = {
	sin_reinversion: "Tradicional",
	reinversion_capital: "Reinversión de capital",
	reinversion_interes: "Reinversión de interés",
	reinversion_total: "Interés compuesto",
	reinversion_variable: "Reinversión variable",
	reinversion_excedente: "Reinversión excedente",
	reinversion_combinada: "Reinversión combinada",
	sin_clasificar: "Sin clasificación histórica",
};

const billingLabels: Record<string, string> = {
	p2p_directa: "P2P directa",
	factura_cube: "Factura CUBE",
	factura_cube_pequeno: "Factura CUBE pequeño contribuyente",
	sin_modalidad: "Sin modalidad",
};

const purchaseLabels: Record<string, string> = {
	nueva_posicion: "Nueva posición",
	ampliacion_posicion: "Ampliación de posición",
	sin_clasificar: "Sin clasificar",
};

export const getReinvestmentModeLabel = (value: string) =>
	labels[value] ?? value;
export const getBillingModeLabel = (value: string) =>
	billingLabels[value] ?? value;
export const getPurchaseClassificationLabel = (value: string) =>
	purchaseLabels[value] ?? value;

export type ReinvestmentModeRow = {
	type: string;
	label: string;
	paid: number;
	reinvested: number;
	distributed: number;
	active: number;
	composition: {
		capital: number;
		interest: number;
		billedVat: number;
		withheldIsr: number;
		distributed: number;
	};
	reinvestmentComposition: {
		capital: number;
		interest: number;
	};
	destinationComposition: {
		paid: {
			capital: number;
			rest: number;
			unclassified: number;
			total: number;
		};
		reinvested: {
			capital: number;
			rest: number;
			unclassified: number;
			total: number;
		};
		flow: { capital: number; rest: number; total: number };
	};
	reconciled: boolean;
	roundingResidual: number | null;
	compositionStatus: "exact" | "tolerance" | "failed" | "unavailable";
	historicalModeVerified: boolean;
};

const emptySummary = {
	paid: { total: 0, percentage: 0, capital: 0, rest: 0, unclassified: 0 },
	reinvested: {
		total: 0,
		percentage: 0,
		capital: 0,
		rest: 0,
		unclassified: 0,
	},
	flow: { total: 0, percentage: 0, capital: 0, rest: 0 },
	ticket: { amount: 0, count: 0, variationPercentage: null as number | null },
	interest: {
		total: 0,
		investors: { amount: 0, percentage: 0 },
		cube: { amount: 0, percentage: 0 },
	},
};

const incompatibleModel = {
	compatible: false as const,
	data: undefined,
	rows: [] as ReinvestmentModeRow[],
	totals: { distributed: 0, paid: 0, reinvested: 0, active: 0 },
	summary: emptySummary,
	reconciliations: {
		destinations: false,
		modes: false,
		interest: false,
		extras: false,
		purchases: false,
		contract: false,
		composition: "failed" as const,
	},
	reconciled: false,
};

export function buildReinvestmentReportModel(input: unknown) {
	const data = getCompatibleReportData(input);
	if (!data) return incompatibleModel;
	const rows = Object.entries(data.porTipo)
		.map(([type, value]): ReinvestmentModeRow => {
			const paid = Number(value.total_cuota);
			const reinvested = Number(value.reinversion_total);
			const distributed = Number(value.total_distribuido);
			const composition = {
				capital: Number(value.total_capital),
				interest: Number(value.total_interes),
				billedVat: Number(value.iva_facturado),
				withheldIsr: Number(value.total_isr),
				distributed,
			};
			const destinationComposition = {
				paid: {
					capital: Number(value.composicion.pagado.capital),
					rest: Number(value.composicion.pagado.resto),
					unclassified: Number(value.composicion.pagado.sin_clasificar),
					total: Number(value.composicion.pagado.total),
				},
				reinvested: {
					capital: Number(value.composicion.reinvertido.capital),
					rest: Number(value.composicion.reinvertido.resto),
					unclassified: Number(value.composicion.reinvertido.sin_clasificar),
					total: Number(value.composicion.reinvertido.total),
				},
				flow: {
					capital: Number(value.composicion.flujo.capital),
					rest: Number(value.composicion.flujo.resto),
					total: Number(value.composicion.flujo.total),
				},
			};
			const compositionReconciles =
				sumCents([
					destinationComposition.paid.capital,
					destinationComposition.paid.rest,
					destinationComposition.paid.unclassified,
				]) === cents(destinationComposition.paid.total) &&
				sumCents([
					destinationComposition.reinvested.capital,
					destinationComposition.reinvested.rest,
					destinationComposition.reinvested.unclassified,
				]) === cents(destinationComposition.reinvested.total) &&
				sumCents([
					destinationComposition.flow.capital,
					destinationComposition.flow.rest,
				]) === cents(destinationComposition.flow.total);
			return {
				type,
				label: labels[type] ?? type,
				paid,
				reinvested,
				distributed,
				active: data.porInversionista
					.filter((investor) => investor.tipo_reinversion === type)
					.reduce(
						(total, investor) => total + Number(investor.capital_activo),
						0,
					),
				composition,
				reinvestmentComposition: {
					capital: destinationComposition.reinvested.capital,
					interest: destinationComposition.reinvested.rest,
				},
				destinationComposition,
				reconciled:
					sumCents([paid, reinvested]) === cents(distributed) &&
					cents(destinationComposition.flow.capital) ===
						cents(value.total_capital) &&
					cents(destinationComposition.reinvested.capital) ===
						cents(value.reinversion_capital) &&
					cents(destinationComposition.reinvested.rest) ===
						cents(value.reinversion_interes) &&
					cents(destinationComposition.paid.total) === cents(paid) &&
					cents(destinationComposition.reinvested.total) ===
						cents(reinvested) &&
					cents(destinationComposition.flow.total) === cents(distributed) &&
					compositionReconciles,
				roundingResidual: 0,
				compositionStatus:
					value.composicion.estado === "exacto" ? "exact" : "unavailable",
				historicalModeVerified: type !== "sin_clasificar",
			};
		})
		.filter((row) => row.distributed !== 0 || row.active !== 0);
	const totals = rows.reduce(
		(total, row) => ({
			distributed: total.distributed + row.distributed,
			paid: total.paid + row.paid,
			reinvested: total.reinvested + row.reinvested,
			active: total.active + row.active,
		}),
		{ distributed: 0, paid: 0, reinvested: 0, active: 0 },
	);
	const roundedTotals = Object.fromEntries(
		Object.entries(totals).map(([key, value]) => [
			key,
			Math.round(value * 100) / 100,
		]),
	) as typeof totals;
	const roundMoney = (value: number) => Math.round(value * 100) / 100;
	const percentage = (value: number, total: number) =>
		total === 0 ? 0 : Math.round((value / total) * 10_000) / 100;
	const compositionTotals = rows.reduce(
		(total, row) => ({
			paidCapital: total.paidCapital + row.destinationComposition.paid.capital,
			paidRest: total.paidRest + row.destinationComposition.paid.rest,
			paidUnclassified:
				total.paidUnclassified + row.destinationComposition.paid.unclassified,
			reinvestedCapital:
				total.reinvestedCapital + row.destinationComposition.reinvested.capital,
			reinvestedRest:
				total.reinvestedRest + row.destinationComposition.reinvested.rest,
			reinvestedUnclassified:
				total.reinvestedUnclassified +
				row.destinationComposition.reinvested.unclassified,
			flowCapital: total.flowCapital + row.destinationComposition.flow.capital,
			flowRest: total.flowRest + row.destinationComposition.flow.rest,
		}),
		{
			paidCapital: 0,
			paidRest: 0,
			paidUnclassified: 0,
			reinvestedCapital: 0,
			reinvestedRest: 0,
			reinvestedUnclassified: 0,
			flowCapital: 0,
			flowRest: 0,
		},
	);
	const cubeRows = data.detalleInteresNeto.filter(
		(row) => row.tratamiento_fiscal === "cube",
	);
	const noVerificadoRows = data.detalleInteresNeto.filter(
		(row) => row.tratamiento_fiscal === "no_verificado",
	);
	const noVerificadoMatches =
		sumCents(noVerificadoRows.map((row) => row.interes)) ===
		cents(data.interesNeto.noVerificado.interes);
	const extrasByCategory =
		sumCents(
			data.detallePagosExtras
				.filter((row) => row.tipo === "abono_capital")
				.map((row) => row.monto),
		) === cents(data.pagosExtras.abonos_capital) &&
		sumCents(
			data.detallePagosExtras
				.filter((row) => row.tipo === "cancelacion")
				.map((row) => row.monto),
		) === cents(data.pagosExtras.cancelaciones);
	const purchaseKey = (row: {
		modalidad_facturacion: string;
		tipo_reinversion: string;
		tipo_compra: string;
	}) =>
		`${row.modalidad_facturacion}\u0000${row.tipo_reinversion}\u0000${row.tipo_compra}`;
	const purchasesByMode = data.comprasMes.every(
		(summary) =>
			data.detalleComprasMes.filter(
				(row) => purchaseKey(row) === purchaseKey(summary),
			).length === summary.cantidad &&
			sumCents(
				data.detalleComprasMes
					.filter((row) => purchaseKey(row) === purchaseKey(summary))
					.map((row) => row.monto),
			) === cents(summary.monto),
	);
	const reconciliations = {
		destinations:
			cents(roundedTotals.paid + roundedTotals.reinvested) ===
			cents(roundedTotals.distributed),
		modes: rows.every((row) => row.reconciled),
		interest:
			noVerificadoMatches &&
			sumCents(cubeRows.map((row) => row.neto)) ===
				cents(data.interesNeto.cube.neto) &&
			cubeRows.length <= 1 &&
			data.detalleInteresNeto.every(
				(row) =>
					row.tratamiento_fiscal === "no_verificado" ||
					row.tratamiento_fiscal === "cube",
			),
		extras:
			sumCents(data.detallePagosExtras.map((row) => row.monto)) ===
				sumCents([
					data.pagosExtras.abonos_capital,
					data.pagosExtras.cancelaciones,
				]) &&
			extrasByCategory &&
			data.detallePagosExtras.every(
				(row) => row.tipo === "abono_capital" || row.tipo === "cancelacion",
			),
		purchases:
			sumCents(data.detalleComprasMes.map((row) => row.monto)) ===
				sumCents(data.comprasMes.map((row) => row.monto)) &&
			purchasesByMode &&
			data.detalleComprasMes.every((row) =>
				data.comprasMes.some(
					(summary) => purchaseKey(summary) === purchaseKey(row),
				),
			),
		contract: data.detalle_estado.disponible,
		composition: rows.some((row) => row.compositionStatus === "unavailable")
			? "unavailable"
			: rows.some((row) => row.compositionStatus === "failed")
				? "failed"
				: rows.some((row) => row.compositionStatus === "tolerance")
					? "tolerance"
					: "exact",
	};
	const interestInvestors = Number(data.interesNeto.noVerificado.interes);
	const interestCube = Number(data.interesNeto.cube.interes);
	const interestTotal = roundMoney(interestInvestors + interestCube);
	const summary = {
		paid: {
			total: roundedTotals.paid,
			percentage: percentage(roundedTotals.paid, roundedTotals.distributed),
			capital: roundMoney(compositionTotals.paidCapital),
			rest: roundMoney(compositionTotals.paidRest),
			unclassified: roundMoney(compositionTotals.paidUnclassified),
		},
		reinvested: {
			total: roundedTotals.reinvested,
			percentage: percentage(
				roundedTotals.reinvested,
				roundedTotals.distributed,
			),
			capital: roundMoney(compositionTotals.reinvestedCapital),
			rest: roundMoney(compositionTotals.reinvestedRest),
			unclassified: roundMoney(compositionTotals.reinvestedUnclassified),
		},
		flow: {
			total: roundedTotals.distributed,
			percentage: roundedTotals.distributed === 0 ? 0 : 100,
			capital: roundMoney(compositionTotals.flowCapital),
			rest: roundMoney(compositionTotals.flowRest),
		},
		ticket: {
			amount: Number(data.ticketInversion.actual.ticket_promedio),
			count: data.ticketInversion.actual.cantidad,
			variationPercentage:
				data.ticketInversion.actual.variacion_porcentual === null
					? null
					: Number(data.ticketInversion.actual.variacion_porcentual),
		},
		interest: {
			total: interestTotal,
			investors: {
				amount: interestInvestors,
				percentage: percentage(interestInvestors, interestTotal),
			},
			cube: {
				amount: interestCube,
				percentage: percentage(interestCube, interestTotal),
			},
		},
	};
	return {
		compatible: true as const,
		data,
		rows,
		totals: roundedTotals,
		summary,
		reconciliations,
		reconciled:
			reconciliations.destinations &&
			reconciliations.modes &&
			reconciliations.interest &&
			reconciliations.extras &&
			reconciliations.purchases &&
			reconciliations.contract,
	};
}

export type ReportState =
	| "loading"
	| "error"
	| "empty"
	| "registered-zero"
	| "partial"
	| "incompatible"
	| "ready";

export const REGISTERED_ZERO_ACTIVITY_COPY =
	"Hay liquidaciones registradas, pero no generan efectivo ni reinversión en este período.";

const PUBLIC_PARTIAL_DETAIL_MESSAGE =
	"Los detalles no están disponibles para este período. No se muestran totales secundarios.";

export function getPublicPartialDetailMessage(_backendMessage?: unknown) {
	return PUBLIC_PARTIAL_DETAIL_MESSAGE;
}

export function getReportState(input: {
	pending: boolean;
	error: boolean;
	data?: unknown;
}): ReportState {
	if (input.pending) return "loading";
	if (input.error) return "error";
	const model = buildReinvestmentReportModel(input.data);
	if (!model.compatible) return input.data ? "incompatible" : "empty";
	const hasReportActivity =
		model.data.cantidad_liquidaciones > 0 ||
		model.data.comprasMes.some((purchase) => purchase.cantidad > 0);
	if (!hasReportActivity) return "empty";
	if (!model.reconciliations.destinations || !model.reconciliations.modes) {
		return "error";
	}
	if (!model.data.detalle_estado.disponible) return "partial";
	if (
		model.data.cantidad_liquidaciones > 0 &&
		!model.data.comprasMes.some((purchase) => purchase.cantidad > 0) &&
		Object.values(model.totals).every((value) => cents(value) === 0)
	) {
		return "registered-zero";
	}
	if (!model.reconciled) return "error";
	return "ready";
}

export function getReconciliationPresentation(
	state: ReportState,
	reconciled: boolean,
	model?: ReturnType<typeof buildReinvestmentReportModel>,
): "verified" | "tolerance" | "unavailable" | "failed" {
	if (state === "partial") return "unavailable";
	if (
		state === "ready" &&
		model?.rows.some((row) => row.compositionStatus === "unavailable")
	)
		return "unavailable";
	if (
		state === "ready" &&
		reconciled &&
		model?.rows.some(
			(row) => row.roundingResidual !== null && row.roundingResidual !== 0,
		)
	)
		return "tolerance";
	return state === "ready" && reconciled ? "verified" : "failed";
}

export function canRenderSecondaryDetails(state: ReportState) {
	return state === "ready";
}

const q = (value: number) => `Q${value.toFixed(2)}`;
const amount = (values: (number | string)[]) => sumCents(values) / 100;
export type DestinationFormula = {
	parts: { label: "Capital" | "Resto" | "Sin clasificar"; value: number }[];
	result: number;
	sentence: string;
};

function destinationFormula(
	destination: "Pagado a inversionistas" | "Reinvertido",
	parts: DestinationFormula["parts"],
	result: number,
): DestinationFormula {
	const composition =
		parts.length === 0
			? "no recibe capital ni rendimiento fiscal neto"
			: `se forma con ${parts
					.map(
						(part) =>
							`${q(part.value)} de ${part.label.toLocaleLowerCase("es")}`,
					)
					.join(" más ")}`;
	return {
		parts,
		result,
		sentence: `${destination} ${composition} y da ${q(result)}.`,
	};
}

function getDestinationFormulas(row: ReinvestmentModeRow): {
	paid: DestinationFormula;
	reinvested: DestinationFormula;
} {
	const parts = (destination: {
		capital: number;
		rest: number;
		unclassified: number;
	}): DestinationFormula["parts"] =>
		(
			[
				{ label: "Capital", value: destination.capital },
				{ label: "Resto", value: destination.rest },
				{ label: "Sin clasificar", value: destination.unclassified },
			] satisfies DestinationFormula["parts"]
		).filter((part) => cents(part.value) !== 0);
	return {
		paid: destinationFormula(
			"Pagado a inversionistas",
			parts(row.destinationComposition.paid),
			row.paid,
		),
		reinvested: destinationFormula(
			"Reinvertido",
			parts(row.destinationComposition.reinvested),
			row.reinvested,
		),
	};
}

export function getModePresentation(row: ReinvestmentModeRow) {
	const destinations = getDestinationFormulas(row);
	const hasUnclassified =
		cents(row.destinationComposition.paid.unclassified) !== 0 ||
		cents(row.destinationComposition.reinvested.unclassified) !== 0;
	return {
		paid: row.paid,
		reinvested: row.reinvested,
		distributed: row.distributed,
		equation: `${q(row.paid)} pagado + ${q(row.reinvested)} reinvertido = ${q(row.distributed)} flujo liquidado.`,
		composition: row.composition,
		destinations,
		splitAvailable: true,
		splitNote: hasUnclassified
			? "La fuente histórica no permite asignar todo el flujo entre capital y resto."
			: null,
	};
}

export function getMonthlyFooterPresentation(model: {
	totals: { paid: number; reinvested: number; distributed: number };
}) {
	const { paid, reinvested, distributed } = model.totals;
	return {
		paid,
		reinvested,
		distributed,
		equation: `${q(paid)} pagado + ${q(reinvested)} reinvertido = ${q(distributed)} flujo liquidado.`,
	};
}

export type SecondarySummaryPresentation = {
	key: "interest" | "extras" | "purchases";
	label: string;
	total: number;
	items: {
		label: string;
		value: number;
		formula?: string;
		meta?: string;
	}[];
};

export function buildSecondarySummaryPresentation(
	input: unknown,
): SecondarySummaryPresentation[] {
	const data = getCompatibleReportData(input);
	if (!data) return [];
	const noVerificado = data.interesNeto.noVerificado;
	const cube = data.interesNeto.cube;
	return [
		{
			key: "interest",
			label: "Interés registrado",
			total: amount([noVerificado.interes, cube.interes]),
			items: [
				{
					label: "Sin asignación fiscal",
					value: Number(noVerificado.interes),
					formula: `${q(Number(noVerificado.interes))} interés registrado sin asignación fiscal`,
				},
				{
					label: "CUBE",
					value: Number(cube.interes),
					formula: `${q(Number(cube.interes))} + ${q(Number(cube.iva))} IVA = ${q(Number(cube.neto))}`,
				},
			],
		},
		{
			key: "extras",
			label: "Pagos extras",
			total: amount([
				data.pagosExtras.abonos_capital,
				data.pagosExtras.cancelaciones,
			]),
			items: [
				{
					label: "Abonos a capital",
					value: Number(data.pagosExtras.abonos_capital),
				},
				{
					label: "Cancelaciones",
					value: Number(data.pagosExtras.cancelaciones),
				},
			],
		},
		{
			key: "purchases",
			label: "Compras del mes",
			total: amount(data.comprasMes.map((item) => item.monto)),
			items: data.comprasMes.map((item) => ({
				label: `${getBillingModeLabel(item.modalidad_facturacion)} · ${getPurchaseClassificationLabel(item.tipo_compra)}`,
				value: Number(item.monto),
				meta: `${getReinvestmentModeLabel(item.tipo_reinversion)} · ${item.cantidad} ${item.cantidad === 1 ? "compra" : "compras"}`,
			})),
		},
	];
}

export function buildInvestorExportRows(input: unknown) {
	const data = getCompatibleReportData(input);
	if (!data) return [];
	return data.porInversionista.map((row) => ({
		Inversionista: row.nombre,
		"Modalidad histórica": getReinvestmentModeLabel(row.tipo_reinversion),
		"Pagado capital": Number(row.composicion.pagado.capital),
		"Pagado resto": Number(row.composicion.pagado.resto),
		"Pagado sin clasificar": Number(row.composicion.pagado.sin_clasificar),
		Pagado: Number(row.a_recibir),
		"Reinvertido capital": Number(row.composicion.reinvertido.capital),
		"Reinvertido resto": Number(row.composicion.reinvertido.resto),
		"Reinvertido sin clasificar": Number(
			row.composicion.reinvertido.sin_clasificar,
		),
		Reinvertido: Number(row.reinversion),
		"Capital activo actual": Number(row.capital_activo),
	}));
}
