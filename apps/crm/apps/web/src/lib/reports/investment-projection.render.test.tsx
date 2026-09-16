import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";

const browserWindow = new Window();
Object.assign(globalThis, {
	window: browserWindow,
	document: browserWindow.document,
	navigator: browserWindow.navigator,
	HTMLElement: browserWindow.HTMLElement,
	Node: browserWindow.Node,
	Event: browserWindow.Event,
	MouseEvent: browserWindow.MouseEvent,
	getComputedStyle: browserWindow.getComputedStyle.bind(browserWindow),
	IS_REACT_ACT_ENVIRONMENT: true,
});

const { cleanup, fireEvent, render, screen } = await import(
	"@testing-library/react"
);
const { InvestmentProjection } = await import(
	"../../components/reports/investment-projection"
);

afterEach(() => cleanup());

test("muestra la proyección separada con supuestos y desglose", () => {
	render(
		<InvestmentProjection
			data={{
				porInversionista: [
					{
						inversionista_id: 10,
						nombre: "Inversionista Ejemplo",
						reinversion_capital: "50.00",
						reinversion_interes: "0.00",
						reinversion_total: "50.00",
						cash_capital: "50.00",
						cash_interes: "11.20",
						cash_total: "61.20",
						interes_bruto: "10.00",
						iva: "1.20",
						isr: "0.00",
						total: "111.20",
					},
				],
				totales: {
					reinversion_total: "50.00",
					cash_total: "61.20",
					interes_bruto: "10.00",
					iva: "1.20",
					isr: "0.00",
					total: "111.20",
					externos: {
						reinversion_total: "50.00",
						cash_total: "61.20",
						total: "111.20",
					},
					cube: {
						reinversion_total: "0.00",
						cash_total: "0.00",
						total: "0.00",
					},
				},
				contexto: {
					cancelaciones_pendientes: {
						cantidad_creditos: 46,
						monto_bruto: "4251094.73",
						capital_externo_asociado: "1148921.24",
					},
					cierres_naturales_periodo: {
						cantidad_creditos: 3,
						capital_externo_asociado: "11202.02",
					},
				},
			}}
			isPending={false}
			isError={false}
			periodLabel="octubre de 2026"
			asOfLabel="14 de septiembre de 2026"
			onRetry={() => undefined}
		/>,
	);

	expect(screen.getByText("Proyección al corte de hoy")).toBeTruthy();
	expect(screen.getByText("Por pagar a inversionistas")).toBeTruthy();
	expect(screen.getByText("Por reinvertir a inversionistas")).toBeTruthy();
	expect(screen.getByText("Flujo CUBE")).toBeTruthy();
	expect(screen.getByText("Flujo económico total")).toBeTruthy();
	expect(
		screen.getByText(/46 créditos pendientes de cancelación/),
	).toBeTruthy();
	expect(screen.getByText(/no se suman al flujo mensual/i)).toBeTruthy();
	expect(screen.getByText(/3 créditos terminan naturalmente/)).toBeTruthy();
	expect(screen.getAllByText("Pago estimado")).toHaveLength(1);
	expect(screen.getAllByText("Reinversión estimada")).toHaveLength(1);
	expect(screen.getByText("Inversionista Ejemplo")).toBeTruthy();
	expect(screen.getAllByText("Interés bruto")).toHaveLength(2);
	expect(screen.getAllByText("IVA")).toHaveLength(2);
	expect(screen.getAllByText("ISR")).toHaveLength(2);
	expect(screen.getByText(/100% de las cuotas programadas/)).toBeTruthy();
	expect(screen.queryByText(/liquidado/i)).toBeNull();
});

test("mantiene visible el contexto cuando no hay cuotas proyectadas", () => {
	render(
		<InvestmentProjection
			data={{
				porInversionista: [],
				totales: {
					reinversion_total: "0.00",
					cash_total: "0.00",
					interes_bruto: "0.00",
					iva: "0.00",
					isr: "0.00",
					total: "0.00",
					externos: {
						reinversion_total: "0.00",
						cash_total: "0.00",
						total: "0.00",
					},
					cube: {
						reinversion_total: "0.00",
						cash_total: "0.00",
						total: "0.00",
					},
				},
				contexto: {
					cancelaciones_pendientes: {
						cantidad_creditos: 1,
						monto_bruto: "150.00",
						capital_externo_asociado: "300.00",
					},
					cierres_naturales_periodo: {
						cantidad_creditos: 0,
						capital_externo_asociado: "0.00",
					},
				},
			}}
			isPending={false}
			isError={false}
			periodLabel="octubre de 2026"
			asOfLabel="14 de septiembre de 2026"
			onRetry={() => undefined}
		/>,
	);

	expect(screen.getByText(/1 crédito pendiente de cancelación/)).toBeTruthy();
	expect(screen.getByText(/no se suman al flujo mensual/i)).toBeTruthy();
	expect(screen.getByText(/No hay cuotas programadas/)).toBeTruthy();
});

test("pagina la tabla de proyección cada 25 inversionistas", () => {
	const investors = Array.from({ length: 26 }, (_, index) => ({
		inversionista_id: index + 1,
		nombre: `Inversionista ${index + 1}`,
		reinversion_capital: "0.00",
		reinversion_interes: "0.00",
		reinversion_total: "0.00",
		cash_capital: "100.00",
		cash_interes: "10.00",
		cash_total: "110.00",
		interes_bruto: "10.00",
		iva: "1.20",
		isr: "0.00",
		total: "110.00",
	}));
	const { rerender } = render(
		<InvestmentProjection
			data={{
				porInversionista: investors,
				totales: {
					reinversion_total: "0.00",
					cash_total: "2860.00",
					interes_bruto: "260.00",
					iva: "31.20",
					isr: "0.00",
					total: "2860.00",
					externos: {
						reinversion_total: "0.00",
						cash_total: "2860.00",
						total: "2860.00",
					},
					cube: {
						reinversion_total: "0.00",
						cash_total: "0.00",
						total: "0.00",
					},
				},
			}}
			isPending={false}
			isError={false}
			periodLabel="octubre de 2026"
			asOfLabel="14 de septiembre de 2026"
			onRetry={() => undefined}
		/>,
	);

	expect(screen.getByText("Inversionista 25")).toBeTruthy();
	expect(screen.queryByText("Inversionista 26")).toBeNull();
	expect(screen.getByText("Página 1 de 2")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
	expect(screen.getByText("Inversionista 26")).toBeTruthy();
	expect(screen.queryByText("Inversionista 1")).toBeNull();
	expect(screen.getByText("Página 2 de 2")).toBeTruthy();

	rerender(
		<InvestmentProjection
			data={{
				porInversionista: investors,
				totales: {
					reinversion_total: "0.00",
					cash_total: "2860.00",
					interes_bruto: "260.00",
					iva: "31.20",
					isr: "0.00",
					total: "2860.00",
					externos: {
						reinversion_total: "0.00",
						cash_total: "2860.00",
						total: "2860.00",
					},
					cube: {
						reinversion_total: "0.00",
						cash_total: "0.00",
						total: "0.00",
					},
				},
			}}
			isPending={false}
			isError={false}
			periodLabel="noviembre de 2026"
			asOfLabel="14 de septiembre de 2026"
			onRetry={() => undefined}
		/>,
	);
	expect(screen.getByText("Inversionista 1")).toBeTruthy();
	expect(screen.queryByText("Inversionista 26")).toBeNull();
	expect(screen.getByText("Página 1 de 2")).toBeTruthy();
});
