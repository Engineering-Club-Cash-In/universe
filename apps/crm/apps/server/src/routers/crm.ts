import { and, count, eq, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	activities,
	clients,
	companies,
	creditAnalysis,
	leads,
	opportunities,
	opportunityStageHistory,
	salesStages,
} from "../db/schema/crm";
import { adminProcedure, analystProcedure, crmProcedure } from "../lib/orpc";

export const crmRouter = {
	// Sales Stages (read-only for all CRM users)
	getSalesStages: crmProcedure.handler(async ({ context }) => {
		const stages = await db
			.select()
			.from(salesStages)
			.orderBy(salesStages.order);
		return stages;
	}),

	// Companies
	getCompanies: crmProcedure.handler(async ({ context }) => {
		// Admin can see all companies, sales can only see companies they created or are assigned to
		if (context.userRole === "admin") {
			return await db.select().from(companies).orderBy(companies.createdAt);
		}
		return await db
			.select()
			.from(companies)
			.where(eq(companies.createdBy, context.userId))
			.orderBy(companies.createdAt);
	}),

	createCompany: crmProcedure
		.input(
			z.object({
				name: z.string().min(1, "Company name is required"),
				industry: z.string().optional(),
				size: z.string().optional(),
				website: z.string().optional(),
				address: z.string().optional(),
				phone: z.string().optional(),
				email: z.string().email().optional(),
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const newCompany = await db
				.insert(companies)
				.values({
					...input,
					createdBy: context.userId,
					updatedAt: new Date(),
				})
				.returning();
			return newCompany[0];
		}),

	updateCompany: crmProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				name: z.string().min(1, "Company name is required").optional(),
				industry: z.string().optional(),
				size: z.string().optional(),
				website: z.string().optional(),
				address: z.string().optional(),
				phone: z.string().optional(),
				email: z.string().email().optional(),
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const { id, ...updateData } = input;

			// Sales users can only update companies they created
			const whereClause =
				context.userRole === "admin"
					? eq(companies.id, id)
					: and(eq(companies.id, id), eq(companies.createdBy, context.userId));

			const updatedCompany = await db
				.update(companies)
				.set({ ...updateData, updatedAt: new Date() })
				.where(whereClause)
				.returning();

			if (updatedCompany.length === 0) {
				throw new Error(
					"Company not found or you don't have permission to update it",
				);
			}

			return updatedCompany[0];
		}),

	// Leads
	getLeads: crmProcedure.handler(async ({ context }) => {
		// Admin can see all leads, sales can only see leads assigned to them
		if (context.userRole === "admin") {
			return await db
				.select({
					id: leads.id,
					firstName: leads.firstName,
					lastName: leads.lastName,
					email: leads.email,
					phone: leads.phone,
					age: leads.age,
					dpi: leads.dpi,
					maritalStatus: leads.maritalStatus,
					dependents: leads.dependents,
					monthlyIncome: leads.monthlyIncome,
					loanAmount: leads.loanAmount,
					occupation: leads.occupation,
					workTime: leads.workTime,
					loanPurpose: leads.loanPurpose,
					ownsHome: leads.ownsHome,
					ownsVehicle: leads.ownsVehicle,
					hasCreditCard: leads.hasCreditCard,
					jobTitle: leads.jobTitle,
					source: leads.source,
					status: leads.status,
					assignedTo: leads.assignedTo,
					notes: leads.notes,
					score: leads.score,
					fit: leads.fit,
					scoredAt: leads.scoredAt,
					createdAt: leads.createdAt,
					updatedAt: leads.updatedAt,
					company: {
						id: companies.id,
						name: companies.name,
					},
					assignedUser: {
						id: user.id,
						name: user.name,
					},
				})
				.from(leads)
				.leftJoin(companies, eq(leads.companyId, companies.id))
				.leftJoin(user, eq(leads.assignedTo, user.id))
				.orderBy(leads.createdAt);
		}
		return await db
			.select({
				id: leads.id,
				firstName: leads.firstName,
				lastName: leads.lastName,
				email: leads.email,
				phone: leads.phone,
				age: leads.age,
				dpi: leads.dpi,
				maritalStatus: leads.maritalStatus,
				dependents: leads.dependents,
				monthlyIncome: leads.monthlyIncome,
				loanAmount: leads.loanAmount,
				occupation: leads.occupation,
				workTime: leads.workTime,
				loanPurpose: leads.loanPurpose,
				ownsHome: leads.ownsHome,
				ownsVehicle: leads.ownsVehicle,
				hasCreditCard: leads.hasCreditCard,
				jobTitle: leads.jobTitle,
				source: leads.source,
				status: leads.status,
				assignedTo: leads.assignedTo,
				notes: leads.notes,
				score: leads.score,
				fit: leads.fit,
				scoredAt: leads.scoredAt,
				createdAt: leads.createdAt,
				updatedAt: leads.updatedAt,
				company: {
					id: companies.id,
					name: companies.name,
				},
				assignedUser: {
					id: user.id,
					name: user.name,
				},
			})
			.from(leads)
			.leftJoin(companies, eq(leads.companyId, companies.id))
			.leftJoin(user, eq(leads.assignedTo, user.id))
			.where(eq(leads.assignedTo, context.userId))
			.orderBy(leads.createdAt);
	}),

	createLead: crmProcedure
		.input(
			z.object({
				firstName: z.string().min(1, "First name is required"),
				lastName: z.string().min(1, "Last name is required"),
				email: z.string().email("Valid email is required"),
				phone: z.string().min(1, "Phone is required"),
				age: z.number().int().positive().optional(),
				dpi: z.string().optional(),
				maritalStatus: z
					.enum(["single", "married", "divorced", "widowed"])
					.optional(),
				dependents: z.number().int().min(0).default(0),
				monthlyIncome: z.number().positive().optional(),
				loanAmount: z.number().positive().optional(),
				occupation: z.enum(["owner", "employee"]).optional(),
				workTime: z.enum(["1_to_5", "5_to_10", "10_plus"]).optional(),
				loanPurpose: z.enum(["personal", "business"]).optional(),
				ownsHome: z.boolean().default(false),
				ownsVehicle: z.boolean().default(false),
				hasCreditCard: z.boolean().default(false),
				jobTitle: z.string().optional(),
				companyId: z.string().uuid().optional(),
				source: z.enum([
					"website",
					"referral",
					"cold_call",
					"email",
					"social_media",
					"event",
					"other",
				]),
				assignedTo: z.string().uuid().optional(),
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// If no assignedTo specified, assign to current user
			// Admin can assign to anyone, sales can only assign to themselves
			const assignedTo = input.assignedTo || context.userId;

			if (context.userRole === "sales" && assignedTo !== context.userId) {
				throw new Error("Sales users can only assign leads to themselves");
			}

			const newLead = await db
				.insert(leads)
				.values({
					...input,
					monthlyIncome: input.monthlyIncome?.toString(),
					loanAmount: input.loanAmount?.toString(),
					assignedTo,
					createdBy: context.userId,
					updatedAt: new Date(),
				})
				.returning();
			return newLead[0];
		}),

	updateLead: crmProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				firstName: z.string().min(1, "First name is required").optional(),
				lastName: z.string().min(1, "Last name is required").optional(),
				email: z.string().email("Valid email is required").optional(),
				phone: z.string().optional(),
				age: z.number().int().positive().optional(),
				dpi: z.string().optional(),
				maritalStatus: z
					.enum(["single", "married", "divorced", "widowed"])
					.optional(),
				dependents: z.number().int().min(0).optional(),
				monthlyIncome: z.number().positive().optional(),
				loanAmount: z.number().positive().optional(),
				occupation: z.enum(["owner", "employee"]).optional(),
				workTime: z.enum(["1_to_5", "5_to_10", "10_plus"]).optional(),
				loanPurpose: z.enum(["personal", "business"]).optional(),
				ownsHome: z.boolean().optional(),
				ownsVehicle: z.boolean().optional(),
				hasCreditCard: z.boolean().optional(),
				jobTitle: z.string().optional(),
				companyId: z.string().uuid().optional(),
				source: z
					.enum([
						"website",
						"referral",
						"cold_call",
						"email",
						"social_media",
						"event",
						"other",
					])
					.optional(),
				status: z
					.enum(["new", "contacted", "qualified", "unqualified", "converted"])
					.optional(),
				assignedTo: z.string().uuid().optional(),
				notes: z.string().optional(),
				score: z.number().min(0).max(1).optional(),
				fit: z.boolean().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const { id, assignedTo, ...updateData } = input;

			// Sales users can only update leads assigned to them
			const whereClause =
				context.userRole === "admin"
					? eq(leads.id, id)
					: and(eq(leads.id, id), eq(leads.assignedTo, context.userId));

			// Sales users cannot reassign leads
			if (
				context.userRole === "sales" &&
				assignedTo &&
				assignedTo !== context.userId
			) {
				throw new Error("Sales users cannot reassign leads");
			}

			const updatedLead = await db
				.update(leads)
				.set({
					...updateData,
					monthlyIncome: updateData.monthlyIncome?.toString(),
					loanAmount: updateData.loanAmount?.toString(),
					score: updateData.score?.toString(),
					...(assignedTo && { assignedTo }),
					...(updateData.score !== undefined && { scoredAt: new Date() }),
					updatedAt: new Date(),
				})
				.where(whereClause)
				.returning();

			if (updatedLead.length === 0) {
				throw new Error(
					"Lead not found or you don't have permission to update it",
				);
			}

			return updatedLead[0];
		}),

	// Credit Analysis
	getCreditAnalysisByLeadId: crmProcedure
		.input(z.object({ leadId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			// Check if user has access to the lead
			const lead = await db
				.select()
				.from(leads)
				.where(eq(leads.id, input.leadId))
				.limit(1);

			if (lead.length === 0) {
				throw new Error("Lead not found");
			}

			// Sales users can only see analysis for their assigned leads
			if (
				context.userRole === "sales" &&
				lead[0].assignedTo !== context.userId
			) {
				throw new Error("You don't have permission to view this analysis");
			}

			const analysis = await db
				.select()
				.from(creditAnalysis)
				.where(eq(creditAnalysis.leadId, input.leadId))
				.limit(1);

			return analysis[0] || null;
		}),

	// Opportunities
	getOpportunities: crmProcedure.handler(async ({ context }) => {
		if (context.userRole === "admin") {
			return await db
				.select({
					id: opportunities.id,
					title: opportunities.title,
					value: opportunities.value,
					probability: opportunities.probability,
					expectedCloseDate: opportunities.expectedCloseDate,
					status: opportunities.status,
					assignedTo: opportunities.assignedTo,
					notes: opportunities.notes,
					createdAt: opportunities.createdAt,
					updatedAt: opportunities.updatedAt,
					company: {
						id: companies.id,
						name: companies.name,
					},
					lead: {
						id: leads.id,
						firstName: leads.firstName,
						lastName: leads.lastName,
						email: leads.email,
					},
					stage: {
						id: salesStages.id,
						name: salesStages.name,
						order: salesStages.order,
						closurePercentage: salesStages.closurePercentage,
						color: salesStages.color,
					},
					assignedUser: {
						id: user.id,
						name: user.name,
					},
				})
				.from(opportunities)
				.leftJoin(companies, eq(opportunities.companyId, companies.id))
				.leftJoin(leads, eq(opportunities.leadId, leads.id))
				.leftJoin(salesStages, eq(opportunities.stageId, salesStages.id))
				.leftJoin(user, eq(opportunities.assignedTo, user.id))
				.orderBy(opportunities.createdAt);
		}
		return await db
			.select({
				id: opportunities.id,
				title: opportunities.title,
				value: opportunities.value,
				probability: opportunities.probability,
				expectedCloseDate: opportunities.expectedCloseDate,
				status: opportunities.status,
				assignedTo: opportunities.assignedTo,
				notes: opportunities.notes,
				createdAt: opportunities.createdAt,
				updatedAt: opportunities.updatedAt,
				company: {
					id: companies.id,
					name: companies.name,
				},
				lead: {
					id: leads.id,
					firstName: leads.firstName,
					lastName: leads.lastName,
					email: leads.email,
				},
				stage: {
					id: salesStages.id,
					name: salesStages.name,
					order: salesStages.order,
					closurePercentage: salesStages.closurePercentage,
					color: salesStages.color,
				},
				assignedUser: {
					id: user.id,
					name: user.name,
				},
			})
			.from(opportunities)
			.leftJoin(companies, eq(opportunities.companyId, companies.id))
			.leftJoin(leads, eq(opportunities.leadId, leads.id))
			.leftJoin(salesStages, eq(opportunities.stageId, salesStages.id))
			.leftJoin(user, eq(opportunities.assignedTo, user.id))
			.where(eq(opportunities.assignedTo, context.userId))
			.orderBy(opportunities.createdAt);
	}),

	createOpportunity: crmProcedure
		.input(
			z.object({
				title: z.string().min(1, "Title is required"),
				leadId: z.string().uuid().optional(),
				companyId: z.string().uuid().optional(),
				value: z.string().optional(), // Will be converted to decimal
				stageId: z.string().uuid(),
				probability: z.number().min(0).max(100).optional(),
				expectedCloseDate: z.string().optional(), // ISO date string
				assignedTo: z.string().uuid().optional(),
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const assignedTo = input.assignedTo || context.userId;

			if (context.userRole === "sales" && assignedTo !== context.userId) {
				throw new Error(
					"Sales users can only assign opportunities to themselves",
				);
			}

			// If a lead is provided, get the company from the lead
			let companyId = input.companyId;
			if (input.leadId) {
				const lead = await db
					.select()
					.from(leads)
					.where(eq(leads.id, input.leadId))
					.limit(1);
				if (lead.length > 0 && lead[0].companyId) {
					companyId = lead[0].companyId;
				}
			}

			const newOpportunity = await db
				.insert(opportunities)
				.values({
					...input,
					companyId,
					assignedTo,
					expectedCloseDate: input.expectedCloseDate
						? new Date(input.expectedCloseDate)
						: undefined,
					createdBy: context.userId,
					updatedAt: new Date(),
				})
				.returning();
			return newOpportunity[0];
		}),

	updateOpportunity: crmProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				title: z.string().min(1, "Title is required").optional(),
				leadId: z.string().uuid().optional(),
				companyId: z.string().uuid().optional(),
				value: z.string().optional(),
				stageId: z.string().uuid().optional(),
				probability: z.number().min(0).max(100).optional(),
				expectedCloseDate: z.string().optional(),
				status: z.enum(["open", "won", "lost", "on_hold"]).optional(),
				assignedTo: z.string().uuid().optional(),
				notes: z.string().optional(),
				stageChangeReason: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const { id, assignedTo, stageChangeReason, ...updateData } = input;

			// Get current opportunity to check for stage changes
			const currentOpportunity = await db
				.select()
				.from(opportunities)
				.where(eq(opportunities.id, id))
				.limit(1);

			if (!currentOpportunity[0]) {
				throw new Error("Opportunity not found");
			}

			// Sales users can only update opportunities assigned to them
			const whereClause =
				context.userRole === "admin"
					? eq(opportunities.id, id)
					: and(
							eq(opportunities.id, id),
							eq(opportunities.assignedTo, context.userId),
						);

			// Sales users cannot reassign opportunities
			if (
				context.userRole === "sales" &&
				assignedTo &&
				assignedTo !== context.userId
			) {
				throw new Error("Sales users cannot reassign opportunities");
			}

			// Check if this is a stage change
			const isStageChange = input.stageId && input.stageId !== currentOpportunity[0].stageId;
			
			// Check if this is an override (sales moving from analysis stage)
			let isOverride = false;
			if (isStageChange && context.userRole === "sales") {
				const analysisStage = await db
					.select()
					.from(salesStages)
					.where(eq(salesStages.name, "Recepción de documentación y traslado a análisis"))
					.limit(1);
				
				if (analysisStage[0] && currentOpportunity[0].stageId === analysisStage[0].id) {
					isOverride = true;
				}
			}

			const updatedOpportunity = await db
				.update(opportunities)
				.set({
					...updateData,
					...(assignedTo && { assignedTo }),
					expectedCloseDate: updateData.expectedCloseDate
						? new Date(updateData.expectedCloseDate)
						: undefined,
					updatedAt: new Date(),
				})
				.where(whereClause)
				.returning();

			if (updatedOpportunity.length === 0) {
				throw new Error(
					"Opportunity not found or you don't have permission to update it",
				);
			}

			// Record stage history if stage changed
			if (isStageChange && input.stageId) {
				await db.insert(opportunityStageHistory).values({
					opportunityId: id,
					fromStageId: currentOpportunity[0].stageId,
					toStageId: input.stageId,
					changedBy: context.userId,
					reason: stageChangeReason || (isOverride ? "Ventas movió la oportunidad desde análisis" : "Cambio de etapa"),
					isOverride,
				});
			}

			return updatedOpportunity[0];
		}),

	// Analyst specific endpoints
	getOpportunitiesForAnalysis: analystProcedure.handler(async ({ context }) => {
		// Get the stage ID for "Recepción de documentación y traslado a análisis"
		const analysisStage = await db
			.select()
			.from(salesStages)
			.where(eq(salesStages.name, "Recepción de documentación y traslado a análisis"))
			.limit(1);

		if (!analysisStage[0]) {
			throw new Error("Analysis stage not found");
		}

		// Get all opportunities in the analysis stage
		return await db
			.select({
				id: opportunities.id,
				title: opportunities.title,
				value: opportunities.value,
				probability: opportunities.probability,
				expectedCloseDate: opportunities.expectedCloseDate,
				status: opportunities.status,
				notes: opportunities.notes,
				createdAt: opportunities.createdAt,
				updatedAt: opportunities.updatedAt,
				lead: {
					id: leads.id,
					firstName: leads.firstName,
					lastName: leads.lastName,
					email: leads.email,
					phone: leads.phone,
				},
				company: {
					id: companies.id,
					name: companies.name,
				},
			})
			.from(opportunities)
			.leftJoin(leads, eq(opportunities.leadId, leads.id))
			.leftJoin(companies, eq(opportunities.companyId, companies.id))
			.where(eq(opportunities.stageId, analysisStage[0].id))
			.orderBy(opportunities.createdAt);
	}),

	approveOpportunityAnalysis: analystProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				approved: z.boolean(),
				reason: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Get current opportunity with stage info
			const opportunity = await db
				.select()
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity[0]) {
				throw new Error("Opportunity not found");
			}

			// Get the analysis stage
			const analysisStage = await db
				.select()
				.from(salesStages)
				.where(eq(salesStages.name, "Recepción de documentación y traslado a análisis"))
				.limit(1);

			if (opportunity[0].stageId !== analysisStage[0].id) {
				throw new Error("Opportunity is not in analysis stage");
			}

			// Get the next stage
			const nextStage = await db
				.select()
				.from(salesStages)
				.where(eq(salesStages.order, 5)) // "Cierre de propuesta"
				.limit(1);

			if (!nextStage[0]) {
				throw new Error("Next stage not found");
			}

			// Update opportunity stage if approved
			const newStageId = input.approved ? nextStage[0].id : opportunity[0].stageId;
			
			if (input.approved || input.reason) {
				// Update opportunity
				await db
					.update(opportunities)
					.set({
						stageId: newStageId,
						notes: input.reason 
							? `${opportunity[0].notes || ""}\n\n[Análisis ${input.approved ? "Aprobado" : "Rechazado"}]: ${input.reason}`
							: opportunity[0].notes,
						updatedAt: new Date(),
					})
					.where(eq(opportunities.id, input.opportunityId));

				// Record stage history
				await db.insert(opportunityStageHistory).values({
					opportunityId: input.opportunityId,
					fromStageId: opportunity[0].stageId,
					toStageId: newStageId,
					changedBy: context.userId,
					reason: input.reason || (input.approved ? "Documentación aprobada" : "Documentación rechazada"),
					isOverride: false,
				});
			}

			return { success: true, approved: input.approved };
		}),

	getOpportunityHistory: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			// Check if user has access to the opportunity
			const opportunity = await db
				.select()
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity[0]) {
				throw new Error("Opportunity not found");
			}

			// For sales users, check if they are assigned to the opportunity
			if (
				context.userRole === "sales" &&
				opportunity[0].assignedTo !== context.userId
			) {
				throw new Error("You don't have permission to view this opportunity");
			}

			// Get stage history with user and stage details
			const history = await db
				.select({
					id: opportunityStageHistory.id,
					changedAt: opportunityStageHistory.changedAt,
					reason: opportunityStageHistory.reason,
					isOverride: opportunityStageHistory.isOverride,
					changedById: opportunityStageHistory.changedBy,
					fromStageId: opportunityStageHistory.fromStageId,
					toStageId: opportunityStageHistory.toStageId,
				})
				.from(opportunityStageHistory)
				.where(eq(opportunityStageHistory.opportunityId, input.opportunityId))
				.orderBy(opportunityStageHistory.changedAt);

			// Get all unique user IDs and stage IDs
			const userIds = [...new Set(history.map(h => h.changedById))];
			const stageIds = [...new Set(history.flatMap(h => [h.fromStageId, h.toStageId].filter(Boolean)))];

			// Fetch users and stages
			const users = userIds.length > 0 
				? await db.select().from(user).where(or(...userIds.map(id => eq(user.id, id))))
				: [];
			const stages = stageIds.length > 0
				? await db.select().from(salesStages).where(or(...stageIds.filter((id): id is string => id !== null).map(id => eq(salesStages.id, id))))
				: [];

			// Map users and stages
			const userMap = new Map(users.map(u => [u.id, u]));
			const stageMap = new Map(stages.map(s => [s.id, s]));

			// Return formatted history
			return history.map(h => ({
				id: h.id,
				changedAt: h.changedAt,
				reason: h.reason,
				isOverride: h.isOverride,
				changedBy: userMap.get(h.changedById) ? {
					id: userMap.get(h.changedById)!.id,
					name: userMap.get(h.changedById)!.name,
					role: userMap.get(h.changedById)!.role,
				} : null,
				fromStage: h.fromStageId && stageMap.get(h.fromStageId) ? {
					id: stageMap.get(h.fromStageId)!.id,
					name: stageMap.get(h.fromStageId)!.name,
				} : null,
				toStage: stageMap.get(h.toStageId) ? {
					id: stageMap.get(h.toStageId)!.id,
					name: stageMap.get(h.toStageId)!.name,
				} : null,
			}));
		}),

	// Clients
	getClients: crmProcedure.handler(async ({ context }) => {
		if (context.userRole === "admin") {
			return await db
				.select({
					id: clients.id,
					contactPerson: clients.contactPerson,
					contractValue: clients.contractValue,
					startDate: clients.startDate,
					endDate: clients.endDate,
					status: clients.status,
					assignedTo: clients.assignedTo,
					notes: clients.notes,
					createdAt: clients.createdAt,
					updatedAt: clients.updatedAt,
					company: {
						id: companies.id,
						name: companies.name,
					},
				})
				.from(clients)
				.leftJoin(companies, eq(clients.companyId, companies.id))
				.orderBy(clients.createdAt);
		}
		return await db
			.select({
				id: clients.id,
				contactPerson: clients.contactPerson,
				contractValue: clients.contractValue,
				startDate: clients.startDate,
				endDate: clients.endDate,
				status: clients.status,
				assignedTo: clients.assignedTo,
				notes: clients.notes,
				createdAt: clients.createdAt,
				updatedAt: clients.updatedAt,
				company: {
					id: companies.id,
					name: companies.name,
				},
			})
			.from(clients)
			.leftJoin(companies, eq(clients.companyId, companies.id))
			.where(eq(clients.assignedTo, context.userId))
			.orderBy(clients.createdAt);
	}),

	createClient: crmProcedure
		.input(
			z.object({
				companyId: z.string().uuid(),
				contactPerson: z.string().min(1, "Contact person is required"),
				contractValue: z.string().optional(),
				startDate: z.string().optional(), // ISO date string
				endDate: z.string().optional(), // ISO date string
				assignedTo: z.string().uuid().optional(),
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const assignedTo = input.assignedTo || context.userId;

			if (context.userRole === "sales" && assignedTo !== context.userId) {
				throw new Error("Sales users can only assign clients to themselves");
			}

			const newClient = await db
				.insert(clients)
				.values({
					...input,
					assignedTo,
					startDate: input.startDate ? new Date(input.startDate) : undefined,
					endDate: input.endDate ? new Date(input.endDate) : undefined,
					createdBy: context.userId,
					updatedAt: new Date(),
				})
				.returning();
			return newClient[0];
		}),

	updateClient: crmProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				companyId: z.string().uuid().optional(),
				contactPerson: z
					.string()
					.min(1, "Contact person is required")
					.optional(),
				contractValue: z.string().optional(),
				startDate: z.string().optional(),
				endDate: z.string().optional(),
				status: z.enum(["active", "inactive", "churned"]).optional(),
				assignedTo: z.string().uuid().optional(),
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const { id, ...updateData } = input;

			// Sales users can only update clients assigned to them
			const whereClause =
				context.userRole === "admin"
					? eq(clients.id, id)
					: and(eq(clients.id, id), eq(clients.assignedTo, context.userId));

			const updatedClient = await db
				.update(clients)
				.set({
					...updateData,
					startDate: updateData.startDate
						? new Date(updateData.startDate)
						: undefined,
					endDate: updateData.endDate
						? new Date(updateData.endDate)
						: undefined,
					updatedAt: new Date(),
				})
				.where(whereClause)
				.returning();

			if (updatedClient.length === 0) {
				throw new Error(
					"Client not found or you don't have permission to update it",
				);
			}

			return updatedClient[0];
		}),

	// Dashboard stats
	getDashboardStats: crmProcedure.handler(async ({ context }) => {
		if (context.userRole === "admin") {
			// Admin gets global stats
			const [totalLeads] = await db.select({ count: count() }).from(leads);
			const [totalOpportunities] = await db
				.select({ count: count() })
				.from(opportunities);
			const [totalClients] = await db.select({ count: count() }).from(clients);

			return {
				totalLeads: totalLeads?.count || 0,
				totalOpportunities: totalOpportunities?.count || 0,
				totalClients: totalClients?.count || 0,
			};
		}
		// Sales users get their own stats
		const [myLeads] = await db
			.select({ count: count() })
			.from(leads)
			.where(eq(leads.assignedTo, context.userId));
		const [myOpportunities] = await db
			.select({ count: count() })
			.from(opportunities)
			.where(eq(opportunities.assignedTo, context.userId));
		const [myClients] = await db
			.select({ count: count() })
			.from(clients)
			.where(eq(clients.assignedTo, context.userId));

		return {
			myLeads: myLeads?.count || 0,
			myOpportunities: myOpportunities?.count || 0,
			myClients: myClients?.count || 0,
		};
	}),
};
