import { describe, expect, test } from "bun:test";
import type { ResultadoSesion } from "./menu-credito";
import {
	type DependenciasResolucion,
	resolverClienteModoAgente,
	VIGENCIA_MODO_AGENTE_MINUTOS,
} from "./modo-agente";

/**
 * Servicio 10 · quién pidió el agente. Lo que cuidan estas pruebas: que la
 * referencia mande cuando sirve, que el teléfono rescate al cliente que nunca
 * se identificó (o cuya referencia venció), y que un `numeroSifco` ajeno no
 * pase.
 */

const REFERENCIA = "aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000";

function sesionOk(creditos: string[]): ResultadoSesion {
	return {
		ok: true,
		otp: {
			id: REFERENCIA,
			leadId: "lead-1",
			coDebtorId: null,
			dpi: "1234567890101",
			usedAt: new Date(),
		} as never,
		creditos: creditos.map((numeroSifco) => ({
			numeroSifco,
			etiqueta: numeroSifco,
			vehiculo: null,
		})),
	};
}

function deps(opciones: { sesion?: ResultadoSesion; porTelefono?: string[] }) {
	const llamadas = { sesion: [] as number[], telefono: [] as string[] };
	const d: DependenciasResolucion = {
		verificarSesion: async (_ref, minutos) => {
			llamadas.sesion.push(minutos);
			return opciones.sesion ?? { ok: false, codigo: "REFERENCIA_INVALIDA" };
		},
		buscarPorTelefono: async (tel) => {
			llamadas.telefono.push(tel);
			return {
				creditos: opciones.porTelefono ?? [],
				identidad:
					(opciones.porTelefono ?? []).length > 0
						? { leadId: "lead-tel", coDebtorId: null, dpi: null }
						: null,
			};
		},
	};
	return { d, llamadas };
}

describe("resolverClienteModoAgente", () => {
	test("sin referencia ni teléfono válido: 400", async () => {
		const { d } = deps({});
		expect(
			await resolverClienteModoAgente(
				{ referencia: "", telefono: "123", numeroSifco: "" },
				d,
			),
		).toEqual({ estado: "error", codigo: "PARAMETROS_INVALIDOS" });
	});

	test("referencia válida manda, con la ventana de 24 h y todos sus créditos", async () => {
		const { d, llamadas } = deps({ sesion: sesionOk(["A1", "A2"]) });
		const r = await resolverClienteModoAgente(
			{ referencia: REFERENCIA, telefono: "50258446376", numeroSifco: "" },
			d,
		);

		expect(r).toMatchObject({
			estado: "identificado",
			origen: { tipo: "referencia", sesionId: REFERENCIA },
			creditos: ["A1", "A2"],
		});
		expect(llamadas.sesion).toEqual([VIGENCIA_MODO_AGENTE_MINUTOS]);
		// Con referencia buena, el teléfono ni se consulta.
		expect(llamadas.telefono).toEqual([]);
	});

	test("el cliente que solo dijo 'hola': se lo encuentra por su teléfono", async () => {
		const { d } = deps({ porTelefono: ["B1"] });
		const r = await resolverClienteModoAgente(
			{ referencia: "", telefono: "5025 8446376", numeroSifco: "" },
			d,
		);

		expect(r).toMatchObject({
			estado: "identificado",
			origen: { tipo: "telefono", telefono8: "58446376" },
			creditos: ["B1"],
			identidad: { leadId: "lead-tel" },
		});
	});

	test("referencia vencida con teléfono: cae al teléfono en vez de rechazar", async () => {
		const { d } = deps({
			sesion: { ok: false, codigo: "SESION_VENCIDA" },
			porTelefono: ["B1"],
		});
		const r = await resolverClienteModoAgente(
			{ referencia: REFERENCIA, telefono: "58446376", numeroSifco: "" },
			d,
		);

		expect(r).toMatchObject({
			estado: "identificado",
			origen: { tipo: "telefono" },
		});
	});

	test("referencia vencida SIN teléfono: el 401 de siempre", async () => {
		const { d } = deps({ sesion: { ok: false, codigo: "SESION_VENCIDA" } });
		expect(
			await resolverClienteModoAgente(
				{ referencia: REFERENCIA, telefono: "", numeroSifco: "" },
				d,
			),
		).toEqual({ estado: "error", codigo: "SESION_VENCIDA" });
	});

	test("con numeroSifco se acota a ese crédito", async () => {
		const { d } = deps({ sesion: sesionOk(["A1", "A2"]) });
		const r = await resolverClienteModoAgente(
			{ referencia: REFERENCIA, telefono: "", numeroSifco: "A2" },
			d,
		);
		expect(r).toMatchObject({ estado: "identificado", creditos: ["A2"] });
	});

	test("un numeroSifco que no es de esa persona no pasa, venga por donde venga", async () => {
		const porRef = deps({ sesion: sesionOk(["A1"]) });
		expect(
			await resolverClienteModoAgente(
				{ referencia: REFERENCIA, telefono: "", numeroSifco: "OTRO" },
				porRef.d,
			),
		).toEqual({ estado: "error", codigo: "CREDITO_NO_ES_DEL_CLIENTE" });

		const porTel = deps({ porTelefono: ["B1"] });
		expect(
			await resolverClienteModoAgente(
				{ referencia: "", telefono: "58446376", numeroSifco: "OTRO" },
				porTel.d,
			),
		).toEqual({ estado: "error", codigo: "CREDITO_NO_ES_DEL_CLIENTE" });
	});

	test("un número que no es de ningún cliente con crédito: no identificado", async () => {
		const { d } = deps({ porTelefono: [] });
		expect(
			await resolverClienteModoAgente(
				{ referencia: "", telefono: "58446376", numeroSifco: "" },
				d,
			),
		).toEqual({ estado: "no_identificado" });
	});
});
