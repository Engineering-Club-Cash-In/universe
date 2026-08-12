import { expect, test } from "bun:test";

test("el pie pasa acumulado al helper del split", async () => {
	const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text();
	const footer = source.slice(source.indexOf("const splitTotals"));

	expect(footer).toMatch(
		/getMontoACobrarParticipacionTotals\([\s\S]*?\),\s*a,\s*\)/,
	);
});

test("presenta las columnas principales consolidadas antes del detalle", async () => {
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
		"Detalle complementario",
		"Interés Inv. pagado (referencia)",
		"Capital Inv.",
		"Capital CUBE",
		"Interés + IVA Inv.",
		"Interés + IVA CUBE",
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
});

test("mantiene alineadas las trece columnas en encabezado, filas y total", async () => {
	const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text();
	const table = source.slice(
		source.indexOf("{/* Tabla detallada */}"),
		source.indexOf("{/* Reporte: Facturado del Mes vs Esperado */}"),
	);
	const header = table.slice(
		table.indexOf("<TableHeader>"),
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

	expect(countTags(header, "TableHead")).toBe(13);
	expect(countTags(body, "TableCell")).toBe(13);
	expect(countTags(footer, "TableCell")).toBe(13);
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
