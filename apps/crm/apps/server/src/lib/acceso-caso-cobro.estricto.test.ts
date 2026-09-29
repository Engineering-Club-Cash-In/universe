/**
 * usuarioDuenoEnCarteraEstricto: la lectura del dueño en cartera que usan las
 * decisiones de ACCESO. `null` solo puede querer decir "cartera contestó y el
 * dueño no tiene usuario en el CRM"; una falla de cartera tiene que lanzar
 * (review de Codex, P1, PR #1765).
 */
import { afterEach, describe, expect, it, mock } from "bun:test";

let integracionActiva = true;
let asesorPorSifcoFalla = false;
let poolFalla = false;
let duenosMock: {
	numero_credito_sifco: string;
	asesor_id: number;
	nombre: string;
}[] = [];
let usuarioPorAsesorMock = new Map<number, string>();

mock.module("../services/cartera-back-integration", () => ({
	isCarteraBackEnabled: () => integracionActiva,
}));
mock.module("../services/cartera-back-client", () => ({
	carteraBackClient: {
		getAsesorPorSifco: async () => {
			if (asesorPorSifcoFalla) throw new Error("cartera caída");
			return { data: duenosMock };
		},
		getPoolPorAsesor: async () => [],
	},
}));
mock.module("../services/cobros-notif-helpers", () => ({
	construirMapaAsesorUsuario: async () => {
		if (poolFalla) throw new Error("pool caído");
		return usuarioPorAsesorMock;
	},
}));

const { usuarioDuenoEnCarteraEstricto, usuarioDuenoEnCartera } = await import(
	"./acceso-caso-cobro"
);

afterEach(() => {
	integracionActiva = true;
	asesorPorSifcoFalla = false;
	poolFalla = false;
	duenosMock = [];
	usuarioPorAsesorMock = new Map();
});

describe("usuarioDuenoEnCarteraEstricto", () => {
	it("devuelve el usuario del CRM del dueño en cartera", async () => {
		duenosMock = [
			{ numero_credito_sifco: "0101", asesor_id: 1, nombre: "Erik" },
		];
		usuarioPorAsesorMock = new Map([[1, "u-erik"]]);
		expect(await usuarioDuenoEnCarteraEstricto("0101")).toBe("u-erik");
	});

	it("null solo cuando cartera contestó y el dueño no tiene usuario en el CRM", async () => {
		duenosMock = [
			{ numero_credito_sifco: "0101", asesor_id: 9, nombre: "Sin cuenta" },
		];
		expect(await usuarioDuenoEnCarteraEstricto("0101")).toBeNull();
	});

	it("cartera caída al buscar el dueño: lanza SERVICE_UNAVAILABLE, no devuelve null", async () => {
		asesorPorSifcoFalla = true;
		await expect(usuarioDuenoEnCarteraEstricto("0101")).rejects.toMatchObject({
			code: "SERVICE_UNAVAILABLE",
		});
	});

	it("falla el catálogo de asesores: también lanza", async () => {
		duenosMock = [
			{ numero_credito_sifco: "0101", asesor_id: 1, nombre: "Erik" },
		];
		poolFalla = true;
		await expect(usuarioDuenoEnCarteraEstricto("0101")).rejects.toMatchObject({
			code: "SERVICE_UNAVAILABLE",
		});
	});

	it("con la integración apagada lanza: no hay forma de saber de quién es", async () => {
		integracionActiva = false;
		await expect(usuarioDuenoEnCarteraEstricto("0101")).rejects.toMatchObject({
			code: "SERVICE_UNAVAILABLE",
		});
	});

	it("la versión para avisos, en cambio, sí se traga la falla (best-effort)", async () => {
		asesorPorSifcoFalla = true;
		expect(await usuarioDuenoEnCartera("0101")).toBeNull();
	});
});
