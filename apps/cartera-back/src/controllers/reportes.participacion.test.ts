import { expect, test } from "bun:test";

test("la CTE de participación usa el porcentaje autoritativo de créditos_inversionistas", async () => {
	const source = await Bun.file(new URL("./reportes.ts", import.meta.url)).text();

	expect(source).toContain(
		"ci.porcentaje_participacion_inversionista::numeric / 100",
	);
	expect(source).not.toContain("ci.porcentaje::numeric / 100");
	expect(source).toContain("FILTER (WHERE i.permite_distribucion = false)");
});
