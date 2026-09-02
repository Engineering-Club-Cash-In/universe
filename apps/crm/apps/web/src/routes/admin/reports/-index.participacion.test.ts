import { expect, test } from "bun:test";

test("el pie pasa acumulado al helper del split", async () => {
	const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text();
	const footer = source.slice(source.indexOf("const splitTotals"));

	expect(footer).toMatch(
		/getMontoACobrarParticipacionTotals\([\s\S]*?\),\s*a,\s*\)/,
	);
});

test("presenta exactamente las once columnas de cobranza", async () => {
	const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text();
	const table = source.slice(
		source.indexOf("{/* Tabla detallada */}"),
		source.indexOf("{/* Reporte: Facturado del Mes vs Esperado */}"),
	);
	const labels = [
		"Período",
		"Cantidad de Cuotas",
		"Capital",
		"Interés + IVA",
		"Servicios (Seguro + GPS)",
		"Membresías",
		"Total Mora",
		"Total",
		"Capital CUBE",
		"Interés + IVA CUBE",
		"Facturación",
	];

	let position = -1;
	for (const label of labels) {
		const next = table.indexOf(label, position + 1);
		expect(
			next,
			`${label} debe aparecer en el orden requerido`,
		).toBeGreaterThan(position);
		position = next;
	}
	expect(table).not.toContain(">Interés<");
	expect(table).not.toContain(">IVA 12%<");
	expect(table).not.toContain(">Seguro<");
	expect(table).not.toContain(">GPS<");
	expect(table).not.toContain("Interés Inv. pagado");
	expect(table).not.toContain("Capital Inv.");
	expect(table).not.toContain("Interés + IVA Inv.");
});

test("mantiene alineadas las once columnas en encabezado, filas y total", async () => {
	const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text();
	const table = source.slice(
		source.indexOf("{/* Tabla detallada */}"),
		source.indexOf("{/* Reporte: Facturado del Mes vs Esperado */}"),
	);
	const header = table.slice(
		table.indexOf("<TableHeader"),
		table.indexOf("</TableHeader>"),
	);
	const bodyStart = table.indexOf("<TableRow key={row.bucket}>");
	const body = table.slice(bodyStart, table.indexOf("</TableRow>", bodyStart));
	const footerStart = table.indexOf(
		'<TableRow className="border-t-2 bg-muted/50 font-bold">',
	);
	const footer = table.slice(
		footerStart,
		table.indexOf("</TableRow>", footerStart),
	);
	const countTags = (section: string, tag: "TableHead" | "TableCell") =>
		section.match(new RegExp(`<${tag}(?=[\\s>])`, "g"))?.length ?? 0;

	expect(countTags(header, "TableHead")).toBe(11);
	expect(countTags(body, "TableCell")).toBe(11);
	expect(countTags(footer, "TableCell")).toBe(11);
});

test("usa cuadrícula centrada y encabezado sticky", async () => {
	const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text();
	const table = source.slice(
		source.indexOf("{/* Tabla detallada */}"),
		source.indexOf("{/* Reporte: Facturado del Mes vs Esperado */}"),
	);

	expect(table).toContain('className="min-w-[1320px] border-collapse');
	expect(table).toContain("sticky top-0");
	expect(table).toContain("text-center");
	expect(table).toContain("border");
});

test("la gráfica usa únicamente los cuatro rubros principales consolidados", async () => {
	const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text();
	const colors = source.slice(
		source.indexOf("const MONTO_COBRAR_COLORS"),
		source.indexOf("const GUATEMALA_TIME_ZONE"),
	);

	expect(colors).toContain('capital: "Capital"');
	expect(colors).toContain('interesIva: "Interés + IVA"');
	expect(colors).toContain('servicios: "Servicios (Seguro + GPS)"');
	expect(colors).toContain('membresias: "Membresías"');
	expect(colors).not.toContain("total_interes");
	expect(colors).not.toContain("total_iva");
	expect(colors).not.toContain("total_seguro");
	expect(colors).not.toContain("total_gps");
});

test("Cobranza e Inversión usan el mismo workbook multihoja", async () => {
	const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text();
	const exportBlock = source.slice(
		source.indexOf("const exportAdminReportsExcel"),
		source.indexOf("const closedCreditsRows"),
	);

	expect(source).toContain("buildAdminReportsWorkbook");
	expect(exportBlock).toContain("cobranza:");
	expect(exportBlock).toContain("reinvestment: reinversionData");
	expect(exportBlock).toContain("metadata:");
	expect(source).not.toContain("buildInvestorExportRows");
	expect(source).toContain("onExportInvestors={exportAdminReportsExcel}");
	expect(source).toContain("onClick={exportAdminReportsExcel}");
	expect(source).toMatch(
		/\{isAdmin && \(\s*<Button variant="outline" onClick=\{exportAdminReportsExcel\}>/,
	);
});

test("pantalla y workbook usan las mismas filas de Cobranza con períodos vacíos", async () => {
	const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text();
	const exportBlock = source.slice(
		source.indexOf("const exportAdminReportsExcel"),
		source.indexOf("const closedCreditsRows"),
	);

	expect(source).toContain(
		"const montoCobrarRows = fillMissingMontoACobrarPeriods(",
	);
	expect(exportBlock).toContain("rows: montoCobrarRows");
	expect(source.match(/fillMissingMontoACobrarPeriods\(/g)?.length).toBe(1);
	expect(source).not.toContain("function fillMissingPeriods(");
	expect(source).toContain("const rows = montoCobrarRows;");
	expect(source).toMatch(
		/const lastRow = rows\.findLast\(\s*\(row\) => row\.cuotas_count > 0,?\s*\)/,
	);
});
