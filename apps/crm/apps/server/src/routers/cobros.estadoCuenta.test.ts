import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const routerPath = fileURLToPath(new URL("./cobros.ts", import.meta.url));

describe("cobrosRouter.enviarEstadoCuentaWhatsapp", () => {
	test("queda registrado bajo cobrosProcedure", async () => {
		const source = await readFile(routerPath, "utf8");

		expect(source).toMatch(
			/enviarEstadoCuentaWhatsapp:\s*cobrosProcedure\s*\.input\(z\.object\(\{\s*casoCobroId:\s*z\.string\(\)\.min\(1\)/s,
		);
	});
});

describe("codigoEstadoCuentaAHttp", () => {
	test("mapea cada código de negocio al HTTP esperado", async () => {
		const source = await readFile(routerPath, "utf8");

		expect(source).toMatch(/case "CASO_NO_ENCONTRADO":\s*return "NOT_FOUND"/s);
		expect(source).toMatch(
			/case "SIN_SIFCO":\s*case "SIN_TELEFONO":\s*case "SIN_MOVIMIENTOS":\s*case "CREDITO_NO_ESTA_EN_CARTERA":\s*return "BAD_REQUEST"/s,
		);
		expect(source).toMatch(
			/case "ERROR_CARTERA":\s*case "ERROR_ENVIO":\s*case "ERROR_INTERNO":\s*return "INTERNAL_SERVER_ERROR"/s,
		);
	});
});
