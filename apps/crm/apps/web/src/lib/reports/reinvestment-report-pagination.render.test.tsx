import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ReactElement } from "react";

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
const { PaginatedRows } = await import(
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
