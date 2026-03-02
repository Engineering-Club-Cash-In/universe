import { and, asc, count, eq, gte, or } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { leads, opportunities, salesStages } from "../db/schema/crm";
import { getRenapInfoController } from "./bot";

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
		.where(and(eq(user.role, "sales"), eq(user.assignLeads, true)));

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

/**
 * Encuentra al usuario de ventas con menos leads asignados.
 * Si hay empate, retorna el primero encontrado.
 * Si no hay usuarios de ventas, retorna null.
 */
export async function getSalesUserWithLeastLeads() {
	// Obtener todos los usuarios de ventas activos (no baneados)
	const salesUsers = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
		})
		.from(user)
		.where(and(eq(user.role, "sales"), eq(user.assignLeads, true)));

	if (salesUsers.length === 0) {
		return null;
	}

	// Contar leads por usuario (solo leads activos, no convertidos)
	const leadCounts = await db
		.select({
			assignedTo: leads.assignedTo,
			count: count(leads.id),
		})
		.from(leads)
		.where(
			or(
				eq(leads.status, "new"),
				eq(leads.status, "contacted"),
				eq(leads.status, "qualified"),
			),
		)
		.groupBy(leads.assignedTo);

	// Crear un mapa de conteos
	const countMap = new Map<string, number>();
	for (const lc of leadCounts) {
		if (lc.assignedTo) {
			countMap.set(lc.assignedTo, lc.count);
		}
	}

	// Encontrar el usuario de ventas con menos leads
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

/**
 * Crea una nueva oportunidad vinculada a un lead
 */
export async function createOpportunityForLead(
	leadId: string,
	firstName: string,
	lastName: string,
	systemUserId: string,
	notes = "",
	source?:
		| "website"
		| "referral"
		| "cold_call"
		| "email"
		| "social_media"
		| "event"
		| "other",
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
			loanPurpose: loanPurpose,
			creditType: creditType ?? "autocompra",
		})
		.returning();

	return newOpportunity;
}

/**
 * Verifica si un lead ya tiene una oportunidad creada en las últimas 24 horas.
 */
export async function hasRecentOpportunity(leadId: string): Promise<boolean> {
	const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
	const [recent] = await db
		.select({ id: opportunities.id })
		.from(opportunities)
		.where(
			and(
				eq(opportunities.leadId, leadId),
				gte(opportunities.createdAt, twentyFourHoursAgo),
			),
		)
		.limit(1);
	return !!recent;
}

export async function createPublicLead(c: Context) {
	try {
		const body = await c.req.json();

		if (!body.firstName || !body.lastName || !body.email) {
			return c.json(
				{
					success: false,
					error: "Faltan campos requeridos: Nombre, Apellido o Email",
				},
				400,
			);
		}

		const creditType = body.creditType || "autocompra";
		const hasDpi = !!(body.dpi && body.dpi.trim() !== "");

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
			if (body.isRegister) {
				return c.json(
					{ success: true, data: existingLead, message: "Lead ya existe" },
					200,
				);
			}

			// Verificar oportunidad reciente antes de crear una nueva
			if (await hasRecentOpportunity(existingLead.id)) {
				return c.json(
					{
						success: true,
						data: existingLead,
						message: "Lead ya tiene una oportunidad reciente (últimas 24 horas)",
					},
					200,
				);
			}

			const salesUser = await getSalesUserWithLeastOpportunities();
			if (!salesUser) {
				return c.json(
					{
						success: false,
						error: "No hay usuario de ventas disponible para asignar",
					},
					500,
				);
			}

			const opportunity = await createOpportunityForLead(
				existingLead.id,
				existingLead.firstName,
				existingLead.lastName,
				salesUser.id,
				body.notes ?? "",
				body.source || existingLead.source || "website",
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
					.set({ email: body.email, updatedAt: new Date() })
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
					data: existingLead,
					message: "Lead ya existe con el mismo email o DPI",
					opportunity,
				},
				200,
			);
		}

		// --- Lead nuevo ---
		const [salesUserForLead, salesUserForOpportunity] = await Promise.all([
			getSalesUserWithLeastLeads(),
			getSalesUserWithLeastOpportunities(),
		]);

		if (!salesUserForLead) {
			return c.json(
				{
					success: false,
					error: "No hay usuario de ventas disponible para asignar",
				},
				500,
			);
		}
		if (!salesUserForOpportunity) {
			return c.json(
				{
					success: false,
					error: "No hay usuario de ventas disponible para asignar oportunidad",
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
				status: "new",
				assignedTo: salesUserForLead.id,
				createdBy: salesUserForLead.id,
				updatedAt: new Date(),
			})
			.returning();

		// RENAP solo si tiene DPI y teléfono
		const renapInfo =
			hasDpi && body.phone
				? await getRenapInfoController(body.dpi, body.phone)
				: null;

		const opportunity = await createOpportunityForLead(
			newLead.id,
			newLead.firstName,
			newLead.lastName,
			salesUserForOpportunity.id,
			body.notes ?? "",
			body.source || "website",
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
