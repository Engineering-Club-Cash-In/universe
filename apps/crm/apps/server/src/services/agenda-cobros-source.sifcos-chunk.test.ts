import { expect, mock, test } from "bun:test";
import { consultarSifcosEnChunks } from "./agenda-cobros-source";

test("consulta cada bloque SIFCO sin omitir ni reordenar resultados", async () => {
	const sifcos = Array.from({ length: 1001 }, (_, index) => `S-${index}`);
	const consultar = mock(async (chunk: readonly string[]) =>
		chunk.map((sifco) => ({ sifco })),
	);

	expect(await consultarSifcosEnChunks(sifcos, consultar)).toEqual(
		sifcos.map((sifco) => ({ sifco })),
	);
	expect(consultar).toHaveBeenCalledTimes(2);
	expect(consultar).toHaveBeenNthCalledWith(1, sifcos.slice(0, 1000));
	expect(consultar).toHaveBeenNthCalledWith(2, sifcos.slice(1000));
});
