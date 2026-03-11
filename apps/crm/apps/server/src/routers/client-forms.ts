import { ORPCError } from "@orpc/server";
import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
	clientFormTokens,
	creditApplications,
	financialStatements,
} from "../db/schema/client-forms";
import { coDebtors, leads, opportunities } from "../db/schema/crm";
import { vehicles } from "../db/schema/vehicles";
import { crmProcedure, publicProcedure } from "../lib/orpc";

const formPersonTypeSchema = z.enum(["lead", "coDebtor"]);
type FormPersonType = z.infer<typeof formPersonTypeSchema>;

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

function personWhereClause(
	opportunityId: string,
	personType: FormPersonType,
	personId: string,
) {
	return and(
		eq(creditApplications.opportunityId, opportunityId),
		eq(creditApplications.personType, personType),
		eq(creditApplications.personId, personId),
	);
}

function financialPersonWhereClause(
	opportunityId: string,
	personType: FormPersonType,
	personId: string,
) {
	return and(
		eq(financialStatements.opportunityId, opportunityId),
		eq(financialStatements.personType, personType),
		eq(financialStatements.personId, personId),
	);
}

type TokenRow = typeof clientFormTokens.$inferSelect;
type FormRow = Record<string, unknown> | null;

async function getOpportunityOrThrow(opportunityId: string) {
	const [opp] = await db
		.select()
		.from(opportunities)
		.where(eq(opportunities.id, opportunityId))
		.limit(1);

	if (!opp) {
		throw new ORPCError("NOT_FOUND", {
			message: "Oportunidad no encontrada",
		});
	}

	return opp;
}

async function resolveParticipant(
	opportunityId: string,
	personType: FormPersonType,
	personId: string,
) {
	const opp = await getOpportunityOrThrow(opportunityId);

	if (personType === "lead") {
		if (!opp.leadId || opp.leadId !== personId) {
			throw new ORPCError("BAD_REQUEST", {
				message: "El lead no pertenece a la oportunidad",
			});
		}

		const [lead] = await db
			.select()
			.from(leads)
			.where(eq(leads.id, personId))
			.limit(1);

		if (!lead) {
			throw new ORPCError("NOT_FOUND", {
				message: "Lead no encontrado",
			});
		}

		return {
			opp,
			participantType: "lead" as const,
			participant: lead,
			displayName: [
				lead.firstName,
				lead.middleName,
				lead.lastName,
				lead.secondLastName,
			]
				.filter(Boolean)
				.join(" "),
		};
	}

	const [coDebtor] = await db
		.select()
		.from(coDebtors)
		.where(
			and(
				eq(coDebtors.id, personId),
				eq(coDebtors.opportunityId, opportunityId),
			),
		)
		.limit(1);

	if (!coDebtor) {
		throw new ORPCError("NOT_FOUND", {
			message: "Co-firmante no encontrado",
		});
	}

	return {
		opp,
		participantType: "coDebtor" as const,
		participant: coDebtor,
		displayName: coDebtor.fullName,
	};
}

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

async function resolveTokenParticipant(tokenRow: TokenRow): Promise<{
	personType: FormPersonType;
	personId: string;
} | null> {
	if (tokenRow.personType && tokenRow.personId) {
		return {
			personType: tokenRow.personType as FormPersonType,
			personId: tokenRow.personId,
		};
	}

	const opp = await getOpportunityOrThrow(tokenRow.opportunityId);
	if (!opp.leadId) return null;

	await db
		.update(clientFormTokens)
		.set({
			personType: "lead",
			personId: opp.leadId,
		})
		.where(eq(clientFormTokens.id, tokenRow.id));

	return {
		personType: "lead",
		personId: opp.leadId,
	};
}

async function getVehicleForOpportunity(opportunityId: string) {
	const [opp] = await db
		.select({ vehicleId: opportunities.vehicleId })
		.from(opportunities)
		.where(eq(opportunities.id, opportunityId))
		.limit(1);

	if (!opp?.vehicleId) return null;

	const [vehicle] = await db
		.select()
		.from(vehicles)
		.where(eq(vehicles.id, opp.vehicleId))
		.limit(1);

	return vehicle ?? null;
}

function serializeRow(row: unknown): FormRow {
	if (!row) return null;
	return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

function getParticipantNameFromForm(row: Record<string, unknown> | null): string {
	if (!row) return "";
	const fullName = [row.primerNombre, row.segundoNombre, row.primerApellido, row.segundoApellido]
		.map((value) => (typeof value === "string" ? value.trim() : ""))
		.filter(Boolean)
		.join(" ");
	return fullName;
}

export const clientFormsRouter = {
	generateFormToken: crmProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				personType: formPersonTypeSchema,
				personId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			await resolveParticipant(
				input.opportunityId,
				input.personType,
				input.personId,
			);

			const expiresAt = new Date();
			expiresAt.setDate(expiresAt.getDate() + 7);

			const [tokenRow] = await db
				.insert(clientFormTokens)
				.values({
					opportunityId: input.opportunityId,
					personType: input.personType,
					personId: input.personId,
					expiresAt,
				})
				.returning();

			return {
				token: tokenRow.token,
				url: `${process.env.FRONT_URL}/formulario/${tokenRow.token}`,
			};
		}),

	validateFormToken: publicProcedure
		.input(z.object({ token: z.string().uuid() }))
		.handler(async ({ input }) => {
			const tokenRow = await getValidToken(input.token);
			const participantRef = await resolveTokenParticipant(tokenRow);
			const vehicle = await getVehicleForOpportunity(tokenRow.opportunityId);

			const [existingCredit] = await db
				.select()
				.from(creditApplications)
				.where(
					participantRef
						? personWhereClause(
								tokenRow.opportunityId,
								participantRef.personType,
								participantRef.personId,
							)
						: eq(creditApplications.opportunityId, tokenRow.opportunityId),
				)
				.limit(1);

			const [existingFinancial] = await db
				.select()
				.from(financialStatements)
				.where(
					participantRef
						? financialPersonWhereClause(
								tokenRow.opportunityId,
								participantRef.personType,
								participantRef.personId,
							)
						: eq(financialStatements.opportunityId, tokenRow.opportunityId),
				)
				.limit(1);

			if (!participantRef) {
				const displayName =
					getParticipantNameFromForm(
						serializeRow(existingCredit ?? existingFinancial),
					) || "Titular";

				return {
					opportunityId: tokenRow.opportunityId,
					personType: "lead" as const,
					personId: null,
					personDisplayName: displayName,
					person: {
						firstName: (existingCredit?.primerNombre as string | null) ?? "",
						middleName: (existingCredit?.segundoNombre as string | null) ?? "",
						lastName: (existingCredit?.primerApellido as string | null) ?? "",
						secondLastName:
							(existingCredit?.segundoApellido as string | null) ?? "",
						dpi: (existingCredit?.dpi as string | null) ?? "",
						nit: (existingCredit?.nit as string | null) ?? "",
						email: (existingCredit?.email as string | null) ?? "",
						phone: (existingCredit?.telMovil as string | null) ?? "",
						direccion:
							(existingCredit?.direccionResidencia as string | null) ?? "",
					},
					vehicle,
					creditApplicationExists: !!existingCredit,
					creditHasSignature: !!existingCredit?.firmaImagen,
					financialStatementExists: !!existingFinancial,
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
			}

			const { participant, participantType, displayName } =
				await resolveParticipant(
					tokenRow.opportunityId,
					participantRef.personType,
					participantRef.personId,
				);

			return {
				opportunityId: tokenRow.opportunityId,
				personType: participantType,
				personId: participantRef.personId,
				personDisplayName: displayName,
				person:
					participantType === "lead"
						? {
								firstName: participant.firstName,
								middleName: participant.middleName,
								lastName: participant.lastName,
								secondLastName: participant.secondLastName,
								dpi: participant.dpi,
								nit: participant.nit,
								email: participant.email,
								phone: participant.phone,
								direccion: participant.direccion,
							}
						: {
								fullName: participant.fullName,
								dpi: participant.dpi,
								email: participant.email,
								phone: participant.phone,
							},
				vehicle,
				creditApplicationExists: !!existingCredit,
				creditHasSignature: !!existingCredit?.firmaImagen,
				financialStatementExists: !!existingFinancial,
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

	submitCreditApplication: publicProcedure
		.input(
			z.object({
				token: z.string().uuid(),
				data: z.record(z.unknown()),
			}),
		)
		.handler(async ({ input }) => {
			const tokenRow = await getValidToken(input.token);
			const participantRef = await resolveTokenParticipant(tokenRow);

			const parsed = creditApplicationServerSchema.safeParse(input.data);
			if (!parsed.success) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Datos de solicitud inválidos: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
				});
			}

			const values = {
				opportunityId: tokenRow.opportunityId,
				...(participantRef
					? {
							personType: participantRef.personType,
							personId: participantRef.personId,
						}
					: {}),
				...sanitizeFormData(parsed.data as Record<string, unknown>),
				updatedAt: new Date(),
			};

			try {
				const [existing] = await db
					.select()
					.from(creditApplications)
					.where(
						participantRef
							? personWhereClause(
									tokenRow.opportunityId,
									participantRef.personType,
									participantRef.personId,
								)
							: eq(creditApplications.opportunityId, tokenRow.opportunityId),
					)
					.limit(1);

				if (existing) {
					await db
						.update(creditApplications)
						.set(values)
						.where(eq(creditApplications.id, existing.id));
				} else {
					await db.insert(creditApplications).values(values);
				}

				await db
					.update(clientFormTokens)
					.set({ creditSubmittedAt: new Date() })
					.where(eq(clientFormTokens.id, tokenRow.id));
			} catch (error) {
				console.error(
					"[submitCreditApplication] DB error for token:",
					tokenRow.id,
					error,
				);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Error al guardar la solicitud de crédito",
				});
			}

			return { success: true };
		}),

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
			const participantRef = await resolveTokenParticipant(tokenRow);

			try {
				const [existing] = await db
					.select()
					.from(creditApplications)
					.where(
						participantRef
							? personWhereClause(
									tokenRow.opportunityId,
									participantRef.personType,
									participantRef.personId,
								)
							: eq(creditApplications.opportunityId, tokenRow.opportunityId),
					)
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
					"[signCreditApplication] DB error for token:",
					tokenRow.id,
					error,
				);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Error al firmar la solicitud de crédito",
				});
			}

			return { success: true };
		}),

	submitFinancialStatement: publicProcedure
		.input(
			z.object({
				token: z.string().uuid(),
				data: z.record(z.unknown()),
			}),
		)
		.handler(async ({ input }) => {
			const tokenRow = await getValidToken(input.token);
			const participantRef = await resolveTokenParticipant(tokenRow);

			const parsed = financialStatementServerSchema.safeParse(input.data);
			if (!parsed.success) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Datos de estado patrimonial inválidos: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
				});
			}

			const values = {
				opportunityId: tokenRow.opportunityId,
				...(participantRef
					? {
							personType: participantRef.personType,
							personId: participantRef.personId,
						}
					: {}),
				...sanitizeFormData(parsed.data as Record<string, unknown>),
				updatedAt: new Date(),
			};

			try {
				const [existing] = await db
					.select()
					.from(financialStatements)
					.where(
						participantRef
							? financialPersonWhereClause(
									tokenRow.opportunityId,
									participantRef.personType,
									participantRef.personId,
								)
							: eq(financialStatements.opportunityId, tokenRow.opportunityId),
					)
					.limit(1);

				if (existing) {
					await db
						.update(financialStatements)
						.set(values)
						.where(eq(financialStatements.id, existing.id));
				} else {
					await db.insert(financialStatements).values(values);
				}

				await db
					.update(clientFormTokens)
					.set({ used: true })
					.where(eq(clientFormTokens.id, tokenRow.id));
			} catch (error) {
				console.error(
					"[submitFinancialStatement] DB error for token:",
					tokenRow.id,
					error,
				);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Error al guardar el estado patrimonial",
				});
			}

			return { success: true };
		}),

	getClientFormData: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input }) => {
			const opp = await getOpportunityOrThrow(input.opportunityId);
			const vehicle = await getVehicleForOpportunity(input.opportunityId);

			const [lead] = opp.leadId
				? await db
						.select()
						.from(leads)
						.where(eq(leads.id, opp.leadId))
						.limit(1)
				: [null];

			const coDebtorsList = await db
				.select()
				.from(coDebtors)
				.where(eq(coDebtors.opportunityId, input.opportunityId))
				.orderBy(coDebtors.createdAt);

			const tokenRows = await db
				.select()
				.from(clientFormTokens)
				.where(eq(clientFormTokens.opportunityId, input.opportunityId))
				.orderBy(desc(clientFormTokens.createdAt));

			const creditRows = await db
				.select()
				.from(creditApplications)
				.where(eq(creditApplications.opportunityId, input.opportunityId));

			const financialRows = await db
				.select()
				.from(financialStatements)
				.where(eq(financialStatements.opportunityId, input.opportunityId));

			const latestTokens = new Map<string, TokenRow>();
			for (const tokenRow of tokenRows) {
				const key =
					tokenRow.personType && tokenRow.personId
						? `${tokenRow.personType}:${tokenRow.personId}`
						: `legacy:${tokenRow.opportunityId}`;
				if (!latestTokens.has(key)) {
					latestTokens.set(key, tokenRow);
				}
			}

			const creditByPerson = new Map(
				creditRows.map((row) => [
					row.personType && row.personId
						? `${row.personType}:${row.personId}`
						: `legacy:${row.opportunityId}`,
					row,
				]),
			);
			const financialByPerson = new Map(
				financialRows.map((row) => [
					row.personType && row.personId
						? `${row.personType}:${row.personId}`
						: `legacy:${row.opportunityId}`,
					row,
				]),
			);
			const participantMap = new Map<
				string,
				{
					personType: "lead" | "coDebtor";
					personId: string;
					displayName: string;
					roleLabel: string;
					email: string | null;
					phone: string | null;
					canGenerateLink: boolean;
				}
			>();

			if (lead) {
				participantMap.set(`lead:${lead.id}`, {
					personType: "lead",
					personId: lead.id,
					displayName: [
						lead.firstName,
						lead.middleName,
						lead.lastName,
						lead.secondLastName,
					]
						.filter(Boolean)
						.join(" "),
					roleLabel: "Titular",
					email: lead.email,
					phone: lead.phone,
					canGenerateLink: true,
				});
			}

			for (const [index, coDebtor] of coDebtorsList.entries()) {
				participantMap.set(`coDebtor:${coDebtor.id}`, {
					personType: "coDebtor",
					personId: coDebtor.id,
					displayName: coDebtor.fullName,
					roleLabel: `Co-firmante ${index + 1}`,
					email: coDebtor.email,
					phone: coDebtor.phone,
					canGenerateLink: true,
				});
			}

			for (const tokenRow of tokenRows) {
				if (!tokenRow.personType || !tokenRow.personId) continue;
				const key = `${tokenRow.personType}:${tokenRow.personId}`;
				if (participantMap.has(key)) continue;
				const creditApp = serializeRow(creditByPerson.get(key) ?? null);
				const financialStmt = serializeRow(financialByPerson.get(key) ?? null);
				participantMap.set(key, {
					personType: tokenRow.personType as "lead" | "coDebtor",
					personId: tokenRow.personId,
					displayName:
						getParticipantNameFromForm(creditApp) ||
						getParticipantNameFromForm(financialStmt) ||
						(tokenRow.personType === "lead"
							? "Titular historico"
							: "Co-firmante historico"),
					roleLabel:
						tokenRow.personType === "lead"
							? "Titular historico"
							: "Co-firmante historico",
					email:
						(typeof creditApp?.email === "string" ? creditApp.email : null) ?? null,
					phone:
						(typeof creditApp?.telMovil === "string"
							? creditApp.telMovil
							: null) ?? null,
					canGenerateLink: false,
				});
			}

			if (
				latestTokens.has(`legacy:${input.opportunityId}`) ||
				creditByPerson.has(`legacy:${input.opportunityId}`) ||
				financialByPerson.has(`legacy:${input.opportunityId}`)
			) {
				const creditApp = serializeRow(
					creditByPerson.get(`legacy:${input.opportunityId}`) ?? null,
				);
				const financialStmt = serializeRow(
					financialByPerson.get(`legacy:${input.opportunityId}`) ?? null,
				);
				participantMap.set(`legacy:${input.opportunityId}`, {
					personType: "lead",
					personId: `legacy:${input.opportunityId}`,
					displayName:
						getParticipantNameFromForm(creditApp) ||
						getParticipantNameFromForm(financialStmt) ||
						"Titular legacy",
					roleLabel: "Titular legacy",
					email:
						(typeof creditApp?.email === "string" ? creditApp.email : null) ?? null,
					phone:
						(typeof creditApp?.telMovil === "string"
							? creditApp.telMovil
							: null) ?? null,
					canGenerateLink: false,
				});
			}

			const participants = Array.from(participantMap.entries()).map(
				([key, participant]) => {
					const latestToken = latestTokens.get(key) ?? null;
					const creditApp = creditByPerson.get(key) ?? null;
					const financialStmt = financialByPerson.get(key) ?? null;

					return {
						...participant,
						latestToken: latestToken
							? {
									token: latestToken.token,
									url: `${process.env.FRONT_URL}/formulario/${latestToken.token}`,
									expiresAt: latestToken.expiresAt,
									used: latestToken.used,
									createdAt: latestToken.createdAt,
								}
							: null,
						creditApplication: serializeRow(creditApp),
						financialStatement: serializeRow(financialStmt),
						creditApplicationExists: !!creditApp,
						creditHasSignature: !!creditApp?.firmaImagen,
						financialStatementExists: !!financialStmt,
					};
				},
			);

			return {
				opportunityId: input.opportunityId,
				vehicle,
				participants,
			};
		}),

	getFormTokenByOpportunity: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input }) => {
			const tokenRows = await db
				.select()
				.from(clientFormTokens)
				.where(eq(clientFormTokens.opportunityId, input.opportunityId))
				.orderBy(desc(clientFormTokens.createdAt));

			const latestTokens = new Map<string, TokenRow>();
			for (const tokenRow of tokenRows) {
				const key = `${tokenRow.personType}:${tokenRow.personId}`;
				if (!latestTokens.has(key)) {
					latestTokens.set(key, tokenRow);
				}
			}

			return Array.from(latestTokens.values()).map((tokenRow) => ({
				personType: tokenRow.personType,
				personId: tokenRow.personId,
				url: `${process.env.FRONT_URL}/formulario/${tokenRow.token}`,
				expiresAt: tokenRow.expiresAt,
				used: tokenRow.used,
			}));
		}),
};
