import { expect, test } from "bun:test";

test("el pie pasa acumulado al helper del split", async () => {
	const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text();
	const footer = source.slice(source.indexOf("const splitTotals"));

	expect(footer).toMatch(
		/getMontoACobrarParticipacionTotals\([\s\S]*?\),\s*a,\s*\)/,
	);
});
