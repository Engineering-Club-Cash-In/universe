import { expect, test } from "bun:test";

const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text();
const cobranzaModals = (source.match(
	/\{canAccessCobranzaReport && \(\n\s*<>\n([\s\S]*?)\n\s*<\/>\n\s*\)\}/,
))?.[1];

test("admin renders the monto simulation modal", () => {
	expect(cobranzaModals).toContain('open={scenarioOpen === "monto"}');
});

test("admin renders the facturacion simulation modal", () => {
	expect(cobranzaModals).toContain('open={scenarioOpen === "facturacion"}');
});

test("cobros supervisor renders the monto simulation modal", () => {
	expect(cobranzaModals).toContain("config={montoACobrarConfig}");
});

test("cobros supervisor renders the facturacion simulation modal", () => {
	expect(cobranzaModals).toContain("config={facturacionConfig}");
});

test("roles without cobranza access do not render the monto modal", () => {
	expect(source).toContain("{canAccessCobranzaReport && (");
});

test("administrative simulation modals remain admin-only", () => {
	const adminSection = source.slice(source.indexOf("{isAdmin && ("));
	expect(adminSection).toMatch(/config=\{coberturaConfig\}[\s\S]*config=\{comparativoConfig\}/);
});
