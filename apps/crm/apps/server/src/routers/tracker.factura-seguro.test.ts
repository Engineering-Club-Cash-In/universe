import { call, ORPCError } from "@orpc/server";
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
import { ROLES } from "../lib/roles";

const ID = "11111111-1111-4111-8111-111111111111";

let membresias: Array<{ companyId: string; sellerId: string | null }> = [];
let caso: Record<string, unknown> = {};
let cotizacion: Array<Record<string, unknown>> = [];
let facturaPrevia: Array<Record<string, unknown>> = [];
// Vendedor asignado leído dentro de la transacción (puede diferir del caso).
let vendedorVigente: string | null | undefined;
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
			if (tabla === quotations) return cadena(() => cotizacion);
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
	generatePresignedUploadUrl: async (key: string) => `https://r2.test/${key}`,
	validateResolvedMimeType: (f: { name: string; type?: string }) => {
		const mime =
			f.type ??
			(f.name.endsWith(".pdf") ? "application/pdf" : "application/msword");
		return { valid: true, mimeType: mime };
	},
	verifyUploadedDocumentInR2: async (p: {
		key: string;
		expectedPrefix: string;
		filename: string;
		mimeType?: string;
	}) => {
		if (!p.key.startsWith(`${p.expectedPrefix}/`)) {
			throw new ORPCError("BAD_REQUEST", {
				message: "El archivo no pertenece al recurso esperado.",
			});
		}
		return {
			key: p.key,
			filename: p.filename,
			size: 2048,
			mimeType: p.mimeType ?? "application/pdf",
		};
	},
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

const archivoValido = {
	name: "factura.pdf",
	type: "application/pdf",
	size: 2048,
	key: `opportunities/${ID}/123-abc-factura.pdf`,
};

beforeEach(() => {
	membresias = [{ companyId: "agencia-1", sellerId: "v1" }];
	caso = casoAl(90);
	cotizacion = [{ insuranceProvider: "gyt", insuredAmount: "300000" }];
	facturaPrevia = [];
	vendedorVigente = undefined;
	resultadoCorreo = { ok: true };
	insertados.length = 0;
	actualizados.length = 0;
	correos.length = 0;
	process.env.CORREOS_ASEGURADORA_GYT = "polizas@gyt.test";
	process.env.CORREOS_ASEGURADORA_UNIVERSALES = "polizas@universales.test";
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

describe("getFacturaSeguroUploadUrl", () => {
	const entrada = {
		opportunityId: ID,
		fileName: "factura.pdf",
		mimeType: "application/pdf",
		size: 2048,
	};

	test("devuelve la URL firmada dentro de la carpeta de la oportunidad (carro usado incluido)", async () => {
		const r = await call(trackerRouter.getFacturaSeguroUploadUrl, entrada, ctx);
		expect(r.key.startsWith(`opportunities/${ID}/`)).toBe(true);
		expect(r.mimeType).toBe("application/pdf");
	});

	test("gerente → FORBIDDEN; etapa 85 → BAD_REQUEST; Word → BAD_REQUEST", async () => {
		membresias = [{ companyId: "agencia-1", sellerId: null }];
		await expect(
			call(trackerRouter.getFacturaSeguroUploadUrl, entrada, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });

		membresias = [{ companyId: "agencia-1", sellerId: "v1" }];
		caso = casoAl(85);
		await expect(
			call(trackerRouter.getFacturaSeguroUploadUrl, entrada, ctx),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });

		caso = casoAl(90);
		await expect(
			call(
				trackerRouter.getFacturaSeguroUploadUrl,
				{
					...entrada,
					fileName: "factura.docx",
					mimeType: "application/msword",
				},
				ctx,
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
});

describe("confirmFacturaSeguro", () => {
	test("guarda la factura como documento seguro_vehiculo y la envía a la aseguradora de la cotización", async () => {
		const r = await call(
			trackerRouter.confirmFacturaSeguro,
			{ opportunityId: ID, file: archivoValido },
			ctx,
		);

		expect(r).toEqual({ envio: "enviado", aseguradora: "gyt" });
		const doc = insertados.find((i) => i.tabla === opportunityDocuments);
		expect(doc?.valores).toMatchObject({
			documentType: "seguro_vehiculo",
			filePath: archivoValido.key,
			uploadedBy: "socio-1",
		});
		const envio = insertados.find(
			(i) => i.tabla === insuranceInvoiceSubmissions,
		);
		expect(envio?.valores).toMatchObject({
			insuranceProvider: "gyt",
			recipients: ["polizas@gyt.test"],
			status: "pendiente",
		});
		// El correo se guarda en el registro y se envía ese mismo.
		const guardado = {
			asunto: envio?.valores.correoAsunto,
			html: envio?.valores.correoHtml,
		};
		expect(guardado.html).toContain("la garantía va al Cliente Juan Pérez");
		expect(correos[0]).toMatchObject({
			destinatarios: ["polizas@gyt.test"],
			// Registro id-2 (id-1 es el documento), primer intento.
			idempotencyKey: "factura-seguro/id-2/1",
			correo: guardado,
		});
		expect(actualizados[0]).toMatchObject({ status: "enviado" });
	});

	test("si Resend dice que el mismo intento sigue en curso, queda 'pendiente'", async () => {
		resultadoCorreo = {
			ok: false,
			error: "concurrente",
			resultado: "en_curso",
		};
		const r = await call(
			trackerRouter.confirmFacturaSeguro,
			{ opportunityId: ID, file: archivoValido },
			ctx,
		);
		expect(r.envio).toBe("pendiente");
		expect(actualizados).toHaveLength(0);
	});

	test("resultado incierto (red caída): queda 'pendiente' con el error, sin abrir otro intento", async () => {
		resultadoCorreo = {
			ok: false,
			error: "Unable to fetch data",
			resultado: "incierto",
		};
		const r = await call(
			trackerRouter.confirmFacturaSeguro,
			{ opportunityId: ID, file: archivoValido },
			ctx,
		);
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
		const r = await call(
			trackerRouter.confirmFacturaSeguro,
			{ opportunityId: ID, file: archivoValido },
			ctx,
		);
		expect(r.envio).toBe("fallido");
		expect(insertados.some((i) => i.tabla === opportunityDocuments)).toBe(true);
		expect(actualizados[0]).toMatchObject({
			status: "fallido",
			error: "Resend caído",
		});
	});

	test("sin destinatarios configurados no se envía, pero la factura queda", async () => {
		process.env.CORREOS_ASEGURADORA_GYT = "";
		const r = await call(
			trackerRouter.confirmFacturaSeguro,
			{ opportunityId: ID, file: archivoValido },
			ctx,
		);
		expect(r.envio).toBe("sin_destinatario");
		expect(correos).toHaveLength(0);
		expect(
			insertados.find((i) => i.tabla === insuranceInvoiceSubmissions)?.valores
				.status,
		).toBe("sin_destinatario");
	});

	test("una segunda factura → CONFLICT, sin escribir nada", async () => {
		facturaPrevia = [{ id: "previa" }];
		await expect(
			call(
				trackerRouter.confirmFacturaSeguro,
				{ opportunityId: ID, file: archivoValido },
				ctx,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(insertados).toHaveLength(0);
	});

	test("un archivo de otra oportunidad → BAD_REQUEST", async () => {
		await expect(
			call(
				trackerRouter.confirmFacturaSeguro,
				{
					opportunityId: ID,
					file: { ...archivoValido, key: "opportunities/otra/x.pdf" },
				},
				ctx,
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(insertados).toHaveLength(0);
	});

	test("el gerente no puede confirmar", async () => {
		membresias = [{ companyId: "agencia-1", sellerId: null }];
		await expect(
			call(
				trackerRouter.confirmFacturaSeguro,
				{ opportunityId: ID, file: archivoValido },
				ctx,
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
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
		key: archivoValido.key,
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
			archivo: { key: archivoValido.key, nombre: "factura.pdf" },
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
