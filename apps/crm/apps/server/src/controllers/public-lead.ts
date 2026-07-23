import { and, asc, count, eq, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	type leadSourceEnum,
	leads,
	opportunities,
	salesStages,
} from "../db/schema/crm";
import { leadIntakeAnswers } from "../db/schema/lead-intake";
import {
	findSalesUserWithLeastAutoAssignedLeads,
	resolveExistingLeadAssigneeFromDatabase,
} from "../lib/lead-assignment";
import { getPublicLeadExistingOpportunityUpdates } from "../lib/lead-helpers";
import { getOpenOpportunityBySource } from "../lib/lead-opportunity";
import { validarDpi } from "../utils/cui-validation";
import { getOnlyRenapInfoController } from "./bot";

type LeadSource = (typeof leadSourceEnum.enumValues)[number];

// Rate limit en memoria por IP para leads públicos sin token. No sobrevive restart ni
// escala entre instancias, pero basta para frenar abuso casual.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_CLEANUP_EVERY_N_CALLS = 500;
const rateLimitBuckets = new Map<string, { count: number; windowStart: number }>();
let rateLimitCallCount = 0;

function cleanupExpiredBuckets() {
	const now = Date.now();
	for (const [ip, bucket] of rateLimitBuckets) {
		if (now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
			rateLimitBuckets.delete(ip);
		}
	}
}

function isRateLimited(ip: string): boolean {
	rateLimitCallCount += 1;
	if (rateLimitCallCount % RATE_LIMIT_CLEANUP_EVERY_N_CALLS === 0) {
		cleanupExpiredBuckets();
	}

	const now = Date.now();
	const bucket = rateLimitBuckets.get(ip);

	if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
		rateLimitBuckets.set(ip, { count: 1, windowStart: now });
		return false;
	}

	bucket.count += 1;
	return bucket.count > RATE_LIMIT_MAX_REQUESTS;
}

function getClientIp(c: Context): string {
	return (
		c.req.header("cf-connecting-ip") ||
		c.req.header("x-forwarded-for") ||
		"unknown"
	);
}

/**
 * Creación básica de lead: pública, solo para el origen de portal-web y con rate limit
 * por IP (comportamiento de siempre, ahora con esa validación de dominio agregada).
 * campaignFormKey/intakeAnswers (Make) sí exige "Authorization: Bearer <secret>".
 */
export async function validatePublicLeadToken(
	c: Context,
	next: () => Promise<void>,
) {
	const authHeader = c.req.header("Authorization");

	if (authHeader) {
		const secret = process.env.BETTER_SECRET_PUBLIC_LEAD;

		if (!secret) {
			console.error("[ERROR] BETTER_SECRET_PUBLIC_LEAD not configured");
			return c.json(
				{ success: false, error: "Configuración de autorización no disponible" },
				500,
			);
		}

		if (authHeader !== `Bearer ${secret}`) {
			return c.json({ success: false, error: "No autorizado" }, 401);
		}

		await next();
		return;
	}

	const body = await c.req.json().catch(() => null);
	const hasBody = typeof body === "object" && body !== null;

	if (hasBody && body.intakeAnswers) {
		return c.json(
			{
				success: false,
				error: "Se requiere autenticación para enviar datos de formulario de captación",
			},
			401,
		);
	}

	const origin = c.req.header("origin") || "";
	const isLocalDev =
		origin.startsWith("http://localhost:") ||
		origin.startsWith("http://127.0.0.1:");
	const allowedOrigin = process.env.PORTAL_WEB_ORIGIN;

	if (!isLocalDev && (!allowedOrigin || origin !== allowedOrigin)) {
		return c.json({ success: false, error: "Origen no permitido" }, 403);
	}

	if (isRateLimited(getClientIp(c))) {
		return c.json(
			{ success: false, error: "Demasiadas solicitudes, intenta más tarde" },
			429,
		);
	}

	await next();
}

type IntakeAnswer = { fieldKey: string; fieldValue?: string | null };

// Campos/valores válidos por formulario (campaignFormKey) — única barrera de validación,
// ya que la tabla es llave-valor sin tipos. Reutiliza un fieldKey entre formularios solo si
// es el mismo concepto; si no, dale uno propio. Rangos de presupuesto/ingreso son
// provisionales hasta confirmar las opciones reales del formulario de Meta.
const INTAKE_FORM_FIELDS: Record<string, Record<string, string[]>> = {
	credito_filtro_julio2026: {
		vehicle_condition: ["nuevo", "usado", "no_seguro"],
		budget_range: [
			"Menos de Q30,000",
			"Q30,000 - Q50,000",
			"Q50,000 - Q80,000",
			"Q80,000 - Q120,000",
			"Q120,000 - Q180,000",
			"Q180,000 o más",
		],
		income_range: [
			"Menos de Q4,000",
			"Q4,000 - Q6,000",
			"Q6,000 - Q8,000",
			"Q8,000 - Q12,000",
			"Q12,000 - Q18,000",
			"Q18,000 o más",
		],
	},
};

export function validateIntakeAnswers(
	campaignFormKey: string,
	answers: IntakeAnswer[],
): string | null {
	const allowedFields = INTAKE_FORM_FIELDS[campaignFormKey];

	if (!allowedFields) {
		return `campaignFormKey no reconocido: ${campaignFormKey}`;
	}

	const seenFieldKeys = new Set<string>();

	for (const answer of answers) {
		if (seenFieldKeys.has(answer.fieldKey)) {
			return `Campo duplicado: ${answer.fieldKey}`;
		}
		seenFieldKeys.add(answer.fieldKey);

		const allowedValues = allowedFields[answer.fieldKey];

		if (!allowedValues) {
			return `El campo "${answer.fieldKey}" no pertenece al formulario "${campaignFormKey}"`;
		}

		if (answer.fieldValue && !allowedValues.includes(answer.fieldValue)) {
			return `Valor no válido para ${answer.fieldKey}: ${answer.fieldValue}`;
		}
	}

	return null;
}

/**
 * Guarda las respuestas de un formulario de captación (ej. Meta Instant Forms) en formato
 * llave-valor, sin requerir migración cuando se agregue una pregunta nueva al formulario.
 * campaignFormKey identifica de qué campaña/formulario vienen, para que dos formularios
 * distintos puedan reusar el mismo fieldKey sin pisarse entre sí.
 */
async function upsertIntakeAnswers(
	leadId: string,
	campaignFormKey: string,
	answers: IntakeAnswer[],
) {
	if (!campaignFormKey || !Array.isArray(answers) || answers.length === 0) {
		return;
	}

	const rows = answers
		.filter((a) => a && a.fieldKey)
		.map((a) => ({
			leadId,
			campaignFormKey,
			fieldKey: a.fieldKey,
			fieldValue: a.fieldValue ?? null,
		}));

	if (rows.length === 0) return;

	// Todo o nada: las respuestas de un mismo envío se guardan juntas o ninguna se guarda.
	await db.transaction(async (tx) => {
		await tx
			.insert(leadIntakeAnswers)
			.values(rows)
			.onConflictDoUpdate({
				target: [
					leadIntakeAnswers.leadId,
					leadIntakeAnswers.campaignFormKey,
					leadIntakeAnswers.fieldKey,
				],
				set: {
					fieldValue: sql`excluded.field_value`,
					updatedAt: new Date(),
				},
			});
	});
}

/**
 * Encuentra al usuario de ventas con menos oportunidades asignadas.
 * Si hay empate, retorna el primero encontrado.
 * Si no hay usuarios de ventas, retorna null.
 */
export async function getSalesUserWithLeastOpportunities() {
	// Obtener todos los usuarios de ventas activos (no baneados)
	const salesUsers = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
		})
		.from(user)
		.where(
			and(
				eq(user.role, "sales"),
				eq(user.assignLeads, true),
				eq(user.banned, false),
			),
		);

	if (salesUsers.length === 0) {
		return null;
	}

	// Contar oportunidades por usuario
	const opportunityCounts = await db
		.select({
			assignedTo: opportunities.assignedTo,
			count: count(opportunities.id),
		})
		.from(opportunities)
		.where(eq(opportunities.status, "open"))
		.groupBy(opportunities.assignedTo);

	// Crear un mapa de conteos
	const countMap = new Map<string, number>();
	for (const oc of opportunityCounts) {
		if (oc.assignedTo) {
			countMap.set(oc.assignedTo, oc.count);
		}
	}

	// Encontrar el usuario de ventas con menos oportunidades
	let minUser = salesUsers[0];
	let minCount = countMap.get(minUser.id) ?? 0;

	for (const salesUser of salesUsers) {
		const userCount = countMap.get(salesUser.id) ?? 0;
		if (userCount < minCount) {
			minCount = userCount;
			minUser = salesUser;
		}
	}

	return minUser;
}

export {
	findSalesUserWithLeastAutoAssignedLeads as getSalesUserWithLeastLeads,
};

/**
 * Crea una nueva oportunidad vinculada a un lead
 */
export async function createOpportunityForLead(
	leadId: string,
	firstName: string,
	lastName: string,
	systemUserId: string,
	notes = "",
	source?: LeadSource,
	campaign?: string,
	loanPurpose?: "personal" | "business",
	creditType?: "autocompra" | "sobre_vehiculo",
) {
	const [firstStage] = await db
		.select()
		.from(salesStages)
		.orderBy(asc(salesStages.order))
		.limit(1);

	if (!firstStage) {
		throw new Error("[ERROR] No sales stage found");
	}

	const [newOpportunity] = await db
		.insert(opportunities)
		.values({
			leadId: leadId,
			status: "open",
			probability: 0,
			stageId: firstStage.id,
			title: `Oportunidad de crédito para ${firstName} ${lastName}`,
			companyId: undefined,
			assignedTo: systemUserId,
			createdBy: systemUserId,
			createdAt: new Date(),
			updatedAt: new Date(),
			notes: notes,
			source: source,
			campaign,
			loanPurpose: loanPurpose,
			creditType: creditType ?? "autocompra",
		})
		.returning();

	return newOpportunity;
}

export async function createPublicLead(c: Context) {
	try {
		const body = await c.req.json();

		if (!body.firstName && body.fullName) {
			const parts = (body.fullName as string).trim().split(/\s+/);
			body.firstName = parts[0] ?? "";
			body.lastName = parts.slice(1).join(" ") || parts[0] || "";
		}

		if (!body.firstName || !body.lastName || !body.email) {
			return c.json(
				{
					success: false,
					error: "Faltan campos requeridos: Nombre, Apellido o Email",
				},
				400,
			);
		}

		if (body.intakeAnswers) {
			if (!Array.isArray(body.intakeAnswers)) {
				return c.json(
					{ success: false, error: "intakeAnswers debe ser un arreglo" },
					400,
				);
			}
			if (!body.campaignFormKey) {
				return c.json(
					{
						success: false,
						error: "campaignFormKey es requerido cuando se envían intakeAnswers",
					},
					400,
				);
			}
			const intakeError = validateIntakeAnswers(
				body.campaignFormKey,
				body.intakeAnswers,
			);
			if (intakeError) {
				return c.json({ success: false, error: intakeError }, 400);
			}
		}

		const creditType = body.creditType || "autocompra";
		const hasDpi = !!(body.dpi && body.dpi.trim() !== "");

		if (hasDpi) {
			const resultadoDpi = validarDpi(body.dpi);
			if (!resultadoDpi.valid) {
				return c.json({ success: false, error: resultadoDpi.error }, 400);
			}
			body.dpi = resultadoDpi.dpiLimpio;
		}

		// Buscar lead existente: por email+DPI si hay DPI, solo por email si no
		const whereClause = hasDpi
			? or(eq(leads.email, body.email), eq(leads.dpi, body.dpi))
			: eq(leads.email, body.email);

		const [existingLead] = await db
			.select()
			.from(leads)
			.where(whereClause)
			.limit(1);

		// --- Lead existente ---
		if (existingLead) {
			const source = body.source || existingLead.source || "website";
			const campaign = body.campaign || existingLead.campaign || undefined;
			let leadData = existingLead;

			if (body.isRegister) {
				return c.json(
					{ success: true, data: existingLead, message: "Lead ya existe" },
					200,
				);
			}

			if (body.campaignFormKey && body.intakeAnswers) {
				await upsertIntakeAnswers(
					existingLead.id,
					body.campaignFormKey,
					body.intakeAnswers,
				);
			}

			if (body.source || body.campaign) {
				[leadData] = await db
					.update(leads)
					.set({
						source,
						campaign,
						updatedAt: new Date(),
					})
					.where(eq(leads.id, existingLead.id))
					.returning();
			}

			// Verificar si ya tiene una oportunidad abierta con el mismo source
			const existingOpportunity = await getOpenOpportunityBySource(
				existingLead.id,
				source,
			);
			if (existingOpportunity) {
				const opportunityUpdates = getPublicLeadExistingOpportunityUpdates(
					existingOpportunity,
					{
						campaign: body.campaign,
						creditType,
					},
				);

				if (Object.keys(opportunityUpdates).length > 0) {
					await db
						.update(opportunities)
						.set({
							...opportunityUpdates,
							updatedAt: new Date(),
						})
						.where(eq(opportunities.id, existingOpportunity.id));
				}

				return c.json(
					{
						success: true,
						data: leadData,
						message:
							"Lead ya tiene una oportunidad abierta con el mismo source",
					},
					200,
				);
			}

			const assignedTo = await resolveExistingLeadAssigneeFromDatabase(
				existingLead.assignedTo,
			);

			if (!assignedTo) {
				return c.json(
					{
						success: false,
						error: "No hay usuario de ventas disponible para asignar",
					},
					500,
				);
			}

			if (assignedTo !== existingLead.assignedTo) {
				[leadData] = await db
					.update(leads)
					.set({
						assignedTo,
						assignmentType: "auto",
						updatedAt: new Date(),
					})
					.where(eq(leads.id, existingLead.id))
					.returning();
			}

			const opportunity = await createOpportunityForLead(
				existingLead.id,
				existingLead.firstName,
				existingLead.lastName,
				assignedTo,
				body.notes ?? "",
				source,
				campaign,
				body.loanPurpose,
				creditType,
			);

			// Si se encontró por DPI y no tenía email, actualizarlo
			if (
				hasDpi &&
				existingLead.dpi === body.dpi &&
				(!existingLead.email || existingLead.email.trim() === "")
			) {
				const [updatedLead] = await db
					.update(leads)
					.set({
						email: body.email,
						source,
						campaign,
						updatedAt: new Date(),
					})
					.where(eq(leads.id, existingLead.id))
					.returning();

				return c.json(
					{
						success: true,
						data: updatedLead,
						message: "Lead encontrado por DPI, email actualizado",
						opportunity,
					},
					200,
				);
			}

			return c.json(
				{
					success: true,
					data: leadData,
					message: "Lead ya existe con el mismo email o DPI",
					opportunity,
				},
				200,
			);
		}

		// --- Lead nuevo: mismo asesor para lead y oportunidad ---
		const salesUserForLead = await findSalesUserWithLeastAutoAssignedLeads();

		if (!salesUserForLead) {
			return c.json(
				{
					success: false,
					error: "No hay usuario de ventas disponible para asignar",
				},
				500,
			);
		}

		const [newLead] = await db
			.insert(leads)
			.values({
				firstName: body.firstName,
				lastName: body.lastName,
				email: body.email,
				phone: body.phone,
				age: body.age,
				dpi: hasDpi ? body.dpi : null,
				clientType: body.clientType || "individual",
				maritalStatus: body.maritalStatus,
				dependents: body.dependents ?? 0,
				monthlyIncome: body.monthlyIncome?.toString(),
				loanAmount: body.loanAmount?.toString(),
				occupation: body.occupation,
				workTime: body.workTime,
				ownsHome: body.ownsHome ?? false,
				ownsVehicle: body.ownsVehicle ?? false,
				hasCreditCard: body.hasCreditCard ?? false,
				jobTitle: body.jobTitle,
				notes: body.notes,
				source: body.source || "website",
				campaign: body.campaign,
				status: "new",
				assignmentType: "auto",
				assignedTo: salesUserForLead.id,
				createdBy: salesUserForLead.id,
				updatedAt: new Date(),
			})
			.returning();

		if (body.campaignFormKey && body.intakeAnswers) {
			await upsertIntakeAnswers(
				newLead.id,
				body.campaignFormKey,
				body.intakeAnswers,
			);
		}

		// RENAP solo si tiene DPI y teléfono
		const renapInfo = hasDpi
			? await getOnlyRenapInfoController(body.dpi)
			: null;

		const opportunity = await createOpportunityForLead(
			newLead.id,
			newLead.firstName,
			newLead.lastName,
			salesUserForLead.id,
			body.notes ?? "",
			body.source || "website",
			body.campaign,
			body.loanPurpose,
			creditType,
		);

		return c.json({ success: true, data: newLead, renapInfo, opportunity });
	} catch (error: any) {
		console.error("[ERROR] createPublicLead:", error);
		return c.json(
			{ success: false, error: error.message || "Error al crear el lead" },
			500,
		);
	}
}
