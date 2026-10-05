import { describe, expect, test } from "bun:test";
import {
	CORREOS_POLIZAS_GYT,
	CORREOS_POLIZAS_UNIVERSALES,
	destinatariosDe,
	envioSinConfirmar,
	nombreDeFactura,
	tipoRealDeFactura,
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

describe("envioSinConfirmar", () => {
	const ahora = new Date("2026-09-30T12:00:00Z");
	const hace = (minutos: number) =>
		new Date(ahora.getTime() - minutos * 60_000);

	test("pendiente pasado el plazo: sin confirmar", () => {
		expect(
			envioSinConfirmar({
				envio: "pendiente",
				envioActualizadoAt: hace(11),
				ahora,
			}),
		).toBe(true);
	});

	test("pendiente reciente, otro estado o sin fecha: no", () => {
		expect(
			envioSinConfirmar({
				envio: "pendiente",
				envioActualizadoAt: hace(5),
				ahora,
			}),
		).toBe(false);
		for (const envio of ["enviado", "fallido", "sin_destinatario", null]) {
			expect(
				envioSinConfirmar({ envio, envioActualizadoAt: hace(60), ahora }),
			).toBe(false);
		}
		expect(envioSinConfirmar({ envio: "pendiente", ahora })).toBe(false);
	});
});

describe("puedeReenviarFacturaSeguro", () => {
	const reenvio = (envio: string | null, retryCount = 0) =>
		puedeReenviarFacturaSeguro({
			envio,
			retryCount,
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
			retryCount: 0,
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

	test("solo hay un reintento por factura", () => {
		expect(reenvio("fallido", 1)).toEqual({
			ok: false,
			motivo: "sin_reintentos",
		});
		expect(reenvio("sin_destinatario", 1)).toEqual({
			ok: false,
			motivo: "sin_reintentos",
		});
	});
});

describe("tipoRealDeFactura", () => {
	const bytes = (...inicio: number[]) => {
		const b = new Uint8Array(64);
		b.set(inicio);
		return b;
	};
	const texto = (t: string) => new TextEncoder().encode(t);

	test("reconoce PDF, JPEG, PNG y WebP por su firma", () => {
		expect(tipoRealDeFactura(texto("%PDF-1.7\n..."))).toBe("application/pdf");
		expect(tipoRealDeFactura(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
		expect(
			tipoRealDeFactura(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
		).toBe("image/png");
		expect(
			tipoRealDeFactura(texto("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ")),
		).toBe("image/webp");
	});

	test("un PDF con basura antes del encabezado (lo admite el estándar)", () => {
		expect(tipoRealDeFactura(texto("\r\n  %PDF-1.4"))).toBe("application/pdf");
	});

	test("rechaza ejecutables, documentos de Office, vacíos o sin firma", () => {
		expect(tipoRealDeFactura(bytes(0x4d, 0x5a, 0x90))).toBeNull();
		expect(tipoRealDeFactura(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull();
		expect(tipoRealDeFactura(new Uint8Array(0))).toBeNull();
		expect(tipoRealDeFactura(new Uint8Array(64))).toBeNull();
		expect(
			tipoRealDeFactura(texto("RIFF\u0000\u0000\u0000\u0000WAVE")),
		).toBeNull();
	});
});

describe("nombreDeFactura", () => {
	test("pone la extensión del tipo real", () => {
		expect(nombreDeFactura("factura.exe", "application/pdf")).toBe(
			"factura.pdf",
		);
		expect(nombreDeFactura("Factura QA.PDF", "application/pdf")).toBe(
			"Factura QA.pdf",
		);
		expect(nombreDeFactura("foto.jpeg", "image/jpeg")).toBe("foto.jpg");
		expect(nombreDeFactura("sin-extension", "image/png")).toBe(
			"sin-extension.png",
		);
	});

	test("quita rutas y caracteres raros; sin nombre usable queda 'factura'", () => {
		expect(nombreDeFactura("C:\\fakepath\\póliza.pdf", "application/pdf")).toBe(
			"póliza.pdf",
		);
		expect(nombreDeFactura("../../x<>|.pdf", "application/pdf")).toBe("x.pdf");
		expect(nombreDeFactura("<>.pdf", "application/pdf")).toBe("factura.pdf");
	});
});
