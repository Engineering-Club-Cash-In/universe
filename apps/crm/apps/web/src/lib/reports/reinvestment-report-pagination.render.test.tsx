import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ReactElement } from "react";
import type { ReinversionLiquidacionesResponse } from "./scenario";

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
const { PaginatedRows, ReinvestmentReport } = await import(
	"../../components/reports/reinvestment-report"
);

afterEach(() => cleanup());

function TableHarness({
	rows,
	period = "2026-08",
}: {
	rows: number[];
	period?: string;
}): ReactElement {
	return (
		<PaginatedRows key={period} label="prueba" rows={rows}>
			{(visibleRows) => (
				<ul>
					{visibleRows.map((row) => (
						<li key={row}>fila-{row}</li>
					))}
				</ul>
			)}
		</PaginatedRows>
	);
}

const buildRows = (total: number) =>
	Array.from({ length: total }, (_, index) => index + 1);

const reportFixture = (): ReinversionLiquidacionesResponse => ({
	contrato_version: 3,
	porTipo: {
		sin_reinversion: {
			reinversion_capital: "0.00",
			reinversion_interes: "0.00",
			reinversion_total: "0.00",
			total_capital: "100.00",
			total_interes: "10.00",
			total_iva: "0.00",
			total_isr: "0.00",
			total_cuota: "110.00",
			iva_facturado: "0.00",
			total_distribuido: "110.00",
			cantidad_liquidaciones: 1,
			composicion: {
				pagado: {
					capital: "100.00",
					resto: "10.00",
					sin_clasificar: "0.00",
					total: "110.00",
				},
				reinvertido: {
					capital: "0.00",
					resto: "0.00",
					sin_clasificar: "0.00",
					total: "0.00",
				},
				flujo: { capital: "100.00", resto: "10.00", total: "110.00" },
				estado: "exacto",
			},
		},
	},
	interesNeto: {
		noVerificado: { interes: "10.00" },
		cube: { interes: "0.00", iva: "0.00", neto: "0.00" },
	},
	pagosExtras: { abonos_capital: "20.00", cancelaciones: "30.00" },
	porInversionista: [],
	comprasMes: [
		{
			modalidad_facturacion: "factura_cube",
			tipo_reinversion: "sin_reinversion",
			tipo_compra: "nueva_posicion",
			cantidad: 1,
			monto: "80.00",
		},
	],
	ticketInversion: {
		actual: {
			periodo: "2026-07",
			cantidad: 1,
			monto_total: "80.00",
			ticket_promedio: "80.00",
			variacion_porcentual: null,
		},
		historico: [],
	},
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
			modalidad_facturacion: "factura_cube",
			tipo_reinversion: "sin_reinversion",
			tipo_compra: "nueva_posicion",
			monto: "80.00",
		},
	],
	detalle_estado: { disponible: true, error: null },
	cantidad_liquidaciones: 1,
});

describe("PaginatedRows", () => {
	for (const total of [133, 135, 60, 80]) {
		test(`navega hasta el remanente final de ${total} filas y vuelve al inicio`, () => {
			render(<TableHarness rows={buildRows(total)} />);

			const totalPages = Math.ceil(total / 25);
			const lastPageRows = total % 25 || 25;
			expect(screen.getAllByRole("listitem")).toHaveLength(25);
			expect(
				screen.getByRole("navigation", { name: "Paginación de prueba" }),
			).toBeTruthy();

			fireEvent.click(screen.getByRole("button", { name: /Última/ }));

			expect(
				screen.getByText(`Página ${totalPages} de ${totalPages}`),
			).toBeTruthy();
			expect(screen.getAllByRole("listitem")).toHaveLength(lastPageRows);
			expect(screen.getByText(`fila-${total}`)).toBeTruthy();
			expect(
				screen.getByRole("button", { name: /Última/ }).hasAttribute("disabled"),
			).toBe(true);

			fireEvent.click(screen.getByRole("button", { name: /Primera/ }));

			expect(screen.getByText(`Página 1 de ${totalPages}`)).toBeTruthy();
			expect(screen.getByText("fila-1")).toBeTruthy();
			expect(
				screen
					.getByRole("button", { name: /Primera/ })
					.hasAttribute("disabled"),
			).toBe(true);
		});
	}

	test("avanza y retrocede una página", () => {
		render(<TableHarness rows={buildRows(60)} />);

		fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
		expect(screen.getByText("Página 2 de 3")).toBeTruthy();
		expect(screen.getByText("fila-26")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Anterior" }));
		expect(screen.getByText("Página 1 de 3")).toBeTruthy();
		expect(screen.getByText("fila-1")).toBeTruthy();
	});

	test("reinicia en la primera página cuando cambia el período", () => {
		const { rerender } = render(
			<TableHarness period="2026-08" rows={buildRows(80)} />,
		);
		fireEvent.click(screen.getByRole("button", { name: /Última/ }));
		expect(screen.getByText("Página 4 de 4")).toBeTruthy();

		rerender(<TableHarness period="2026-09" rows={buildRows(60)} />);

		expect(screen.getByText("Página 1 de 3")).toBeTruthy();
		expect(screen.getByText("fila-1")).toBeTruthy();
	});
});

describe("detalle secundario compartido", () => {
	test("cambia de tabla y se cierra al repetir la selección activa", () => {
		render(
			<ReinvestmentReport
				data={reportFixture()}
				isPending={false}
				isError={false}
				periodLabel="julio 2026"
				onRetry={() => undefined}
			/>,
		);

		const buttons = screen.getAllByRole("button", {
			name: /Ver detalle de/,
		});
		const panels = () =>
			document.querySelectorAll('[data-layout="secondary-detail-panel"]');

		expect(buttons).toHaveLength(3);
		expect(
			buttons.map((button) => button.getAttribute("aria-controls")),
		).toEqual([null, null, null]);
		expect(panels()).toHaveLength(0);

		fireEvent.click(buttons[0]);
		expect(panels()).toHaveLength(1);
		const panel = panels()[0];
		const panelId = panel?.id;
		expect(panelId).toBeTruthy();
		expect(panel?.parentElement?.children).toHaveLength(4);
		expect(panel?.parentElement?.lastElementChild).toBe(panel);
		expect(panel?.parentElement?.className).toContain("lg:grid-cols-3");
		expect(panel?.className).toContain("lg:col-span-3");
		expect(panel?.textContent).toContain("LIQ-1");
		expect(
			buttons.map((button) => button.getAttribute("aria-controls")),
		).toEqual([panelId, panelId, panelId]);
		expect(
			screen
				.getByRole("button", {
					name: "Ocultar detalle de Interés registrado",
				})
				.getAttribute("aria-expanded"),
		).toBe("true");

		fireEvent.click(buttons[1]);
		expect(panels()).toHaveLength(1);
		expect(panels()[0]?.textContent).toContain("CR-1");
		expect(panels()[0]?.textContent).not.toContain("LIQ-1");
		expect(
			screen
				.getByRole("button", {
					name: "Ocultar detalle de Pagos extras",
				})
				.getAttribute("aria-expanded"),
		).toBe("true");

		fireEvent.click(buttons[2]);
		expect(panels()).toHaveLength(1);
		expect(panels()[0]?.textContent).toContain("Modalidad de facturación");
		expect(panels()[0]?.textContent).not.toContain("CR-1");

		fireEvent.click(buttons[2]);
		expect(panels()).toHaveLength(0);
		expect(
			buttons.map((button) => button.getAttribute("aria-controls")),
		).toEqual([null, null, null]);
	});
});
