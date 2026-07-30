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

export function getCompatibleReportData(
	input: unknown,
): ReinversionLiquidacionesResponse | undefined {
	if (!isRecord(input) || input.contrato_version !== 2) return undefined;
	if (!isRecord(input.porTipo)) return undefined;
	if (
		!Object.keys(input.porTipo).every((key) => MODES.has(key)) ||
		!Object.values(input.porTipo).every(
			(row) =>
				isRecord(row) &&
				hasMoneyFields(row, MODE_MONEY_FIELDS) &&
				isNonnegativeInteger(row.cantidad_liquidaciones),
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
				]),
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
				MODES.has(String(row.tipo)) &&
				isNonnegativeInteger(row.cantidad) &&
				isMoney(row.monto),
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
				MODES.has(String(row.modalidad)) &&
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
};

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
	reconciled: boolean;
	roundingResidual: number | null;
	compositionStatus: "exact" | "tolerance" | "failed" | "unavailable";
	historicalModeVerified: false;
};

const incompatibleModel = {
	compatible: false as const,
	data: undefined,
	rows: [] as ReinvestmentModeRow[],
	totals: { distributed: 0, paid: 0, reinvested: 0, active: 0 },
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
			const hasAmbiguousFiscal =
				Number(value.total_iva) !== 0 || Number(value.total_isr) !== 0;
			const roundingResidual = Math.abs(
				sumCents([
					composition.capital,
					composition.interest,
					composition.billedVat,
					-composition.withheldIsr,
				]) - cents(distributed),
			);
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
					capital: Number(value.reinversion_capital),
					interest: Number(value.reinversion_interes),
				},
				reconciled:
					sumCents([paid, reinvested]) === cents(distributed) &&
					(hasAmbiguousFiscal ||
						roundingResidual <= value.cantidad_liquidaciones),
				roundingResidual: hasAmbiguousFiscal ? null : roundingResidual / 100,
				compositionStatus: hasAmbiguousFiscal
					? "unavailable"
					: roundingResidual === 0
						? "exact"
						: roundingResidual <= value.cantidad_liquidaciones
							? "tolerance"
							: "failed",
				historicalModeVerified: false,
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
	const purchasesByMode = data.comprasMes.every(
		(summary) =>
			data.detalleComprasMes.filter((row) => row.modalidad === summary.tipo)
				.length === summary.cantidad &&
			sumCents(
				data.detalleComprasMes
					.filter((row) => row.modalidad === summary.tipo)
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
				data.comprasMes.some((summary) => summary.tipo === row.modalidad),
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
	return {
		compatible: true as const,
		data,
		rows,
		totals: roundedTotals,
		reconciliations,
		reconciled: Object.values(reconciliations).every(Boolean),
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
const NO_SPLIT_TYPES = new Set([
	"reinversion_variable",
	"reinversion_excedente",
	"reinversion_combinada",
]);

export type DestinationFormula = {
	parts: { label: "Capital" | "Rendimiento fiscal neto"; value: number }[];
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
} | null {
	// La modalidad procede del perfil actual, no de un snapshot histórico.
	if (NO_SPLIT_TYPES.has(row.type) || !row.historicalModeVerified) return null;
	const capital = {
		label: "Capital" as const,
		value: row.composition.capital,
	};
	const netYield = {
		label: "Rendimiento fiscal neto" as const,
		value:
			Math.round(
				(row.composition.interest +
					row.composition.billedVat -
					row.composition.withheldIsr) *
					100,
			) / 100,
	};
	const partsByType = {
		sin_reinversion: { paid: [capital, netYield], reinvested: [] },
		reinversion_capital: { paid: [netYield], reinvested: [capital] },
		reinversion_interes: { paid: [capital], reinvested: [netYield] },
		reinversion_total: { paid: [], reinvested: [capital, netYield] },
	} satisfies Record<
		string,
		{
			paid: DestinationFormula["parts"];
			reinvested: DestinationFormula["parts"];
		}
	>;
	const parts = partsByType[row.type as keyof typeof partsByType];
	if (!parts) return null;
	if (
		sumCents(parts.paid.map((part) => part.value)) !== cents(row.paid) ||
		sumCents(parts.reinvested.map((part) => part.value)) !==
			cents(row.reinvested)
	)
		return null;
	return {
		paid: destinationFormula("Pagado a inversionistas", parts.paid, row.paid),
		reinvested: destinationFormula(
			"Reinvertido",
			parts.reinvested,
			row.reinvested,
		),
	};
}

export function getModePresentation(row: ReinvestmentModeRow) {
	const destinations = getDestinationFormulas(row);
	const splitAvailable = destinations !== null;
	return {
		paid: row.paid,
		reinvested: row.reinvested,
		distributed: row.distributed,
		equation: `${q(row.paid)} pagado + ${q(row.reinvested)} reinvertido = ${q(row.distributed)} flujo liquidado.`,
		composition: row.composition,
		destinations,
		splitAvailable,
		splitNote: splitAvailable
			? null
			: "El desglose de la reinversión entre capital e interés no está disponible en la fuente actual.",
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
				label: labels[item.tipo] ?? item.tipo,
				value: Number(item.monto),
				meta: `${item.cantidad} ${item.cantidad === 1 ? "compra" : "compras"}`,
			})),
		},
	];
}

export function buildInvestorExportRows(input: unknown) {
	const data = getCompatibleReportData(input);
	if (!data) return [];
	return data.porInversionista.map((row) => ({
		Inversionista: row.nombre,
		"Modalidad actual": row.tipo_reinversion,
		Pagado: row.a_recibir,
		Reinvertido: row.reinversion,
		"Capital activo actual": row.capital_activo,
	}));
}
