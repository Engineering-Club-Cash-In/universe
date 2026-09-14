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

const { cleanup, render, screen } = await import("@testing-library/react");
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
	expect(screen.getAllByText("Pago estimado")).toHaveLength(2);
	expect(screen.getAllByText("Reinversión estimada")).toHaveLength(2);
	expect(screen.getByText("Inversionista Ejemplo")).toBeTruthy();
	expect(screen.getAllByText("Interés bruto")).toHaveLength(2);
	expect(screen.getAllByText("IVA")).toHaveLength(2);
	expect(screen.getAllByText("ISR")).toHaveLength(2);
	expect(screen.getByText(/100% de las cuotas programadas/)).toBeTruthy();
	expect(screen.queryByText(/liquidado/i)).toBeNull();
});
