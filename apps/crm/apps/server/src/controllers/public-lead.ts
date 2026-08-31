import { and, asc, count, eq, not, or } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db";
import { auditRecord } from "../lib/audit";
import { user } from "../db/schema/auth";
import {
	type leadSourceEnum,
	leads,
	opportunities,
	salesStages,
} from "../db/schema/crm";
import { eqDpi } from "../lib/dpi-lookup";
import {
	findSalesUserWithLeastAutoAssignedLeads,
	resolveExistingLeadAssigneeFromDatabase,
} from "../lib/lead-assignment";
import { getPublicLeadExistingOpportunityUpdates } from "../lib/lead-helpers";
import { getActiveOpportunities } from "../lib/lead-opportunity";
import { isOpportunityFromSource } from "../lib/lead-opportunity-source";
import { validarDpi } from "../utils/cui-validation";
import { getOnlyRenapInfoController } from "./bot";

type LeadSource = (typeof leadSourceEnum.enumValues)[number];

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

	auditRecord({
		entity: "opportunity",
		id: newOpportunity.id,
		action: "create",
		data: { leadId, source, campaign, creditType, assignedTo: systemUserId },
	});

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
			? or(eq(leads.email, body.email), eqDpi(leads.dpi, body.dpi))
			: eq(leads.email, body.email);

		// Se traen TODAS las filas que empataron, no una sola: mientras queden
		// leads duplicados sin depurar, el proceso en curso puede estar colgado de
		// cualquiera de ellas. Se trabaja sobre el lead que sostiene ese proceso y,
		// si no hay ninguno, sobre el más antiguo, que arrastra el historial.
		const matchingLeads = await db
			.select()
			.from(leads)
			.where(whereClause)
			.orderBy(asc(leads.createdAt));

		const activeOpportunities = await getActiveOpportunities(
			matchingLeads.map((lead) => lead.id),
		);

		const activeOpportunity = activeOpportunities[0];

		const existingLead =
			matchingLeads.find((lead) => lead.id === activeOpportunity?.leadId) ??
			matchingLeads[0];

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

			// Un cliente que ya está siendo atendido no vuelve a la ruleta ni estrena
			// oportunidad por entrar de nuevo. Antes esto solo se respetaba cuando la
			// oportunidad abierta era del mismo canal, y por eso una re-entrada por
			// otro canal le quitaba el lead al asesor cada vez que el dueño actual
			// tenía `assign_leads = false`, aunque llevara días trabajando el caso.
			if (activeOpportunity) {
				// ¿Alguno de los procesos vivos es del canal por el que acaba de
				// entrar? Se busca sobre todos, no solo sobre los del lead elegido:
				// con filas duplicadas el proceso del canal entrante puede estar
				// colgado de otra. Y cada oportunidad legacy (sin source) se clasifica
				// con el canal de SU lead, que es el que le corresponde.
				const leadById = new Map(
					matchingLeads.map((lead) => [lead.id, lead] as const),
				);

				const leadOf = (opportunity: { leadId: string | null }) =>
					(opportunity.leadId && leadById.get(opportunity.leadId)) ||
					existingLead;

				const sameSourceOpportunity = activeOpportunities.find((opportunity) =>
					isOpportunityFromSource(
						opportunity.source,
						source,
						leadOf(opportunity).source,
					),
				);

				if (sameSourceOpportunity) {
					const opportunityUpdates = getPublicLeadExistingOpportunityUpdates(
						sameSourceOpportunity,
						{
							campaign: body.campaign,
							creditType,
						},
					);

					if (Object.keys(opportunityUpdates).length > 0) {
						// `opportunityUpdates` puede traer `creditType`, que es campo
						// congelado. La oportunidad se eligió entre las abiertas, pero
						// entre esa lectura y este UPDATE `closeOpportunity` puede
						// haberla marcado ganada: el predicado lo exige en la misma
						// sentencia, como en `updateOpportunity`.
						const actualizadas = await db
							.update(opportunities)
							.set({
								...opportunityUpdates,
								updatedAt: new Date(),
							})
							.where(
								and(
									eq(opportunities.id, sameSourceOpportunity.id),
									not(eq(opportunities.status, "won")),
								),
							)
							.returning({ id: opportunities.id });

						if (actualizadas.length > 0) {
							auditRecord({
								entity: "opportunity",
								id: sameSourceOpportunity.id,
								action: "update",
								data: opportunityUpdates,
							});
						} else {
							// No es un error del formulario: el proceso ya se cerró
							// mientras tanto y sus datos quedaron fijados.
							console.log(
								`[PublicLead] Oportunidad ${sameSourceOpportunity.id} ya está ganada; no se actualiza`,
							);
						}
					}

					// La campaña sí se sincroniza cuando la re-entrada es del mismo
					// canal: es la atribución del proceso que ya está abierto, y
					// `createOpportunity` la copia del lead cuando se crea una
					// oportunidad sin campaña explícita. Se escribe en el lead dueño de
					// esa oportunidad, que con filas duplicadas no siempre es el que se
					// eligió arriba. El `source` no se toca (ver abajo); si la re-entrada
					// es de otro canal, la campaña tampoco, porque pertenece a un toque
					// que no se está registrando.
					const opportunityLead = leadOf(sameSourceOpportunity);

					if (body.campaign && body.campaign !== opportunityLead.campaign) {
						const [syncedLead] = await db
							.update(leads)
							.set({ campaign: body.campaign, updatedAt: new Date() })
							.where(eq(leads.id, opportunityLead.id))
							.returning();
						auditRecord({
							entity: "lead",
							id: opportunityLead.id,
							action: "update",
							data: { campaign: body.campaign },
						});

						if (syncedLead?.id === existingLead.id) {
							leadData = syncedLead;
						}
					}
				}

				// El correo sí se sincroniza aunque la re-entrada no cree oportunidad:
				// es dato de contacto del cliente, no atribución ni asignación, y el
				// bloque que lo hacía más abajo ya no se alcanza desde acá.
				if (
					hasDpi &&
					existingLead.dpi === body.dpi &&
					(!existingLead.email || existingLead.email.trim() === "")
				) {
					[leadData] = await db
						.update(leads)
						.set({ email: body.email, updatedAt: new Date() })
						.where(eq(leads.id, existingLead.id))
						.returning();
					auditRecord({
						entity: "lead",
						id: existingLead.id,
						action: "update",
						data: { email: body.email },
					});
				}

				// De `leads` no se toca nada más: `source` es lo que clasifica a las
				// oportunidades legacy sin source, así que pisarlo con el canal de una
				// re-entrada que se está rechazando haría que la próxima entrada por
				// ese canal se lleve por delante el proceso de otro canal.
				return c.json(
					{
						success: true,
						data: leadData,
						message: sameSourceOpportunity
							? "Lead ya tiene una oportunidad abierta con el mismo source"
							: "Lead ya tiene un proceso activo con su asesor; no se creó una oportunidad nueva",
					},
					200,
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
				auditRecord({
					entity: "lead",
					id: existingLead.id,
					action: "update",
					data: { source, campaign },
				});
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
				// Reasignación por ruleta: es de lo que más se reclama y hasta ahora
				// no dejaba rastro en ningún lado.
				auditRecord({
					entity: "lead",
					id: existingLead.id,
					action: "reassign",
					data: { assignedTo, motivo: "reingreso_formulario_publico" },
				});
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
				auditRecord({
					entity: "lead",
					id: existingLead.id,
					action: "update",
					data: { email: body.email, source, campaign },
				});

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
		auditRecord({
			entity: "lead",
			id: newLead.id,
			action: "create",
			data: body,
		});

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
