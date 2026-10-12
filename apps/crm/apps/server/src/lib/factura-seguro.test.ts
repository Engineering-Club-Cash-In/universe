import { describe, expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import {
	CORREOS_POLIZAS_GYT,
	CORREOS_POLIZAS_INTERNOS,
	CORREOS_POLIZAS_UNIVERSALES,
	destinatariosDe,
	envioSinConfirmar,
	nombreDeFactura,
	puedeEnviarFacturaDesdeCrm,
	puedeReenviarFacturaSeguro,
	puedeReintentarDesdeCrm,
	puedeSubirFacturaSeguro,
	reintentoDisponibleDesde,
	resolverAseguradora,
	tipoPermitidoDesdeCrm,
	tipoRealDeFactura,
} from "./factura-seguro";
import type { MembresiaSocio } from "./partner-scope";

const vendedor: MembresiaSocio[] = [{ companyId: "agencia-1", sellerId: "v1" }];
const gerente: MembresiaSocio[] = [{ companyId: "agencia-1", sellerId: null }];

function caso(parcial: Partial<Parameters<typeof puedeSubirFacturaSeguro>[0]>) {
	return puedeSubirFacturaSeguro({
		closurePercentage: 90,
		status: "won",
		companyId: "agencia-1",
		sellerId: "v1",
		membresias: vendedor,
		yaSubida: false,
		...parcial,
	});
}

describe("puedeSubirFacturaSeguro", () => {
	test("el vendedor asignado puede subirla al 90% ya ganada (el flujo normal)", () => {
		expect(caso({})).toEqual({ ok: true });
	});

	test("al 90% sin cerrar (abierta o en pausa) todavía no", () => {
		expect(caso({ status: "open" })).toEqual({
			ok: false,
			motivo: "sin_cerrar",
		});
		expect(caso({ status: "on_hold" })).toEqual({
			ok: false,
			motivo: "sin_cerrar",
		});
	});

	test("desde formalización final (90%) en adelante, también ya desembolsada", () => {
		expect(caso({ closurePercentage: 85 })).toEqual({
			ok: false,
			motivo: "etapa",
		});
		expect(caso({ closurePercentage: 100 })).toEqual({ ok: true });
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
	test("la aseguradora y los internos, limpios y sin duplicados", () => {
		const correos = {
			gyt: [" a@gyt.com", "B@gyt.com ", "a@gyt.com", "no-es-correo", ""],
			universales: ["u@universales.com"],
		};
		const internos = ["i@cci.com", "A@gyt.com", " x "];
		expect(destinatariosDe("gyt", correos, internos)).toEqual([
			"a@gyt.com",
			"b@gyt.com",
			"i@cci.com",
		]);
		expect(destinatariosDe("universales", correos, internos)).toEqual([
			"u@universales.com",
			"i@cci.com",
			"a@gyt.com",
		]);
	});

	test("sin correos de la aseguradora no se manda solo a los internos", () => {
		const correos = { gyt: ["no-es-correo"], universales: [] };
		expect(destinatariosDe("gyt", correos, ["i@cci.com"])).toEqual([]);
		expect(destinatariosDe("universales", correos, ["i@cci.com"])).toEqual([]);
	});

	test("las listas fijas de pólizas más el equipo interno", () => {
		// Explícitas: si otro test mockea el módulo en el mismo proceso, las
		// listas por defecto podrían no ser las reales.
		const fijas = {
			gyt: CORREOS_POLIZAS_GYT,
			universales: CORREOS_POLIZAS_UNIVERSALES,
		};
		expect(destinatariosDe("gyt", fijas, CORREOS_POLIZAS_INTERNOS)).toEqual([
			...CORREOS_POLIZAS_GYT,
			...CORREOS_POLIZAS_INTERNOS,
		]);
		expect(
			destinatariosDe("universales", fijas, CORREOS_POLIZAS_INTERNOS),
		).toEqual([...CORREOS_POLIZAS_UNIVERSALES, ...CORREOS_POLIZAS_INTERNOS]);
		expect(CORREOS_POLIZAS_INTERNOS).toHaveLength(10);
	});
});

describe("reintentoDisponibleDesde", () => {
	const ahora = new Date("2026-09-30T12:00:00Z");
	const hace5 = new Date("2026-09-30T11:55:00Z");
	test("un pendiente en plazo pasa a reintentable a los 10 minutos", () => {
		expect(
			reintentoDisponibleDesde({
				envio: "pendiente",
				envioActualizadoAt: hace5,
				retryCount: 0,
				ahora,
			}),
		).toEqual(new Date("2026-09-30T12:05:00Z"));
	});

	test("nunca, si ya se reintentó, venció el plazo o no está pendiente", () => {
		const base = { envioActualizadoAt: hace5, ahora };
		expect(
			reintentoDisponibleDesde({ ...base, envio: "pendiente", retryCount: 1 }),
		).toBeNull();
		expect(
			reintentoDisponibleDesde({
				envio: "pendiente",
				envioActualizadoAt: new Date("2026-09-30T11:00:00Z"),
				retryCount: 0,
				ahora,
			}),
		).toBeNull();
		expect(
			reintentoDisponibleDesde({ ...base, envio: "fallido", retryCount: 0 }),
		).toBeNull();
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

describe("puedeEnviarFacturaDesdeCrm", () => {
	const caso = (
		parcial: Partial<Parameters<typeof puedeEnviarFacturaDesdeCrm>[0]>,
	) =>
		puedeEnviarFacturaDesdeCrm({
			closurePercentage: 90,
			status: "won",
			companyId: "agencia-1",
			yaSubida: false,
			...parcial,
		});

	test("al 90% ganada y de una agencia: se envía; sin cerrar, todavía no", () => {
		expect(caso({})).toEqual({ ok: true });
		for (const status of ["open", "on_hold"]) {
			expect(caso({ status })).toEqual({ ok: false, motivo: "sin_cerrar" });
		}
	});

	test("sin agencia, fuera de etapa, perdida o con factura ya registrada: no", () => {
		expect(caso({ companyId: null })).toEqual({
			ok: false,
			motivo: "sin_agencia",
		});
		expect(caso({ closurePercentage: 85 })).toEqual({
			ok: false,
			motivo: "etapa",
		});
		expect(caso({ closurePercentage: 100 })).toEqual({ ok: true });
		expect(caso({ status: "lost" })).toEqual({ ok: false, motivo: "estado" });
		expect(caso({ yaSubida: true })).toEqual({
			ok: false,
			motivo: "ya_subida",
		});
	});
});

describe("puedeReintentarDesdeCrm", () => {
	const usuario = (userRole: string | null) => ({ userId: "u1", userRole });

	test("los mismos roles que suben documentos en el CRM", () => {
		for (const rol of ["admin", "sales_supervisor", "analyst"]) {
			expect(puedeReintentarDesdeCrm(usuario(rol), "otro")).toBe(true);
		}
	});

	test("un asesor comercial, solo en sus oportunidades", () => {
		expect(puedeReintentarDesdeCrm(usuario("sales"), "u1")).toBe(true);
		expect(puedeReintentarDesdeCrm(usuario("sales"), "otro")).toBe(false);
		expect(puedeReintentarDesdeCrm(usuario("sales"), null)).toBe(false);
	});

	test("cobros, contabilidad, jurídico y los demás roles no", () => {
		for (const rol of [
			"cobros",
			"cobros_supervisor",
			"juridico",
			"accounting",
			"vehicle_verifier",
			"partner",
			null,
		]) {
			expect(puedeReintentarDesdeCrm(usuario(rol), "u1")).toBe(false);
		}
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

	const conCierre = (inicio: Uint8Array, cierre: number[]) => {
		const b = new Uint8Array(64);
		b.set(inicio);
		b.set(cierre, 64 - cierre.length);
		return b;
	};
	const webp = () => {
		const b = Buffer.alloc(32);
		b.write("RIFF", 0, "latin1");
		b.writeUInt32LE(24, 4);
		b.write("WEBPVP8 ", 8, "latin1");
		return new Uint8Array(b);
	};

	test("reconoce PDF, JPEG, PNG y WebP por su firma y su cierre", () => {
		expect(tipoRealDeFactura(texto("%PDF-1.7\n...\n%%EOF\n"))).toBe(
			"application/pdf",
		);
		expect(
			tipoRealDeFactura(conCierre(bytes(0xff, 0xd8, 0xff, 0xe0), [0xff, 0xd9])),
		).toBe("image/jpeg");
		expect(
			tipoRealDeFactura(
				conCierre(
					bytes(
						0x89,
						0x50,
						0x4e,
						0x47,
						0x0d,
						0x0a,
						0x1a,
						0x0a,
						0,
						0,
						0,
						13,
						0x49,
						0x48,
						0x44,
						0x52,
					),
					[0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82],
				),
			),
		).toBe("image/png");
		expect(tipoRealDeFactura(webp())).toBe("image/webp");
	});

	test("un PDF con basura antes del encabezado (lo admite el estándar)", () => {
		expect(tipoRealDeFactura(texto("\r\n  %PDF-1.4\n%%EOF"))).toBe(
			"application/pdf",
		);
	});

	test("un archivo truncado que solo trae la firma no pasa", () => {
		expect(tipoRealDeFactura(texto("%PDF-1.4"))).toBeNull();
		expect(tipoRealDeFactura(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
		expect(
			tipoRealDeFactura(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
		).toBeNull();
		expect(
			tipoRealDeFactura(texto("RIFF\u00ff\u0000\u0000\u0000WEBPVP8 ")),
		).toBeNull();
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

// ZIP mínimo pero bien formado (sin comprimir), con su directorio central.
// Cada entrada lleva el contenido dado (vacío si no se pasa).
function zipConEntradas(
	entradas: Array<string | [string, string] | [string, string, boolean]>,
): Uint8Array {
	const locales: Buffer[] = [];
	const centrales: Buffer[] = [];
	let desplazamiento = 0;
	for (const entrada of entradas) {
		const [nombre, contenido, comprimir] =
			typeof entrada === "string" ? [entrada, "", false] : entrada;
		const n = Buffer.from(nombre);
		const d = comprimir
			? deflateRawSync(Buffer.from(contenido))
			: Buffer.from(contenido);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		if (comprimir) local.writeUInt16LE(8, 8);
		local.writeUInt32LE(d.length, 18);
		local.writeUInt32LE(d.length, 22);
		local.writeUInt16LE(n.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		if (comprimir) central.writeUInt16LE(8, 10);
		central.writeUInt32LE(d.length, 20);
		central.writeUInt32LE(d.length, 24);
		central.writeUInt16LE(n.length, 28);
		central.writeUInt32LE(desplazamiento, 42);
		locales.push(local, n, d);
		centrales.push(central, n);
		desplazamiento += 30 + n.length + d.length;
	}
	const directorio = Buffer.concat(centrales);
	const fin = Buffer.alloc(22);
	fin.writeUInt32LE(0x06054b50, 0);
	fin.writeUInt16LE(entradas.length, 8);
	fin.writeUInt16LE(entradas.length, 10);
	fin.writeUInt32LE(directorio.length, 12);
	fin.writeUInt32LE(desplazamiento, 16);
	return new Uint8Array(Buffer.concat([...locales, directorio, fin]));
}

// Archivo OLE mínimo pero bien formado (.doc/.xls viejos): encabezado, un
// sector de FAT y uno de directorio con estos streams.
function oleConStreams(streams: string[], tipoStream = 2): Uint8Array {
	const encabezado = Buffer.alloc(512, 0);
	Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(
		encabezado,
	);
	encabezado.writeUInt16LE(9, 0x1e); // sectores de 512 bytes
	encabezado.writeUInt32LE(1, 0x2c); // un sector de FAT
	encabezado.writeUInt32LE(1, 0x30); // el directorio empieza en el sector 1
	for (let i = 0; i < 109; i++)
		encabezado.writeUInt32LE(0xffffffff, 0x4c + i * 4);
	encabezado.writeUInt32LE(0, 0x4c); // la FAT está en el sector 0
	const fat = Buffer.alloc(512, 0xff);
	fat.writeUInt32LE(0xfffffffd, 0); // sector 0: la propia FAT
	fat.writeUInt32LE(0xfffffffe, 4); // sector 1: fin de la cadena del directorio
	const directorio = Buffer.alloc(512, 0);
	["Root Entry", ...streams].slice(0, 4).forEach((nombre, i) => {
		const n = Buffer.from(`${nombre}\0`, "utf16le");
		n.copy(directorio, i * 128);
		directorio.writeUInt16LE(n.length, i * 128 + 0x40);
		directorio[i * 128 + 0x42] = i === 0 ? 5 : tipoStream; // raíz y streams
		directorio.writeUInt32LE(0, i * 128 + 0x74); // sector de inicio
		directorio.writeUInt32LE(4096, i * 128 + 0x78); // tamaño
	});
	return new Uint8Array(Buffer.concat([encabezado, fat, directorio]));
}

// AVIF mínimo pero completo: cajas ftyp, meta y mdat encadenadas hasta el final.
function avifCompleto(): Uint8Array {
	const caja = (tipo: string, contenido: Buffer) => {
		const encabezado = Buffer.alloc(8);
		encabezado.writeUInt32BE(8 + contenido.length, 0);
		encabezado.write(tipo, 4, "latin1");
		return Buffer.concat([encabezado, contenido]);
	};
	return new Uint8Array(
		Buffer.concat([
			caja("ftyp", Buffer.from("avif\u0000\u0000\u0000\u0000avif", "latin1")),
			caja("meta", Buffer.alloc(4)),
			caja("mdat", Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])),
		]),
	);
}

describe("tipoPermitidoDesdeCrm", () => {
	const DOCX =
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document";
	const MANIFIESTO_DOCX =
		'<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
	const zip = zipConEntradas([
		["[Content_Types].xml", MANIFIESTO_DOCX],
		["word/document.xml", "<w:document/>"],
	]);
	const ole = oleConStreams(["WordDocument"]);
	const avif = avifCompleto();
	const texto = (s: string) => new TextEncoder().encode(s);

	test("PDF, imagen y AVIF por su contenido", () => {
		expect(tipoPermitidoDesdeCrm(texto("%PDF-1.4\n%%EOF"), DOCX)).toBe(
			"application/pdf",
		);
		expect(tipoPermitidoDesdeCrm(avif, "image/avif")).toBe("image/avif");
		// Solo el comienzo del contenedor (truncado): no.
		expect(
			tipoPermitidoDesdeCrm(avif.subarray(0, 12), "image/avif"),
		).toBeNull();
	});

	test("Word y Excel solo si el contenido es de Office del tipo declarado", () => {
		expect(tipoPermitidoDesdeCrm(zip, DOCX)).toBe(DOCX);
		expect(tipoPermitidoDesdeCrm(ole, "application/msword")).toBe(
			"application/msword",
		);
		expect(tipoPermitidoDesdeCrm(zip, "application/msword")).toBeNull();
		// Un Excel declarado como Word, un ZIP sin manifiesto de Office, o bytes
		// que solo nombran las entradas sin ser un ZIP de verdad: no.
		expect(
			tipoPermitidoDesdeCrm(
				zipConEntradas([
					["[Content_Types].xml", MANIFIESTO_DOCX],
					["xl/workbook.xml", "<workbook/>"],
				]),
				DOCX,
			),
		).toBeNull();
		expect(
			tipoPermitidoDesdeCrm(zipConEntradas(["word/document.xml"]), DOCX),
		).toBeNull();
		// Comprimido también vale; una parte que se infla sin tope (ZIP bomb),
		// no.
		expect(
			tipoPermitidoDesdeCrm(
				zipConEntradas([
					["[Content_Types].xml", MANIFIESTO_DOCX, true],
					["word/document.xml", "<w:document/>", true],
				]),
				DOCX,
			),
		).toBe(DOCX);
		expect(
			tipoPermitidoDesdeCrm(
				zipConEntradas([
					[
						"[Content_Types].xml",
						MANIFIESTO_DOCX + " ".repeat(25 * 1024 * 1024),
						true,
					],
					["word/document.xml", "<w:document/>"],
				]),
				DOCX,
			),
		).toBeNull();
		// Con las entradas vacías (sin manifiesto ni documento de verdad): no.
		expect(
			tipoPermitidoDesdeCrm(
				zipConEntradas(["[Content_Types].xml", "word/document.xml"]),
				DOCX,
			),
		).toBeNull();
		const falso = new Uint8Array(
			Buffer.concat([
				Buffer.from([0x50, 0x4b, 0x03, 0x04]),
				Buffer.from("[Content_Types].xml word/document.xml"),
			]),
		);
		expect(tipoPermitidoDesdeCrm(falso, DOCX)).toBeNull();
	});

	test("Word y Excel viejos (OLE) solo con su stream principal", () => {
		expect(
			tipoPermitidoDesdeCrm(
				oleConStreams(["Workbook"]),
				"application/vnd.ms-excel",
			),
		).toBe("application/vnd.ms-excel");
		// Un Word declarado como Excel, o solo la firma de 8 bytes: no.
		expect(tipoPermitidoDesdeCrm(ole, "application/vnd.ms-excel")).toBeNull();
		expect(
			tipoPermitidoDesdeCrm(
				new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
				"application/msword",
			),
		).toBeNull();
		// Un nombre en el directorio que no es un stream de verdad: no.
		expect(
			tipoPermitidoDesdeCrm(
				oleConStreams(["WordDocument"], 0),
				"application/msword",
			),
		).toBeNull();
	});

	test("un HTML declarado como PDF o como Word no pasa", () => {
		const html = texto("<html><script>x</script></html>");
		expect(tipoPermitidoDesdeCrm(html, "application/pdf")).toBeNull();
		expect(tipoPermitidoDesdeCrm(html, DOCX)).toBeNull();
	});
});
