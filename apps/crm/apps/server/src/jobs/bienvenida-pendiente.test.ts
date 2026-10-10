import { describe, expect, test } from "bun:test";
import {
	type CandidatoBienvenida,
	recuperarBienvenidasPendientes,
} from "./bienvenida-pendiente";

const c = (
	sifco: string,
	leadPhone: string | null = "30295849",
): CandidatoBienvenida => ({
	opportunityId: `op-${sifco}`,
	userId: "u-1",
	numeroSifco: sifco,
	leadPhone,
});

function correr(
	candidatos: CandidatoBienvenida[],
	estado: Record<string, { enviada: boolean; fallidos: number }> = {},
	over: { habilitada?: boolean; modoPrueba?: boolean } = {},
) {
	const enviados: string[] = [];
	const promesa = recuperarBienvenidasPendientes({
		habilitada: () => over.habilitada ?? true,
		modoPrueba: () => over.modoPrueba ?? false,
		candidatos: async () => candidatos,
		enviados: async () => new Map(Object.entries(estado)),
		enviar: async (p) => {
			enviados.push(p.numeroSifco);
			return { cuentaNexa: null, bienvenidaEnviada: true };
		},
	});
	return { promesa, enviados };
}

describe("recuperarBienvenidasPendientes", () => {
	test("manda solo a los que no tienen bienvenida enviada ni 3 fallos", async () => {
		const { promesa, enviados } = correr([c("A"), c("B"), c("C"), c("A")], {
			B: { enviada: true, fallidos: 0 },
			C: { enviada: false, fallidos: 3 },
		});
		expect(await promesa).toEqual({ revisadas: 1, enviadas: 1 });
		expect(enviados).toEqual(["A"]);
	});

	test("salta leads sin teléfono salvo en modo prueba", async () => {
		const real = correr([c("A", null)]);
		await real.promesa;
		expect(real.enviados).toEqual([]);
		const prueba = correr([c("A", null)], {}, { modoPrueba: true });
		await prueba.promesa;
		expect(prueba.enviados).toEqual(["A"]);
	});

	test("apagado no hace nada", async () => {
		const { promesa, enviados } = correr([c("A")], {}, { habilitada: false });
		expect(await promesa).toEqual({ revisadas: 0, enviadas: 0 });
		expect(enviados).toEqual([]);
	});
});
