import { beforeEach, describe, expect, mock, test } from "bun:test";
import { call } from "@orpc/server";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { user } from "../db/schema/auth";
import {
	companies,
	opportunities,
	opportunityStageHistory,
} from "../db/schema/crm";
import { opportunityDocuments } from "../db/schema/documents";
import {
	insuranceInvoiceSubmissions,
	opportunityAgencySellers,
	partnerAccounts,
	partnerMembers,
} from "../db/schema/partners";
import {
	opportunityCloseQuotations,
	quotations,
} from "../db/schema/quotations";
import type { CorreosPorAseguradora } from "../lib/factura-seguro";
import { ROLES } from "../lib/roles";

const ID = "11111111-1111-4111-8111-111111111111";

let membresias: Array<{ companyId: string; sellerId: string | null }> = [];
let userRole: string = ROLES.PARTNER;
let caso: Record<string, unknown> = {};
let cotizacion: Array<Record<string, unknown>> = [];
let facturaPrevia: Array<Record<string, unknown>> = [];
// Lo que devuelve R2 para un archivo ya subido (la factura desde el CRM).
let contenidoR2: Buffer = Buffer.from("%PDF-1.4");
const topesLecturaR2: Array<number | undefined> = [];
// Otros documentos que usan la key original de una subida del CRM.
let documentosConKey: Array<{ id: string }> = [];
// Vendedor asignado leído dentro de la transacción (puede diferir del caso).
let vendedorVigente: string | null | undefined;
let fallaLecturaCotizacion = false;
// La oportunidad leída FOR UPDATE, si cambió desde la lectura inicial.
let casoBajoBloqueo: Record<string, unknown> | undefined;
// Lo que devuelve una relectura sin bloqueo después de la primera lectura.
let casoReleido: Record<string, unknown> | undefined;
let lecturasCaso = 0;
// Membresías que devuelve una relectura después de la de la sesión.
let membresiasVigentes: typeof membresias | undefined;
let lecturasMembresias = 0;
// Cotización que guardó el cierre, y el filtro con el que se buscó la cotización.
let cotizacionDelCierre: Array<{ quotationId: string }> = [];
let filtroCotizacion: unknown;
// Cuántos archivos había subidos a R2 cada vez que se bloquearon las cotizaciones.
const bloqueosCotizacion: Array<{ modo: string; subidosR2: number }> = [];
let resultadoCorreo:
	| { ok: true }
	| {
			ok: false;
			error: string;
			resultado: "rechazado" | "incierto" | "en_curso";
	  } = { ok: true };
const insertados: Array<{ tabla: unknown; valores: Record<string, unknown> }> =
	[];
const actualizados: Array<Record<string, unknown>> = [];
const condicionesActualizacion: unknown[] = [];
const correos: Array<Record<string, unknown>> = [];
const subidosR2: Array<{ key: string; mime: string }> = [];
const borradosR2: string[] = [];

function cadena<T>(
	obtenerFilas: (bajoBloqueo: boolean) => T[],
	alFiltrar?: (condicion: unknown) => void,
	alBloquear?: (modo: string) => void,
) {
	let bajoBloqueo = false;
	const nodo = {
		from: () => nodo,
		innerJoin: () => nodo,
		leftJoin: () => nodo,
		where: (condicion: unknown) => {
			alFiltrar?.(condicion);
			return nodo;
		},
		orderBy: () => nodo,
		limit: () => nodo,
		for: (modo: string) => {
			bajoBloqueo = true;
			alBloquear?.(modo);
			return nodo;
		},
		then: (resolve: (filas: T[]) => void) => resolve(obtenerFilas(bajoBloqueo)),
	};
	return nodo;
}

const dbFalsa = {
	select: () => ({
		from: (tabla: unknown) => {
			if (tabla === user)
				return cadena(() => [
					{
						id: "socio-1",
						email: "s@x.com",
						role: userRole,
						banned: false,
					},
				]);
			if (tabla === partnerMembers)
				return cadena(() => {
					lecturasMembresias++;
					return membresiasVigentes && lecturasMembresias > 1
						? membresiasVigentes
						: membresias;
				});
			if (tabla === partnerAccounts)
				return cadena(() => [{ passwordChangedAt: new Date("2026-01-01") }]);
			if (tabla === opportunities)
				return cadena((bajoBloqueo) => {
					lecturasCaso++;
					if (bajoBloqueo && casoBajoBloqueo) return [casoBajoBloqueo];
					if (!bajoBloqueo && casoReleido && lecturasCaso > 1)
						return [casoReleido];
					return [caso];
				});
			if (tabla === quotations)
				return cadena(
					() => {
						if (fallaLecturaCotizacion) throw new Error("BD no disponible");
						return cotizacion;
					},
					(condicion) => {
						filtroCotizacion = condicion;
					},
					(modo) =>
						bloqueosCotizacion.push({ modo, subidosR2: subidosR2.length }),
				);
			if (tabla === opportunityCloseQuotations)
				return cadena(() => cotizacionDelCierre);
			if (tabla === opportunityAgencySellers)
				return cadena(() => [
					{
						sellerId:
							vendedorVigente === undefined ? caso.sellerId : vendedorVigente,
					},
				]);
			if (tabla === insuranceInvoiceSubmissions)
				return cadena(() => facturaPrevia);
			if (tabla === opportunityDocuments) return cadena(() => documentosConKey);
			if (tabla === companies || tabla === opportunityStageHistory)
				return cadena(() => []);
			throw new Error("Tabla no mockeada en tracker.factura-seguro.test.ts");
		},
	}),
	selectDistinctOn: () => ({
		from: () => ({ orderBy: () => ({ as: () => ({}) }) }),
	}),
	insert: (tabla: unknown) => ({
		values: (valores: Record<string, unknown>) => ({
			returning: async () => {
				insertados.push({ tabla, valores });
				return [
					{
						id: `id-${insertados.length}`,
						intento: 1,
						createdAt: new Date("2026-09-29T20:00:00Z"),
					},
				];
			},
		}),
	}),
	update: () => ({
		set: (valores: Record<string, unknown>) => ({
			where: async (condicion: unknown) => {
				actualizados.push(valores);
				condicionesActualizacion.push(condicion);
			},
		}),
	}),
	transaction: async (fn: (tx: unknown) => unknown) => fn(dbFalsa),
};

mock.module("../db", () => ({ db: dbFalsa }));
mock.module("../lib/partner-auth", () => ({
	PARTNER_AUTH_BASE_PATH: "/api/partner-auth",
	PARTNER_CHANGE_PASSWORD_PATH: "/api/partner-auth/change-password",
	partnerAuth: { api: { changePassword: async () => ({}) } },
}));
// Se extiende el módulo real en vez de reemplazarlo: en una corrida de un solo
// proceso, `mock.module` es global y otros tests necesitan el resto de exports.
const storageReal = await import("../lib/storage");
mock.module("../lib/storage", () => ({
	...storageReal,
	MAX_FILE_SIZE: 10 * 1024 * 1024,
	buildUploadPrefix: (_: string, id: string) => `opportunities/${id}`,
	generateUniqueFilename: (nombre: string) => `123-abc-${nombre}`,
	validateResolvedMimeType: (f: { name: string; type?: string }) => {
		const mime =
			f.type ??
			(f.name.endsWith(".pdf") ? "application/pdf" : "application/msword");
		return { valid: true, mimeType: mime };
	},
	uploadBufferToR2: async (key: string, _buffer: Buffer, mime: string) => {
		subidosR2.push({ key, mime });
	},
	deleteFileFromR2: async (key: string) => {
		borradosR2.push(key);
	},
	getFileUrl: async (key: string) => `https://r2.test/${key}`,
	getFileBuffer: async (_key: string, limite?: number) => {
		topesLecturaR2.push(limite);
		return contenidoR2;
	},
}));
// Solo cambia la lista por defecto; con una lista explícita (los tests de
// lib/factura-seguro) se comporta como el módulo real.
const facturaReal = await import("../lib/factura-seguro");
// Se guarda antes de mockear: Bun reemplaza los exports del módulo ya cargado.
const destinatariosReal = facturaReal.destinatariosDe;
let correosPolizas: CorreosPorAseguradora = { gyt: [], universales: [] };
mock.module("../lib/factura-seguro", () => ({
	...facturaReal,
	destinatariosDe: (
		aseguradora: "gyt" | "universales",
		correos?: CorreosPorAseguradora,
	) => destinatariosReal(aseguradora, correos ?? correosPolizas, []),
}));
// La plantilla real sí corre; solo el envío se simula.
const correoReal = await import("../lib/correo-factura-seguro");
mock.module("../lib/correo-factura-seguro", () => ({
	...correoReal,
	enviarCorreoFacturaSeguro: async (params: Record<string, unknown>) => {
		correos.push(params);
		return resultadoCorreo;
	},
}));

const {
	trackerRouter,
	enviarFacturaSeguroDesdeCrm,
	previsualizarFacturaSeguroDesdeCrm,
} = await import("./tracker");

const ctx = {
	context: {
		partnerSession: { user: { id: "socio-1" }, session: { id: "sesion-1" } },
		headers: { get: () => null },
	},
} as never;

const crmCtx = {
	context: {
		session: { user: { id: "crm-1" }, session: { id: "sesion-crm" } },
	},
} as never;

function casoAl(porcentaje: number, extra: Record<string, unknown> = {}) {
	return {
		id: ID,
		status: "open",
		createdAt: new Date("2026-01-01"),
		updatedAt: new Date("2026-02-01"),
		closurePercentage: porcentaje,
		companyId: "agencia-1",
		agenciaNombre: "Agencia de prueba",
		sellerId: "v1",
		vendedorNombre: "Ana López",
		leadFirstName: "Juan",
		leadLastName: "Pérez",
		vehicleMake: "Toyota",
		vehicleModel: "Corolla",
		vehicleYear: 2020,
		facturaEnvio: null,
		facturaSubidaAt: null,
		insuranceProvider: "universales",
		vin: "VIN123",
		...extra,
	};
}

// Key que arma el mock de storage para "factura.pdf" en esta oportunidad.
const KEY = `opportunities/${ID}/123-abc-factura.pdf`;
// Con encabezado real: el server valida el contenido, no el tipo declarado.
const ENCABEZADO_PDF = new TextEncoder().encode("%PDF-1.4\n");
function conContenido(inicio: Uint8Array, bytes: number) {
	const contenido = new Uint8Array(bytes);
	contenido.set(inicio.subarray(0, bytes));
	return contenido;
}
const pdf = (nombre = "factura.pdf", tipo = "application/pdf", bytes = 2048) =>
	new File([conContenido(ENCABEZADO_PDF, bytes)], nombre, { type: tipo });

beforeEach(() => {
	userRole = ROLES.PARTNER;
	membresias = [{ companyId: "agencia-1", sellerId: "v1" }];
	caso = casoAl(90);
	cotizacion = [{ insuranceProvider: "gyt", insuredAmount: "300000" }];
	facturaPrevia = [];
	contenidoR2 = Buffer.from("%PDF-1.4");
	vendedorVigente = undefined;
	fallaLecturaCotizacion = false;
	casoBajoBloqueo = undefined;
	cotizacionDelCierre = [];
	filtroCotizacion = undefined;
	bloqueosCotizacion.length = 0;
	resultadoCorreo = { ok: true };
	insertados.length = 0;
	actualizados.length = 0;
	condicionesActualizacion.length = 0;
	topesLecturaR2.length = 0;
	documentosConKey = [];
	casoReleido = undefined;
	lecturasCaso = 0;
	membresiasVigentes = undefined;
	lecturasMembresias = 0;
	correos.length = 0;
	subidosR2.length = 0;
	borradosR2.length = 0;
	correosPolizas = {
		gyt: ["polizas@gyt.test"],
		universales: ["polizas@universales.test"],
	};
});

describe("facturaSeguro en el caso", () => {
	test("habilitada para el vendedor asignado al 90%", async () => {
		const [c] = await call(trackerRouter.getCasos, {}, ctx);
		expect(c.facturaSeguro).toEqual({
			habilitada: true,
			motivo: null,
			subidaAt: null,
			envio: null,
		});
	});

	test("habilitada al 90% con la oportunidad ya ganada (flujo normal)", async () => {
		caso = casoAl(90, { status: "won" });
		const [c] = await call(trackerRouter.getCasos, {}, ctx);
		expect(c.facturaSeguro.habilitada).toBe(true);
		expect(c.cerrado).toBe(true);
	});

	test("el gerente ve el caso pero no puede subir la factura", async () => {
		membresias = [{ companyId: "agencia-1", sellerId: null }];
		const [c] = await call(trackerRouter.getCasos, {}, ctx);
		expect(c.facturaSeguro.habilitada).toBe(false);
		expect(c.facturaSeguro.motivo).toContain("vendedor asignado");
	});
});

describe("subirFacturaSeguro", () => {
	const subir = (archivo = pdf()) =>
		call(trackerRouter.subirFacturaSeguro, { opportunityId: ID, archivo }, ctx);

	test("se sube con la oportunidad ganada al 90%, como llega en el flujo normal", async () => {
		caso = casoAl(90, {
			status: "won",
			actualCloseDate: new Date("2026-09-01"),
		});
		const r = await subir();
		expect(r.envio).toBe("enviado");
		expect(
			insertados.find((i) => i.tabla === insuranceInvoiceSubmissions)?.valores,
		).toMatchObject({ companyId: "agencia-1" });
	});

	test("ya ganada, la aseguradora es la que el cierre le mandó al crédito, no la de una cotización posterior", async () => {
		// El cierre estampó Universales; la cotización que devuelve la BD es G&T.
		caso = casoAl(90, {
			status: "won",
			actualCloseDate: new Date("2026-09-01"),
			insuranceProvider: "universales",
		});
		cotizacion = [{ insuranceProvider: "gyt", insuredAmount: "300000" }];
		const r = await subir();
		expect(r.aseguradora).toBe("universales");
		expect(
			insertados.find((i) => i.tabla === insuranceInvoiceSubmissions)?.valores,
		).toMatchObject({
			insuranceProvider: "universales",
			recipients: ["polizas@universales.test"],
		});
	});

	test("ya ganada, si el cierre guardó su cotización se usa exactamente esa", async () => {
		caso = casoAl(90, {
			status: "won",
			actualCloseDate: new Date("2026-09-01"),
		});
		cotizacionDelCierre = [{ quotationId: "cot-del-cierre" }];
		await subir();
		const { params } = new PgDialect().sqlToQuery(filtroCotizacion as SQL);
		expect(params).toContain("cot-del-cierre");
		// Con la del cierre no se reconstruye por fecha.
		expect(
			params.some((p) => p instanceof Date || /^\d{4}-/.test(String(p))),
		).toBe(false);
	});

	test("ya ganada sin cotización guardada (cierres anteriores): se reconstruye con la fecha del cierre", async () => {
		caso = casoAl(90, {
			status: "won",
			actualCloseDate: new Date("2026-09-01T00:00:00Z"),
		});
		await subir();
		const { params } = new PgDialect().sqlToQuery(filtroCotizacion as SQL);
		expect(params.map(String).some((p) => p.startsWith("2026-09-01"))).toBe(
			true,
		);
	});

	test("sin cerrar, la aseguradora sigue saliendo de la cotización", async () => {
		caso = casoAl(90, { insuranceProvider: "universales" });
		cotizacion = [{ insuranceProvider: "gyt", insuredAmount: "300000" }];
		const r = await subir();
		expect(r.aseguradora).toBe("gyt");
	});

	test("si falla la lectura de los datos del correo, se borra el archivo recién subido y no se registra nada", async () => {
		fallaLecturaCotizacion = true;
		await expect(subir()).rejects.toThrow();
		expect(borradosR2).toEqual([KEY]);
		expect(insertados).toHaveLength(0);
	});

	test("si al socio le quitaron la agencia mientras subía, no registra ni envía", async () => {
		membresiasVigentes = [];
		await expect(subir()).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(insertados).toHaveLength(0);
		expect(correos).toHaveLength(0);
		expect(borradosR2).toEqual([KEY]);
	});

	test("los datos del correo se leen después de subir, con las cotizaciones FOR SHARE", async () => {
		await subir();
		expect(bloqueosCotizacion).toEqual([{ modo: "share", subidosR2: 1 }]);
	});

	test("sube a R2 desde el server, guarda el documento seguro_vehiculo y envía a la aseguradora (carro usado incluido)", async () => {
		const r = await subir();

		expect(r).toEqual({ envio: "enviado", aseguradora: "gyt" });
		expect(subidosR2).toEqual([{ key: KEY, mime: "application/pdf" }]);
		const doc = insertados.find((i) => i.tabla === opportunityDocuments);
		expect(doc?.valores).toMatchObject({
			documentType: "seguro_vehiculo",
			filePath: KEY,
			originalName: "factura.pdf",
			size: 2048,
			uploadedBy: "socio-1",
		});
		const envio = insertados.find(
			(i) => i.tabla === insuranceInvoiceSubmissions,
		);
		expect(envio?.valores).toMatchObject({
			insuranceProvider: "gyt",
			recipients: ["polizas@gyt.test"],
			status: "pendiente",
			// La agencia queda fija aunque la oportunidad cambie de agencia después.
			companyId: "agencia-1",
		});
		// El correo se guarda en el registro y se envía ese mismo.
		const guardado = {
			asunto: envio?.valores.correoAsunto,
			html: envio?.valores.correoHtml,
		};
		expect(guardado.html).toContain("la garantía va al Cliente Juan Pérez");
		expect(correos[0]).toMatchObject({
			destinatarios: ["polizas@gyt.test"],
			archivo: { key: KEY, nombre: "factura.pdf" },
			// Registro id-2 (id-1 es el documento), primer intento.
			idempotencyKey: "factura-seguro/id-2/1",
			correo: guardado,
		});
		expect(actualizados[0]).toMatchObject({ status: "enviado" });
		expect(borradosR2).toHaveLength(0);
	});

	test("gerente → FORBIDDEN; etapa 85 → BAD_REQUEST; sin subir nada a R2", async () => {
		membresias = [{ companyId: "agencia-1", sellerId: null }];
		await expect(subir()).rejects.toMatchObject({ code: "FORBIDDEN" });

		membresias = [{ companyId: "agencia-1", sellerId: "v1" }];
		caso = casoAl(85);
		await expect(subir()).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(subidosR2).toHaveLength(0);
	});

	test("Word, archivo vacío o de más de 10 MB → BAD_REQUEST, sin subir nada", async () => {
		await expect(
			subir(pdf("factura.docx", "application/msword")),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			subir(pdf("factura.pdf", "application/pdf", 0)),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			subir(pdf("factura.pdf", "application/pdf", 10 * 1024 * 1024 + 1)),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(subidosR2).toHaveLength(0);
	});

	test("un ejecutable declarado como PDF → BAD_REQUEST, sin subir ni enviar nada", async () => {
		// "MZ" es la firma de un .exe de Windows.
		const exe = new File(
			[conContenido(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]), 2048)],
			"factura.pdf",
			{ type: "application/pdf" },
		);
		await expect(subir(exe)).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "El archivo no es un PDF ni una imagen válida (JPG, PNG o WebP)",
		});
		expect(subidosR2).toHaveLength(0);
		expect(correos).toHaveLength(0);
	});

	test("un PDF declarado como imagen se guarda y se adjunta como .pdf", async () => {
		// Pasa el filtro del tipo declarado (PNG está permitido), pero el
		// contenido manda: es un PDF.
		await subir(pdf("factura.png", "image/png"));
		expect(subidosR2).toEqual([{ key: KEY, mime: "application/pdf" }]);
		expect(
			insertados.find((i) => i.tabla === opportunityDocuments)?.valores,
		).toMatchObject({
			originalName: "factura.pdf",
			mimeType: "application/pdf",
		});
		expect(correos[0]).toMatchObject({
			archivo: { key: KEY, nombre: "factura.pdf" },
		});
	});

	test("el tipo guardado es el del contenido, no el declarado", async () => {
		const png = new File(
			[
				conContenido(
					new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
					2048,
				),
			],
			"factura.jpg",
			{ type: "image/jpeg" },
		);
		await subir(png);
		expect(subidosR2[0]?.mime).toBe("image/png");
		expect(
			insertados.find((i) => i.tabla === opportunityDocuments)?.valores,
		).toMatchObject({ originalName: "factura.png", mimeType: "image/png" });
	});

	test("si otra subida ganó la carrera: CONFLICT y se borra solo el archivo recién subido", async () => {
		facturaPrevia = [{ id: "previa" }];
		await expect(subir()).rejects.toMatchObject({ code: "CONFLICT" });
		expect(subidosR2).toEqual([{ key: KEY, mime: "application/pdf" }]);
		expect(borradosR2).toEqual([KEY]);
		expect(insertados).toHaveLength(0);
	});

	test("si Resend dice que el mismo intento sigue en curso, queda 'pendiente'", async () => {
		resultadoCorreo = {
			ok: false,
			error: "concurrente",
			resultado: "en_curso",
		};
		const r = await subir();
		expect(r.envio).toBe("pendiente");
		expect(actualizados).toHaveLength(0);
	});

	test("resultado incierto (red caída): queda 'pendiente' con el error, sin abrir otro intento", async () => {
		resultadoCorreo = {
			ok: false,
			error: "Unable to fetch data",
			resultado: "incierto",
		};
		const r = await subir();
		expect(r.envio).toBe("pendiente");
		expect(actualizados[0]).toMatchObject({ error: "Unable to fetch data" });
		expect(actualizados[0]).not.toHaveProperty("status");
	});

	test("si Resend lo rechaza, la factura queda subida y el envío en 'fallido'", async () => {
		resultadoCorreo = {
			ok: false,
			error: "Resend caído",
			resultado: "rechazado",
		};
		const r = await subir();
		expect(r.envio).toBe("fallido");
		expect(insertados.some((i) => i.tabla === opportunityDocuments)).toBe(true);
		expect(actualizados[0]).toMatchObject({
			status: "fallido",
			error: "Resend caído",
		});
		expect(borradosR2).toHaveLength(0);
	});

	test("sin vehículo vinculado, el correo nombra el vehículo de la cotización elegida, no el de la última editada", async () => {
		// La fila trae el vehículo de la última cotización editada (Kia); la
		// cotización elegida para el correo (la aceptada) es de otro vehículo.
		caso = casoAl(90, {
			vehicleMake: null,
			vehicleModel: null,
			vehicleYear: null,
			quotationBrand: "Kia",
			quotationLine: "Rio",
			quotationModel: "2019",
		});
		cotizacion = [
			{
				insuranceProvider: "gyt",
				insuredAmount: "300000",
				vehicleBrand: "Toyota",
				vehicleLine: "Hilux",
				vehicleModel: "2024",
			},
		];
		await subir();
		const html = insertados.find((i) => i.tabla === insuranceInvoiceSubmissions)
			?.valores.correoHtml as string;
		expect(html).toContain("Toyota Hilux 2024");
		expect(html).not.toContain("Kia");
	});

	test("si el caso se cerró mientras se subía, rechaza, borra el archivo y no manda un correo con datos de antes del cierre", async () => {
		casoBajoBloqueo = { ...caso, status: "won" };
		await expect(subir()).rejects.toMatchObject({
			code: "CONFLICT",
			message:
				"El caso cambió mientras se procesaba la factura. Vuelve a intentarlo.",
		});
		expect(subidosR2).toEqual([{ key: KEY, mime: "application/pdf" }]);
		expect(borradosR2).toEqual([KEY]);
		expect(insertados).toHaveLength(0);
		expect(correos).toHaveLength(0);
	});

	test("sin destinatarios no se envía, pero la factura queda", async () => {
		correosPolizas = { ...correosPolizas, gyt: [] };
		const r = await subir();
		expect(r.envio).toBe("sin_destinatario");
		expect(correos).toHaveLength(0);
		expect(
			insertados.find((i) => i.tabla === insuranceInvoiceSubmissions)?.valores
				.status,
		).toBe("sin_destinatario");
	});
});

describe("reenviarFacturaSeguro", () => {
	beforeEach(() => {
		userRole = ROLES.ADMIN;
	});
	const creado = new Date("2026-09-29T18:00:00Z");
	const registro = (status: string, actualizadoAt: Date | null = null) => ({
		id: "envio-1",
		status,
		intento: 1,
		retryCount: 0,
		recipients: ["antes@gyt.test"],
		correoAsunto: "Asunto guardado",
		correoHtml: "<p>Correo guardado del intento</p>",
		createdAt: creado,
		actualizadoAt,
		insuranceProvider: "gyt",
		key: KEY,
		nombre: "factura.pdf",
	});

	test("si el caso cambió de estado antes del bloqueo (se cerró), no reenvía con datos viejos", async () => {
		facturaPrevia = [registro("fallido")];
		casoBajoBloqueo = { ...caso, status: "won" };
		await expect(
			call(trackerRouter.reenviarFacturaSeguro, { opportunityId: ID }, crmCtx),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message:
				"El caso cambió mientras se procesaba la factura. Vuelve a intentarlo.",
		});
		expect(actualizados).toHaveLength(0);
		expect(correos).toHaveLength(0);
	});

	test("tras un rechazo: nuevo intento (nueva llave) con el mismo correo guardado al subir", async () => {
		facturaPrevia = [registro("fallido")];
		// Otra cotización aceptada después de subir no cambia lo que se reenvía.
		cotizacion = [{ ...cotizacion[0], insuranceProvider: "universales" }];
		const r = await call(
			trackerRouter.reenviarFacturaSeguro,
			{ opportunityId: ID },
			crmCtx,
		);
		expect(r).toEqual({ envio: "enviado", aseguradora: "gyt" });
		expect(actualizados[0]).toMatchObject({
			status: "pendiente",
			intento: 2,
			retryCount: 1,
			recipients: ["polizas@gyt.test"],
			correoHtml: "<p>Correo guardado del intento</p>",
		});
		expect(correos[0]).toMatchObject({
			archivo: { key: KEY, nombre: "factura.pdf" },
			idempotencyKey: "factura-seguro/envio-1/2",
			correo: {
				asunto: "Asunto guardado",
				html: "<p>Correo guardado del intento</p>",
			},
		});
		expect(actualizados[1]).toMatchObject({ status: "enviado" });
		expect(insertados).toHaveLength(0);
	});

	test("un registro sin correo guardado (anterior a guardarlo) lo arma de nuevo", async () => {
		facturaPrevia = [
			{ ...registro("fallido"), correoAsunto: null, correoHtml: null },
		];
		await call(
			trackerRouter.reenviarFacturaSeguro,
			{ opportunityId: ID },
			crmCtx,
		);
		expect(actualizados[0].correoHtml as string).toContain(
			"la garantía va al Cliente Juan Pérez",
		);
	});

	test("pendiente abandonado: repite el MISMO intento, destinatarios y correo guardado", async () => {
		facturaPrevia = [registro("pendiente", new Date("2026-01-01T00:00:00Z"))];
		await call(
			trackerRouter.reenviarFacturaSeguro,
			{ opportunityId: ID },
			crmCtx,
		);
		expect(actualizados[0]).toMatchObject({
			intento: 1,
			retryCount: 1,
			recipients: ["antes@gyt.test"],
		});
		// Aunque los datos del caso cambiaron, se reenvía el contenido guardado:
		// con la misma llave Resend exige el mismo payload.
		expect(correos[0]).toMatchObject({
			idempotencyKey: "factura-seguro/envio-1/1",
			destinatarios: ["antes@gyt.test"],
			correo: {
				asunto: "Asunto guardado",
				html: "<p>Correo guardado del intento</p>",
			},
		});
	});

	test("el resultado del envío solo se registra sobre el mismo intento y nunca pisa un enviado", async () => {
		facturaPrevia = [registro("pendiente", new Date("2026-01-01T00:00:00Z"))];
		await call(
			trackerRouter.reenviarFacturaSeguro,
			{ opportunityId: ID },
			crmCtx,
		);
		// [0] reserva el registro; [1] guarda el resultado del envío.
		expect(actualizados[1]).toMatchObject({ status: "enviado" });
		const { sql, params } = new PgDialect().sqlToQuery(
			condicionesActualizacion[1] as SQL,
		);
		expect(sql).toContain('"intento" = ');
		expect(sql).toContain('"status" <> ');
		expect(params).toEqual(["envio-1", 1, "enviado"]);
	});

	test("un asesor comercial no puede reenviar una oportunidad ajena", async () => {
		facturaPrevia = [registro("fallido")];
		userRole = ROLES.SALES;
		caso = { ...caso, assignedTo: "otro-asesor" };
		await expect(
			call(trackerRouter.reenviarFacturaSeguro, { opportunityId: ID }, crmCtx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(correos).toHaveLength(0);
		expect(actualizados).toHaveLength(0);
	});

	test("cobros, contabilidad, jurídico y otros roles del CRM no pueden reintentar", async () => {
		facturaPrevia = [registro("fallido")];
		for (const rol of [
			ROLES.COBROS,
			ROLES.COBROS_SUPERVISOR,
			ROLES.JURIDICO,
			ROLES.ACCOUNTING,
			ROLES.VEHICLE_VERIFIER,
		]) {
			userRole = rol;
			await expect(
				call(
					trackerRouter.reenviarFacturaSeguro,
					{ opportunityId: ID },
					crmCtx,
				),
				// Algunos ni entran al CRM (crmProcedure); a los demás los frena la regla.
			).rejects.toMatchObject({ code: "FORBIDDEN" });
		}
		expect(correos).toHaveLength(0);
		expect(actualizados).toHaveLength(0);
	});

	test("supervisor de ventas, analista y el asesor de la oportunidad sí pueden reintentar", async () => {
		facturaPrevia = [registro("fallido")];
		caso = { ...caso, assignedTo: "crm-1" };
		for (const rol of [ROLES.SALES_SUPERVISOR, ROLES.ANALYST, ROLES.SALES]) {
			userRole = rol;
			const r = await call(
				trackerRouter.reenviarFacturaSeguro,
				{ opportunityId: ID },
				crmCtx,
			);
			expect(r.envio).toBe("enviado");
		}
		expect(correos).toHaveLength(3);
	});

	test("si ya se envió, o está en curso → CONFLICT, sin mandar nada", async () => {
		for (const status of ["enviado", "pendiente"]) {
			facturaPrevia = [registro(status)];
			await expect(
				call(
					trackerRouter.reenviarFacturaSeguro,
					{ opportunityId: ID },
					crmCtx,
				),
			).rejects.toMatchObject({ code: "CONFLICT" });
		}
		expect(correos).toHaveLength(0);
	});

	test("sin factura subida → NOT_FOUND; socio del tracker → UNAUTHORIZED", async () => {
		facturaPrevia = [];
		await expect(
			call(trackerRouter.reenviarFacturaSeguro, { opportunityId: ID }, crmCtx),
		).rejects.toMatchObject({ code: "NOT_FOUND" });

		facturaPrevia = [registro("fallido")];
		await expect(
			call(trackerRouter.reenviarFacturaSeguro, { opportunityId: ID }, ctx),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	test("el CRM solo puede reintentar una vez, aunque vuelva a fallar", async () => {
		facturaPrevia = [registro("fallido")];
		resultadoCorreo = { ok: false, error: "rechazado", resultado: "rechazado" };
		await call(
			trackerRouter.reenviarFacturaSeguro,
			{ opportunityId: ID },
			crmCtx,
		);
		expect(actualizados[0].retryCount).toBe(1);
		facturaPrevia = [{ ...registro("fallido"), retryCount: 1, intento: 2 }];
		await expect(
			call(trackerRouter.reenviarFacturaSeguro, { opportunityId: ID }, crmCtx),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(correos).toHaveLength(1);
	});

	test("sin destinatarios no consume el único reintento", async () => {
		facturaPrevia = [registro("sin_destinatario")];
		correosPolizas = { gyt: [], universales: [] };
		await expect(
			call(trackerRouter.reenviarFacturaSeguro, { opportunityId: ID }, crmCtx),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(actualizados).toHaveLength(0);
	});
});

describe("previsualizarFacturaSeguroDesdeCrm", () => {
	test("si se enviaría, dice a qué aseguradora (para la confirmación del CRM)", async () => {
		expect(await previsualizarFacturaSeguroDesdeCrm(ID)).toEqual({
			seEnviara: true,
			aseguradora: "gyt",
		});
		expect(insertados).toHaveLength(0);
		expect(correos).toHaveLength(0);
	});

	test("si no se enviaría, da el motivo y no pide confirmación", async () => {
		caso = casoAl(85);
		expect(await previsualizarFacturaSeguroDesdeCrm(ID)).toEqual({
			seEnviara: false,
			motivo: "la oportunidad no está en formalización final (90%)",
		});
	});
});

describe("enviarFacturaSeguroDesdeCrm", () => {
	const KEY_CRM = `opportunities/${ID}/999-crm-factura.pdf`;
	// La copia que sube el server con los bytes validados.
	const COPIA = `opportunities/${ID}/123-abc-factura-crm.pdf`;
	const enviar = (
		nombre = "factura-crm.pdf",
		rol = "admin",
		mimeType = "application/pdf",
	) =>
		enviarFacturaSeguroDesdeCrm({
			opportunityId: ID,
			documentId: "doc-crm",
			key: KEY_CRM,
			nombre,
			mimeType,
			userId: "crm-1",
			userRole: rol,
		});
	const envioRegistrado = () =>
		insertados.find((i) => i.tabla === insuranceInvoiceSubmissions)?.valores;

	test("los datos del correo se leen dentro del registro, con las cotizaciones FOR SHARE", async () => {
		caso = casoAl(90, {
			status: "won",
			actualCloseDate: new Date("2026-09-01"),
		});
		await enviar();
		expect(bloqueosCotizacion.map((b) => b.modo)).toEqual(["share"]);
	});

	test("al 90% ganada, de una agencia: registra el envío con el documento del CRM y manda el correo", async () => {
		caso = casoAl(90, {
			status: "won",
			actualCloseDate: new Date("2026-09-01"),
		});
		const r = await enviar();
		expect(r).toEqual({
			enviada: true,
			envio: "enviado",
			aseguradora: "universales",
		});
		expect(envioRegistrado()).toMatchObject({
			documentId: "doc-crm",
			companyId: "agencia-1",
			submittedBy: "crm-1",
			status: "pendiente",
		});
		// Solo el registro del envío: el documento ya lo guardó el CRM.
		expect(insertados.some((i) => i.tabla === opportunityDocuments)).toBe(
			false,
		);
		expect(correos[0]).toMatchObject({
			archivo: { key: COPIA, nombre: "factura-crm.pdf" },
		});
	});

	test("manda una copia de los bytes validados: la URL firmada de la subida ya no alcanza lo que sale", async () => {
		await enviar();
		expect(subidosR2).toEqual([{ key: COPIA, mime: "application/pdf" }]);
		expect(actualizados).toContainEqual(
			expect.objectContaining({ filePath: COPIA, mimeType: "application/pdf" }),
		);
		expect(borradosR2).toEqual([KEY_CRM]);
	});

	test("el archivo se baja con tope y uno que se pasa de 10 MB no se copia ni se envía", async () => {
		contenidoR2 = Buffer.concat([
			Buffer.from("%PDF-1.4"),
			Buffer.alloc(10 * 1024 * 1024),
		]);
		const r = await enviar();
		expect(topesLecturaR2).toEqual([10 * 1024 * 1024]);
		expect(r).toEqual({
			enviada: false,
			motivo: "la factura no puede pesar más de 10MB",
		});
		expect(subidosR2).toHaveLength(0);
		expect(insertados).toHaveLength(0);
		expect(correos).toHaveLength(0);
	});

	test("el correo usa el vehículo vigente al registrar, no el de antes de validar", async () => {
		casoReleido = { ...caso, vehicleMake: "Honda", vehicleModel: "Civic" };
		await enviar();
		const html = (correos[0] as { correo: { html: string } }).correo.html;
		expect(html).toContain("Honda Civic");
		expect(html).not.toContain("Toyota");
	});

	test("si otro documento usa la key original, no se borra", async () => {
		documentosConKey = [{ id: "doc-anterior" }];
		await enviar();
		expect(correos).toHaveLength(1);
		expect(borradosR2).toEqual([]);
	});

	test("un PDF subido como .docx queda como .pdf en el documento, que es lo que lee el reintento", async () => {
		await enviar("factura.docx");
		expect(actualizados).toContainEqual(
			expect.objectContaining({ originalName: "factura.pdf" }),
		);
		expect(correos[0]).toMatchObject({ archivo: { nombre: "factura.pdf" } });
	});

	test("fuera de formalización final, sin agencia o con factura ya registrada: no se envía", async () => {
		const casos: Array<[Record<string, unknown>, string]> = [
			[casoAl(85), "la oportunidad no está en formalización final (90%)"],
			[
				casoAl(90, { companyId: null }),
				"la oportunidad no es de una agencia o predio",
			],
			[
				casoAl(90, { facturaEnvio: "enviado" }),
				"la oportunidad ya tiene su factura del seguro registrada",
			],
			[
				casoAl(90, { status: "lost" }),
				"la oportunidad ya no admite la factura del seguro",
			],
		];
		for (const [c, motivo] of casos) {
			caso = c;
			expect(await enviar()).toEqual({ enviada: false, motivo });
		}
		expect(insertados).toHaveLength(0);
		expect(correos).toHaveLength(0);
	});

	test("un Word o un Excel también se envía, con su nombre y su tipo", async () => {
		const DOCX =
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document";
		contenidoR2 = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
		const r = await enviar("factura.docx", "admin", DOCX);
		expect(r).toMatchObject({ enviada: true });
		expect(subidosR2).toEqual([
			{ key: `opportunities/${ID}/123-abc-factura.docx`, mime: DOCX },
		]);
		expect(correos[0]).toMatchObject({ archivo: { nombre: "factura.docx" } });
	});

	test("el nombre del adjunto lleva la extensión del tipo real", async () => {
		await enviar("Factura Seguro.PDF");
		expect(correos[0]).toMatchObject({
			archivo: { nombre: "Factura Seguro.pdf" },
		});
	});

	test("si la oportunidad cambió de estado mientras tanto, no registra ni envía", async () => {
		casoBajoBloqueo = { ...caso, status: "won" };
		const r = await enviar();
		expect(r).toEqual({
			enviada: false,
			motivo: "la oportunidad cambió mientras se guardaba la factura",
		});
		expect(insertados).toHaveLength(0);
		expect(correos).toHaveLength(0);
		// Se borra la copia y el documento sigue con su archivo.
		expect(borradosR2).toEqual([COPIA]);
	});

	test("un asesor comercial al que le reasignaron la oportunidad mientras subía no registra ni envía", async () => {
		casoBajoBloqueo = { ...caso, assignedTo: "otro-asesor" };
		const r = await enviar("factura-crm.pdf", "sales");
		expect(r).toMatchObject({ enviada: false });
		expect(insertados).toHaveLength(0);
		expect(correos).toHaveLength(0);
		expect(borradosR2).toEqual([COPIA]);
	});

	test("el asesor comercial asignado sí la envía", async () => {
		casoBajoBloqueo = { ...caso, assignedTo: "crm-1" };
		expect(await enviar("factura-crm.pdf", "sales")).toMatchObject({
			enviada: true,
		});
	});

	test("sin destinatarios: queda registrada como sin destinatario y no se manda correo", async () => {
		correosPolizas = { gyt: [], universales: [] };
		const r = await enviar();
		expect(r).toMatchObject({ enviada: true, envio: "sin_destinatario" });
		expect(envioRegistrado()).toMatchObject({ status: "sin_destinatario" });
		expect(correos).toHaveLength(0);
	});
});

describe("verFacturaSeguro", () => {
	test("el vendedor asignado recibe un link temporal al archivo", async () => {
		facturaPrevia = [{ key: KEY }];
		expect(
			await call(trackerRouter.verFacturaSeguro, { opportunityId: ID }, ctx),
		).toEqual({ url: `https://r2.test/${KEY}` });
	});

	test("el gerente de la agencia también puede abrirla", async () => {
		membresias = [{ companyId: "agencia-1", sellerId: null }];
		facturaPrevia = [{ key: KEY }];
		expect(
			await call(trackerRouter.verFacturaSeguro, { opportunityId: ID }, ctx),
		).toEqual({ url: `https://r2.test/${KEY}` });
	});

	test("otro vendedor de la agencia o de otra agencia: no la ve", async () => {
		facturaPrevia = [{ key: KEY }];
		membresias = [{ companyId: "agencia-1", sellerId: "v2" }];
		await expect(
			call(trackerRouter.verFacturaSeguro, { opportunityId: ID }, ctx),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			message: "Este caso no está asignado a ti",
		});
		membresias = [{ companyId: "agencia-2", sellerId: null }];
		await expect(
			call(trackerRouter.verFacturaSeguro, { opportunityId: ID }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	test("sin factura subida: no encontrada", async () => {
		await expect(
			call(trackerRouter.verFacturaSeguro, { opportunityId: ID }, ctx),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Este caso todavía no tiene factura del seguro",
		});
	});
});
