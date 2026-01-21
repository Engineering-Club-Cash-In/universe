import { ORPCError } from "@orpc/server";
import {
	and,
	count,
	desc,
	eq,
	gte,
	ilike,
	isNotNull,
	not,
	or,
	sql,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
	vehicleDocumentRequirements,
	vehicleDocuments,
	vehicleInspections,
	vehicles,
} from "../db/schema";
import { user } from "../db/schema/auth";
import {
	clients,
	companies,
	creditAnalysis,
	leads,
	opportunities,
	opportunityStageHistory,
	salesStages,
} from "../db/schema/crm";
import {
	analysisChecklists,
	disbursementChecklists,
	documentRequirementsByClientType,
	documentTypeEnum,
	documentValidations,
	opportunityDocuments,
} from "../db/schema/documents";
import { analystProcedure, crmProcedure } from "../lib/orpc";
import { PERMISSIONS } from "../lib/roles";
import {
	deleteFileFromR2,
	generateUniqueFilename,
	getFileUrl,
	uploadFileToR2,
	validateFile,
} from "../lib/storage";
import {
	formatMissingFields,
	getMissingFields,
	getMissingFieldsForContracts,
} from "../lib/vehicle-helpers";
import { closeOpportunity } from "../services/close-opportunity";
import { updateChecklistForClientDocument } from "@/lib/checklist";

export const crmRouter = {
	// Sales Stages (read-only for all CRM users)
	getSalesStages: crmProcedure.handler(async ({ context: _ }) => {
		const stages = await db
			.select()
			.from(salesStages)
			.orderBy(salesStages.order);
		return stages;
	}),

	// Get sales users for assignment dropdown
	getCrmUsers: crmProcedure.handler(async () => {
		const users = await db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				role: user.role,
			})
			.from(user)
			.where(eq(user.role, "sales"));

		return users;
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
	getLeads: crmProcedure
		.input(
			z
				.object({
					limit: z.number().min(1).max(100).default(20),
					offset: z.number().min(0).default(0),
					search: z.string().optional(),
					status: z
						.enum(["new", "contacted", "qualified", "converted", "unqualified"])
						.optional(),
					id: z.string().uuid().optional(),
				})
				.optional(),
		)
		.handler(async ({ input, context }) => {
			const limit = input?.limit ?? 20;
			const offset = input?.offset ?? 0;
			const search = input?.search;
			const status = input?.status;
			const id = input?.id;

			// Build conditions
			const conditions = [];

			// ID filter (for direct lookup)
			if (id) {
				conditions.push(eq(leads.id, id));
			}

			// Role-based filter: admin and sales_supervisor can see all, others only their own
			if (context.userRole !== "admin" && context.userRole !== "sales_supervisor") {
				conditions.push(eq(leads.assignedTo, context.userId));
			}

			// Status filter
			if (status) {
				conditions.push(eq(leads.status, status));
			}

			// Search filter (name, email, company name)
			if (search && search.trim() !== "") {
				const searchTerms = search.trim().split(/\s+/);
				// Build conditions for each search term (all terms must match)
				const termConditions = searchTerms.map((term) => {
					const searchPattern = `%${term}%`;
					return or(
						ilike(leads.firstName, searchPattern),
						ilike(leads.lastName, searchPattern),
						ilike(leads.email, searchPattern),
						ilike(companies.name, searchPattern),
					);
				});
				// All terms must match (AND)
				if (termConditions.length > 0) {
					conditions.push(...termConditions);
				}
			}

			const whereClause =
				conditions.length > 0 ? and(...conditions) : undefined;

			// Get total count
			const [{ total }] = await db
				.select({ total: count() })
				.from(leads)
				.leftJoin(companies, eq(leads.companyId, companies.id))
				.where(whereClause);

			// Get paginated data
			const data = await db
				.select({
					id: leads.id,
					firstName: leads.firstName,
					middleName: leads.middleName,
					lastName: leads.lastName,
					secondLastName: leads.secondLastName,
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
					departamento: leads.departamento,
					municipio: leads.municipio,
					zona: leads.zona,
					direccion: leads.direccion,
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
				.where(whereClause)
				.orderBy(desc(leads.createdAt))
				.limit(limit)
				.offset(offset);

			return {
				data,
				total,
				limit,
				offset,
			};
		}),

	getLeadById: crmProcedure
		.input(z.object({ leadId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const [lead] = await db
				.select({
					id: leads.id,
					firstName: leads.firstName,
					lastName: leads.lastName,
					email: leads.email,
					phone: leads.phone,
					dpi: leads.dpi,
					status: leads.status,
					source: leads.source,
					assignedTo: leads.assignedTo,
					companyId: leads.companyId,
					notes: leads.notes,
					createdAt: leads.createdAt,
					updatedAt: leads.updatedAt,
					company: companies,
					assignedUser: {
						id: user.id,
						name: user.name,
					},
				})
				.from(leads)
				.leftJoin(companies, eq(leads.companyId, companies.id))
				.leftJoin(user, eq(leads.assignedTo, user.id))
				.where(eq(leads.id, input.leadId))
				.limit(1);

			if (!lead) {
				throw new ORPCError("NOT_FOUND", {
					message: "Lead no encontrado",
				});
			}

			// Sales users can only see their assigned leads
			if (context.userRole === "sales" && lead.assignedTo !== context.userId) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para ver este lead",
				});
			}

			return lead;
		}),

	getLeadsStats: crmProcedure.handler(async ({ context }) => {
		// Build role-based condition
		const roleCondition =
			context.userRole !== "admin" && context.userRole !== "sales_supervisor"
				? eq(leads.assignedTo, context.userId)
				: undefined;

		// Get counts for each status
		const statusCounts = await db
			.select({
				status: leads.status,
				count: count(),
			})
			.from(leads)
			.where(roleCondition)
			.groupBy(leads.status);

		// Transform to object
		const stats = {
			total: 0,
			new: 0,
			contacted: 0,
			qualified: 0,
			converted: 0,
			lost: 0,
		};

		for (const row of statusCounts) {
			const c = Number(row.count);
			stats.total += c;
			if (row.status in stats) {
				stats[row.status as keyof typeof stats] = c;
			}
		}

		return stats;
	}),

	createLead: crmProcedure
		.input(
			z.object({
				firstName: z.string().min(1, "First name is required"),
				middleName: z.string().optional(),
				lastName: z.string().min(1, "Last name is required"),
				secondLastName: z.string().optional(),
				email: z.string().email("Valid email is required"),
				phone: z.string().min(1, "Phone is required"),
				age: z.number().int().positive().optional(),
				dpi: z.string().optional(),
				departamento: z.string().optional(),
				municipio: z.string().optional(),
				zona: z.string().optional(),
				clientType: z
					.enum(["individual", "comerciante", "empresa"])
					.default("individual"),
				maritalStatus: z
					.enum(["single", "married", "divorced", "widowed"])
					.optional(),
				dependents: z.number().int().min(0).default(0),
				monthlyIncome: z.number().positive().optional(),
				loanAmount: z.number().positive().optional(),
				occupation: z.enum(["owner", "employee"]).optional(),
				workTime: z
					.enum(["less_than_1", "1_to_5", "5_to_10", "10_plus"])
					.optional(),
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
				assignedTo: z.string().optional(), // Better Auth user ID (text, not UUID)
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
				middleName: z.string().optional(),
				lastName: z.string().min(1, "Last name is required").optional(),
				secondLastName: z.string().optional(),
				email: z.string().email("Valid email is required").optional(),
				phone: z.string().optional(),
				age: z.number().int().positive().optional(),
				dpi: z.string().optional(),
				departamento: z.string().optional(),
				municipio: z.string().optional(),
				zona: z.string().optional(),
				maritalStatus: z
					.enum(["single", "married", "divorced", "widowed"])
					.optional(),
				dependents: z.number().int().min(0).optional(),
				monthlyIncome: z.number().positive().optional(),
				loanAmount: z.number().positive().optional(),
				occupation: z.enum(["owner", "employee"]).optional(),
				workTime: z
					.enum(["less_than_1", "1_to_5", "5_to_10", "10_plus"])
					.optional(),
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
				assignedTo: z.string().optional(), // Better Auth user ID (text, not UUID)
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

	upsertCreditAnalysis: crmProcedure
		.input(
			z.object({
				leadId: z.string().uuid(),
				monthlyFixedIncome: z.number().min(0).optional(),
				monthlyVariableIncome: z.number().min(0).optional(),
				monthlyFixedExpenses: z.number().min(0).optional(),
				monthlyVariableExpenses: z.number().min(0).optional(),
				economicAvailability: z.number().optional(),
				minPayment: z.number().min(0).optional(),
				maxPayment: z.number().min(0).optional(),
				adjustedPayment: z.number().min(0).optional(),
				maxCreditAmount: z.number().min(0).optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const { leadId, ...analysisData } = input;

			// Check if user has access to the lead
			const lead = await db
				.select()
				.from(leads)
				.where(eq(leads.id, leadId))
				.limit(1);

			if (lead.length === 0) {
				throw new Error("Lead not found");
			}

			// Sales users can only update analysis for their assigned leads
			if (
				context.userRole === "sales" &&
				lead[0].assignedTo !== context.userId
			) {
				throw new Error("You don't have permission to update this analysis");
			}

			// Convert numbers to strings for decimal fields
			const dataForDb = {
				monthlyFixedIncome: analysisData.monthlyFixedIncome?.toString(),
				monthlyVariableIncome: analysisData.monthlyVariableIncome?.toString(),
				monthlyFixedExpenses: analysisData.monthlyFixedExpenses?.toString(),
				monthlyVariableExpenses:
					analysisData.monthlyVariableExpenses?.toString(),
				economicAvailability: analysisData.economicAvailability?.toString(),
				minPayment: analysisData.minPayment?.toString(),
				maxPayment: analysisData.maxPayment?.toString(),
				adjustedPayment: analysisData.adjustedPayment?.toString(),
				maxCreditAmount: analysisData.maxCreditAmount?.toString(),
			};

			// Check if analysis already exists
			const existing = await db
				.select()
				.from(creditAnalysis)
				.where(eq(creditAnalysis.leadId, leadId))
				.limit(1);

			if (existing.length > 0) {
				// Update existing
				const updated = await db
					.update(creditAnalysis)
					.set({
						...dataForDb,
						updatedAt: new Date(),
					})
					.where(eq(creditAnalysis.leadId, leadId))
					.returning();
				return updated[0];
			}
			// Create new
			const created = await db
				.insert(creditAnalysis)
				.values({
					leadId,
					...dataForDb,
					createdBy: context.userId,
					analyzedAt: new Date(),
				})
				.returning();
			return created[0];
		}),

	// Opportunities
	getOpportunities: crmProcedure
		.input(
			z
				.object({
					leadId: z.string().uuid().optional(),
					search: z.string().optional(),
					limit: z.number().min(1).max(100).default(50),
					notStatus: z.enum(["open", "won", "lost", "on_hold"]).optional(),
					opportunityId: z.string().uuid().optional(),
				})
				.optional(),
		)
		.handler(async ({ input, context }) => {
			const leadIdFilter = input?.leadId;
			const searchTerm = input?.search;
			const limit = input?.limit ?? 50;

			const selectFields = {
				id: opportunities.id,
				title: opportunities.title,
				vehicleId: opportunities.vehicleId,
				creditType: opportunities.creditType,
				value: opportunities.value,
				probability: opportunities.probability,
				expectedCloseDate: opportunities.expectedCloseDate,
				status: opportunities.status,
				assignedTo: opportunities.assignedTo,
				notes: opportunities.notes,
				createdAt: opportunities.createdAt,
				updatedAt: opportunities.updatedAt,
				// Credit terms fields
				numeroCuotas: opportunities.numeroCuotas,
				tasaInteres: opportunities.tasaInteres,
				cuotaMensual: opportunities.cuotaMensual,
				fechaInicio: opportunities.fechaInicio,
				diaPagoMensual: opportunities.diaPagoMensual,
				// Additional credit fields
				seguro: opportunities.seguro,
				gps: opportunities.gps,
				categoria: opportunities.categoria,
				nit: opportunities.nit,
				royalti: opportunities.royalti,
				porcentajeRoyalti: opportunities.porcentajeRoyalti,
				reserva: opportunities.reserva,
				membresiaPago: opportunities.membresiaPago,
				inversionistas: opportunities.inversionistas,
				asesorId: opportunities.asesorId,
				rubros: opportunities.rubros,
				loanPurpose: opportunities.loanPurpose,
				company: {
					id: companies.id,
					name: companies.name,
				},
				lead: {
					id: leads.id,
					firstName: leads.firstName,
					lastName: leads.lastName,
					email: leads.email,
					age: leads.age,
					direccion: leads.direccion,
					departamento: leads.departamento,
					municipio: leads.municipio,
					zona: leads.zona,
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
				vehicle: {
					id: vehicles.id,
					make: vehicles.make,
					model: vehicles.model,
					year: vehicles.year,
					licensePlate: vehicles.licensePlate,
					vinNumber: vehicles.vinNumber,
					origin: vehicles.origin,
					color: vehicles.color,
					vehicleType: vehicles.vehicleType,
					kmMileage: vehicles.kmMileage,
					status: vehicles.status,
					isNew: vehicles.isNew,
					fuelType: vehicles.fuelType,
					transmission: vehicles.transmission,
				},
			};

			const baseQuery = db
				.select(selectFields)
				.from(opportunities)
				.leftJoin(companies, eq(opportunities.companyId, companies.id))
				.leftJoin(leads, eq(opportunities.leadId, leads.id))
				.leftJoin(salesStages, eq(opportunities.stageId, salesStages.id))
				.leftJoin(user, eq(opportunities.assignedTo, user.id))
				.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id));

			// Build conditions
			const conditions = [];

			// Lead filter
			if (leadIdFilter) {
				conditions.push(eq(opportunities.leadId, leadIdFilter));
			}

			if (input?.opportunityId) {
				conditions.push(eq(opportunities.id, input.opportunityId));
			}

			// Search filter (by title, company name, or lead name)
			if (searchTerm) {
				conditions.push(
					or(
						ilike(opportunities.title, `%${searchTerm}%`),
						ilike(companies.name, `%${searchTerm}%`),
						ilike(leads.firstName, `%${searchTerm}%`),
						ilike(leads.lastName, `%${searchTerm}%`),
					),
				);
			}

			if (input?.notStatus) {
				conditions.push(not(eq(opportunities.status, input.notStatus)));
			}

			// Role-based filter: admin and sales_supervisor can see all, others only their own
			if (context.userRole !== "admin" && context.userRole !== "sales_supervisor" && context.userRole !== "juridico" && context.userRole !== "analyst") {
				conditions.push(eq(opportunities.assignedTo, context.userId));
			}

			if (conditions.length > 0) {
				return await baseQuery
					.where(and(...conditions))
					.orderBy(desc(opportunities.createdAt))
					.limit(limit);
			}

			return await baseQuery
				.orderBy(desc(opportunities.createdAt))
				.limit(limit);
		}),

	createOpportunity: crmProcedure
		.input(
			z.object({
				title: z.string().min(1, "Title is required"),
				leadId: z.string().uuid().optional(),
				companyId: z.string().uuid().optional(),
				vehicleId: z.string().uuid().optional(),
				creditType: z.enum(["autocompra", "sobre_vehiculo"]),
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
				loanPurpose: z.enum(["personal", "business"]).optional(),
				value: z.string().optional(), // Will be converted to decimal
				stageId: z.string().uuid(),
				probability: z.number().min(0).max(100).optional(),
				expectedCloseDate: z.string().optional(), // ISO date string
				assignedTo: z.string().optional(), // Better Auth user ID (text, not UUID)
				vendorId: z.string().uuid().optional(), // Vehicle vendor
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

			// If a lead is provided, get the company and source from the lead
			let companyId = input.companyId;
			let source = input.source;
			if (input.leadId) {
				const lead = await db
					.select()
					.from(leads)
					.where(eq(leads.id, input.leadId))
					.limit(1);
				if (lead.length > 0) {
					if (lead[0].companyId) {
						companyId = lead[0].companyId;
					}
					// If source not provided, take from lead
					if (!source && lead[0].source) {
						source = lead[0].source;
					}
				}
			}

			const newOpportunity = await db
				.insert(opportunities)
				.values({
					...input,
					companyId,
					source,
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
				vehicleId: z.string().uuid().nullable().optional(),
				creditType: z.enum(["autocompra", "sobre_vehiculo"]).optional(),
				value: z.string().optional(),
				stageId: z.string().uuid().optional(),
				probability: z.number().min(0).max(100).optional(),
				expectedCloseDate: z.string().optional(),
				status: z.enum(["open", "won", "lost", "on_hold"]).optional(),
				assignedTo: z.string().optional(), // Better Auth user ID (text, not UUID)
				notes: z.string().optional(),
				stageChangeReason: z.string().optional(),
				// Credit terms
				numeroCuotas: z.number().int().positive().optional(),
				tasaInteres: z.string().optional(),
				cuotaMensual: z.string().optional(),
				fechaInicio: z.string().optional(),
				diaPagoMensual: z.number().int().min(1).max(31).optional(),
				// Additional fields
				seguro: z.number().optional(),
				gps: z.number().optional(),
				categoria: z
					.enum([
						"Contraseña",
						"CV Vehículo",
						"CV Vehículo nuevo",
						"Fiduciario",
						"Hipotecario",
						"Vehículo",
					])
					.optional(),
				nit: z.string().optional(),
				royalti: z.number().optional(),
				porcentajeRoyalti: z.string().optional(),
				reserva: z.number().optional(),
				membresiaPago: z.number().optional(),
				inversionistas: z.string().optional(), // JSON string
				asesorId: z.number().optional(),
				direccion: z.string().optional(),
				rubros: z.string().optional(), // JSON string with expense items
				gastosAdministrativos: z.number().optional(), // Administrative expenses for cartera "otros"
				loanPurpose: z.enum(["personal", "business"]).optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const {
				id,
				assignedTo,
				stageChangeReason,
				seguro,
				gps,
				royalti,
				porcentajeRoyalti,
				reserva,
				membresiaPago,
				direccion,
				gastosAdministrativos,
				expectedCloseDate,
				fechaInicio,
				...updateData
			} = input;

			// Get current opportunity to check for stage changes
			const currentOpportunity = await db
				.select()
				.from(opportunities)
				.where(eq(opportunities.id, id))
				.limit(1);

			if (!currentOpportunity[0]) {
				throw new Error("Opportunity not found");
			}

			// Validate stage transitions
			if (input.stageId) {
				const targetStage = await db
					.select()
					.from(salesStages)
					.where(eq(salesStages.id, input.stageId))
					.limit(1);

				// Get current stage to check transition
				const currentStage = await db
					.select()
					.from(salesStages)
					.where(eq(salesStages.id, currentOpportunity[0].stageId))
					.limit(1);

				const fromPercentage = currentStage[0]?.closurePercentage ?? 0;
				const toPercentage = targetStage[0]?.closurePercentage ?? 0;

				// Validate credit detail approval when moving from <=40% to >=50%
				if (fromPercentage <= 40 && toPercentage >= 50) {
					// Check if credit detail has been approved
					if (!currentOpportunity[0].creditDetailApproved) {
						throw new ORPCError("BAD_REQUEST", {
							message:
								"Para avanzar de análisis (40%) a la siguiente etapa (50%+), el detalle de crédito debe ser aprobado por un supervisor de ventas.",
						});
					}
				}

				//  en este apartado ya nadie puede mover de 80 a 90 sin aprobacion de analista
				// Validate document approval when moving from 80% to 90%
				if (fromPercentage === 80 && toPercentage >= 90) {
					console.log("Validating document approval for 80% to 90% stage change");
					throw new ORPCError("BAD_REQUEST", {
						message:
							"Para avanzar de evaluación (80%) a la siguiente etapa (90%+), solo un analista puede realizar este cambio después de aprobar los documentos.",
					});
					
				}

				// Validate disbursement approval when moving from 90% to 100%
				if (fromPercentage === 90 && toPercentage === 100) {
					// Check if disbursement has been approved via checklist
					if (!currentOpportunity[0].disbursementApproved) {
						console.log("Disbursement not approved, cannot move to 100% stage");
						throw new ORPCError("BAD_REQUEST", {
							message:
								"Para completar la oportunidad (100%), el desembolso debe ser aprobado por un analista completando el checklist de desembolso.",
						});
					}
				}

				// Note: The actual 100% closure logic (credit creation, client, contract)
				// is now handled by approveDisbursement via closeOpportunity service
			}

			// Sales users can only update opportunities assigned to them
			// Admin and sales_supervisor can update any opportunity
			const whereClause =
				context.userRole === "admin" || context.userRole === "sales_supervisor"
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
			const isStageChange =
				input.stageId && input.stageId !== currentOpportunity[0].stageId;

			// Check if this is an override (sales moving from analysis stage)
			let isOverride = false;
			if (isStageChange && context.userRole === "sales") {
				const analysisStage = await db
					.select()
					.from(salesStages)
					.where(
						eq(
							salesStages.name,
							"Recepción de documentación y traslado a análisis",
						),
					)
					.limit(1);

				if (
					analysisStage[0] &&
					currentOpportunity[0].stageId === analysisStage[0].id
				) {
					isOverride = true;
				}
			}

			const updatedOpportunity = await db
				.update(opportunities)
				.set({
					...updateData,
					...(assignedTo && { assignedTo }),
					...(expectedCloseDate && {
						expectedCloseDate: new Date(expectedCloseDate),
					}),
					...(fechaInicio && {
						fechaInicio: new Date(fechaInicio),
					}),
					// Convert numeric fields to strings for decimal columns
					...(seguro !== undefined && { seguro: String(seguro) }),
					...(gps !== undefined && { gps: String(gps) }),
					...(royalti !== undefined && { royalti: String(royalti) }),
					...(porcentajeRoyalti !== undefined && {
						porcentajeRoyalti: String(porcentajeRoyalti),
					}),
					...(reserva !== undefined && { reserva: String(reserva) }),
					...(membresiaPago !== undefined && {
						membresiaPago: String(membresiaPago),
					}),
					...(gastosAdministrativos !== undefined && {
						gastosAdministrativos: String(gastosAdministrativos),
					}),
					...(updateData.status === "won" && { actualCloseDate: new Date() }),
					updatedAt: new Date(),
				})
				.where(whereClause)
				.returning();

			if (updatedOpportunity.length === 0) {
				throw new Error(
					"Opportunity not found or you don't have permission to update it",
				);
			}

			// Si viene direccion, actualizar en el lead en lugar de la oportunidad
			if (direccion !== undefined && currentOpportunity[0].leadId) {
				await db
					.update(leads)
					.set({
						direccion,
						updatedAt: new Date(),
					})
					.where(eq(leads.id, currentOpportunity[0].leadId));
			}

			// Record stage history if stage changed
			if (isStageChange && input.stageId) {
				await db.insert(opportunityStageHistory).values({
					opportunityId: id,
					fromStageId: currentOpportunity[0].stageId,
					toStageId: input.stageId,
					changedBy: context.userId,
					reason:
						stageChangeReason ||
						(isOverride
							? "Ventas movió la oportunidad desde análisis"
							: "Cambio de etapa"),
					isOverride,
				});
			}

			return updatedOpportunity[0];
		}),

	// Analyst specific endpoints
	getOpportunitiesForAnalysis: analystProcedure.handler(
		async ({ context: _ }) => {
			// Get the stage ID for "Recepción de documentación y traslado a análisis"
			const analysisStage = await db
				.select()
				.from(salesStages)
				.where(
					eq(
						salesStages.name,
						"Recepción de documentación y traslado a análisis",
					),
				)
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
					vehicle: {
						id: vehicles.id,
						make: vehicles.make,
						model: vehicles.model,
						year: vehicles.year,
						licensePlate: vehicles.licensePlate,
						color: vehicles.color,
						isNew: vehicles.isNew,
					},
				})
				.from(opportunities)
				.leftJoin(leads, eq(opportunities.leadId, leads.id))
				.leftJoin(companies, eq(opportunities.companyId, companies.id))
				.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
				.where(eq(opportunities.stageId, analysisStage[0].id))
				.orderBy(opportunities.createdAt);
		},
	),

	approveOpportunityAnalysis: analystProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				approved: z.boolean(),
				reason: z.string().optional(),
				bypassValidation: z.boolean().optional(), // Solo admin puede usar bypass
			}),
		)
		.handler(async ({ input, context }) => {
			// Get current opportunity with stage info and lead data
			const opportunity = await db
				.select({
					id: opportunities.id,
					vehicleId: opportunities.vehicleId,
					creditType: opportunities.creditType,
					stageId: opportunities.stageId,
					notes: opportunities.notes,
					leadId: opportunities.leadId,
					clientType: leads.clientType,
				})
				.from(opportunities)
				.leftJoin(leads, eq(opportunities.leadId, leads.id))
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity[0]) {
				throw new Error("Opportunity not found");
			}

			// NUEVA VALIDACIÓN: Verificar documentos y vehículo antes de aprobar
			if (input.approved && !input.bypassValidation) {
				// Validar que tenga vehicleId y creditType
				if (!opportunity[0].vehicleId) {
					throw new Error("La oportunidad debe tener un vehículo asociado");
				}
				if (!opportunity[0].creditType) {
					throw new Error("La oportunidad debe tener un tipo de crédito");
				}

				// Obtener datos del vehículo para verificar si es nuevo
				const vehicleData = await db
					.select({ isNew: vehicles.isNew })
					.from(vehicles)
					.where(eq(vehicles.id, opportunity[0].vehicleId))
					.limit(1);

				const isNewVehicle = vehicleData[0]?.isNew ?? false;

				// Validar inspección del vehículo (solo para vehículos usados)
				if (!isNewVehicle) {
					const inspection = await db
						.select()
						.from(vehicleInspections)
						.where(
							and(
								eq(vehicleInspections.vehicleId, opportunity[0].vehicleId),
								eq(vehicleInspections.status, "approved"),
							),
						)
						.limit(1);

					if (!inspection || inspection.length === 0) {
						throw new Error("El vehículo debe tener una inspección aprobada");
					}
				}
				// Vehículos nuevos no requieren inspección

				// Validar documentos requeridos según tipo de cliente
				const clientType = opportunity[0].clientType || "individual";
				const requiredDocs = await db
					.select()
					.from(documentRequirementsByClientType)
					.where(
						and(
							eq(documentRequirementsByClientType.clientType, clientType),
							eq(
								documentRequirementsByClientType.creditType,
								opportunity[0].creditType,
							),
							eq(documentRequirementsByClientType.required, true),
						),
					);

				const uploadedDocs = await db
					.select()
					.from(opportunityDocuments)
					.where(eq(opportunityDocuments.opportunityId, input.opportunityId));

				const uploadedTypes = new Set(uploadedDocs.map((d) => d.documentType));
				const requiredTypes = requiredDocs.map((r) => r.documentType);
				const missingDocs = requiredTypes.filter((t) => !uploadedTypes.has(t));

				if (missingDocs.length > 0) {
					const docLabels: Record<string, string> = {
						identification: "Identificación (DPI/Pasaporte)",
						income_proof: "Comprobante de Ingresos",
						bank_statement: "Estado de Cuenta Bancario",
						business_license: "Patente de Comercio",
						property_deed: "Escrituras de Propiedad",
						vehicle_title: "Tarjeta de Circulación",
						credit_report: "Reporte Crediticio",
						other: "Otro",
						// Documentos específicos por cliente
						dpi: "DPI",
						licencia: "Licencia",
						recibo_luz: "Recibo de luz",
						recibo_adicional: "Recibo adicional",
						formularios: "Formularios",
						estados_cuenta_1: "Estado de cuenta mes 1",
						estados_cuenta_2: "Estado de cuenta mes 2",
						estados_cuenta_3: "Estado de cuenta mes 3",
						patente_comercio: "Patente de comercio",
						representacion_legal: "Representación Legal",
						constitucion_sociedad: "Constitución de sociedad",
						patente_mercantil: "Patente mercantil",
						iva_1: "Formulario IVA mes 1",
						iva_2: "Formulario IVA mes 2",
						iva_3: "Formulario IVA mes 3",
						estado_financiero: "Estado financiero",
						clausula_consentimiento: "Cláusula de consentimiento",
						minutas: "Minutas",
					};
					const missingLabels = missingDocs
						.map((d) => docLabels[d] || d)
						.join(", ");
					throw new Error(`Faltan documentos obligatorios: ${missingLabels}`);
				}

				// Registrar validación exitosa
				await db.insert(documentValidations).values({
					opportunityId: input.opportunityId,
					validatedBy: context.userId,
					allDocumentsPresent: true,
					vehicleInspected: !isNewVehicle, // Vehículos nuevos no requieren inspección
					missingDocuments: [],
					notes: isNewVehicle
						? "Validación automática al aprobar análisis (vehículo nuevo - sin inspección)"
						: "Validación automática al aprobar análisis",
				});
			}

			// Permitir bypass solo a admin
			if (input.bypassValidation && context.userRole !== "admin") {
				throw new Error("No tienes permisos para omitir la validación");
			}

			// Get the analysis stage
			const analysisStage = await db
				.select()
				.from(salesStages)
				.where(
					eq(
						salesStages.name,
						"Recepción de documentación y traslado a análisis",
					),
				)
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
			const newStageId = input.approved
				? nextStage[0].id
				: opportunity[0].stageId;

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
					reason:
						input.reason ||
						(input.approved
							? "Documentación aprobada"
							: "Documentación rechazada"),
					isOverride: false,
				});
			}

			return { success: true, approved: input.approved };
		}),

	// Approve credit detail (40% → 50% transition)
	approveCreditDetail: crmProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Only admin or sales_supervisor can approve
			if (!PERMISSIONS.canApproveCreditDetail(context.userRole)) {
				throw new Error(
					"Solo supervisores de ventas o administradores pueden aprobar el detalle de crédito",
				);
			}

			// Get current opportunity
			const [opportunity] = await db
				.select()
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity) {
				throw new Error("Oportunidad no encontrada");
			}

			// Already approved
			if (opportunity.creditDetailApproved) {
				throw new Error("El detalle de crédito ya fue aprobado");
			}

			// Validar que los campos requeridos estén llenos
			const camposFaltantes: string[] = [];

			if (!opportunity.categoria) {
				camposFaltantes.push("Categoría");
			}
			if (!opportunity.nit) {
				camposFaltantes.push("NIT");
			}
			if (!opportunity.diaPagoMensual) {
				camposFaltantes.push("Día de pago mensual");
			}

			// Validar dirección desde el lead
			if (opportunity.leadId) {
				const [leadData] = await db
					.select({ direccion: leads.direccion })
					.from(leads)
					.where(eq(leads.id, opportunity.leadId))
					.limit(1);
				if (!leadData?.direccion) {
					camposFaltantes.push("Dirección");
				}
			} else {
				camposFaltantes.push("Lead/Dirección");
			}

			// Validar inversionistas
			if (!opportunity.inversionistas) {
				camposFaltantes.push("Inversionistas");
			} else {
				try {
					const inversionistasParsed = JSON.parse(opportunity.inversionistas);
					if (
						!Array.isArray(inversionistasParsed) ||
						inversionistasParsed.length === 0
					) {
						camposFaltantes.push("Inversionistas");
					}
				} catch {
					camposFaltantes.push("Inversionistas (formato inválido)");
				}
			}

			if (camposFaltantes.length > 0) {
				throw new Error(
					`Faltan campos requeridos para aprobar: ${camposFaltantes.join(", ")}. Guarde los cambios primero.`,
				);
			}

			// Update opportunity with approval
			await db
				.update(opportunities)
				.set({
					creditDetailApproved: true,
					creditDetailApprovedBy: context.userId,
					creditDetailApprovedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(opportunities.id, input.opportunityId));

			return { success: true };
		}),

	// Get credit detail approval status
	getCreditDetailApprovalStatus: crmProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			// Get opportunity
			const [opportunity] = await db
				.select({
					creditDetailApproved: opportunities.creditDetailApproved,
					creditDetailApprovedBy: opportunities.creditDetailApprovedBy,
					creditDetailApprovedAt: opportunities.creditDetailApprovedAt,
				})
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity) {
				throw new Error("Oportunidad no encontrada");
			}

			return {
				approved: opportunity.creditDetailApproved || false,
				approvedBy: opportunity.creditDetailApprovedBy || null,
				approvedAt: opportunity.creditDetailApprovedAt || null,
			};
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
			const userIds = [...new Set(history.map((h) => h.changedById))];
			const stageIds = [
				...new Set(
					history.flatMap((h) => [h.fromStageId, h.toStageId].filter(Boolean)),
				),
			];

			// Fetch users and stages
			const users =
				userIds.length > 0
					? await db
							.select()
							.from(user)
							.where(or(...userIds.map((id) => eq(user.id, id))))
					: [];
			const stages =
				stageIds.length > 0
					? await db
							.select()
							.from(salesStages)
							.where(
								or(
									...stageIds
										.filter((id): id is string => id !== null)
										.map((id) => eq(salesStages.id, id)),
								),
							)
					: [];

			// Map users and stages
			const userMap = new Map(users.map((u) => [u.id, u]));
			const stageMap = new Map(stages.map((s) => [s.id, s]));

			// Return formatted history
			return history.map((h) => ({
				id: h.id,
				changedAt: h.changedAt,
				reason: h.reason,
				isOverride: h.isOverride,
				changedBy: userMap.get(h.changedById)
					? {
							id: userMap.get(h.changedById)!.id,
							name: userMap.get(h.changedById)!.name,
							role: userMap.get(h.changedById)!.role,
						}
					: null,
				fromStage:
					h.fromStageId && stageMap.get(h.fromStageId)
						? {
								id: stageMap.get(h.fromStageId)!.id,
								name: stageMap.get(h.fromStageId)!.name,
							}
						: null,
				toStage: stageMap.get(h.toStageId)
					? {
							id: stageMap.get(h.toStageId)!.id,
							name: stageMap.get(h.toStageId)!.name,
						}
					: null,
			}));
		}),

	// Clients
	getClients: crmProcedure
		.input(
			z.object({
				limit: z.number().min(1).max(100).default(20),
				offset: z.number().min(0).default(0),
				search: z.string().optional(),
				status: z.enum(["active", "inactive", "churned"]).optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const { limit, offset, search, status } = input;
			const conditions: any[] = [];

			// Filter by user if not admin/sales_supervisor
			if (context.userRole !== "admin" && context.userRole !== "sales_supervisor") {
				conditions.push(eq(clients.assignedTo, context.userId));
			}

			// Filter by status
			if (status) {
				conditions.push(eq(clients.status, status));
			}

			// Search filter
			if (search && search.trim() !== "") {
				const searchTerms = search.trim().split(/\s+/);
				const termConditions = searchTerms.map((term) => {
					const searchPattern = `%${term}%`;
					return or(
						ilike(clients.contactPerson, searchPattern),
						ilike(companies.name, searchPattern),
					);
				});
				if (termConditions.length > 0) {
					conditions.push(...termConditions);
				}
			}

			const whereClause =
				conditions.length > 0 ? and(...conditions) : undefined;

			// Get total count
			const countResult = await db
				.select({ count: sql<number>`count(*)` })
				.from(clients)
				.leftJoin(companies, eq(clients.companyId, companies.id))
				.where(whereClause);

			const total = Number(countResult[0]?.count || 0);

			// Get paginated data
			const data = await db
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
				.where(whereClause)
				.orderBy(desc(clients.createdAt))
				.limit(limit)
				.offset(offset);

			return {
				data,
				total,
				limit,
				offset,
			};
		}),

	getClientsStats: crmProcedure.handler(async ({ context }) => {
		const conditions: any[] = [];

		// Filter by user if not admin/sales_supervisor
		if (context.userRole !== "admin" && context.userRole !== "sales_supervisor") {
			conditions.push(eq(clients.assignedTo, context.userId));
		}

		const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

		const allClients = await db
			.select({
				status: clients.status,
				contractValue: clients.contractValue,
			})
			.from(clients)
			.where(whereClause);

		const total = allClients.length;
		const active = allClients.filter((c) => c.status === "active").length;
		const inactive = allClients.filter((c) => c.status === "inactive").length;
		const churned = allClients.filter((c) => c.status === "churned").length;
		const totalContractValue = allClients.reduce((sum, c) => {
			return sum + (Number.parseFloat(c.contractValue || "0") || 0);
		}, 0);

		return {
			total,
			active,
			inactive,
			churned,
			totalContractValue,
		};
	}),

	// NEW: Get leads that are considered "clients" (have at least one closed opportunity)
	// A lead is a client if they have an opportunity with:
	// 1. numeroSifco set, OR
	// 2. stage with closurePercentage = 100
	getLeadsAsClients: crmProcedure
		.input(
			z.object({
				limit: z.number().min(1).max(100).default(20),
				offset: z.number().min(0).default(0),
				search: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const { limit, offset, search } = input;

			// First, get all stages with 100% closure
			const closedStages = await db
				.select({ id: salesStages.id })
				.from(salesStages)
				.where(gte(salesStages.closurePercentage, 100));

			const closedStageIds = closedStages.map((s) => s.id);

			// Build subquery to find leads with at least one closed opportunity
			// A closed opportunity is one with numeroSifco OR in a 100% stage
			const leadsWithClosedOpportunities = await db
				.selectDistinct({ leadId: opportunities.leadId })
				.from(opportunities)
				.leftJoin(salesStages, eq(opportunities.stageId, salesStages.id))
				.where(
					and(
						isNotNull(opportunities.leadId),
						or(
							isNotNull(opportunities.numeroSifco),
							closedStageIds.length > 0
								? sql`${opportunities.stageId} IN (${sql.join(
										closedStageIds.map((id) => sql`${id}`),
										sql`, `,
									)})`
								: sql`false`,
						),
					),
				);

			const clientLeadIds = leadsWithClosedOpportunities
				.map((r) => r.leadId)
				.filter((id): id is string => id !== null);

			if (clientLeadIds.length === 0) {
				return {
					data: [],
					total: 0,
					limit,
					offset,
				};
			}

			// Build conditions for the main query
			const conditions: any[] = [
				sql`${leads.id} IN (${sql.join(
					clientLeadIds.map((id) => sql`${id}`),
					sql`, `,
				)})`,
			];

			// Filter by user if not admin/sales_supervisor
			if (context.userRole !== "admin" && context.userRole !== "sales_supervisor") {
				conditions.push(eq(leads.assignedTo, context.userId));
			}

			// Search filter
			if (search && search.trim() !== "") {
				const searchPattern = `%${search.trim()}%`;
				conditions.push(
					or(
						ilike(leads.firstName, searchPattern),
						ilike(leads.lastName, searchPattern),
						ilike(leads.email, searchPattern),
						ilike(leads.phone, searchPattern),
						ilike(leads.dpi, searchPattern),
					),
				);
			}

			const whereClause = and(...conditions);

			// Get total count
			const countResult = await db
				.select({ count: sql<number>`count(*)` })
				.from(leads)
				.where(whereClause);

			const total = Number(countResult[0]?.count || 0);

			// Get paginated leads
			const clientLeads = await db
				.select({
					id: leads.id,
					firstName: leads.firstName,
					lastName: leads.lastName,
					email: leads.email,
					phone: leads.phone,
					dpi: leads.dpi,
					age: leads.age,
					clientType: leads.clientType,
					maritalStatus: leads.maritalStatus,
					dependents: leads.dependents,
					monthlyIncome: leads.monthlyIncome,
					loanAmount: leads.loanAmount,
					occupation: leads.occupation,
					workTime: leads.workTime,
					ownsHome: leads.ownsHome,
					ownsVehicle: leads.ownsVehicle,
					hasCreditCard: leads.hasCreditCard,
					jobTitle: leads.jobTitle,
					assignedTo: leads.assignedTo,
					createdAt: leads.createdAt,
					updatedAt: leads.updatedAt,
					assignedUser: {
						id: user.id,
						name: user.name,
					},
				})
				.from(leads)
				.leftJoin(user, eq(leads.assignedTo, user.id))
				.where(whereClause)
				.orderBy(desc(leads.createdAt))
				.limit(limit)
				.offset(offset);

			// Now get the opportunities for each lead
			const leadIds = clientLeads.map((l) => l.id);

			const leadsOpportunities =
				leadIds.length > 0
					? await db
							.select({
								id: opportunities.id,
								title: opportunities.title,
								leadId: opportunities.leadId,
								value: opportunities.value,
								creditType: opportunities.creditType,
								numeroSifco: opportunities.numeroSifco,
								status: opportunities.status,
								createdAt: opportunities.createdAt,
								stage: {
									id: salesStages.id,
									name: salesStages.name,
									closurePercentage: salesStages.closurePercentage,
									color: salesStages.color,
								},
							})
							.from(opportunities)
							.leftJoin(salesStages, eq(opportunities.stageId, salesStages.id))
							.where(
								sql`${opportunities.leadId} IN (${sql.join(
									leadIds.map((id) => sql`${id}`),
									sql`, `,
								)})`,
							)
							.orderBy(desc(opportunities.createdAt))
					: [];

			// Group opportunities by lead
			const opportunitiesByLead = leadsOpportunities.reduce(
				(acc, opp) => {
					const leadId = opp.leadId;
					if (leadId) {
						if (!acc[leadId]) {
							acc[leadId] = [];
						}
						acc[leadId].push({
							id: opp.id,
							title: opp.title,
							value: opp.value,
							creditType: opp.creditType,
							numeroSifco: opp.numeroSifco,
							status: opp.status,
							createdAt: opp.createdAt,
							stage: opp.stage,
							isClosed:
								opp.numeroSifco !== null ||
								(opp.stage?.closurePercentage ?? 0) >= 100,
						});
					}
					return acc;
				},
				{} as Record<string, any[]>,
			);

			// Get credit analysis for each lead
			const creditAnalysisByLead =
				leadIds.length > 0
					? await db
							.select({
								leadId: creditAnalysis.leadId,
								monthlyFixedIncome: creditAnalysis.monthlyFixedIncome,
								monthlyVariableIncome: creditAnalysis.monthlyVariableIncome,
								monthlyFixedExpenses: creditAnalysis.monthlyFixedExpenses,
								monthlyVariableExpenses: creditAnalysis.monthlyVariableExpenses,
								economicAvailability: creditAnalysis.economicAvailability,
								minPayment: creditAnalysis.minPayment,
								maxPayment: creditAnalysis.maxPayment,
								adjustedPayment: creditAnalysis.adjustedPayment,
								maxCreditAmount: creditAnalysis.maxCreditAmount,
								analyzedAt: creditAnalysis.analyzedAt,
							})
							.from(creditAnalysis)
							.where(
								sql`${creditAnalysis.leadId} IN (${sql.join(
									leadIds.map((id) => sql`${id}`),
									sql`, `,
								)})`,
							)
					: [];

			// Map credit analysis by lead ID
			const creditAnalysisMap = creditAnalysisByLead.reduce(
				(acc, ca) => {
					if (ca.leadId) {
						acc[ca.leadId] = ca;
					}
					return acc;
				},
				{} as Record<string, (typeof creditAnalysisByLead)[0]>,
			);

			// Combine leads with their opportunities and credit analysis
			const data = clientLeads.map((lead) => ({
				...lead,
				opportunities: opportunitiesByLead[lead.id] || [],
				creditAnalysis: creditAnalysisMap[lead.id] || null,
				// Calculate total value from closed opportunities
				totalClosedValue: (opportunitiesByLead[lead.id] || [])
					.filter((opp: any) => opp.isClosed)
					.reduce(
						(sum: number, opp: any) =>
							sum + (Number.parseFloat(opp.value || "0") || 0),
						0,
					),
				// Count of closed opportunities
				closedOpportunitiesCount: (opportunitiesByLead[lead.id] || []).filter(
					(opp: any) => opp.isClosed,
				).length,
			}));

			return {
				data,
				total,
				limit,
				offset,
			};
		}),

	createClient: crmProcedure
		.input(
			z.object({
				companyId: z.string().uuid(),
				contactPerson: z.string().min(1, "Contact person is required"),
				contractValue: z.string().optional(),
				startDate: z.string().optional(), // ISO date string
				endDate: z.string().optional(), // ISO date string
				assignedTo: z.string().optional(), // Better Auth user ID (text, not UUID)
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
				assignedTo: z.string().optional(), // Better Auth user ID (text, not UUID)
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

	// Document Management
	getOpportunityDocuments: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			// Verificar que el usuario tenga acceso a la oportunidad
			const opportunity = await db
				.select()
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity[0]) {
				throw new Error("Oportunidad no encontrada");
			}

			// Para ventas, verificar que sea su oportunidad
			if (
				context.userRole === "sales" &&
				opportunity[0].assignedTo !== context.userId
			) {
				throw new Error("No tienes permiso para ver estos documentos");
			}

			// Obtener documentos con información del usuario que los subió
			const documents = await db
				.select({
					id: opportunityDocuments.id,
					filename: opportunityDocuments.filename,
					originalName: opportunityDocuments.originalName,
					mimeType: opportunityDocuments.mimeType,
					size: opportunityDocuments.size,
					documentType: opportunityDocuments.documentType,
					description: opportunityDocuments.description,
					uploadedAt: opportunityDocuments.uploadedAt,
					filePath: opportunityDocuments.filePath,
					uploadedBy: {
						id: user.id,
						name: user.name,
					},
				})
				.from(opportunityDocuments)
				.leftJoin(user, eq(opportunityDocuments.uploadedBy, user.id))
				.where(eq(opportunityDocuments.opportunityId, input.opportunityId))
				.orderBy(opportunityDocuments.uploadedAt);

			// Generar URLs firmadas para cada documento
			const documentsWithUrls = await Promise.all(
				documents.map(async (doc) => {
					const url = await getFileUrl(doc.filePath);
					return {
						...doc,
						url,
					};
				}),
			);

			return documentsWithUrls;
		}),

	uploadOpportunityDocument: crmProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				documentType: z.enum(documentTypeEnum.enumValues),
				description: z.string().optional(),
				file: z.object({
					name: z.string(),
					type: z.string(),
					size: z.number(),
					data: z.string(), // Base64
				}),
			}),
		)
		.handler(async ({ input, context }) => {
			// Verificar acceso a la oportunidad
			const opportunity = await db
				.select()
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity[0]) {
				throw new Error("Oportunidad no encontrada");
			}

			// Admin, sales, sales_supervisor y analyst pueden subir documentos
			if (!["admin", "sales", "sales_supervisor", "analyst"].includes(context.userRole)) {
				throw new Error("No tienes permiso para subir documentos");
			}

			// Para sales, verificar que sea su oportunidad
			if (
				context.userRole === "sales" &&
				opportunity[0].assignedTo !== context.userId
			) {
				throw new Error(
					"No tienes permiso para subir documentos a esta oportunidad",
				);
			}

			// Crear un File/Blob desde los datos
			const fileBuffer = Buffer.from(input.file.data, "base64");
			const fileBlob = new Blob([fileBuffer], { type: input.file.type });

			// Validar archivo
			const validation = validateFile({
				type: input.file.type,
				size: input.file.size,
			} as File);

			if (!validation.valid) {
				throw new Error(validation.error);
			}

			// Generar nombre único
			const uniqueFilename = generateUniqueFilename(input.file.name);

			// Subir a R2
			const { key } = await uploadFileToR2(
				fileBlob,
				uniqueFilename,
				input.opportunityId,
			);

			// Guardar en base de datos
			const [newDocument] = await db
				.insert(opportunityDocuments)
				.values({
					opportunityId: input.opportunityId,
					filename: uniqueFilename,
					originalName: input.file.name,
					mimeType: input.file.type,
					size: input.file.size,
					documentType: input.documentType,
					description: input.description,
					uploadedBy: context.userId,
					filePath: key,
				})
				.returning();

			await updateChecklistForClientDocument(
				input.opportunityId,
				input.documentType,
				newDocument.id,
				!!opportunity[0]?.vehicleId,
				opportunity[0]?.vehicleId || undefined,
			);

			return newDocument;
		}),

	deleteOpportunityDocument: crmProcedure
		.input(
			z.object({
				documentId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Obtener el documento
			const [document] = await db
				.select()
				.from(opportunityDocuments)
				.where(eq(opportunityDocuments.id, input.documentId))
				.limit(1);

			if (!document) {
				throw new Error("Documento no encontrado");
			}

			// Verificar permisos
			if (
				context.userRole === "admin" ||
				document.uploadedBy === context.userId
			) {
				// Eliminar de R2
				await deleteFileFromR2(document.filePath);

				// Eliminar de la base de datos
				await db
					.delete(opportunityDocuments)
					.where(eq(opportunityDocuments.id, input.documentId));

				return { success: true };
			}
			throw new Error("No tienes permiso para eliminar este documento");
		}),

	// Validate opportunity documents - Para analistas
	validateOpportunityDocuments: analystProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input }) => {
			try {
				// 1. Obtener oportunidad con información del lead
				const [opp] = await db
					.select({
						id: opportunities.id,
						creditType: opportunities.creditType,
						vehicleId: opportunities.vehicleId,
						leadId: opportunities.leadId,
						clientType: leads.clientType,
					})
					.from(opportunities)
					.leftJoin(leads, eq(opportunities.leadId, leads.id))
					.where(eq(opportunities.id, input.opportunityId))
					.limit(1);

				if (!opp) {
					throw new Error("Oportunidad no encontrada");
				}

				// Si falta creditType, no podemos determinar requisitos
				if (!opp.creditType) {
					return {
						creditType: "unknown",
						vehicleInspected: false,
						allDocumentsPresent: false,
						canApprove: false,
						requiredDocuments: [],
						uploadedDocuments: [],
						missingDocuments: [],
						vehicleInfo: {
							id: opp.vehicleId || null,
							inspectionStatus: "pending",
						},
					};
				}

				// 2. Validar inspección del vehículo (solo si hay vehículo asociado)
				let vehicleInspected = false;
				let inspectionStatus = "pending";
				let isNewVehicle = false;
				if (opp.vehicleId) {
					// Obtener info del vehículo para verificar si es nuevo
					const [vehicleData] = await db
						.select({ isNew: vehicles.isNew })
						.from(vehicles)
						.where(eq(vehicles.id, opp.vehicleId))
						.limit(1);

					isNewVehicle = vehicleData?.isNew ?? false;

					// Vehículos nuevos no requieren inspección
					if (isNewVehicle) {
						vehicleInspected = true;
						inspectionStatus = "not_required";
					} else {
						const inspection = await db
							.select()
							.from(vehicleInspections)
							.where(
								and(
									eq(vehicleInspections.vehicleId, opp.vehicleId),
									eq(vehicleInspections.status, "approved"),
								),
							)
							.limit(1);

						vehicleInspected = inspection.length > 0;
						if (inspection.length > 0) {
							inspectionStatus = inspection[0].status;
						}
					}
				}

				// 3. Obtener documentos requeridos según tipo de cliente y crédito
				const clientType = opp.clientType || "individual";
				const requiredDocs = await db
					.select()
					.from(documentRequirementsByClientType)
					.where(
						and(
							eq(documentRequirementsByClientType.clientType, clientType),
							eq(documentRequirementsByClientType.creditType, opp.creditType),
							eq(documentRequirementsByClientType.required, true),
						),
					)
					.orderBy(documentRequirementsByClientType.order);

				// 4. Obtener documentos subidos
				const uploadedDocs = await db
					.select()
					.from(opportunityDocuments)
					.where(eq(opportunityDocuments.opportunityId, input.opportunityId));

				// 5. Calcular documentos faltantes
				const uploadedTypes = new Set(uploadedDocs.map((d) => d.documentType));
				const requiredTypes = requiredDocs.map((r) => r.documentType);
				const missingDocs = requiredTypes.filter((t) => !uploadedTypes.has(t));

				const allDocumentsPresent = missingDocs.length === 0;
				const canApprove = allDocumentsPresent && vehicleInspected;

				return {
					creditType: opp.creditType,
					vehicleInspected,
					allDocumentsPresent,
					canApprove,
					requiredDocuments: requiredDocs,
					uploadedDocuments: uploadedDocs,
					missingDocuments: missingDocs,
					vehicleInfo: {
						id: opp.vehicleId,
						inspectionStatus,
					},
				};
			} catch (error) {
				console.error("[validateOpportunityDocuments] ERROR:", error);
				throw error;
			}
		}),

	// Get document requirements by client type
	getDocumentRequirementsByClientType: crmProcedure
		.input(
			z.object({
				clientType: z.enum(["individual", "comerciante", "empresa"]),
				creditType: z.enum(["autocompra", "sobre_vehiculo"]),
			}),
		)
		.handler(async ({ input }) => {
			const requirements = await db
				.select()
				.from(documentRequirementsByClientType)
				.where(
					and(
						eq(documentRequirementsByClientType.clientType, input.clientType),
						eq(documentRequirementsByClientType.creditType, input.creditType),
					),
				)
				.orderBy(documentRequirementsByClientType.order);

			return requirements;
		}),

	// Get analysis checklist for an opportunity
	getAnalysisChecklist: analystProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input }) => {
			// Get opportunity with lead info
			const [opportunity] = await db
				.select({
					id: opportunities.id,
					creditType: opportunities.creditType,
					vehicleId: opportunities.vehicleId,
					leadId: opportunities.leadId,
					clientType: leads.clientType,
				})
				.from(opportunities)
				.leftJoin(leads, eq(opportunities.leadId, leads.id))
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity) {
				throw new Error("Oportunidad no encontrada");
			}

			console.log("[getAnalysisChecklist] opportunity:", opportunity);

			// Check if checklist already exists
			const [existingChecklist] = await db
				.select()
				.from(analysisChecklists)
				.where(eq(analysisChecklists.opportunityId, input.opportunityId))
				.limit(1);

			if (existingChecklist) {
				return existingChecklist.checklistData;
			}

			// Get required documents for this client type
			const requiredDocs = await db
				.select()
				.from(documentRequirementsByClientType)
				.where(
					and(
						eq(
							documentRequirementsByClientType.clientType,
							opportunity.clientType || "individual",
						),
						eq(
							documentRequirementsByClientType.creditType,
							opportunity.creditType,
						),
					),
				)
				.orderBy(documentRequirementsByClientType.order);

			// Get uploaded documents
			const uploadedDocs = await db
				.select()
				.from(opportunityDocuments)
				.where(eq(opportunityDocuments.opportunityId, input.opportunityId));

			const uploadedTypes = new Set(uploadedDocs.map((d) => d.documentType));

			// Check vehicle inspection and get vehicle info
			let vehicleInspected = false;
			let inspectionId = null;
			let vehicleOwnerType = null;
			if (opportunity.vehicleId) {
				// Get vehicle info including ownerType
				const [vehicle] = await db
					.select()
					.from(vehicles)
					.where(eq(vehicles.id, opportunity.vehicleId))
					.limit(1);

				if (vehicle) {
					vehicleOwnerType = vehicle.ownerType;

					// Vehículos nuevos no requieren inspección
					if (vehicle.isNew) {
						vehicleInspected = true;
					} else {
						// Check inspection solo para vehículos usados
						const [inspection] = await db
							.select()
							.from(vehicleInspections)
							.where(
								and(
									eq(vehicleInspections.vehicleId, opportunity.vehicleId),
									eq(vehicleInspections.status, "approved"),
								),
							)
							.limit(1);

						if (inspection) {
							vehicleInspected = true;
							inspectionId = inspection.id;
						}
					}
				}
			}

			// Get required vehicle documents based on ownerType
			let requiredVehicleDocs: any[] = [];
			let uploadedVehicleDocs: any[] = [];
			if (opportunity.vehicleId && vehicleOwnerType) {
				requiredVehicleDocs = await db
					.select()
					.from(vehicleDocumentRequirements)
					.where(eq(vehicleDocumentRequirements.ownerType, vehicleOwnerType))
					.orderBy(vehicleDocumentRequirements.order);

				uploadedVehicleDocs = await db
					.select()
					.from(vehicleDocuments)
					.where(eq(vehicleDocuments.vehicleId, opportunity.vehicleId));
			}

			const uploadedVehicleTypes = new Set(
				uploadedVehicleDocs.map((d) => d.documentType),
			);

			// Check if credit analysis exists
			let creditAnalysisExists = null;
			if (opportunity.leadId) {
				[creditAnalysisExists] = await db
					.select()
					.from(creditAnalysis)
					.where(eq(creditAnalysis.leadId, opportunity.leadId))
					.limit(1);
			}

			console.log(
				"[getAnalysisChecklist] creditAnalysisExists:",
				creditAnalysisExists,
			);

			// Create initial checklist structure
			const checklistData = {
				sections: {
					documentos: {
						completed:
							requiredDocs.length > 0 &&
							requiredDocs.every((doc) => uploadedTypes.has(doc.documentType)),
						items: requiredDocs.map((doc) => ({
							documentType: doc.documentType,
							required: doc.required,
							description: doc.description,
							uploaded: uploadedTypes.has(doc.documentType),
							documentId: uploadedDocs.find(
								(ud) => ud.documentType === doc.documentType,
							)?.id,
						})),
					},
					verificaciones: {
						completed: false,
						items: [
							{
								name: "RTU - Validar que no sea PEP",
								type: "rtu_pep",
								required: true,
								completed: false,
							},
							{
								name: "RTU - Confirmar empresa registrada",
								type: "rtu_empresa",
								required: opportunity.clientType !== "individual",
								completed: false,
							},
							{
								name: "Revisar cliente/empresa en internet y redes sociales",
								type: "revision_internet",
								required: true,
								completed: false,
							},
							{
								name: "Confirmación de referencias",
								type: "confirmacion_referencias",
								required: true,
								completed: false,
							},
							{
								name: "Confirmación de lugar de trabajo",
								type: "confirmacion_trabajo",
								required: true,
								completed: false,
							},
							{
								name: "Confirmación de negocio propio",
								type: "confirmacion_negocio",
								required: opportunity.clientType !== "individual",
								completed: false,
							},
							{
								name: "Análisis de capacidad de pago",
								type: "capacidad_pago",
								required: true,
								completed: !!creditAnalysisExists,
								analysisId: creditAnalysisExists?.id,
							},
							{
								name: "Consulta Infornet",
								type: "infornet",
								required: true,
								completed: false,
							},
							{
								name: "Verificación de dirección domicilio",
								type: "verificacion_direccion",
								required: true,
								completed: false,
							},
						],
					},
					vehiculo: {
						completed: false, // Will be calculated below
						vehicleId: opportunity.vehicleId,
						ownerType: vehicleOwnerType,
						inspected: vehicleInspected,
						inspectionId,
						// Vehicle documents subsection
						documentos: {
							completed:
								requiredVehicleDocs.length > 0 &&
								requiredVehicleDocs.every((doc) =>
									uploadedVehicleTypes.has(doc.documentType),
								),
							items: requiredVehicleDocs.map((doc) => ({
								documentType: doc.documentType,
								required: doc.required,
								uploaded: uploadedVehicleTypes.has(doc.documentType),
								documentId: uploadedVehicleDocs.find(
									(ud) => ud.documentType === doc.documentType,
								)?.id,
							})),
						},
						// Vehicle verifications subsection (manual checkboxes)
						verificaciones: {
							completed: false,
							items: [
								{
									name: "Consulta WhatsApp con AutoEfectivo",
									type: "whatsapp_autoefectivo",
									required: true,
									completed: false,
								},
								{
									name: "Consulta WhatsApp con INREXA",
									type: "whatsapp_inrexa",
									required: true,
									completed: false,
								},
								{
									name: "Consulta SAT (Portal web)",
									type: "consulta_sat_portal",
									required: true,
									completed: false,
								},
								{
									name: "Consulta Garantías Mobiliarias (RGM)",
									type: "consulta_rgm",
									required: true,
									completed: false,
								},
							],
						},
					},
				},
				overallProgress: 0,
				canApprove: false,
			};

			// Calculate vehicle section completion
			checklistData.sections.vehiculo.verificaciones.completed =
				checklistData.sections.vehiculo.verificaciones.items
					.filter((i: any) => i.required)
					.every((i: any) => i.completed);

			checklistData.sections.vehiculo.completed =
				vehicleInspected &&
				checklistData.sections.vehiculo.documentos.completed &&
				checklistData.sections.vehiculo.verificaciones.completed;

			// Calculate overall progress
			const totalItems =
				checklistData.sections.documentos.items.length + // client docs
				checklistData.sections.verificaciones.items.filter((i) => i.required)
					.length + // client verifications
				(opportunity.vehicleId ? 1 : 0) + // vehicle inspection
				(opportunity.vehicleId
					? checklistData.sections.vehiculo.documentos.items.length
					: 0) + // vehicle docs
				(opportunity.vehicleId
					? checklistData.sections.vehiculo.verificaciones.items.filter(
							(i: any) => i.required,
						).length
					: 0); // vehicle verifications

			const completedItems =
				checklistData.sections.documentos.items.filter((i) => i.uploaded)
					.length + // client docs uploaded
				checklistData.sections.verificaciones.items.filter(
					(i) => i.required && i.completed,
				).length + // client verifications completed
				(vehicleInspected ? 1 : 0) + // vehicle inspection
				(opportunity.vehicleId
					? checklistData.sections.vehiculo.documentos.items.filter(
							(i: any) => i.uploaded,
						).length
					: 0) + // vehicle docs uploaded
				(opportunity.vehicleId
					? checklistData.sections.vehiculo.verificaciones.items.filter(
							(i: any) => i.required && i.completed,
						).length
					: 0); // vehicle verifications completed

			checklistData.overallProgress = Math.round(
				(completedItems / totalItems) * 100,
			);

			// Can approve if all sections are completed
			checklistData.sections.verificaciones.completed =
				checklistData.sections.verificaciones.items
					.filter((i) => i.required)
					.every((i) => i.completed);

			checklistData.canApprove =
				checklistData.sections.documentos.completed &&
				checklistData.sections.verificaciones.completed &&
				(opportunity.vehicleId
					? checklistData.sections.vehiculo.completed
					: true); // Only require vehicle section if there's a vehicle

			// Save initial checklist
			await db.insert(analysisChecklists).values({
				opportunityId: input.opportunityId,
				checklistData,
			});

			return checklistData;
		}),

	// Update analysis checklist verification
	updateAnalysisChecklistVerification: analystProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				verificationType: z.string(),
				completed: z.boolean(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Get existing checklist
			const [existing] = await db
				.select()
				.from(analysisChecklists)
				.where(eq(analysisChecklists.opportunityId, input.opportunityId))
				.limit(1);

			if (!existing) {
				throw new Error("Checklist no encontrado");
			}

			const checklistData = existing.checklistData as any;

			// Update the specific verification
			const item = checklistData.sections.verificaciones.items.find(
				(i: any) => i.type === input.verificationType,
			);

			if (item) {
				item.completed = input.completed;
				if (input.completed) {
					item.verifiedBy = context.userId;
					item.verifiedAt = new Date().toISOString();
				} else {
					delete item.verifiedBy;
					delete item.verifiedAt;
				}
			}

			// Recalculate completion status
			checklistData.sections.verificaciones.completed =
				checklistData.sections.verificaciones.items
					.filter((i: any) => i.required)
					.every((i: any) => i.completed);

			// Recalculate overall progress
			const [opportunity] = await db
				.select({ vehicleId: opportunities.vehicleId })
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			let vehicleInspected = false;
			if (opportunity?.vehicleId) {
				const [inspection] = await db
					.select()
					.from(vehicleInspections)
					.where(
						and(
							eq(vehicleInspections.vehicleId, opportunity.vehicleId),
							eq(vehicleInspections.status, "approved"),
						),
					)
					.limit(1);
				vehicleInspected = !!inspection;
				if (!vehicleInspected) {
						const [vehicle] = await db
					.select()
					.from(vehicles)
					.where(eq(vehicles.id, opportunity.vehicleId))
					.limit(1);

					if (vehicle?.isNew) {
						vehicleInspected = true;
					}

				}
			}

			// Recalculate vehicle section if exists
			if (opportunity?.vehicleId && checklistData.sections.vehiculo) {
				// Recalculate vehicle verifications completion
				if (checklistData.sections.vehiculo.verificaciones) {
					checklistData.sections.vehiculo.verificaciones.completed =
						checklistData.sections.vehiculo.verificaciones.items
							.filter((i: any) => i.required)
							.every((i: any) => i.completed);
				}

				// Recalculate vehicle section completion
				checklistData.sections.vehiculo.completed =
					vehicleInspected &&
					(checklistData.sections.vehiculo.documentos?.completed ?? false) &&
					(checklistData.sections.vehiculo.verificaciones?.completed ?? false);
			}

			const totalItems =
				checklistData.sections.documentos.items.length + // client docs
				checklistData.sections.verificaciones.items.filter(
					(i: any) => i.required,
				).length + // client verifications
				(opportunity?.vehicleId ? 1 : 0) + // vehicle inspection
				(opportunity?.vehicleId && checklistData.sections.vehiculo?.documentos
					? checklistData.sections.vehiculo.documentos.items.length
					: 0) + // vehicle docs
				(opportunity?.vehicleId &&
				checklistData.sections.vehiculo?.verificaciones
					? checklistData.sections.vehiculo.verificaciones.items.filter(
							(i: any) => i.required,
						).length
					: 0); // vehicle verifications

			const completedItems =
				checklistData.sections.documentos.items.filter((i: any) => i.uploaded)
					.length + // client docs uploaded
				checklistData.sections.verificaciones.items.filter(
					(i: any) => i.required && i.completed,
				).length + // client verifications completed
				(vehicleInspected ? 1 : 0) + // vehicle inspection
				(opportunity?.vehicleId && checklistData.sections.vehiculo?.documentos
					? checklistData.sections.vehiculo.documentos.items.filter(
							(i: any) => i.uploaded,
						).length
					: 0) + // vehicle docs uploaded
				(opportunity?.vehicleId &&
				checklistData.sections.vehiculo?.verificaciones
					? checklistData.sections.vehiculo.verificaciones.items.filter(
							(i: any) => i.required && i.completed,
						).length
					: 0); // vehicle verifications completed

			checklistData.overallProgress = Math.round(
				(completedItems / totalItems) * 100,
			);

			checklistData.canApprove =
				checklistData.sections.documentos.completed &&
				checklistData.sections.verificaciones.completed &&
				(opportunity?.vehicleId
					? (checklistData.sections.vehiculo?.completed ?? false)
					: true);

			// Update checklist
			await db
				.update(analysisChecklists)
				.set({
					checklistData,
					updatedAt: new Date(),
				})
				.where(eq(analysisChecklists.opportunityId, input.opportunityId));

			return checklistData;
		}),

	// Update vehicle verification in analysis checklist
	updateAnalysisChecklistVehicleVerification: analystProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				verificationType: z.string(),
				completed: z.boolean(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Get existing checklist
			const [existing] = await db
				.select()
				.from(analysisChecklists)
				.where(eq(analysisChecklists.opportunityId, input.opportunityId))
				.limit(1);

			if (!existing) {
				throw new Error("Checklist no encontrado");
			}

			const checklistData = existing.checklistData as any;

			// Verify vehicle section exists
			if (!checklistData.sections.vehiculo?.verificaciones) {
				throw new Error(
					"La sección de verificaciones de vehículo no existe en este checklist",
				);
			}

			// Update the specific vehicle verification
			const item = checklistData.sections.vehiculo.verificaciones.items.find(
				(i: any) => i.type === input.verificationType,
			);

			if (item) {
				item.completed = input.completed;
				if (input.completed) {
					item.verifiedBy = context.userId;
					item.verifiedAt = new Date().toISOString();
				} else {
					delete item.verifiedBy;
					delete item.verifiedAt;
				}
			}

			// Recalculate vehicle verifications completion
			checklistData.sections.vehiculo.verificaciones.completed =
				checklistData.sections.vehiculo.verificaciones.items
					.filter((i: any) => i.required)
					.every((i: any) => i.completed);

			// Get opportunity and vehicle inspection status
			const [opportunity] = await db
				.select({ vehicleId: opportunities.vehicleId })
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			let vehicleInspected = false;
			if (opportunity?.vehicleId) {
				const [inspection] = await db
					.select()
					.from(vehicleInspections)
					.where(
						and(
							eq(vehicleInspections.vehicleId, opportunity.vehicleId),
							eq(vehicleInspections.status, "approved"),
						),
					)
					.limit(1);
				vehicleInspected = !!inspection;
			}

			// Recalculate vehicle section completion
			checklistData.sections.vehiculo.completed =
				vehicleInspected &&
				(checklistData.sections.vehiculo.documentos?.completed ?? false) &&
				checklistData.sections.vehiculo.verificaciones.completed;

			// Recalculate client verificaciones completion
			checklistData.sections.verificaciones.completed =
				checklistData.sections.verificaciones.items
					.filter((i: any) => i.required)
					.every((i: any) => i.completed);

			// Recalculate overall progress
			const totalItems =
				checklistData.sections.documentos.items.length + // client docs
				checklistData.sections.verificaciones.items.filter(
					(i: any) => i.required,
				).length + // client verifications
				(opportunity?.vehicleId ? 1 : 0) + // vehicle inspection
				(opportunity?.vehicleId && checklistData.sections.vehiculo?.documentos
					? checklistData.sections.vehiculo.documentos.items.length
					: 0) + // vehicle docs
				(opportunity?.vehicleId &&
				checklistData.sections.vehiculo?.verificaciones
					? checklistData.sections.vehiculo.verificaciones.items.filter(
							(i: any) => i.required,
						).length
					: 0); // vehicle verifications

			const completedItems =
				checklistData.sections.documentos.items.filter((i: any) => i.uploaded)
					.length + // client docs uploaded
				checklistData.sections.verificaciones.items.filter(
					(i: any) => i.required && i.completed,
				).length + // client verifications completed
				(vehicleInspected ? 1 : 0) + // vehicle inspection
				(opportunity?.vehicleId && checklistData.sections.vehiculo?.documentos
					? checklistData.sections.vehiculo.documentos.items.filter(
							(i: any) => i.uploaded,
						).length
					: 0) + // vehicle docs uploaded
				(opportunity?.vehicleId &&
				checklistData.sections.vehiculo?.verificaciones
					? checklistData.sections.vehiculo.verificaciones.items.filter(
							(i: any) => i.required && i.completed,
						).length
					: 0); // vehicle verifications completed

			checklistData.overallProgress = Math.round(
				(completedItems / totalItems) * 100,
			);

			checklistData.canApprove =
				checklistData.sections.documentos.completed &&
				checklistData.sections.verificaciones.completed &&
				(opportunity?.vehicleId
					? (checklistData.sections.vehiculo?.completed ?? false)
					: true);

			// Update checklist
			await db
				.update(analysisChecklists)
				.set({
					checklistData,
					updatedAt: new Date(),
				})
				.where(eq(analysisChecklists.opportunityId, input.opportunityId));

			return checklistData;
		}),

	// ============================================================
	// DISBURSEMENT CHECKLIST ENDPOINTS (90% → 100%)
	// ============================================================

	// Get or create disbursement checklist for an opportunity
	getDisbursementChecklist: analystProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input }) => {
			// Check if opportunity exists and is at 90%
			const [opportunity] = await db
				.select({
					id: opportunities.id,
					stageId: opportunities.stageId,
					leadId: opportunities.leadId,
					value: opportunities.value,
					disbursementApproved: opportunities.disbursementApproved,
				})
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity) {
				throw new Error("Oportunidad no encontrada");
			}

			// Get stage info
			const [stage] = await db
				.select()
				.from(salesStages)
				.where(eq(salesStages.id, opportunity.stageId))
				.limit(1);

			if (!stage || stage.closurePercentage !== 90) {
				throw new Error(
					"Esta oportunidad no está en la etapa de 90% para desembolso",
				);
			}

			// Get lead info
			let lead: { firstName: string; lastName: string } | undefined;
			if (opportunity.leadId) {
				const [leadResult] = await db
					.select({
						firstName: leads.firstName,
						lastName: leads.lastName,
					})
					.from(leads)
					.where(eq(leads.id, opportunity.leadId))
					.limit(1);
				lead = leadResult;
			}

			// Try to get existing checklist
			let [checklist] = await db
				.select()
				.from(disbursementChecklists)
				.where(eq(disbursementChecklists.opportunityId, input.opportunityId))
				.limit(1);

			// If no checklist exists, create one
			if (!checklist) {
				const [newChecklist] = await db
					.insert(disbursementChecklists)
					.values({
						opportunityId: input.opportunityId,
					})
					.returning();
				checklist = newChecklist;
			}

			// Calculate progress
			const items = [
				{
					key: "traspasoRealizado",
					label: "Traspaso del vehículo realizado",
					completed: checklist.traspasoRealizado,
				},
				{
					key: "documentosEnviadosAsesor",
					label: "Documentos enviados al asesor para firmas del vendedor",
					completed: checklist.documentosEnviadosAsesor,
				},
				{
					key: "documentosFirmadosRecibidos",
					label: "Documentos firmados recibidos",
					completed: checklist.documentosFirmadosRecibidos,
				},
				{
					key: "copiaLlaveRecibida",
					label: "Copia de llave recibida",
					completed: checklist.copiaLlaveRecibida,
				},
				{
					key: "engancheValidado",
					label: "Enganche completo validado",
					completed: checklist.engancheValidado,
				},
				{
					key: "listoDesembolsar",
					label: "Listo para desembolsar",
					completed: checklist.listoDesembolsar,
				},
			];

			const completedCount = items.filter((item) => item.completed).length;
			const progress = Math.round((completedCount / items.length) * 100);
			const canApprove = items.every((item) => item.completed);

			return {
				id: checklist.id,
				opportunityId: checklist.opportunityId,
				items,
				progress,
				canApprove,
				notes: checklist.notes,
				completedBy: checklist.completedBy,
				completedAt: checklist.completedAt,
				lead: lead ? `${lead.firstName} ${lead.lastName}` : "N/A",
				value: opportunity.value,
				disbursementApproved: opportunity.disbursementApproved,
			};
		}),

	// Update a specific item in the disbursement checklist
	updateDisbursementChecklistItem: analystProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				itemKey: z.enum([
					"traspasoRealizado",
					"documentosEnviadosAsesor",
					"documentosFirmadosRecibidos",
					"copiaLlaveRecibida",
					"engancheValidado",
					"listoDesembolsar",
				]),
				completed: z.boolean(),
			}),
		)
		.handler(async ({ input }) => {
			// Get existing checklist
			const [checklist] = await db
				.select()
				.from(disbursementChecklists)
				.where(eq(disbursementChecklists.opportunityId, input.opportunityId))
				.limit(1);

			if (!checklist) {
				throw new Error(
					"Checklist de desembolso no encontrado. Primero obtén el checklist.",
				);
			}

			// Security: Explicit whitelist mapping for column names (defense-in-depth)
			// Even though Zod validates input.itemKey, we use an explicit mapping
			// to ensure only valid column names are used in the database update
			const validColumnKeys = {
				traspasoRealizado: "traspasoRealizado",
				documentosEnviadosAsesor: "documentosEnviadosAsesor",
				documentosFirmadosRecibidos: "documentosFirmadosRecibidos",
				copiaLlaveRecibida: "copiaLlaveRecibida",
				engancheValidado: "engancheValidado",
				listoDesembolsar: "listoDesembolsar",
			} as const;

			const columnKey = validColumnKeys[input.itemKey];
			if (!columnKey) {
				throw new Error("Clave de item inválida");
			}

			// Update the specific item using the validated column key
			const updateData: Record<string, boolean | Date> = {
				[columnKey]: input.completed,
				updatedAt: new Date(),
			};

			await db
				.update(disbursementChecklists)
				.set(updateData)
				.where(eq(disbursementChecklists.opportunityId, input.opportunityId));

			return { success: true };
		}),

	// Update notes in disbursement checklist
	updateDisbursementChecklistNotes: analystProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				// Security: Limit notes length to prevent DoS and apply trim
				notes: z.string().max(5000).trim(),
			}),
		)
		.handler(async ({ input }) => {
			await db
				.update(disbursementChecklists)
				.set({
					notes: input.notes,
					updatedAt: new Date(),
				})
				.where(eq(disbursementChecklists.opportunityId, input.opportunityId));

			return { success: true };
		}),

	// Approve disbursement (90% → 100% transition)
	approveDisbursement: analystProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			// Get checklist and verify all items are completed
			const [checklist] = await db
				.select()
				.from(disbursementChecklists)
				.where(eq(disbursementChecklists.opportunityId, input.opportunityId))
				.limit(1);

			if (!checklist) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Checklist de desembolso no encontrado",
				});
			}

			// Verify all items are completed
			const allCompleted =
				checklist.traspasoRealizado &&
				checklist.documentosEnviadosAsesor &&
				checklist.documentosFirmadosRecibidos &&
				checklist.copiaLlaveRecibida &&
				checklist.engancheValidado &&
				checklist.listoDesembolsar;

			if (!allCompleted) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Todos los items del checklist deben estar completados antes de aprobar",
				});
			}

			// Get current opportunity
			const [opportunity] = await db
				.select()
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			// Already approved
			if (opportunity.disbursementApproved) {
				throw new ORPCError("BAD_REQUEST", {
					message: "El desembolso ya fue aprobado",
				});
			}

			// Get current stage to verify it's 90%
			const [currentStage] = await db
				.select()
				.from(salesStages)
				.where(eq(salesStages.id, opportunity.stageId))
				.limit(1);

			if (!currentStage || currentStage.closurePercentage !== 90) {
				throw new ORPCError("BAD_REQUEST", {
					message: "La oportunidad debe estar en la etapa del 90%",
				});
			}

			// Get the 100% stage
			const [targetStage] = await db
				.select()
				.from(salesStages)
				.where(eq(salesStages.closurePercentage, 100))
				.limit(1);

			if (!targetStage) {
				throw new ORPCError("NOT_FOUND", {
					message: "No se encontró la etapa del 100%",
				});
			}


			// Update opportunity with approval and move to 100%
			await db
				.update(opportunities)
				.set({
					disbursementApproved: true,
					disbursementApprovedBy: context.userId,
					disbursementApprovedAt: new Date(),
					stageId: targetStage.id,
					updatedAt: new Date(),
				})
				.where(eq(opportunities.id, input.opportunityId));

			// Mark checklist as completed
			await db
				.update(disbursementChecklists)
				.set({
					completedBy: context.userId,
					completedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(disbursementChecklists.opportunityId, input.opportunityId));

			// Record stage history
			await db.insert(opportunityStageHistory).values({
				opportunityId: input.opportunityId,
				fromStageId: opportunity.stageId,
				toStageId: targetStage.id,
				changedBy: context.userId,
				reason: "Desembolso aprobado - Checklist completado",
			});

			return {
				success: true,
			};
		}),

	// Get opportunities at 90% for disbursement review
	getOpportunitiesForDisbursement: analystProcedure.handler(async () => {
		// Get the 90% stage
		const [stage90] = await db
			.select()
			.from(salesStages)
			.where(eq(salesStages.closurePercentage, 90))
			.limit(1);

		if (!stage90) {
			return [];
		}

		// Get opportunities at 90%
		const opps = await db
			.select({
				id: opportunities.id,
				value: opportunities.value,
				stageId: opportunities.stageId,
				disbursementApproved: opportunities.disbursementApproved,
				leadId: opportunities.leadId,
				vehicleId: opportunities.vehicleId,
				createdAt: opportunities.createdAt,
				updatedAt: opportunities.updatedAt,
			})
			.from(opportunities)
			.where(eq(opportunities.stageId, stage90.id))
			.orderBy(desc(opportunities.updatedAt));

		// Get lead info for each opportunity
		const result = await Promise.all(
			opps.map(async (opp) => {
				let lead:
					| { firstName: string; lastName: string; phone: string | null }
					| undefined;
				if (opp.leadId) {
					const [leadResult] = await db
						.select({
							firstName: leads.firstName,
							lastName: leads.lastName,
							phone: leads.phone,
						})
						.from(leads)
						.where(eq(leads.id, opp.leadId))
						.limit(1);
					lead = leadResult;
				}

				// Get vehicle info
				let vehicle:
					| {
							id: string;
							make: string;
							model: string;
							year: number;
							licensePlate: string | null;
							color: string;
							isNew: boolean;
					  }
					| undefined;
				if (opp.vehicleId) {
					const [vehicleResult] = await db
						.select({
							id: vehicles.id,
							make: vehicles.make,
							model: vehicles.model,
							year: vehicles.year,
							licensePlate: vehicles.licensePlate,
							color: vehicles.color,
							isNew: vehicles.isNew,
						})
						.from(vehicles)
						.where(eq(vehicles.id, opp.vehicleId))
						.limit(1);
					vehicle = vehicleResult;
				}

				// Get checklist status
				const [checklist] = await db
					.select()
					.from(disbursementChecklists)
					.where(eq(disbursementChecklists.opportunityId, opp.id))
					.limit(1);

				let progress = 0;
				if (checklist) {
					const items = [
						checklist.traspasoRealizado,
						checklist.documentosEnviadosAsesor,
						checklist.documentosFirmadosRecibidos,
						checklist.copiaLlaveRecibida,
						checklist.engancheValidado,
						checklist.listoDesembolsar,
					];
					const completedCount = items.filter(Boolean).length;
					progress = Math.round((completedCount / items.length) * 100);
				}

				return {
					...opp,
					leadName: lead ? `${lead.firstName} ${lead.lastName}` : "N/A",
					leadPhone: lead?.phone,
					vehicle: vehicle || null,
					checklistProgress: progress,
					hasChecklist: !!checklist,
				};
			}),
		);

		return result;
	}),
};
