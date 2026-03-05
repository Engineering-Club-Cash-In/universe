import { ORPCError } from "@orpc/server";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
	clientFormTokens,
	creditApplications,
	financialStatements,
} from "../db/schema/client-forms";
import { leads, opportunities } from "../db/schema/crm";
import { vehicles } from "../db/schema/vehicles";
import { crmProcedure, publicProcedure } from "../lib/orpc";

// Relaxed server-side validation schemas (all fields optional, only validates types)
const referenciaCrediticiaServerSchema = z.object({
	nombre: z.string().optional(),
	telefono: z.string().optional(),
});

const cuentaBancariaServerSchema = z.object({
	numero: z.string().optional(),
	tipo: z.string().optional(),
	banco: z.string().optional(),
});

const referenciaPersonalServerSchema = z.object({
	nombre: z.string().optional(),
	relacion: z.string().optional(),
	telefono: z.string().optional(),
});

const creditApplicationServerSchema = z.object({
	primerApellido: z.string().optional(),
	segundoApellido: z.string().optional(),
	apellidoCasada: z.string().optional(),
	primerNombre: z.string().optional(),
	segundoNombre: z.string().optional(),
	dpi: z.string().optional(),
	nit: z.string().optional(),
	licenciaNo: z.string().optional(),
	edad: z.coerce.number().optional(),
	estadoCivil: z.string().optional(),
	dependientes: z.coerce.number().optional(),
	fechaNacimiento: z.string().optional(),
	sexo: z.string().optional(),
	nacionalidad: z.string().optional(),
	direccionResidencia: z.string().optional(),
	telResidencia: z.string().optional(),
	telMovil: z.string().optional(),
	telEmergencia: z.string().optional(),
	email: z.string().optional(),
	vehiculoMarca: z.string().optional(),
	vehiculoLinea: z.string().optional(),
	vehiculoModelo: z.string().optional(),
	valorEstimado: z.string().optional(),
	montoSolicitado: z.string().optional(),
	usoUber: z.boolean().optional(),
	profesion: z.string().optional(),
	puesto: z.string().optional(),
	sueldo: z.string().optional(),
	sueldoPeriodicidad: z.string().optional(),
	egresos: z.string().optional(),
	egresosPeriodicidad: z.string().optional(),
	fechaProximoPago: z.string().optional(),
	empresa: z.string().optional(),
	direccionTrabajo: z.string().optional(),
	fechaInicioLabores: z.string().optional(),
	tiempoTrabajado: z.string().optional(),
	horarios: z.string().optional(),
	telTrabajo: z.string().optional(),
	supervisor: z.string().optional(),
	rrhh: z.string().optional(),
	bancoPago: z.string().optional(),
	numCuenta: z.string().optional(),
	tipoCuenta: z.string().optional(),
	conyugeNombre: z.string().optional(),
	conyugeEmpresa: z.string().optional(),
	conyugeDireccion: z.string().optional(),
	conyugeTelOficina: z.string().optional(),
	conyugeTelMovil: z.string().optional(),
	referenciasCrediticias: z.array(referenciaCrediticiaServerSchema).optional(),
	cuentasBancarias: z.array(cuentaBancariaServerSchema).optional(),
	referenciasPersonales: z.array(referenciaPersonalServerSchema).optional(),
	esPep: z.boolean().optional(),
	comoSeEntero: z.string().optional(),
	utilizacionCredito: z.string().optional(),
});

const depositoBancarioServerSchema = z.object({
	descripcion: z.string().optional(),
	monto: z.string().optional(),
});

const descripcionMontoServerSchema = z.object({
	descripcion: z.string().optional(),
	monto: z.string().optional(),
});

const anexoInmuebleServerSchema = z.object({
	finca: z.string().optional(),
	folio: z.string().optional(),
	libro: z.string().optional(),
	valor: z.string().optional(),
	hipotecada: z.boolean().optional(),
	aFavorDe: z.string().optional(),
	direccion: z.string().optional(),
});

const anexoVehiculoServerSchema = z.object({
	marca: z.string().optional(),
	linea: z.string().optional(),
	placa: z.string().optional(),
	modeloAnio: z.string().optional(),
	valor: z.string().optional(),
});

const financialStatementServerSchema = z.object({
	primerNombre: z.string().optional(),
	segundoNombre: z.string().optional(),
	primerApellido: z.string().optional(),
	segundoApellido: z.string().optional(),
	apellidoCasada: z.string().optional(),
	dpi: z.string().optional(),
	dpiExtendidoEn: z.string().optional(),
	nit: z.string().optional(),
	efectivo: z.string().optional(),
	depositosBancarios: z.array(depositoBancarioServerSchema).optional(),
	cuentasCobrarAmigos: z.string().optional(),
	cuentasCobrarOtros: z.string().optional(),
	documentosCobrar: z.string().optional(),
	bienesInmueblesCantidad: z.coerce.number().optional(),
	bienesInmueblesValor: z.string().optional(),
	vehiculosCantidad: z.coerce.number().optional(),
	vehiculosValor: z.string().optional(),
	maquinaria: z.string().optional(),
	muebles: z.string().optional(),
	menaje: z.string().optional(),
	otrosActivos: z.array(descripcionMontoServerSchema).optional(),
	cuentasPagarAmigos: z.string().optional(),
	cuentasPagarOtros: z.string().optional(),
	letrasPagar: z.string().optional(),
	obligacionesParticulares: z.array(descripcionMontoServerSchema).optional(),
	obligacionesCortoPlazo: z.array(descripcionMontoServerSchema).optional(),
	obligacionesLargoPlazo: z.array(descripcionMontoServerSchema).optional(),
	otrosPasivos: z.array(descripcionMontoServerSchema).optional(),
	sueldos: z.string().optional(),
	bonificaciones: z.string().optional(),
	arrendamientos: z.string().optional(),
	otrosIngresos: z.array(descripcionMontoServerSchema).optional(),
	gastosPersonales: z.string().optional(),
	alquileres: z.string().optional(),
	amortizacionVivienda: z.string().optional(),
	deudasPersonales: z.string().optional(),
	otrosEgresos: z.array(descripcionMontoServerSchema).optional(),
	origenIngresos: z.string().optional(),
	comoAcreditanIngresos: z.string().optional(),
	anexoInmuebles: z.array(anexoInmuebleServerSchema).optional(),
	anexoVehiculos: z.array(anexoVehiculoServerSchema).optional(),
	firmaImagen: z.string().optional(),
	fechaFirma: z.string().optional(),
});

// Fields that are decimal/integer in the DB and must not receive empty strings
const DECIMAL_FIELDS = new Set([
	"valorEstimado",
	"montoSolicitado",
	"sueldo",
	"egresos",
	"efectivo",
	"cuentasCobrarAmigos",
	"cuentasCobrarOtros",
	"documentosCobrar",
	"bienesInmueblesValor",
	"vehiculosValor",
	"maquinaria",
	"muebles",
	"menaje",
	"cuentasPagarAmigos",
	"cuentasPagarOtros",
	"letrasPagar",
	"sueldos",
	"bonificaciones",
	"arrendamientos",
	"gastosPersonales",
	"alquileres",
	"amortizacionVivienda",
	"deudasPersonales",
]);

const INTEGER_FIELDS = new Set([
	"edad",
	"dependientes",
	"bienesInmueblesCantidad",
	"vehiculosCantidad",
]);

// Fields with monto/valor inside JSONB arrays that need sanitization
const JSONB_DECIMAL_KEYS = new Set(["monto", "valor"]);

function sanitizeJsonbArray(
	arr: Record<string, unknown>[],
): Record<string, unknown>[] {
	return arr.map((item) => {
		const sanitized: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(item)) {
			if (JSONB_DECIMAL_KEYS.has(key)) {
				if (value === "" || value === null || value === undefined) {
					sanitized[key] = null;
				} else {
					const num = Number(value);
					sanitized[key] = Number.isNaN(num) ? null : String(num);
				}
			} else {
				sanitized[key] = value;
			}
		}
		return sanitized;
	});
}

const JSONB_ARRAY_FIELDS = new Set([
	"depositosBancarios",
	"otrosActivos",
	"obligacionesParticulares",
	"obligacionesCortoPlazo",
	"obligacionesLargoPlazo",
	"otrosPasivos",
	"otrosIngresos",
	"otrosEgresos",
]);

function sanitizeFormData(
	data: Record<string, unknown>,
): Record<string, unknown> {
	const sanitized: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data)) {
		if (DECIMAL_FIELDS.has(key)) {
			if (value === "" || value === null || value === undefined) {
				sanitized[key] = null;
			} else {
				const num = Number(value);
				sanitized[key] = Number.isNaN(num) ? null : String(num);
			}
		} else if (INTEGER_FIELDS.has(key)) {
			if (value === "" || value === null || value === undefined) {
				sanitized[key] = null;
			} else {
				const num = Number(value);
				sanitized[key] = Number.isNaN(num) ? null : Math.trunc(num);
			}
		} else if (JSONB_ARRAY_FIELDS.has(key) && Array.isArray(value)) {
			sanitized[key] = sanitizeJsonbArray(value as Record<string, unknown>[]);
		} else {
			sanitized[key] = value;
		}
	}
	return sanitized;
}

// Shared token validation for public endpoints
async function getValidToken(token: string) {
	const [tokenRow] = await db
		.select()
		.from(clientFormTokens)
		.where(
			and(
				eq(clientFormTokens.token, token),
				gt(clientFormTokens.expiresAt, new Date()),
			),
		)
		.limit(1);

	if (!tokenRow) {
		throw new ORPCError("NOT_FOUND", {
			message: "El enlace es inválido o ha expirado",
		});
	}

	if (tokenRow.used) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Este formulario ya fue completado",
		});
	}

	return tokenRow;
}

export const clientFormsRouter = {
	// Protected: Generate a token for an opportunity
	generateFormToken: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input }) => {
			// Check opportunity exists
			const [opp] = await db
				.select()
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opp) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			// Create token with 7-day expiry
			const expiresAt = new Date();
			expiresAt.setDate(expiresAt.getDate() + 7);

			const [tokenRow] = await db
				.insert(clientFormTokens)
				.values({
					opportunityId: input.opportunityId,
					expiresAt,
				})
				.returning();

			const url = `${process.env.FRONT_URL}/formulario/${tokenRow.token}`;
			return { token: tokenRow.token, url };
		}),

	// Public: Validate token and return data for pre-fill
	validateFormToken: publicProcedure
		.input(z.object({ token: z.string().uuid() }))
		.handler(async ({ input }) => {
			const tokenRow = await getValidToken(input.token);

			// Get opportunity + lead data for pre-fill
			const [opp] = await db
				.select()
				.from(opportunities)
				.where(eq(opportunities.id, tokenRow.opportunityId))
				.limit(1);

			let lead = null;
			if (opp?.leadId) {
				const [leadRow] = await db
					.select()
					.from(leads)
					.where(eq(leads.id, opp.leadId))
					.limit(1);
				lead = leadRow ?? null;
			}

			let vehicle = null;
			if (opp?.vehicleId) {
				const [vehicleRow] = await db
					.select()
					.from(vehicles)
					.where(eq(vehicles.id, opp.vehicleId))
					.limit(1);
				vehicle = vehicleRow ?? null;
			}

			// Check if forms already exist (partial submission)
			const [existingCredit] = await db
				.select()
				.from(creditApplications)
				.where(eq(creditApplications.opportunityId, tokenRow.opportunityId))
				.limit(1);

			const [existingFinancial] = await db
				.select()
				.from(financialStatements)
				.where(eq(financialStatements.opportunityId, tokenRow.opportunityId))
				.limit(1);

			return {
				opportunityId: tokenRow.opportunityId,
				lead,
				vehicle,
				creditApplicationExists: !!existingCredit,
				creditHasSignature: !!existingCredit?.firmaImagen,
				financialStatementExists: !!existingFinancial,
				// Only return fields needed for pre-fill, not the full row
				existingCreditApplication: existingCredit
					? {
							primerNombre: existingCredit.primerNombre,
							segundoNombre: existingCredit.segundoNombre,
							primerApellido: existingCredit.primerApellido,
							segundoApellido: existingCredit.segundoApellido,
							apellidoCasada: existingCredit.apellidoCasada,
							dpi: existingCredit.dpi,
							nit: existingCredit.nit,
						}
					: null,
			};
		}),

	// Public: Submit credit application
	submitCreditApplication: publicProcedure
		.input(
			z.object({
				token: z.string().uuid(),
				data: z.record(z.unknown()),
			}),
		)
		.handler(async ({ input }) => {
			const tokenRow = await getValidToken(input.token);

			// Validate data shape (strips unknown keys)
			const parsed = creditApplicationServerSchema.safeParse(input.data);
			if (!parsed.success) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Datos de solicitud inválidos: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
				});
			}

			// Upsert credit application using validated data
			const values = {
				opportunityId: tokenRow.opportunityId,
				...sanitizeFormData(parsed.data as Record<string, unknown>),
				updatedAt: new Date(),
			};

			try {
				const [existing] = await db
					.select()
					.from(creditApplications)
					.where(eq(creditApplications.opportunityId, tokenRow.opportunityId))
					.limit(1);

				if (existing) {
					await db
						.update(creditApplications)
						.set(values)
						.where(eq(creditApplications.id, existing.id));
				} else {
					await db.insert(creditApplications).values(values);
				}

				// Track partial completion
				await db
					.update(clientFormTokens)
					.set({ creditSubmittedAt: new Date() })
					.where(eq(clientFormTokens.id, tokenRow.id));
			} catch (error) {
				console.error(
					"[submitCreditApplication] DB error for opportunity:",
					tokenRow.opportunityId,
					error,
				);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Error al guardar la solicitud de crédito",
				});
			}

			return { success: true };
		}),

	// Public: Sign credit application (add signature after submission)
	signCreditApplication: publicProcedure
		.input(
			z.object({
				token: z.string().uuid(),
				firmaImagen: z.string(),
				fechaFirma: z.string(),
				horaFirma: z.string(),
			}),
		)
		.handler(async ({ input }) => {
			const tokenRow = await getValidToken(input.token);

			try {
				const [existing] = await db
					.select()
					.from(creditApplications)
					.where(eq(creditApplications.opportunityId, tokenRow.opportunityId))
					.limit(1);

				if (!existing) {
					throw new ORPCError("NOT_FOUND", {
						message: "No se encontró la solicitud de crédito para firmar",
					});
				}

				await db
					.update(creditApplications)
					.set({
						firmaImagen: input.firmaImagen,
						fechaFirma: input.fechaFirma,
						horaFirma: input.horaFirma,
						updatedAt: new Date(),
					})
					.where(eq(creditApplications.id, existing.id));
			} catch (error) {
				if (error instanceof ORPCError) throw error;
				console.error(
					"[signCreditApplication] DB error for opportunity:",
					tokenRow.opportunityId,
					error,
				);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Error al firmar la solicitud de crédito",
				});
			}

			return { success: true };
		}),

	// Public: Submit financial statement
	submitFinancialStatement: publicProcedure
		.input(
			z.object({
				token: z.string().uuid(),
				data: z.record(z.unknown()),
			}),
		)
		.handler(async ({ input }) => {
			const tokenRow = await getValidToken(input.token);

			// Validate data shape (strips unknown keys)
			const parsed = financialStatementServerSchema.safeParse(input.data);
			if (!parsed.success) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Datos de estado patrimonial inválidos: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
				});
			}

			// Upsert financial statement using validated data
			const values = {
				opportunityId: tokenRow.opportunityId,
				...sanitizeFormData(parsed.data as Record<string, unknown>),
				updatedAt: new Date(),
			};

			try {
				const [existing] = await db
					.select()
					.from(financialStatements)
					.where(eq(financialStatements.opportunityId, tokenRow.opportunityId))
					.limit(1);

				if (existing) {
					await db
						.update(financialStatements)
						.set(values)
						.where(eq(financialStatements.id, existing.id));
				} else {
					await db.insert(financialStatements).values(values);
				}

				// Mark token as used (both forms now submitted)
				await db
					.update(clientFormTokens)
					.set({ used: true })
					.where(eq(clientFormTokens.id, tokenRow.id));
			} catch (error) {
				console.error(
					"[submitFinancialStatement] DB error for opportunity:",
					tokenRow.opportunityId,
					error,
				);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Error al guardar el estado patrimonial",
				});
			}

			return { success: true };
		}),

	// Protected: Get form data for viewing in CRM
	getClientFormData: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input }) => {
			const [creditApp] = await db
				.select()
				.from(creditApplications)
				.where(eq(creditApplications.opportunityId, input.opportunityId))
				.limit(1);

			const [financialStmt] = await db
				.select()
				.from(financialStatements)
				.where(eq(financialStatements.opportunityId, input.opportunityId))
				.limit(1);

			return {
				creditApplication: creditApp ?? null,
				financialStatement: financialStmt ?? null,
			};
		}),

	// Protected: Check if token exists for opportunity
	getFormTokenByOpportunity: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input }) => {
			const [tokenRow] = await db
				.select()
				.from(clientFormTokens)
				.where(eq(clientFormTokens.opportunityId, input.opportunityId))
				.limit(1);

			if (!tokenRow) return null;

			return {
				token: tokenRow.token,
				url: `${process.env.FRONT_URL}/formulario/${tokenRow.token}`,
				expiresAt: tokenRow.expiresAt,
				used: tokenRow.used,
			};
		}),
};
