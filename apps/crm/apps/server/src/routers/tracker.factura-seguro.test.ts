import { call } from "@orpc/server";
import { beforeEach, describe, expect, mock, test } from "bun:test";
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
import { quotations } from "../db/schema/quotations";
import type { CorreosPorAseguradora } from "../lib/factura-seguro";
import { ROLES } from "../lib/roles";

const ID = "11111111-1111-4111-8111-111111111111";

let membresias: Array<{ companyId: string; sellerId: string | null }> = [];
let caso: Record<string, unknown> = {};
let cotizacion: Array<Record<string, unknown>> = [];
let facturaPrevia: Array<Record<string, unknown>> = [];
// Vendedor asignado leído dentro de la transacción (puede diferir del caso).
let vendedorVigente: string | null | undefined;
let fallaLecturaCotizacion = false;
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
const correos: Array<Record<string, unknown>> = [];
const subidosR2: Array<{ key: string; mime: string }> = [];
const borradosR2: string[] = [];

function cadena<T>(obtenerFilas: () => T[]) {
	const nodo = {
		from: () => nodo,
		innerJoin: () => nodo,
		leftJoin: () => nodo,
		where: () => nodo,
		orderBy: () => nodo,
		limit: () => nodo,
		for: () => nodo,
		then: (resolve: (filas: T[]) => void) => resolve(obtenerFilas()),
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
						role: ROLES.PARTNER,
						banned: false,
					},
				]);
			if (tabla === partnerMembers) return cadena(() => membresias);
			if (tabla === partnerAccounts)
				return cadena(() => [{ passwordChangedAt: new Date("2026-01-01") }]);
			if (tabla === opportunities) return cadena(() => [caso]);
			if (tabla === quotations)
				return cadena(() => {
					if (fallaLecturaCotizacion) throw new Error("BD no disponible");
					return cotizacion;
				});
			if (tabla === opportunityAgencySellers)
				return cadena(() => [
					{
						sellerId:
							vendedorVigente === undefined ? caso.sellerId : vendedorVigente,
					},
				]);
			if (tabla === insuranceInvoiceSubmissions)
				return cadena(() => facturaPrevia);
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
			where: async () => {
				actualizados.push(valores);
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
	) => destinatariosReal(aseguradora, correos ?? correosPolizas),
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

const { trackerRouter } = await import("./tracker");

const ctx = {
	context: {
		partnerSession: { user: { id: "socio-1" }, session: { id: "sesion-1" } },
		headers: { get: () => null },
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
const pdf = (nombre = "factura.pdf", tipo = "application/pdf", bytes = 2048) =>
	new File([new Uint8Array(bytes)], nombre, { type: tipo });

beforeEach(() => {
	membresias = [{ companyId: "agencia-1", sellerId: "v1" }];
	caso = casoAl(90);
	cotizacion = [{ insuranceProvider: "gyt", insuredAmount: "300000" }];
	facturaPrevia = [];
	vendedorVigente = undefined;
	fallaLecturaCotizacion = false;
	resultadoCorreo = { ok: true };
	insertados.length = 0;
	actualizados.length = 0;
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
			reenviable: false,
		});
	});

	test("reenviable solo si el envío quedó fallido", async () => {
		caso = casoAl(90, { facturaEnvio: "fallido", facturaSubidaAt: new Date() });
		let [c] = await call(trackerRouter.getCasos, {}, ctx);
		expect(c.facturaSeguro.reenviable).toBe(true);

		caso = casoAl(90, { facturaEnvio: "enviado", facturaSubidaAt: new Date() });
		[c] = await call(trackerRouter.getCasos, {}, ctx);
		expect(c.facturaSeguro.reenviable).toBe(false);
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

	test("si falla la lectura de los datos del correo, no se sube nada a R2", async () => {
		fallaLecturaCotizacion = true;
		await expect(subir()).rejects.toThrow();
		expect(subidosR2).toHaveLength(0);
		expect(insertados).toHaveLength(0);
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
	const creado = new Date("2026-09-29T18:00:00Z");
	const registro = (status: string, actualizadoAt: Date | null = null) => ({
		id: "envio-1",
		status,
		intento: 1,
		recipients: ["antes@gyt.test"],
		correoAsunto: "Asunto guardado",
		correoHtml: "<p>Correo guardado del intento</p>",
		createdAt: creado,
		actualizadoAt,
		insuranceProvider: "gyt",
		key: KEY,
		nombre: "factura.pdf",
	});

	test("tras un rechazo: nuevo intento (nueva llave) con el correo armado de nuevo", async () => {
		facturaPrevia = [registro("fallido")];
		const r = await call(
			trackerRouter.reenviarFacturaSeguro,
			{ opportunityId: ID },
			ctx,
		);
		expect(r).toEqual({ envio: "enviado", aseguradora: "gyt" });
		expect(actualizados[0]).toMatchObject({
			status: "pendiente",
			intento: 2,
			recipients: ["polizas@gyt.test"],
		});
		const nuevoHtml = actualizados[0].correoHtml as string;
		expect(nuevoHtml).toContain("la garantía va al Cliente Juan Pérez");
		expect(correos[0]).toMatchObject({
			archivo: { key: KEY, nombre: "factura.pdf" },
			idempotencyKey: "factura-seguro/envio-1/2",
			correo: { html: nuevoHtml },
		});
		expect(actualizados[1]).toMatchObject({ status: "enviado" });
		expect(insertados).toHaveLength(0);
	});

	test("pendiente abandonado: repite el MISMO intento, destinatarios y correo guardado", async () => {
		facturaPrevia = [registro("pendiente", new Date("2026-01-01T00:00:00Z"))];
		await call(trackerRouter.reenviarFacturaSeguro, { opportunityId: ID }, ctx);
		expect(actualizados[0]).toMatchObject({
			intento: 1,
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

	test("si reasignaron el vendedor, el anterior ya no puede reenviar", async () => {
		facturaPrevia = [registro("fallido")];
		vendedorVigente = "v2";
		await expect(
			call(trackerRouter.reenviarFacturaSeguro, { opportunityId: ID }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(correos).toHaveLength(0);
		expect(actualizados).toHaveLength(0);
	});

	test("si ya se envió, o está en curso → CONFLICT, sin mandar nada", async () => {
		for (const status of ["enviado", "pendiente"]) {
			facturaPrevia = [registro(status)];
			await expect(
				call(trackerRouter.reenviarFacturaSeguro, { opportunityId: ID }, ctx),
			).rejects.toMatchObject({ code: "CONFLICT" });
		}
		expect(correos).toHaveLength(0);
	});

	test("sin factura subida → NOT_FOUND; gerente → FORBIDDEN", async () => {
		facturaPrevia = [];
		await expect(
			call(trackerRouter.reenviarFacturaSeguro, { opportunityId: ID }, ctx),
		).rejects.toMatchObject({ code: "NOT_FOUND" });

		facturaPrevia = [registro("fallido")];
		membresias = [{ companyId: "agencia-1", sellerId: null }];
		await expect(
			call(trackerRouter.reenviarFacturaSeguro, { opportunityId: ID }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
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
