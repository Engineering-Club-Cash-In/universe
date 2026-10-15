import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CreditApplicationForm } from "./CreditApplicationForm";

// Render del servidor (sin DOM global): no choca con las pruebas que usan happy-dom.
function inputsDeDpi(html: string) {
	return [...html.matchAll(/<input[^>]*placeholder="13 dígitos"[^>]*>/g)].map(
		(m) => m[0],
	);
}

describe("CreditApplicationForm: DPI de las referencias", () => {
	const html = renderToStaticMarkup(
		<CreditApplicationForm onSubmit={mock()} />,
	);
	const campos = inputsDeDpi(html);

	test("hay un campo DPI opcional en cada referencia familiar y personal", () => {
		expect(campos).toHaveLength(6);
		expect(html.match(/DPI \(opcional\)/g)).toHaveLength(6);
		expect(html.match(/Nos ayuda a identificar a la persona\./g)).toHaveLength(
			6,
		);
	});

	test("cada campo tiene límite de 15, teclado numérico y el nombre que viaja al servidor", () => {
		for (const campo of campos) {
			expect(campo).toContain('maxLength="15"');
			expect(campo).toContain('inputMode="numeric"');
		}
		const nombres = campos.map((c) => c.match(/name="([^"]+)"/)?.[1]);
		expect(nombres).toEqual([
			"referenciasCrediticias.0.dpi",
			"referenciasCrediticias.1.dpi",
			"referenciasCrediticias.2.dpi",
			"referenciasPersonales.0.dpi",
			"referenciasPersonales.1.dpi",
			"referenciasPersonales.2.dpi",
		]);
	});

	test("sin errores de DPI de entrada", () => {
		expect(html).not.toContain("DPI inválido");
	});
});
