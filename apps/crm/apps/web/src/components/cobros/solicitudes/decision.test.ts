import { describe, expect, test } from "bun:test";
import { estadoContrapropuesta } from "./contrapropuesta-dialog";
import { salidaDeError } from "./decidir-solicitud-modal";

describe("salidaDeError", () => {
	test("la mora ya no alcanza: ofrece rechazar", () => {
		expect(
			salidaDeError("rebaja", "aprobar", {
				code: "CONFLICT",
				message:
					"La mora ahora es Q 420.00 y la rebaja pedida es Q 600.00. Rechácela para que el asesor pida una nueva.",
			}).tipo,
		).toBe("ofrecer_rechazo");
	});

	test("cartera la rechazó: queda resuelta como rechazada", () => {
		expect(
			salidaDeError("juridico", "aprobar", {
				code: "CONFLICT",
				message: "El escalado no se aplicó y quedó rechazado: sin pool en B5",
			}),
		).toMatchObject({ tipo: "decidida", decision: "rechazada" });
	});

	test("ya estaba aplicada al rechazar: queda resuelta como aprobada", () => {
		expect(
			salidaDeError("rebaja", "rechazar", {
				code: "CONFLICT",
				message:
					"Cartera ya había aplicado esta rebaja: la solicitud quedó como aplicada y no se puede rechazar.",
			}),
		).toMatchObject({ tipo: "decidida", decision: "aprobada" });
	});

	test("lo demás se muestra como error", () => {
		expect(
			salidaDeError("rebaja", "aprobar", {
				code: "SERVICE_UNAVAILABLE",
				message: "Cartera no respondió",
			}),
		).toEqual({ tipo: "error", mensaje: "Cartera no respondió" });
	});
});

describe("estadoContrapropuesta", () => {
	test("descartada por un supervisor es retirada", () => {
		expect(estadoContrapropuesta("descartada", true)).toBe("retirada");
		expect(estadoContrapropuesta("descartada", false)).toBe("descartada");
		expect(estadoContrapropuesta("aceptada", false)).toBe("aceptada");
		expect(estadoContrapropuesta("raro", false)).toBe("sin_efecto");
	});
});
