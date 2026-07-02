import { and, eq, inArray, sql } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	investmentAuditLog,
	type investmentLeadSourceEnum,
	investmentLeads,
	investmentOpportunities,
	investmentStageHistory,
} from "../db/schema/investments";

const INVESTMENT_ROLES = [
	"investment_advisor_jr",
	"investment_advisor_sr",
	"investment_manager",
] as const;

type InvestmentLeadSource =
	(typeof investmentLeadSourceEnum.enumValues)[number];

/**
 * Obtiene el usuario con menos leads de inversión asignados
 * entre los roles de inversión (jr, sr, manager).
 */
async function getAdvisorWithFewestLeads(): Promise<string> {
	const advisors = await db
		.select({
			id: user.id,
			leadCount: sql<number>`coalesce(count(${investmentLeads.id}), 0)`.as(
				"lead_count",
			),
		})
		.from(user)
		.leftJoin(investmentLeads, eq(investmentLeads.assignedTo, user.id))
		.where(and(inArray(user.role, [...INVESTMENT_ROLES]), eq(user.assignLeads, true), eq(user.banned, false)))
		.groupBy(user.id)
		.orderBy(sql`lead_count asc`)
		.limit(1);

	if (advisors.length === 0) {
		throw new Error(
			"No hay asesores de inversión disponibles para asignar el lead",
		);
	}

	return advisors[0].id;
}

interface CreateInvestmentLeadInput {
	name: string;
	email?: string;
	phones?: string[];
	source?: InvestmentLeadSource;
	campaign?: string;
	proposedAmount?: number;
	assignedTo?: string;
	userId?: string;
	companyName?: string;
	dpi?: string;
	investmentExperience?: string;
	notes?: string;
}

export async function createInvestmentLeadWithOpportunity(
	input: CreateInvestmentLeadInput,
	performedBy: string,
) {
	const { proposedAmount, assignedTo: inputAssignedTo, ...rest } = input;
	const assignedTo = inputAssignedTo ?? performedBy;

	const [lead] = await db
		.insert(investmentLeads)
		.values({
			...rest,
			assignedTo,
			source: input.source ?? "website",
			campaign: input.campaign,
			proposedAmount: proposedAmount?.toString(),
		})
		.returning();

	// Crear oportunidad automaticamente en etapa de recoleccion de datos
	const [opportunity] = await db
		.insert(investmentOpportunities)
		.values({
			investmentLeadId: lead.id,
			assignedAdvisorId: assignedTo,
			stage: "data_collection",
			status: "open",
		})
		.returning();

	// Registrar en auditoria
	await db.insert(investmentAuditLog).values({
		investmentOpportunityId: opportunity.id,
		action: "lead_created",
		details: {
			leadId: lead.id,
			source: input.source,
			campaign: input.campaign,
		},
		performedBy,
	});

	// Registrar stage history
	await db.insert(investmentStageHistory).values({
		investmentOpportunityId: opportunity.id,
		toStage: "data_collection",
		changedBy: performedBy,
	});

	return { lead, opportunity };
}

export async function createInvestmentLeadController(c: Context) {
	try {
		const body = await c.req.json();

		if (!body.name) {
			return c.json(
				{ success: false, error: "El campo 'name' es requerido" },
				400,
			);
		}

		if (body.email) {
			const [existing] = await db
				.select()
				.from(investmentLeads)
				.where(eq(investmentLeads.email, body.email))
				.limit(1);

			if (existing) {
				return c.json(
					{ success: true, data: { lead: existing }, message: "Lead ya existe" },
					200,
				);
			}
		}

		// Asignar al asesor de inversión con menos leads
		const assignedAdvisorId = await getAdvisorWithFewestLeads();

		const result = await createInvestmentLeadWithOpportunity(
			{
				name: body.name,
				email: body.email,
				phones: body.phones
					? Array.isArray(body.phones)
						? body.phones
						: [body.phones]
					: undefined,
				source: body.source,
				campaign: body.campaign,
				proposedAmount: body.proposedAmount,
				assignedTo: assignedAdvisorId,
				userId: body.userId,
				companyName: body.companyName,
				dpi: body.dpi,
				investmentExperience: body.investmentExperience,
				notes: body.notes,
			},
			assignedAdvisorId,
		);

		return c.json({ success: true, data: result });
	} catch (error: any) {
		console.error("[ERROR] createInvestmentLeadController:", error);
		return c.json(
			{
				success: false,
				error: error.message || "Error al crear el lead de inversión",
			},
			500,
		);
	}
}
