import { afterEach, describe, expect, mock, test } from "bun:test";
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
const { BankStatementCoverage } = await import("./BankStatementCoverage");

afterEach(() => cleanup());

const detectedCoverage = {
	version: 1 as const,
	analysisBatchId: "analysis-1",
	status: "detected" as const,
	saveStatus: "saved" as const,
	months: [
		{ month: "2026-06", sourceFileIndexes: [0] },
		{ month: "2026-07", sourceFileIndexes: [0] },
		{ month: "2026-08", sourceFileIndexes: [0] },
	],
	files: [
		{
			fileIndex: 0,
			name: "estado-trimestral.pdf",
			status: "detected" as const,
			detectedMonths: ["2026-06", "2026-07", "2026-08"],
			effectiveMonths: ["2026-06", "2026-07", "2026-08"],
		},
	],
	manualDeclarations: [],
};

describe("BankStatementCoverage", () => {
	test("shows per-PDF months, unique total, and saved status", () => {
		render(<BankStatementCoverage coverage={detectedCoverage} />);

		expect(screen.getByText("estado-trimestral.pdf")).toBeTruthy();
		expect(screen.getByText("Junio, julio y agosto de 2026")).toBeTruthy();
		expect(screen.getByText("3 de 3 meses")).toBeTruthy();
		expect(screen.getByText("Guardado")).toBeTruthy();
	});

	test("save failure is not announced as completion and offers focused retry", () => {
		const onRetry = mock(() => {});
		render(
			<BankStatementCoverage
				coverage={{
					...detectedCoverage,
					saveStatus: "failed",
					saveError: "No se pudieron guardar los adjuntos.",
				}}
				onRetry={onRetry}
			/>,
		);

		expect(screen.queryByText("Requisitos completados")).toBeNull();
		expect(screen.getByText("Guardado fallido")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Reintentar guardado" }),
		);
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	test("ambiguous files use the required copy and an accessible explicit month review", () => {
		const onConfirm = mock(() => {});
		render(
			<BankStatementCoverage
				coverage={{
					...detectedCoverage,
					status: "needs_confirmation",
					months: [],
					files: [
						{
							fileIndex: 0,
							name: "periodo-ilegible.pdf",
							status: "needs_confirmation",
							detectedMonths: ["Junio"],
							effectiveMonths: [],
						},
					],
				}}
				onConfirm={onConfirm}
			/>,
		);

		expect(
			screen.getByText("No pudimos confirmar los meses de este documento"),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Revisar meses" }));
		const monthInput = screen.getByLabelText(
			"Mes y año para periodo-ilegible.pdf",
		);
		fireEvent.change(monthInput, { target: { value: "2026-06" } });
		fireEvent.click(screen.getByRole("button", { name: "Confirmar meses" }));
		expect(onConfirm).toHaveBeenCalledWith(0, ["2026-06"]);
	});

	test("historical analyses remain uninferred", () => {
		render(<BankStatementCoverage coverage={null} />);
		expect(screen.getByText("Cobertura no registrada")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Revisar meses" })).toBeNull();
	});

	test("save status is textual and not color-only", () => {
		render(
			<BankStatementCoverage
				coverage={{ ...detectedCoverage, saveStatus: "pending" }}
			/>,
		);
		expect(screen.getByText("Guardado pendiente")).toBeTruthy();
	});

	test("not-applicable attachment state never claims documents were saved", () => {
		render(
			<BankStatementCoverage
				coverage={{ ...detectedCoverage, saveStatus: "not_applicable" }}
			/>,
		);
		expect(screen.getByText("Adjuntos no aplicables")).toBeTruthy();
		expect(screen.queryByText("Guardado")).toBeNull();
		expect(screen.queryByRole("button", { name: "Reintentar guardado" })).toBeNull();
	});

	test("manual confirmation can add and remove more than three canonical months", () => {
		const onConfirm = mock(() => {});
		render(
			<BankStatementCoverage
				coverage={{
					...detectedCoverage,
					status: "needs_confirmation",
					months: [],
					files: [
						{
							fileIndex: 0,
							name: "periodo-cuatro-meses.pdf",
							status: "needs_confirmation",
							detectedMonths: [],
							effectiveMonths: [],
						},
					],
				}}
				onConfirm={onConfirm}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Revisar meses" }));
		for (let index = 0; index < 3; index++) {
			fireEvent.click(screen.getByRole("button", { name: "Agregar mes" }));
		}
		for (const [index, value] of [
			"2026-01",
			"2026-02",
			"2026-03",
			"2026-04",
		].entries()) {
			fireEvent.change(
				screen.getByLabelText(
					index === 0
						? "Mes y año para periodo-cuatro-meses.pdf"
						: `Mes y año adicional ${index + 1}`,
				),
				{ target: { value } },
			);
		}
		fireEvent.click(screen.getByRole("button", { name: "Quitar mes 2" }));
		fireEvent.click(screen.getByRole("button", { name: "Agregar mes" }));
		fireEvent.change(screen.getByLabelText("Mes y año adicional 4"), {
			target: { value: "2026-05" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Confirmar meses" }));
		expect(onConfirm).toHaveBeenCalledWith(0, [
			"2026-01",
			"2026-03",
			"2026-04",
			"2026-05",
		]);
	});
});
