import { describe, expect, test } from "bun:test";
import {
	buildInvestorExportRows,
	buildReinvestmentReportModel,
	buildSecondarySummaryPresentation,
	canRenderSecondaryDetails,
	getModePresentation,
	getMonthlyFooterPresentation,
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
			cantidad_liquidaciones: 1,
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
			cantidad_liquidaciones: 1,
		},
	},
	interesNeto: {
		noVerificado: { interes: "15.00" },
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
			tratamiento_fiscal: "no_verificado",
			interes: "10.00",
			iva: "0.00",
			isr: "0.00",
		},
		{
			inversionista_id: 2,
			inversionista: "Luis",
			referencia: "LIQ-2",
			tratamiento_fiscal: "no_verificado",
			interes: "5.00",
			iva: "0.00",
			isr: "0.00",
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
		composition: "unavailable",
	});
	expect(model.rows.map((row) => row.type)).toContain("reinversion_capital");
});

test("conserva la conciliación canónica aunque la metadata fiscal tenga deriva", () => {
	const data = response();
	data.porTipo.sin_reinversion.total_capital = "100.02";
	data.porTipo.sin_reinversion.cantidad_liquidaciones = 2;

	expect(buildReinvestmentReportModel(data).reconciliations.modes).toBe(true);
	expect(getReportState({ pending: false, error: false, data })).toBe("ready");
});

test("IVA e ISR registrados sin asignación fiscal dejan la composición no disponible", () => {
	const data = response();
	data.porTipo.sin_reinversion.iva_facturado = "0.00";
	data.porTipo.sin_reinversion.total_iva = "1.20";
	data.porTipo.sin_reinversion.total_isr = "0.35";
	data.porTipo.sin_reinversion.total_cuota = "110.85";
	data.porTipo.sin_reinversion.total_distribuido = "110.85";
	const model = buildReinvestmentReportModel(data);

	expect(getReportState({ pending: false, error: false, data })).toBe("ready");
	expect(model.rows[0]?.compositionStatus).toBe("unavailable");
	expect(model.reconciliations.composition).toBe("unavailable");
	expect(getReconciliationPresentation("ready", model.reconciled, model)).toBe(
		"unavailable",
	);
});

test("distingue una conciliación exacta de una dentro de tolerancia", () => {
	const exactData = response();
	exactData.porTipo.sin_reinversion = {
		reinversion_capital: "0.00",
		reinversion_interes: "0.00",
		reinversion_total: "0.00",
		total_capital: "100.00",
		total_interes: "0.00",
		total_iva: "0.00",
		total_isr: "0.00",
		total_cuota: "100.00",
		iva_facturado: "0.00",
		total_distribuido: "100.00",
		cantidad_liquidaciones: 1,
	};
	exactData.porTipo.reinversion_capital = {
		reinversion_capital: "50.00",
		reinversion_interes: "0.00",
		reinversion_total: "50.00",
		total_capital: "100.00",
		total_interes: "0.00",
		total_iva: "0.00",
		total_isr: "0.00",
		total_cuota: "50.00",
		iva_facturado: "0.00",
		total_distribuido: "100.00",
		cantidad_liquidaciones: 1,
	};
	const exact = buildReinvestmentReportModel(exactData);
	expect(getReconciliationPresentation("ready", exact.reconciled, exact)).toBe(
		"verified",
	);

	const tolerated = structuredClone(exactData);
	tolerated.porTipo.sin_reinversion = {
		reinversion_capital: "0.00",
		reinversion_interes: "0.00",
		reinversion_total: "0.00",
		total_capital: "100.01",
		total_interes: "0.00",
		total_iva: "0.00",
		total_isr: "0.00",
		total_cuota: "100.00",
		iva_facturado: "0.00",
		total_distribuido: "100.00",
		cantidad_liquidaciones: 1,
	};
	const model = buildReinvestmentReportModel(tolerated);
	expect(model.reconciled).toBe(true);
	expect(getReconciliationPresentation("ready", model.reconciled, model)).toBe(
		"tolerance",
	);

	const beyondTolerance = structuredClone(exactData);
	beyondTolerance.porTipo.sin_reinversion = {
		...tolerated.porTipo.sin_reinversion,
		total_capital: "100.02",
	};
	const failed = buildReinvestmentReportModel(beyondTolerance);
	expect(failed.reconciled).toBe(false);
	expect(
		getReconciliationPresentation("ready", failed.reconciled, failed),
	).toBe("failed");
});

test("rechaza un destino que no concilia", () => {
	const data = response();
	data.porTipo.sin_reinversion.total_distribuido = "100.03";

	expect(buildReinvestmentReportModel(data).reconciliations.modes).toBe(false);
	expect(getReportState({ pending: false, error: false, data })).toBe("error");
});

test("modalidad actual no presenta fórmulas históricas sin snapshot", () => {
	const model = buildReinvestmentReportModel(response());
	const row = model.rows.find((item) => item.type === "reinversion_capital");
	expect(row).toBeDefined();
	if (!row) throw new Error("Falta modalidad de reinversión de capital");
	expect(getModePresentation(row)).toMatchObject({
		paid: 4.65,
		reinvested: 50,
		distributed: 54.65,
		splitAvailable: false,
		destinations: null,
	});
});

test("cambio de modalidad actual no reclasifica ni verifica el flujo histórico", () => {
	const data = response();
	data.porTipo = { reinversion_total: data.porTipo.reinversion_capital };
	const row = buildReinvestmentReportModel(data).rows[0];
	expect(row?.label).toBe("Interés compuesto");
	if (!row) throw new Error("Se esperaba una modalidad");
	expect(getModePresentation(row).destinations).toBeNull();
});

test("suprime fórmulas de una modalidad actual que no concilia con destinos históricos", () => {
	const data = response();
	data.porTipo = {
		reinversion_total: {
			...data.porTipo.reinversion_capital,
			reinversion_capital: "0.00",
			reinversion_interes: "0.00",
			reinversion_total: "0.00",
			total_cuota: "54.65",
		},
	};

	const model = buildReinvestmentReportModel(data);
	const row = model.rows[0];
	expect(row).toBeDefined();
	if (!row) throw new Error("Falta modalidad histórica reclasificada");

	expect(model.reconciliations.destinations).toBe(true);
	expect(row).toMatchObject({ paid: 54.65, reinvested: 0, distributed: 54.65 });
	expect(getModePresentation(row)).toMatchObject({
		destinations: null,
		splitAvailable: false,
	});
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
				cantidad_liquidaciones: 1,
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

	const missingModeCount = response() as unknown as Record<string, unknown>;
	delete (missingModeCount.porTipo as Record<string, Record<string, unknown>>)
		.sin_reinversion.cantidad_liquidaciones;
	expect(buildReinvestmentReportModel(missingModeCount).compatible).toBe(false);
});

test("contrato web rechaza categorías, ids y conteos fuera del contrato", () => {
	const invalidCategory = response() as unknown as Record<string, unknown>;
	(
		invalidCategory.detalleInteresNeto as Record<string, unknown>[]
	)[0].tratamiento_fiscal = "inventado";
	expect(buildReinvestmentReportModel(invalidCategory).compatible).toBe(false);

	const invalidCount = response() as unknown as Record<string, unknown>;
	(invalidCount.comprasMes as Record<string, unknown>[])[0].cantidad = 1.5;
	expect(buildReinvestmentReportModel(invalidCount).compatible).toBe(false);

	const invalidId = response() as unknown as Record<string, unknown>;
	invalidId.porInversionista = [
		{
			inversionista_id: -1,
			nombre: "Ana",
			tipo_reinversion: "sin_reinversion",
			reinversion_capital: "0.00",
			reinversion_interes: "0.00",
			reinversion: "0.00",
			a_recibir: "0.00",
			capital_activo: "0.00",
		},
	];
	expect(buildReinvestmentReportModel(invalidId).compatible).toBe(false);

	const invalidMoney = response() as unknown as Record<string, unknown>;
	(invalidMoney.pagosExtras as Record<string, unknown>).abonos_capital =
		"-0.01";
	expect(buildReinvestmentReportModel(invalidMoney).compatible).toBe(false);
	for (const value of ["1e2", "0x10"]) {
		const invalidDecimal = response() as unknown as Record<string, unknown>;
		(invalidDecimal.pagosExtras as Record<string, unknown>).abonos_capital =
			value;
		expect(buildReinvestmentReportModel(invalidDecimal).compatible).toBe(false);
	}

	const invalidMode = response() as unknown as Record<string, unknown>;
	invalidMode.porTipo = { inventado: response().porTipo.sin_reinversion };
	expect(buildReinvestmentReportModel(invalidMode).compatible).toBe(false);

	for (const detalle_estado of [
		{ disponible: true, error: "contradictorio" },
		{ disponible: false, error: " " },
	]) {
		const contradictory = response() as unknown as Record<string, unknown>;
		contradictory.detalle_estado = detalle_estado;
		expect(buildReinvestmentReportModel(contradictory).compatible).toBe(false);
	}
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
			capital_activo: "1000.00",
		},
	];
	expect(buildInvestorExportRows(data)).toEqual([
		{
			Inversionista: "Ana",
			"Modalidad actual": "reinversion_capital",
			Pagado: "4.65",
			Reinvertido: "50.00",
			"Capital activo actual": "1000.00",
		},
	]);
	expect(buildInvestorExportRows({})).toEqual([]);
});

test("rechaza inversionistas con campos monetarios no numéricos", () => {
	const nan = response();
	nan.porInversionista = [
		{
			inversionista_id: 1,
			nombre: "Ana",
			tipo_reinversion: "reinversion_capital",
			reinversion_capital: "NaN",
			reinversion_interes: "0.00",
			reinversion: "0.00",
			a_recibir: "0.00",
			capital_activo: "0.00",
		},
	];
	expect(buildReinvestmentReportModel(nan).compatible).toBe(false);
	expect(getReportState({ pending: false, error: false, data: nan })).toBe(
		"incompatible",
	);

	const nonnumeric = response();
	nonnumeric.porInversionista = [
		{
			inversionista_id: 1,
			nombre: "Ana",
			tipo_reinversion: "reinversion_capital",
			reinversion_capital: "0.00",
			reinversion_interes: "0.00",
			reinversion: "0.00",
			a_recibir: "no-numérico",
			capital_activo: "0.00",
		},
	];
	expect(buildReinvestmentReportModel(nonnumeric).compatible).toBe(false);
	expect(
		getReportState({ pending: false, error: false, data: nonnumeric }),
	).toBe("incompatible");
});

test("rechaza campos monetarios vacíos o con solo whitespace", () => {
	for (const value of ["", "   "]) {
		const data = response();
		data.porTipo.sin_reinversion.total_cuota = value;

		expect(buildReinvestmentReportModel(data).compatible).toBe(false);
		expect(getReportState({ pending: false, error: false, data })).toBe(
			"incompatible",
		);
	}
});

test("acepta campos monetarios válidos y conserva capital activo sin flujo", () => {
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
			cantidad_liquidaciones: 1,
		},
	};
	zero.interesNeto = {
		noVerificado: { interes: "0.00" },
		cube: { interes: "0.00", iva: "0.00", neto: "0.00" },
	};
	zero.pagosExtras = { abonos_capital: "0.00", cancelaciones: "0.00" };
	zero.porInversionista = [
		{
			inversionista_id: 1,
			nombre: "Ana",
			tipo_reinversion: "sin_reinversion",
			reinversion_capital: "0.00",
			reinversion_interes: "0.00",
			reinversion: "0.00",
			a_recibir: "0.00",
			capital_activo: "1250.00",
		},
	];
	zero.comprasMes = [];
	zero.detalleInteresNeto = [];
	zero.detallePagosExtras = [];
	zero.detalleComprasMes = [];

	const model = buildReinvestmentReportModel(zero);
	expect(model.compatible).toBe(true);
	expect(model.totals).toEqual({
		distributed: 0,
		paid: 0,
		reinvested: 0,
		active: 1250,
	});
	expect(getReportState({ pending: false, error: false, data: zero })).toBe(
		"ready",
	);
});

test("presentación restaura los tres subresúmenes canónicos y sus fórmulas", () => {
	expect(buildSecondarySummaryPresentation(response())).toEqual([
		{
			key: "interest",
			label: "Interés registrado",
			total: 15,
			items: [
				{
					label: "Sin asignación fiscal",
					value: 15,
					formula: "Q15.00 interés registrado sin asignación fiscal",
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
		equation: "Q115.85 pagado + Q50.00 reinvertido = Q165.85 flujo liquidado.",
	});
});

test("modelo fail-closed marca no reconciliado cualquier detalle descuadrado, incluido CUBE", () => {
	const interestMismatch = response();
	interestMismatch.detalleInteresNeto[0].interes = "10.20";
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
	expect(
		getReportState({ pending: false, error: false, data: purchases }),
	).toBe("ready");
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
	expect(queryWiring).toContain(
		"input: { mes: flujoMesNum, anio: flujoAnioNum }",
	);
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

test("UI y export nombran el capital como posición actual", async () => {
	const component = await Bun.file(
		new URL(
			"../../components/reports/reinvestment-report.tsx",
			import.meta.url,
		),
	).text();
	expect(component).toContain("Capital activo actual");
	expect(component).toMatch(
		/getReconciliationPresentation\(\s*state,\s*model\.reconciled,\s*model,?\s*\)/,
	);
	const report = await Bun.file(
		new URL("./reinvestment-report.ts", import.meta.url),
	).text();
	expect(report).toContain('"Capital activo actual": row.capital_activo');
});

test("el modelo no permite descuadres compensados entre subcategorías", () => {
	const interest = response();
	interest.detalleInteresNeto[0].interes = "10.20";
	interest.detalleInteresNeto[1].interes = "5.00";
	expect(buildReinvestmentReportModel(interest).reconciliations.interest).toBe(
		false,
	);

	const extras = response();
	extras.detallePagosExtras[0].monto = "19.00";
	extras.detallePagosExtras[1].monto = "31.00";
	expect(buildReinvestmentReportModel(extras).reconciliations.extras).toBe(
		false,
	);
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
	const purchaseOnlyResponse = () => {
		const data = response();
		data.porTipo = {};
		data.interesNeto = {
			noVerificado: { interes: "0.00" },
			cube: { interes: "0.00", iva: "0.00", neto: "0.00" },
		};
		data.pagosExtras = { abonos_capital: "0.00", cancelaciones: "0.00" };
		data.porInversionista = [];
		data.detalleInteresNeto = [];
		data.detallePagosExtras = [];
		data.cantidad_liquidaciones = 0;
		return data;
	};

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
		mismatch.detalleInteresNeto[0].interes = "10.20";
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

	test("detalle parcial precede a registered-zero", () => {
		const zero = response();
		zero.porTipo = Object.fromEntries(
			Object.keys(zero.porTipo).map((type) => [
				type,
				{
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
					cantidad_liquidaciones: 1,
				},
			]),
		);
		zero.comprasMes = [];
		zero.detalleComprasMes = [];
		zero.detalleInteresNeto = [];
		zero.detallePagosExtras = [];
		zero.interesNeto = {
			noVerificado: { interes: "0.00" },
			cube: { interes: "0.00", iva: "0.00", neto: "0.00" },
		};
		zero.pagosExtras = { abonos_capital: "0.00", cancelaciones: "0.00" };
		zero.porInversionista = [];
		zero.detalle_estado = { disponible: false, error: "No disponible" };
		expect(getReportState({ pending: false, error: false, data: zero })).toBe(
			"partial",
		);
	});

	test("liquidaciones en cero con compra completada se mantienen como actividad", () => {
		const data = response();
		data.porTipo = {
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
				cantidad_liquidaciones: 1,
			},
		};
		data.interesNeto = {
			noVerificado: { interes: "0.00" },
			cube: { interes: "0.00", iva: "0.00", neto: "0.00" },
		};
		data.pagosExtras = { abonos_capital: "0.00", cancelaciones: "0.00" };
		data.porInversionista = [];
		data.comprasMes = [{ tipo: "sin_reinversion", cantidad: 1, monto: "0.00" }];
		data.detalleInteresNeto = [];
		data.detallePagosExtras = [];
		data.detalleComprasMes = [
			{
				fecha: "2026-07-03",
				inversionista: "Ana",
				modalidad: "sin_reinversion",
				monto: "0.00",
			},
		];
		data.cantidad_liquidaciones = 1;
		expect(getReportState({ pending: false, error: false, data })).toBe(
			"ready",
		);
	});

	test("compra completada de valor cero no se presenta como registered-zero", () => {
		const purchases = purchaseOnlyResponse();
		purchases.comprasMes = [
			{ tipo: "sin_reinversion", cantidad: 1, monto: "0.00" },
		];
		purchases.detalleComprasMes = [
			{
				fecha: "2026-07-03",
				inversionista: "Ana",
				modalidad: "sin_reinversion",
				monto: "0.00",
			},
		];
		expect(
			getReportState({ pending: false, error: false, data: purchases }),
		).toBe("ready");
	});

	test("conserva compras conciliadas aunque no existan liquidaciones", () => {
		const purchases = purchaseOnlyResponse();

		expect(buildReinvestmentReportModel(purchases).reconciled).toBe(true);
		expect(
			getReportState({ pending: false, error: false, data: purchases }),
		).toBe("ready");
		expect(
			buildSecondarySummaryPresentation(purchases).find(
				(summary) => summary.key === "purchases",
			)?.total,
		).toBe(80);
	});

	test("mantiene vacío un mes compatible sin liquidaciones ni compras", () => {
		const empty = purchaseOnlyResponse();
		empty.comprasMes = [];
		empty.detalleComprasMes = [];

		expect(buildReinvestmentReportModel(empty).reconciled).toBe(true);
		expect(getReportState({ pending: false, error: false, data: empty })).toBe(
			"empty",
		);
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
				cantidad_liquidaciones: 1,
			},
		};
		zero.interesNeto = {
			noVerificado: { interes: "0.00" },
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
