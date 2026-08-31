import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const headerPath = fileURLToPath(new URL("./header.tsx", import.meta.url));

test("muestra Supervisión Págalo para rol cobros en menú desktop y móvil", async () => {
	const source = await readFile(headerPath, "utf8");
	const enlacesPagalo = source.match(
		/\{PERMISSIONS\.canAccessCobros\(userRole\) && \(\s*(?:<DropdownMenuItem asChild>)?\s*<Link to="\/cobros\/pagalo"/gs,
	);

	expect(enlacesPagalo).toHaveLength(2);
});
