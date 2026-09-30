import { describe, expect, test } from "bun:test";
import {
	CORREOS_POLIZAS_GYT,
	CORREOS_POLIZAS_UNIVERSALES,
	destinatariosDe,
	puedeReenviarFacturaSeguro,
	puedeSubirFacturaSeguro,
	resolverAseguradora,
} from "./factura-seguro";
import type { MembresiaSocio } from "./partner-scope";

const vendedor: MembresiaSocio[] = [{ companyId: "agencia-1", sellerId: "v1" }];
const gerente: MembresiaSocio[] = [{ companyId: "agencia-1", sellerId: null }];

function caso(parcial: Partial<Parameters<typeof puedeSubirFacturaSeguro>[0]>) {
	return puedeSubirFacturaSeguro({
		closurePercentage: 90,
		status: "open",
		companyId: "agencia-1",
		sellerId: "v1",
		membresias: vendedor,
		yaSubida: false,
		...parcial,
	});
}

describe("puedeSubirFacturaSeguro", () => {
	test("el vendedor asignado puede subirla al 90%", () => {
		expect(caso({})).toEqual({ ok: true });
		expect(caso({ status: "on_hold" })).toEqual({ ok: true });
	});

	test("al 90% ya ganada (el flujo normal: confirmar contratos la cierra y la mueve a 90%)", () => {
		expect(caso({ status: "won" })).toEqual({ ok: true });
	});

	test("solo en formalización final: ni antes del 90% ni ya desembolsado", () => {
		expect(caso({ closurePercentage: 85 })).toEqual({
			ok: false,
			motivo: "etapa",
		});
		expect(caso({ closurePercentage: 100 })).toEqual({
			ok: false,
			motivo: "etapa",
		});
	});

	test("un crédito perdido ya no la admite", () => {
		expect(caso({ status: "lost" })).toEqual({ ok: false, motivo: "estado" });
	});

	test("el gerente, otro vendedor o un caso sin vendedor no pueden", () => {
		expect(caso({ membresias: gerente })).toEqual({
			ok: false,
			motivo: "no_es_el_vendedor",
		});
		expect(caso({ sellerId: "v2" })).toEqual({
			ok: false,
			motivo: "no_es_el_vendedor",
		});
		expect(caso({ sellerId: null })).toEqual({
			ok: false,
			motivo: "no_es_el_vendedor",
		});
		expect(
			caso({ membresias: [{ companyId: "agencia-2", sellerId: "v1" }] }),
		).toEqual({ ok: false, motivo: "no_es_el_vendedor" });
	});

	test("una sola factura por crédito", () => {
		expect(caso({ yaSubida: true })).toEqual({
			ok: false,
			motivo: "ya_subida",
		});
	});
});

describe("resolverAseguradora", () => {
	test("manda la cotización; la oportunidad es respaldo; por defecto Universales", () => {
		expect(resolverAseguradora("gyt", "universales")).toBe("gyt");
		expect(resolverAseguradora(null, "gyt")).toBe("gyt");
		expect(resolverAseguradora("universales", "gyt")).toBe("universales");
		expect(resolverAseguradora(null, null)).toBe("universales");
		expect(resolverAseguradora(" GyT ", null)).toBe("gyt");
	});
});

describe("destinatariosDe", () => {
	test("usa la lista de la aseguradora, limpia y sin duplicados", () => {
		const correos = {
			gyt: [" a@gyt.com", "B@gyt.com ", "a@gyt.com", "no-es-correo", ""],
			universales: [],
		};
		expect(destinatariosDe("gyt", correos)).toEqual(["a@gyt.com", "b@gyt.com"]);
		expect(destinatariosDe("universales", correos)).toEqual([]);
	});

	test("por defecto, las listas fijas de pólizas de cada aseguradora", () => {
		expect(destinatariosDe("gyt")).toEqual([...CORREOS_POLIZAS_GYT]);
		expect(destinatariosDe("universales")).toEqual([
			...CORREOS_POLIZAS_UNIVERSALES,
		]);
		expect(destinatariosDe("gyt").length).toBeGreaterThan(0);
		expect(destinatariosDe("universales").length).toBeGreaterThan(0);
	});
});

describe("puedeReenviarFacturaSeguro", () => {
	const reenvio = (envio: string | null, membresias = vendedor) =>
		puedeReenviarFacturaSeguro({
			envio,
			companyId: "agencia-1",
			sellerId: "v1",
			membresias,
		});

	test("solo si el primer envío no salió", () => {
		expect(reenvio("fallido")).toEqual({ ok: true });
		expect(reenvio("sin_destinatario")).toEqual({ ok: true });
		expect(reenvio("enviado")).toEqual({ ok: false, motivo: "ya_enviada" });
		expect(reenvio("pendiente")).toEqual({ ok: false, motivo: "en_curso" });
		expect(reenvio(null)).toEqual({ ok: false, motivo: "sin_factura" });
	});

	test("un pendiente abandonado (más de 10 minutos) se puede reenviar", () => {
		const ahora = new Date("2026-09-29T12:00:00Z");
		const base = {
			envio: "pendiente",
			ahora,
			companyId: "agencia-1",
			sellerId: "v1",
			membresias: vendedor,
		};
		expect(
			puedeReenviarFacturaSeguro({
				...base,
				envioActualizadoAt: new Date("2026-09-29T11:55:00Z"),
			}),
		).toEqual({ ok: false, motivo: "en_curso" });
		expect(
			puedeReenviarFacturaSeguro({
				...base,
				envioActualizadoAt: new Date("2026-09-29T11:40:00Z"),
			}),
		).toEqual({ ok: true });
	});

	test("solo el vendedor asignado", () => {
		expect(reenvio("fallido", gerente)).toEqual({
			ok: false,
			motivo: "no_es_el_vendedor",
		});
	});
});
