import { describe, expect, test } from "bun:test";
import {
	buildInvestorExportRows,
	buildReinvestmentReportModel,
	buildSecondarySummaryPresentation,
	canRenderSecondaryDetails,
	getMonthlyFooterPresentation,
	getModePresentation,
	getPublicPartialDetailMessage,
	getReconciliationPresentation,
	getReportState,
	REGISTERED_ZERO_ACTIVITY_COPY,
} from "./reinvestment-report";
import type { ReinversionLiquidacionesResponse } from "./scenario";

const response = (): ReinversionLiquidacionesResponse => ({
	contrato_version: 2,
	porTipo: {
		sin_reinversion: {
			reinversion_capital: "0.00",
			reinversion_interes: "0.00",
			reinversion_total: "0.00",
			total_capital: "100.00",
			total_interes: "10.00",
			total_iva: "1.20",
			total_isr: "0.00",
			total_cuota: "111.20",
			iva_facturado: "1.20",
			total_distribuido: "111.20",
		},
		reinversion_capital: {
			reinversion_capital: "50.00",
			reinversion_interes: "0.00",
			reinversion_total: "50.00",
			total_capital: "50.00",
			total_interes: "5.00",
			total_iva: "0.00",
			total_isr: "0.35",
			total_cuota: "4.65",
			iva_facturado: "0.00",
			total_distribuido: "54.65",
		},
	},
	interesNeto: {
		conFactura: { interes: "10.00", iva: "1.20", neto: "11.20" },
		sinFactura: { interes: "5.00", isr: "0.35", neto: "4.65" },
		cube: { interes: "0.00", iva: "0.00", neto: "0.00" },
	},
	pagosExtras: { abonos_capital: "20.00", cancelaciones: "30.00" },
	porInversionista: [],
	comprasMes: [{ tipo: "sin_reinversion", cantidad: 1, monto: "80.00" }],
	detalleInteresNeto: [
		{
			inversionista_id: 1,
			inversionista: "Ana",
			referencia: "LIQ-1",
			tratamiento_fiscal: "con_factura",
			interes: "10.00",
			iva: "1.20",
			isr: "0.00",
			neto: "11.20",
		},
		{
			inversionista_id: 2,
			inversionista: "Luis",
			referencia: "LIQ-2",
			tratamiento_fiscal: "sin_factura",
			interes: "5.00",
			iva: "0.00",
			isr: "0.35",
			neto: "4.65",
		},
	],
	detallePagosExtras: [
		{
			fecha: "2026-07-01",
			credito: "CR-1",
			tipo: "abono_capital",
			monto: "20.00",
		},
		{
			fecha: "2026-07-02",
			credito: "CR-2",
			tipo: "cancelacion",
			monto: "30.00",
		},
	],
	detalleComprasMes: [
		{
			fecha: "2026-07-03",
			inversionista: "Ana",
			modalidad: "sin_reinversion",
			monto: "80.00",
		},
	],
	detalle_estado: { disponible: true, error: null },
	cantidad_liquidaciones: 2,
});

test("modelo ejecutivo concilia pagado + reinvertido con flujo liquidado", () => {
	const model = buildReinvestmentReportModel(response());
	expect(model.totals).toEqual({
		distributed: 165.85,
		paid: 115.85,
		reinvested: 50,
		active: 0,
	});
	expect(model.reconciled).toBe(true);
	expect(model.reconciliations).toEqual({
		destinations: true,
		modes: true,
		interest: true,
		extras: true,
		purchases: true,
		contract: true,
	});
	expect(model.rows.map((row) => row.type)).toContain("reinversion_capital");
});

test("presentación por modalidad conserva destinos, ecuación y composición contable", () => {
	const model = buildReinvestmentReportModel(response());
	const row = model.rows.find((item) => item.type === "reinversion_capital");
	expect(row).toBeDefined();
	if (!row) throw new Error("Falta modalidad de reinversión de capital");
	expect(getModePresentation(row)).toMatchObject({
		paid: 4.65,
		reinvested: 50,
		distributed: 54.65,
		equation: "Q4.65 pagado + Q50.00 reinvertido = Q54.65 flujo liquidado.",
		composition: {
			capital: 50,
			interest: 5,
			billedVat: 0,
			withheldIsr: 0.35,
			distributed: 54.65,
		},
		splitAvailable: true,
		destinations: {
			paid: {
				parts: [{ label: "Rendimiento fiscal neto", value: 4.65 }],
				result: 4.65,
				sentence:
					"Pagado a inversionistas se forma con Q4.65 de rendimiento fiscal neto y da Q4.65.",
			},
			reinvested: {
				parts: [{ label: "Capital", value: 50 }],
				result: 50,
				sentence: "Reinvertido se forma con Q50.00 de capital y da Q50.00.",
			},
		},
	});
});

test("capital, interés y total explican qué forma cada destino", () => {
	const base = response().porTipo.reinversion_capital;
	const cases = [
		{
			type: "reinversion_capital",
			paid: 4.65,
			reinvested: 50,
			paidParts: ["Rendimiento fiscal neto"],
			reinvestedParts: ["Capital"],
		},
		{
			type: "reinversion_interes",
			paid: 50,
			reinvested: 4.65,
			paidParts: ["Capital"],
			reinvestedParts: ["Rendimiento fiscal neto"],
		},
		{
			type: "reinversion_total",
			paid: 0,
			reinvested: 54.65,
			paidParts: [],
			reinvestedParts: ["Capital", "Rendimiento fiscal neto"],
		},
	] as const;

	for (const item of cases) {
		const data = response();
		data.porTipo = {
			[item.type]: {
				...base,
				reinversion_capital:
					item.type === "reinversion_capital" ||
					item.type === "reinversion_total"
						? "50.00"
						: "0.00",
				reinversion_interes:
					item.type === "reinversion_interes" ||
					item.type === "reinversion_total"
						? "4.65"
						: "0.00",
				reinversion_total: item.reinvested.toFixed(2),
				total_cuota: item.paid.toFixed(2),
			},
		};
		const row = buildReinvestmentReportModel(data).rows[0];
		expect(row).toBeDefined();
		if (!row) throw new Error(`Falta modalidad ${item.type}`);
			const presentation = getModePresentation(row);
			expect(presentation.destinations?.paid.parts.map((part) => part.label)).toEqual(
				[...item.paidParts],
			);
			expect(
				presentation.destinations?.reinvested.parts.map((part) => part.label),
			).toEqual([...item.reinvestedParts]);
		expect(presentation.destinations?.paid.result).toBe(item.paid);
		expect(presentation.destinations?.reinvested.result).toBe(item.reinvested);
		expect(presentation.destinations?.paid.sentence).toContain(
			"Pagado a inversionistas",
		);
		expect(presentation.destinations?.reinvested.sentence).toContain(
			"Reinvertido",
		);
	}
});

test("variable, excedente y combinada no fabrican fórmulas por destino", () => {
	for (const type of [
		"reinversion_variable",
		"reinversion_excedente",
		"reinversion_combinada",
	]) {
		const data = response();
		data.porTipo = {
			[type]: {
				reinversion_capital: "0.00",
				reinversion_interes: "0.00",
				reinversion_total: "40.00",
				total_capital: "100.00",
				total_interes: "10.00",
				total_iva: "1.20",
				total_isr: "0.00",
				total_cuota: "71.20",
				iva_facturado: "1.20",
				total_distribuido: "111.20",
			},
		};
		const row = buildReinvestmentReportModel(data).rows[0];
		expect(row).toBeDefined();
		if (!row) throw new Error(`Falta modalidad ${type}`);
		const presentation = getModePresentation(row);
		expect(presentation.destinations).toBeNull();
		expect(presentation.splitAvailable).toBe(false);
		expect(presentation.splitNote).toContain(
			"no está disponible en la fuente actual",
		);
	}
});

test("contrato anterior o malformado falla de forma controlada y no concilia", () => {
	const legacy = { ...response() } as Record<string, unknown>;
	delete legacy.contrato_version;
	expect(() => buildReinvestmentReportModel(legacy)).not.toThrow();
	expect(buildReinvestmentReportModel(legacy)).toMatchObject({
		compatible: false,
		reconciled: false,
		rows: [],
	});
	expect(getReportState({ pending: false, error: false, data: legacy })).toBe(
		"incompatible",
	);

	const malformed = {
		...response(),
		contrato_version: 2,
		detalleInteresNeto: null,
	};
	expect(() => buildReinvestmentReportModel(malformed)).not.toThrow();
	expect(
		getReportState({ pending: false, error: false, data: malformed }),
	).toBe("incompatible");
});

test("reemplazo conserva export Excel por inversionista con destinos y capital activo", () => {
	const data = response();
	data.porInversionista = [
		{
			inversionista_id: 1,
			nombre: "Ana",
			tipo_reinversion: "reinversion_capital",
			reinversion_capital: "50.00",
			reinversion_interes: "0.00",
			reinversion: "50.00",
			a_recibir: "4.65",
			monto_aportado: "950.00",
			capital_activo: "1000.00",
		},
	];
	expect(buildInvestorExportRows(data)).toEqual([
		{
			Inversionista: "Ana",
			Modalidad: "reinversion_capital",
			Pagado: "4.65",
			Reinvertido: "50.00",
			"Capital activo": "1000.00",
		},
	]);
	expect(buildInvestorExportRows({})).toEqual([]);
});

test("presentación restaura los tres subresúmenes canónicos y sus fórmulas", () => {
	expect(buildSecondarySummaryPresentation(response())).toEqual([
		{
			key: "interest",
			label: "Interés neto",
			total: 15.85,
			items: [
				{
					label: "Con factura",
					value: 11.2,
					formula: "Q10.00 + Q1.20 IVA = Q11.20",
				},
				{
					label: "Sin factura",
					value: 4.65,
					formula: "Q5.00 − Q0.35 ISR = Q4.65",
				},
				{
					label: "CUBE",
					value: 0,
					formula: "Q0.00 + Q0.00 IVA = Q0.00",
				},
			],
		},
		{
			key: "extras",
			label: "Pagos extras",
			total: 50,
			items: [
				{ label: "Abonos a capital", value: 20 },
				{ label: "Cancelaciones", value: 30 },
			],
		},
		{
			key: "purchases",
			label: "Compras del mes",
			total: 80,
			items: [
				{
					label: "Tradicional",
					value: 80,
					meta: "1 compra",
				},
			],
		},
	]);
});

test("footer mensual presenta la misma conciliación que el modelo", () => {
	const model = buildReinvestmentReportModel(response());
	expect(getMonthlyFooterPresentation(model)).toEqual({
		paid: 115.85,
		reinvested: 50,
		distributed: 165.85,
		equation:
			"Q115.85 pagado + Q50.00 reinvertido = Q165.85 flujo liquidado.",
	});
});

test("modelo fail-closed marca no reconciliado cualquier detalle descuadrado, incluido CUBE", () => {
	const interestMismatch = response();
	interestMismatch.detalleInteresNeto[0].neto = "10.20";
	expect(buildReinvestmentReportModel(interestMismatch).reconciled).toBe(false);

	const cubeMismatch = response();
	cubeMismatch.interesNeto.cube.neto = "22.40";
	cubeMismatch.detalleInteresNeto.push(
		{
			inversionista_id: 0,
			inversionista: "CUBE",
			referencia: "CUBE",
			tratamiento_fiscal: "cube",
			interes: "22.40",
			iva: "0.00",
			isr: "0.00",
			neto: "22.40",
		},
		{
			inversionista_id: 0,
			inversionista: "CUBE",
			referencia: "CUBE-duplicado",
			tratamiento_fiscal: "cube",
			interes: "22.40",
			iva: "0.00",
			isr: "0.00",
			neto: "22.40",
		},
	);
	expect(buildReinvestmentReportModel(cubeMismatch).reconciled).toBe(false);

	const extrasMismatch = response();
	extrasMismatch.detallePagosExtras[0].monto = "19.99";
	expect(buildReinvestmentReportModel(extrasMismatch).reconciled).toBe(false);

	const purchasesMismatch = response();
	purchasesMismatch.detalleComprasMes[0].monto = "79.99";
	expect(buildReinvestmentReportModel(purchasesMismatch).reconciled).toBe(
		false,
	);
});

test("dos compras del mismo inversionista, fecha y modalidad concilian como dos operaciones", () => {
	const purchases = response();
	purchases.comprasMes = [
		{ tipo: "sin_reinversion", cantidad: 2, monto: "80.00" },
	];
	purchases.detalleComprasMes = [
		{
			fecha: "2026-07-03",
			inversionista: "Ana",
			modalidad: "sin_reinversion",
			monto: "40.00",
		},
		{
			fecha: "2026-07-03",
			inversionista: "Ana",
			modalidad: "sin_reinversion",
			monto: "40.00",
		},
	];

	const model = buildReinvestmentReportModel(purchases);
	expect(model.reconciliations.purchases).toBe(true);
	expect(getReportState({ pending: false, error: false, data: purchases })).toBe(
		"ready",
	);
});

test("ruta Admin reportes entrega query real, estados y respuesta íntegra al componente productivo", async () => {
	const routeSource = await Bun.file(
		new URL("../../routes/admin/reports/index.tsx", import.meta.url),
	).text();
	const queryStart = routeSource.indexOf(
		"const reinversionLiquidacionesQuery = useQuery",
	);
	const queryEnd = routeSource.indexOf(
		"const investorsCarteraQuery",
		queryStart,
	);
	const renderStart = routeSource.indexOf("<ReinvestmentReport");
	const renderEnd = routeSource.indexOf("/>", renderStart);
	const queryWiring = routeSource.slice(queryStart, queryEnd);
	const renderWiring = routeSource.slice(renderStart, renderEnd);

	expect(queryWiring).toContain(
		"orpc.getReinversionLiquidaciones.queryOptions",
	);
	expect(queryWiring).toContain("input: { mes: flujoMesNum, anio: flujoAnioNum }");
	expect(renderWiring).toContain("data={reinversionData}");
	expect(renderWiring).toContain(
		"isPending={reinversionLiquidacionesQuery.isPending}",
	);
	expect(renderWiring).toContain(
		"isError={reinversionLiquidacionesQuery.isError}",
	);
	expect(renderWiring).toContain(
		"onRetry={() => reinversionLiquidacionesQuery.refetch()}",
	);
	expect(renderWiring).not.toContain("detalleInteresNeto:");
	expect(renderWiring).not.toContain("detalleComprasMes:");
});

test("el modelo no permite descuadres compensados entre subcategorías", () => {
	const interest = response();
	interest.detalleInteresNeto[0].neto = "10.20";
	interest.detalleInteresNeto[1].neto = "5.65";
	expect(buildReinvestmentReportModel(interest).reconciliations.interest).toBe(
		false,
	);

	const extras = response();
	extras.detallePagosExtras[0].monto = "19.00";
	extras.detallePagosExtras[1].monto = "31.00";
	expect(buildReinvestmentReportModel(extras).reconciliations.extras).toBe(false);
});

describe("presentación fail-closed", () => {
	test("solo presenta conciliación verificada para ready + reconciled", () => {
		expect(getReconciliationPresentation("ready", true)).toBe("verified");
		expect(getReconciliationPresentation("ready", false)).toBe("failed");
	});

	test("partial nunca presenta confianza ni totales secundarios", () => {
		expect(getReconciliationPresentation("partial", true)).toBe("unavailable");
		expect(getReconciliationPresentation("partial", false)).toBe("unavailable");
		expect(canRenderSecondaryDetails("partial")).toBe(false);
		expect(canRenderSecondaryDetails("ready")).toBe(true);
		expect(canRenderSecondaryDetails("error")).toBe(false);
	});
});

describe("getReportState", () => {
	test("distingue carga, error, vacío, parcial y listo", () => {
		expect(getReportState({ pending: true, error: false })).toBe("loading");
		expect(getReportState({ pending: false, error: true })).toBe("error");
		expect(getReportState({ pending: false, error: false })).toBe("empty");
		expect(
			getReportState({
				pending: false,
				error: false,
				data: {
					...response(),
					detalle_estado: {
						disponible: false,
						error: "No fue posible recuperar el detalle.",
					},
				},
			}),
		).toBe("partial");
		expect(
			getReportState({ pending: false, error: false, data: response() }),
		).toBe("ready");
	});

	test("una respuesta completa descuadrada fuerza error", () => {
		const mismatch = response();
		mismatch.detalleInteresNeto[0].neto = "10.20";
		expect(
			getReportState({ pending: false, error: false, data: mismatch }),
		).toBe("error");
	});

	test("una respuesta parcial con modalidades descuadradas fuerza error", () => {
		const mismatch = response();
		mismatch.detalle_estado = {
			disponible: false,
			error: "No fue posible recuperar el detalle.",
		};
		mismatch.porTipo.sin_reinversion.total_distribuido = "999.99";
		expect(
			getReportState({ pending: false, error: false, data: mismatch }),
		).toBe("error");
	});

	test("distingue liquidaciones registradas sin flujo ni posición", () => {
		const zero = response();
		zero.porTipo = {
			sin_reinversion: {
				reinversion_capital: "0.00",
				reinversion_interes: "0.00",
				reinversion_total: "0.00",
				total_capital: "0.00",
				total_interes: "0.00",
				total_iva: "0.00",
				total_isr: "0.00",
				total_cuota: "0.00",
				iva_facturado: "0.00",
				total_distribuido: "0.00",
			},
		};
		zero.interesNeto = {
			conFactura: { interes: "0.00", iva: "0.00", neto: "0.00" },
			sinFactura: { interes: "0.00", isr: "0.00", neto: "0.00" },
			cube: { interes: "0.00", iva: "0.00", neto: "0.00" },
		};
		zero.pagosExtras = { abonos_capital: "0.00", cancelaciones: "0.00" };
		zero.comprasMes = [];
		zero.detalleInteresNeto = [];
		zero.detallePagosExtras = [];
		zero.detalleComprasMes = [];
		zero.cantidad_liquidaciones = 1;

		expect(getReportState({ pending: false, error: false, data: zero })).toBe(
			"registered-zero",
		);
		expect(REGISTERED_ZERO_ACTIVITY_COPY).toContain(
			"Hay liquidaciones registradas",
		);
		expect(REGISTERED_ZERO_ACTIVITY_COPY).toContain(
			"no generan efectivo ni reinversión",
		);
	});
});

test("el copy parcial nunca expone el error técnico recibido", () => {
	const secret =
		'relation "cartera.liquidaciones" does not exist at 10.0.0.8:5432';
	const copy = getPublicPartialDetailMessage(secret);
	expect(copy).toBe(
		"Los detalles no están disponibles para este período. No se muestran totales secundarios.",
	);
	expect(copy).not.toContain("cartera.liquidaciones");
	expect(copy).not.toContain("10.0.0.8");
});
