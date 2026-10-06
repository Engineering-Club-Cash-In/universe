import { describe, expect, test } from "bun:test";
import {
	type BienvenidaCreditoDeps,
	enviarMensajesDeCreditoNuevo,
} from "./bienvenida-credito";

const params = {
	opportunityId: "op-1",
	userId: "u-1",
	numeroSifco: "01010214100000",
};

function deps(over: Partial<BienvenidaCreditoDeps> = {}) {
	const orden: string[] = [];
	const bienvenidas: unknown[] = [];
	const d: BienvenidaCreditoDeps = {
		carteraHabilitada: () => true,
		dpiDelCliente: async () => "1234567890123",
		solicitarCuentaNexa: async () => {
			orden.push("cuenta");
			return {
				estado: "lista",
				creditoId: 55,
				cuenta: {
					token: "32200100000002",
					identifier: "100000002",
					nexaUserId: 99,
				},
				nueva: true,
				notificada: false,
			};
		},
		marcarCuentaNexaNotificada: async () => {
			orden.push("marcar");
		},
		enviarBienvenida: async (p) => {
			orden.push("bienvenida");
			bienvenidas.push(p);
			return { sent: true };
		},
		enviarCobertura: async () => {
			orden.push("cobertura");
			return { sent: false, skipped: true, reason: "deshabilitado" };
		},
		...over,
	};
	return { d, orden, bienvenidas };
}

describe("enviarMensajesDeCreditoNuevo", () => {
	test("pide la cuenta, la mete en la bienvenida, la marca avisada y después el seguro", async () => {
		const { d, orden, bienvenidas } = deps();
		const r = await enviarMensajesDeCreditoNuevo(params, d);
		expect(r).toEqual({
			cuentaNexa: "32200100000002",
			bienvenidaEnviada: true,
		});
		expect(orden).toEqual(["cuenta", "bienvenida", "marcar", "cobertura"]);
		expect(bienvenidas).toEqual([{ ...params, cuentaNexa: "32200100000002" }]);
	});

	test("si la cuenta queda pendiente la bienvenida sale sin ella y no se marca", async () => {
		const { d, orden, bienvenidas } = deps({
			solicitarCuentaNexa: async () => ({
				estado: "pendiente",
				creditoId: 55,
				error: "timeout",
			}),
		});
		await enviarMensajesDeCreditoNuevo(params, d);
		expect(orden).toEqual(["bienvenida", "cobertura"]);
		expect(bienvenidas).toEqual([{ ...params, cuentaNexa: null }]);
	});

	test("si cartera lanza, igual sale la bienvenida", async () => {
		const { d, orden } = deps({
			solicitarCuentaNexa: async () => {
				throw new Error("cartera caída");
			},
		});
		const r = await enviarMensajesDeCreditoNuevo(params, d);
		expect(r.bienvenidaEnviada).toBe(true);
		expect(orden).toEqual(["bienvenida", "cobertura"]);
	});

	test("si la bienvenida no sale, la cuenta no se marca (cartera la manda aparte)", async () => {
		const { d, orden } = deps({
			enviarBienvenida: async () => ({ sent: false, error: "x" }),
		});
		await enviarMensajesDeCreditoNuevo(params, d);
		expect(orden).not.toContain("marcar");
	});

	test("con cartera apagada no pide cuenta", async () => {
		const { d, orden } = deps({ carteraHabilitada: () => false });
		await enviarMensajesDeCreditoNuevo(params, d);
		expect(orden).toEqual(["bienvenida", "cobertura"]);
	});
});
