import { ORPCError } from "@orpc/server";
import {
	and,
	count,
	desc,
	eq,
	gte,
	ilike,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	not,
	or,
	sql,
	sum,
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
	creditApplications,
	financialStatements,
} from "../db/schema/client-forms";
import {
	clients,
	coDebtors,
	companies,
	creditAnalysis,
	deletedOpportunityLogs,
	leadSourceEnum,
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
	VEHICLE_DOCUMENT_TYPES,
} from "../db/schema/documents";
import {
	carryForwardAnalysisChecklistVerificationState,
	hasStaleAnalysisChecklistDocumentState,
	hasStaleAnalysisChecklistVehicleState,
} from "../lib/analysis-checklist";
import {
	updateChecklistForClientDocument,
	updateChecklistForVehicleDocument,
} from "../lib/checklist";
import { buildDeletedOpportunitySnapshot } from "../lib/deleted-opportunity-audit";
import {
	getGuatemalaMonthWindow,
	toDateStrGT,
} from "../lib/guatemala-month-window";
import {
	formatMissingLeadFields,
	getMissingLeadFieldsForContracts,
} from "../lib/lead-helpers";
import { getLeadSourceLabel } from "../lib/lead-sources";
import { analystProcedure, crmProcedure } from "../lib/orpc";
import { PERMISSIONS } from "../lib/roles";
import {
	buildUploadPrefix,
	deleteFileFromR2,
	getFileUrl,
	verifyUploadedDocumentInR2,
} from "../lib/storage";
import {
	formatMissingFields,
	getMissingFieldsForCompletion,
	getMissingFieldsForContracts,
} from "../lib/vehicle-helpers";
import { carteraBackClient } from "../services/cartera-back-client";
import { scoreLead } from "../services/lead-scoring";
import type { StatusCreditEnum } from "../types/cartera-back";
import { validarDpi } from "../utils/cui-validation";
import { createNotification } from "./notifications";

const CLIENT_CREDIT_CARTERA_STATUSES = [
	"ACTIVO",
	"MOROSO",
	"EN_CONVENIO",
] as const satisfies readonly StatusCreditEnum[];

type ClientCreditCarteraStatus =
	(typeof CLIENT_CREDIT_CARTERA_STATUSES)[number];

type ClientCreditFetcher = (params: {
	mes: number;
	anio: number;
	estado: ClientCreditCarteraStatus;
	page: number;
	perPage: number;
}) => Promise<{
	data: CarteraClientCredit[];
	totalPages?: number | null;
}>;

type CarteraClientCredit = {
	creditos?: {
		numero_credito_sifco?: string | null;
		statusCredit?: StatusCreditEnum | null;
		capital?: string | null;
		deudatotal?: string | null;
		cuota?: string | null;
		fecha_creacion?: string | null;
		tipoCredito?: string | null;
	};
	usuarios?: {
		nombre?: string | null;
		nit?: string | null;
	};
	asesores?: {
		nombre?: string | null;
	} | null;
};

type ClientRowOpportunity = {
	id: string;
	title?: string;
	value?: string | null;
	creditType?: string | null;
	numeroSifco: string | null;
	status?: string;
	createdAt?: Date;
	stage?: {
		id: string;
		name: string;
		closurePercentage: number;
		color: string | null;
	} | null;
	isClosed: boolean;
};

type MatchedClientLead = {
	id: string;
	firstName: string;
	middleName?: string | null;
	lastName: string;
	secondLastName?: string | null;
	email: string | null;
	phone: string | null;
	dpi: string | null;
	nit?: string | null;
	age?: number | null;
	clientType?: string | null;
	maritalStatus?: string | null;
	dependents?: number | null;
	monthlyIncome?: string | null;
	loanAmount?: string | null;
	occupation?: string | null;
	workTime?: string | null;
	ownsHome?: boolean | null;
	ownsVehicle?: boolean | null;
	hasCreditCard?: boolean | null;
	jobTitle?: string | null;
	direccion?: string | null;
	departamento?: string | null;
	municipio?: string | null;
	zona?: string | null;
	assignedTo?: string | null;
	createdAt: Date;
	updatedAt: Date;
	assignedUser?: { id: string | null; name: string | null } | null;
};

type MatchedClientRow = MatchedClientLead & {
	rowId: string;
	opportunities: ClientRowOpportunity[];
	creditAnalysis: unknown;
	totalClosedValue: number;
	closedOpportunitiesCount: number;
	crmMatchStatus: "matched";
	carteraCredit: ReturnType<typeof buildCarteraOnlyClientRow>["carteraCredit"];
};

function getCarteraCreditAmount(credit: CarteraClientCredit) {
	return (
		Number.parseFloat(
			credit.creditos?.deudatotal || credit.creditos?.capital || "0",
		) || 0
	);
}

function getCurrentCarteraMonthParams(now = new Date()) {
	const [anio, mes] = toDateStrGT(now).split("-").map(Number);
	return { mes, anio };
}

export async function getClientCreditSifcosFromCartera(
	fetchCredits: ClientCreditFetcher,
	params: { mes: number; anio: number },
) {
	const credits = await getClientCreditsFromCartera(fetchCredits, params);
	return credits
		.map((row) => row.creditos?.numero_credito_sifco?.trim())
		.filter((sifco): sifco is string => Boolean(sifco));
}

async function getClientCreditsFromCartera(
	fetchCredits: ClientCreditFetcher,
	params: { mes: number; anio: number },
) {
	const perPage = 100;
	const maxPages = 200;
	const creditsBySifco = new Map<string, CarteraClientCredit>();

	for (const estado of CLIENT_CREDIT_CARTERA_STATUSES) {
		let page = 1;
		while (page <= maxPages) {
			const response = await fetchCredits({
				...params,
				estado,
				page,
				perPage,
			});

			for (const row of response.data) {
				const sifco = row.creditos?.numero_credito_sifco?.trim();
				if (sifco && !creditsBySifco.has(sifco)) creditsBySifco.set(sifco, row);
			}

			if (response.data.length < perPage) break;
			if (response.totalPages != null && page >= response.totalPages) break;
			page += 1;
		}
	}

	return Array.from(creditsBySifco.values());
}

async function getCurrentClientCreditsFromCartera() {
	return getClientCreditsFromCartera(
		(params) => carteraBackClient.getAllCreditos(params),
		getCurrentCarteraMonthParams(),
	);
}

function splitFullName(fullName: string | null | undefined) {
	const parts = (fullName || "Cliente sin nombre")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	return {
		firstName: parts[0] || "Cliente",
		middleName: parts.length > 3 ? parts[1] : null,
		lastName:
			parts.length > 1 ? parts[parts.length > 2 ? parts.length - 2 : 1] : "",
		secondLastName: parts.length > 2 ? parts[parts.length - 1] : null,
	};
}

export function buildCarteraOnlyClientRow(credit: CarteraClientCredit) {
	const sifco = credit.creditos?.numero_credito_sifco?.trim() || "sin-sifco";
	const name = splitFullName(credit.usuarios?.nombre);
	const createdAt = credit.creditos?.fecha_creacion
		? new Date(credit.creditos.fecha_creacion)
		: new Date();
	const totalValue = getCarteraCreditAmount(credit);

	return {
		id: `cartera-${sifco}`,
		rowId: `cartera-${sifco}`,
		...name,
		email: "",
		phone: null,
		dpi: null,
		nit: credit.usuarios?.nit || null,
		age: null,
		clientType: "individual",
		maritalStatus: null,
		dependents: null,
		monthlyIncome: null,
		loanAmount: credit.creditos?.capital || null,
		occupation: null,
		workTime: null,
		ownsHome: null,
		ownsVehicle: null,
		hasCreditCard: null,
		jobTitle: null,
		direccion: null,
		departamento: null,
		municipio: null,
		zona: null,
		assignedTo: "",
		createdAt,
		updatedAt: createdAt,
		assignedUser: credit.asesores?.nombre
			? { id: "cartera", name: credit.asesores.nombre }
			: null,
		opportunities: [],
		creditAnalysis: null,
		totalClosedValue: totalValue,
		closedOpportunitiesCount: 0,
		crmMatchStatus: "missing" as const,
		carteraCredit: {
			numeroSifco: sifco,
			statusCredit: credit.creditos?.statusCredit || null,
			capital: credit.creditos?.capital || null,
			deudaTotal: credit.creditos?.deudatotal || null,
			cuota: credit.creditos?.cuota || null,
			tipoCredito: credit.creditos?.tipoCredito || null,
		},
	};
}

export function buildCarteraMatchedClientRows(params: {
	lead: MatchedClientLead;
	leadOpportunities: ClientRowOpportunity[];
	creditAnalysis: unknown;
	carteraCreditBySifco: Map<string, CarteraClientCredit>;
}): MatchedClientRow[] {
	const rows: MatchedClientRow[] = [];

	for (const [sifco, credit] of params.carteraCreditBySifco) {
		const matchingOpportunities = params.leadOpportunities.filter(
			(opp) => opp.numeroSifco === sifco,
		);
		if (matchingOpportunities.length === 0) continue;

		rows.push({
			...params.lead,
			rowId: `${params.lead.id}-${sifco}`,
			opportunities: matchingOpportunities,
			creditAnalysis: params.creditAnalysis,
			totalClosedValue: getCarteraCreditAmount(credit),
			closedOpportunitiesCount: matchingOpportunities.filter(
				(opp) => opp.isClosed,
			).length,
			crmMatchStatus: "matched",
			carteraCredit: buildCarteraOnlyClientRow(credit).carteraCredit,
		});
	}

	return rows;
}

export function calculateCarteraClientStats(params: {
	carteraCredits: CarteraClientCredit[];
	matchedSifcos: Set<string>;
	uniqueLeadCount: number;
	scopedOpportunityCount: number;
	userRole: string | null | undefined;
}) {
	const visibleCredits =
		params.userRole === "sales"
			? params.carteraCredits.filter((credit) => {
					const sifco = credit.creditos?.numero_credito_sifco?.trim();
					return sifco ? params.matchedSifcos.has(sifco) : false;
				})
			: params.carteraCredits;

	return {
		totalClients:
			params.userRole === "sales"
				? params.uniqueLeadCount
				: params.carteraCredits.length,
		totalClosedOpportunities: params.scopedOpportunityCount,
		totalValue: visibleCredits.reduce(
			(sum, credit) => sum + getCarteraCreditAmount(credit),
			0,
		),
		missingCrmCount:
			params.userRole === "sales"
				? 0
				: Math.max(0, params.carteraCredits.length - params.matchedSifcos.size),
	};
}

export const getLeadsInputSchema = z.object({
	limit: z.number().min(1).max(100).default(20),
	offset: z.number().min(0).default(0),
	search: z.string().optional(),
	status: z
		.enum(["new", "contacted", "qualified", "converted", "unqualified"])
		.optional(),
	id: z.string().uuid().optional(),
	source: z.enum(leadSourceEnum.enumValues).optional(),
	dateFrom: z.string().optional(),
	dateTo: z.string().optional(),
});

/**
 * Helper function to check vehicle inspection status.
 * Reduces code duplication across the codebase.
 *
 * @param vehicleId - The ID of the vehicle to check
 * @returns Object with inspection status details
 */
async function getVehicleInspectionStatus(vehicleId: string) {
	// Get vehicle info and check if it's new
	const [vehicle] = await db
		.select({ isNew: vehicles.isNew })
		.from(vehicles)
		.where(eq(vehicles.id, vehicleId))
		.limit(1);

	const isNew = vehicle?.isNew ?? false;

	// New vehicles don't require inspection
	if (isNew) {
		return {
			isNew: true,
			isInspected: true,
			inspectionId: null,
			inspectionStatus: "not_required" as const,
		};
	}

	// Check for approved inspection
	const [inspection] = await db
		.select({ id: vehicleInspections.id, status: vehicleInspections.status })
		.from(vehicleInspections)
		.where(
			and(
				eq(vehicleInspections.vehicleId, vehicleId),
				eq(vehicleInspections.status, "approved"),
			),
		)
		.limit(1);

	return {
		isNew: false,
		isInspected: !!inspection,
		inspectionId: inspection?.id ?? null,
		inspectionStatus: inspection?.status ?? "pending",
	};
}

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
				throw new ORPCError("NOT_FOUND", {
					message:
						"Empresa no encontrada o no tienes permiso para actualizarla",
				});
			}

			return updatedCompany[0];
		}),

	// Leads
	getLeads: crmProcedure
		.input(getLeadsInputSchema.optional())
		.handler(async ({ input, context }) => {
			const limit = input?.limit ?? 20;
			const offset = input?.offset ?? 0;
			const search = input?.search;
			const status = input?.status;
			const id = input?.id;
			const source = input?.source;

			// Build conditions
			const conditions = [];

			// ID filter (for direct lookup)
			if (id) {
				conditions.push(eq(leads.id, id));
			}

			// Role-based filter: admin, sales_supervisor, juridico, and analyst can see all
			// When fetching by specific ID, juridico needs access for contract generation
			// Analysts need access to view lead details for analysis checklist
			const canSeeAllLeads =
				context.userRole === "admin" ||
				context.userRole === "sales_supervisor" ||
				context.userRole === "juridico" ||
				context.userRole === "analyst";

			if (!canSeeAllLeads) {
				conditions.push(eq(leads.assignedTo, context.userId));
			}

			// Status filter
			if (status) {
				conditions.push(eq(leads.status, status));
			}

			// Source filter
			if (source) {
				conditions.push(eq(leads.source, source));
			}

			// Search filter (name, email, company name)
			if (search && search.trim() !== "") {
				const searchTerms = search.trim().split(/\s+/);
				// Build conditions for each search term (all terms must match)
				const termConditions = searchTerms.map((term) => {
					const searchPattern = `%${term}%`;
					return or(
						ilike(leads.firstName, searchPattern),
						ilike(leads.middleName, searchPattern),
						ilike(leads.lastName, searchPattern),
						ilike(leads.secondLastName, searchPattern),
						ilike(leads.email, searchPattern),
						ilike(companies.name, searchPattern),
					);
				});
				// All terms must match (AND)
				if (termConditions.length > 0) {
					conditions.push(...termConditions);
				}
			}

			// Excluir leads migrados (solo se muestran en la sección de clientes migrados)
			conditions.push(not(eq(leads.status, "migrate")));

			// Date range filter on createdAt
			if (input?.dateFrom) {
				conditions.push(gte(leads.createdAt, new Date(input.dateFrom)));
			}
			if (input?.dateTo) {
				const toDate = new Date(input.dateTo);
				toDate.setHours(23, 59, 59, 999);
				conditions.push(lte(leads.createdAt, toDate));
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
					nit: leads.nit,
					clientType: leads.clientType,
					maritalStatus: leads.maritalStatus,
					birthDate: leads.birthDate,
					gender: leads.gender,
					nationality: leads.nationality,
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
					livenessValidated: leads.livenessValidated,
					convertedAt: leads.convertedAt,
					createdAt: leads.createdAt,
					updatedAt: leads.updatedAt,
					createdBy: leads.createdBy,
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
					nit: leads.nit,
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
			context.userRole === "sales"
				? eq(leads.assignedTo, context.userId)
				: undefined;

		// Excluir leads migrados
		const excludeMigrated = not(eq(leads.status, "migrate"));

		// Combinar condiciones
		const whereCondition = roleCondition
			? and(roleCondition, excludeMigrated)
			: excludeMigrated;

		// Get counts for each status
		const statusCounts = await db
			.select({
				status: leads.status,
				count: count(),
			})
			.from(leads)
			.where(whereCondition)
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
				email: z.string().email("Valid email is required").optional(),
				phone: z.string().min(1, "Phone is required"),
				age: z.number().int().positive().optional(),
				dpi: z.string().optional(),
				nit: z.string().optional(),
				direccion: z.string().optional(),
				departamento: z.string().optional(),
				municipio: z.string().optional(),
				zona: z.string().optional(),
				clientType: z
					.enum(["individual", "comerciante", "empresa"])
					.default("individual"),
				maritalStatus: z
					.enum(["single", "married", "divorced", "widowed"])
					.optional(),
				birthDate: z.coerce.date().optional().nullable(),
				gender: z.string().optional().nullable(),
				nationality: z.string().optional().nullable(),
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
				source: z.enum(leadSourceEnum.enumValues),
				campaign: z.string().min(1).optional(),
				assignedTo: z.string().optional(), // Better Auth user ID (text, not UUID)
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// If no assignedTo specified, assign to current user
			// Admin can assign to anyone, sales can only assign to themselves
			const assignedTo = input.assignedTo || context.userId;

			if (context.userRole === "sales" && assignedTo !== context.userId) {
				throw new ORPCError("FORBIDDEN", {
					message:
						"Los usuarios de ventas solo pueden asignarse leads a sí mismos",
				});
			}

			// Normalizar y validar DPI
			let normalizedDpi: string | undefined;
			if (input.dpi) {
				const resultado = validarDpi(input.dpi);
				if (!resultado.valid) {
					throw new ORPCError("BAD_REQUEST", {
						message: resultado.error,
					});
				}
				normalizedDpi = resultado.dpiLimpio;
			}

			// Validar DPI duplicado
			if (normalizedDpi) {
				const [existingLead] = await db
					.select({
						id: leads.id,
						assignedTo: leads.assignedTo,
						assignedToName: user.name,
					})
					.from(leads)
					.innerJoin(user, eq(leads.assignedTo, user.id))
					.where(eq(leads.dpi, normalizedDpi))
					.limit(1);

				if (existingLead) {
					// Verificar si tiene oportunidades activas (open o on_hold)
					const [activeOpportunity] = await db
						.select({ id: opportunities.id })
						.from(opportunities)
						.where(
							and(
								eq(opportunities.leadId, existingLead.id),
								inArray(opportunities.status, ["open", "on_hold"]),
							),
						)
						.limit(1);

					if (activeOpportunity) {
						throw new ORPCError("CONFLICT", {
							message: `Ya existe un lead con este DPI y tiene un proceso activo, asignado al asesor: ${existingLead.assignedToName}`,
						});
					}

					// Lead existe pero sin procesos activos → reasignar al nuevo asesor
					const reassignedLead = await db.transaction(async (tx) => {
						const [lead] = await tx
							.update(leads)
							.set({
								assignedTo,
								status: "new",
								source: input.source,
								campaign: input.campaign,
								updatedAt: new Date(),
							})
							.where(eq(leads.id, existingLead.id))
							.returning();

						// Crear nueva oportunidad en el primer stage
						const [firstStage] = await tx
							.select({ id: salesStages.id })
							.from(salesStages)
							.orderBy(salesStages.order)
							.limit(1);

						if (!firstStage) {
							throw new ORPCError("INTERNAL_SERVER_ERROR", {
								message: "No se encontró el primer stage de ventas",
							});
						}

						await tx.insert(opportunities).values({
							title: `${input.firstName} ${input.lastName}`,
							leadId: existingLead.id,
							creditType: "autocompra",
							stageId: firstStage.id,
							probability: 1,
							assignedTo,
							createdBy: context.userId,
							source: input.source,
							campaign: input.campaign,
						});

						return lead;
					});

					return reassignedLead;
				}
			}

			const newLead = await db
				.insert(leads)
				.values({
					...input,
					dpi: normalizedDpi,
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
				nit: z.string().optional(),
				direccion: z.string().optional(),
				departamento: z.string().optional(),
				municipio: z.string().optional(),
				zona: z.string().optional(),
				clientType: z.enum(["individual", "comerciante", "empresa"]).optional(),
				maritalStatus: z
					.enum(["single", "married", "divorced", "widowed"])
					.optional(),
				birthDate: z.coerce.date().optional().nullable(),
				gender: z.string().optional().nullable(),
				nationality: z.string().optional().nullable(),
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
				source: z.enum(leadSourceEnum.enumValues).optional(),
				campaign: z.string().min(1).optional(),
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

			// Validar DPI si se envía
			if (updateData.dpi) {
				const resultado = validarDpi(updateData.dpi);
				if (!resultado.valid) {
					throw new ORPCError("BAD_REQUEST", {
						message: resultado.error,
					});
				}
				updateData.dpi = resultado.dpiLimpio;
			}

			// Admin and juridico can update any lead, others only their own
			const canUpdateAnyLead = context.userRole !== "sales";
			const whereClause = canUpdateAnyLead
				? eq(leads.id, id)
				: and(eq(leads.id, id), eq(leads.assignedTo, context.userId));

			// Sales users cannot reassign leads
			if (
				context.userRole === "sales" &&
				assignedTo &&
				assignedTo !== context.userId
			) {
				throw new ORPCError("FORBIDDEN", {
					message: "Los usuarios de ventas no pueden reasignar leads",
				});
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
				throw new ORPCError("NOT_FOUND", {
					message: "Lead no encontrado o no tienes permiso para actualizarlo",
				});
			}

			// Sync NIT to associated opportunities
			if (updateData.nit !== undefined) {
				await db
					.update(opportunities)
					.set({ nit: updateData.nit || null, updatedAt: new Date() })
					.where(eq(opportunities.leadId, id));
			}

			if (
				updateData.source !== undefined ||
				updateData.campaign !== undefined
			) {
				const [activeOpportunity] = await db
					.select({ id: opportunities.id })
					.from(opportunities)
					.where(
						and(
							eq(opportunities.leadId, id),
							inArray(opportunities.status, ["open", "on_hold"]),
						),
					)
					.orderBy(desc(opportunities.createdAt))
					.limit(1);

				if (activeOpportunity) {
					await db
						.update(opportunities)
						.set({
							...(updateData.source !== undefined
								? { source: updateData.source }
								: {}),
							...(updateData.campaign !== undefined
								? { campaign: updateData.campaign }
								: {}),
							updatedAt: new Date(),
						})
						.where(eq(opportunities.id, activeOpportunity.id));
				}
			}

			return updatedLead[0];
		}),

	// Credit Analysis
	getCreditAnalysisByLeadId: crmProcedure
		.input(
			z
				.object({
					leadId: z.string().uuid().optional(),
					coDebtorId: z.string().uuid().optional(),
				})
				.refine((data) => data.leadId || data.coDebtorId, {
					message: "Debe proporcionar leadId o coDebtorId",
				}),
		)
		.handler(async ({ input, context }) => {
			// Si es búsqueda por leadId
			if (input.leadId) {
				const lead = await db
					.select()
					.from(leads)
					.where(eq(leads.id, input.leadId))
					.limit(1);

				if (lead.length === 0) {
					throw new ORPCError("NOT_FOUND", { message: "Lead no encontrado" });
				}

				// Sales users can only see analysis for their assigned leads
				if (
					context.userRole === "sales" &&
					lead[0].assignedTo !== context.userId
				) {
					throw new ORPCError("FORBIDDEN", {
						message: "No tienes permiso para ver este análisis",
					});
				}

				const analysis = await db
					.select()
					.from(creditAnalysis)
					.where(eq(creditAnalysis.leadId, input.leadId))
					.limit(1);

				return analysis[0] || null;
			}

			// Si es búsqueda por coDebtorId
			if (input.coDebtorId) {
				const coDebtor = await db
					.select()
					.from(coDebtors)
					.where(eq(coDebtors.id, input.coDebtorId))
					.limit(1);

				if (coDebtor.length === 0) {
					throw new ORPCError("NOT_FOUND", {
						message: "Co-deudor no encontrado",
					});
				}

				const analysis = await db
					.select()
					.from(creditAnalysis)
					.where(eq(creditAnalysis.coDebtorId, input.coDebtorId))
					.limit(1);

				return analysis[0] || null;
			}

			return null;
		}),

	upsertCreditAnalysis: crmProcedure
		.input(
			z
				.object({
					leadId: z.string().uuid().optional(),
					coDebtorId: z.string().uuid().optional(),
					monthlyFixedIncome: z.number().min(0).optional(),
					monthlyVariableIncome: z.number().min(0).optional(),
					monthlyFixedExpenses: z.number().min(0).optional(),
					monthlyVariableExpenses: z.number().min(0).optional(),
					economicAvailability: z.number().optional(),
					maxPayment: z.number().min(0).optional(),
					maxCreditAmount: z.number().min(0).optional(),
				})
				.refine((data) => data.leadId || data.coDebtorId, {
					message: "Debe proporcionar leadId o coDebtorId",
				}),
		)
		.handler(async ({ input, context }) => {
			const { leadId, coDebtorId, ...analysisData } = input;

			// Convert numbers to strings for decimal fields
			const dataForDb = {
				monthlyFixedIncome: analysisData.monthlyFixedIncome?.toString(),
				monthlyVariableIncome: analysisData.monthlyVariableIncome?.toString(),
				monthlyFixedExpenses: analysisData.monthlyFixedExpenses?.toString(),
				monthlyVariableExpenses:
					analysisData.monthlyVariableExpenses?.toString(),
				economicAvailability: analysisData.economicAvailability?.toString(),
				maxPayment: analysisData.maxPayment?.toString(),
				maxCreditAmount: analysisData.maxCreditAmount?.toString(),
			};

			// Si es para un lead
			if (leadId) {
				const lead = await db
					.select()
					.from(leads)
					.where(eq(leads.id, leadId))
					.limit(1);

				if (lead.length === 0) {
					throw new ORPCError("NOT_FOUND", { message: "Lead no encontrado" });
				}

				// Sales users can only update analysis for their assigned leads
				if (
					context.userRole === "sales" &&
					lead[0].assignedTo !== context.userId
				) {
					throw new ORPCError("FORBIDDEN", {
						message: "No tienes permiso para actualizar este análisis",
					});
				}

				// Check if analysis already exists
				const existing = await db
					.select()
					.from(creditAnalysis)
					.where(eq(creditAnalysis.leadId, leadId))
					.limit(1);

				if (existing.length > 0) {
					const updated = await db
						.update(creditAnalysis)
						.set({
							...dataForDb,
							analyzedAt: existing[0].analyzedAt ?? new Date(),
							updatedAt: new Date(),
						})
						.where(eq(creditAnalysis.leadId, leadId))
						.returning();
					return updated[0];
				}

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
			}

			// Si es para un co-deudor
			if (coDebtorId) {
				const coDebtor = await db
					.select()
					.from(coDebtors)
					.where(eq(coDebtors.id, coDebtorId))
					.limit(1);

				if (coDebtor.length === 0) {
					throw new ORPCError("NOT_FOUND", {
						message: "Co-deudor no encontrado",
					});
				}

				// Check if analysis already exists
				const existing = await db
					.select()
					.from(creditAnalysis)
					.where(eq(creditAnalysis.coDebtorId, coDebtorId))
					.limit(1);

				if (existing.length > 0) {
					const updated = await db
						.update(creditAnalysis)
						.set({
							...dataForDb,
							analyzedAt: existing[0].analyzedAt ?? new Date(),
							updatedAt: new Date(),
						})
						.where(eq(creditAnalysis.coDebtorId, coDebtorId))
						.returning();
					return updated[0];
				}

				const created = await db
					.insert(creditAnalysis)
					.values({
						coDebtorId,
						...dataForDb,
						createdBy: context.userId,
						analyzedAt: new Date(),
					})
					.returning();
				return created[0];
			}

			throw new ORPCError("BAD_REQUEST", {
				message: "Debe proporcionar leadId o coDebtorId",
			});
		}),

	resetCreditAnalysis: crmProcedure
		.input(
			z
				.object({
					leadId: z.string().uuid().optional(),
					coDebtorId: z.string().uuid().optional(),
				})
				.refine((data) => data.leadId || data.coDebtorId, {
					message: "Debe proporcionar leadId o coDebtorId",
				}),
		)
		.handler(async ({ input, context }) => {
			if (
				context.userRole !== "admin" &&
				context.userRole !== "sales_supervisor" &&
				context.userRole !== "analyst"
			) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para resetear análisis crediticios",
				});
			}

			const whereCondition = input.leadId
				? eq(creditAnalysis.leadId, input.leadId)
				: eq(creditAnalysis.coDebtorId, input.coDebtorId!);

			const deleted = await db
				.delete(creditAnalysis)
				.where(whereCondition)
				.returning({ id: creditAnalysis.id });

			if (deleted.length === 0) {
				throw new ORPCError("NOT_FOUND", {
					message: "No se encontró análisis crediticio para resetear",
				});
			}

			return { success: true };
		}),

	// Opportunities
	getOpportunities: crmProcedure
		.input(
			z
				.object({
					leadId: z.string().uuid().optional(),
					search: z.string().optional(),
					// Excluir múltiples status
					excludeStatuses: z
						.array(z.enum(["open", "won", "lost", "on_hold", "migrate"]))
						.optional(),
					opportunityId: z.string().uuid().optional(),
					// Filtro por mes/año para alinear con dashboard
					month: z.number().min(1).max(12).optional(),
					year: z.number().optional(),
					// NEW: Filtro por fecha de creación
					createdMonth: z.number().min(1).max(12).optional(),
					createdYear: z.number().optional(),
					// NEW: Filtro por fuente/medio
					source: z.enum(leadSourceEnum.enumValues).optional(),
				})
				.optional(),
		)
		.handler(async ({ input, context }) => {
			const leadIdFilter = input?.leadId;
			const searchTerm = input?.search;
			const firstClosedStageDates = db
				.select({
					opportunityId: opportunityStageHistory.opportunityId,
					firstClosedStageAt:
						sql<Date>`min(${opportunityStageHistory.changedAt})`.as(
							"first_closed_stage_at",
						),
				})
				.from(opportunityStageHistory)
				.innerJoin(
					salesStages,
					eq(opportunityStageHistory.toStageId, salesStages.id),
				)
				.where(gte(salesStages.closurePercentage, 90))
				.groupBy(opportunityStageHistory.opportunityId)
				.as("first_closed_stage_dates");

			const latestStageHistory = db
				.select({
					opportunityId: opportunityStageHistory.opportunityId,
					latestStageChangedAt:
						sql<Date>`max(${opportunityStageHistory.changedAt})`.as(
							"latest_stage_changed_at",
						),
				})
				.from(opportunityStageHistory)
				.groupBy(opportunityStageHistory.opportunityId)
				.as("latest_stage_history");

			const closedAtExpression = sql<Date | null>`coalesce(${firstClosedStageDates.firstClosedStageAt}, ${opportunities.actualCloseDate})`;

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
				closedAt: closedAtExpression.as("closed_at"),
				latestStageChangedAt:
					sql<Date>`coalesce(${latestStageHistory.latestStageChangedAt}, ${opportunities.createdAt})`.as(
						"latest_stage_changed_at",
					),
				updatedAt: opportunities.updatedAt,
				numeroSifco: opportunities.numeroSifco,
				// Analysis status for tracking rejection/resubmission
				analysisStatus: opportunities.analysisStatus,
				analysisRejectionCount: opportunities.analysisRejectionCount,
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
				source: opportunities.source,
				rubros: opportunities.rubros,
				loanPurpose: opportunities.loanPurpose,
				company: {
					id: companies.id,
					name: companies.name,
				},
				lead: {
					id: leads.id,
					firstName: leads.firstName,
					middleName: leads.middleName,
					lastName: leads.lastName,
					secondLastName: leads.secondLastName,
					email: leads.email,
					phone: leads.phone,
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
					isOwned: vehicles.isOwned,
					fuelType: vehicles.fuelType,
					transmission: vehicles.transmission,
				},
			};

			const baseQuery = db
				.select(selectFields)
				.from(opportunities)
				.leftJoin(
					firstClosedStageDates,
					eq(opportunities.id, firstClosedStageDates.opportunityId),
				)
				.leftJoin(
					latestStageHistory,
					eq(opportunities.id, latestStageHistory.opportunityId),
				)
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

			// Search filter (by title, company name, lead name, phone, or opportunity ID)
			if (searchTerm) {
				conditions.push(
					or(
						ilike(opportunities.title, `%${searchTerm}%`),
						ilike(companies.name, `%${searchTerm}%`),
						ilike(leads.firstName, `%${searchTerm}%`),
						ilike(leads.lastName, `%${searchTerm}%`),
						ilike(opportunities.numeroSifco, `%${searchTerm}%`),
						ilike(leads.phone, `%${searchTerm}%`),
						sql`${opportunities.id}::text ILIKE ${`%${searchTerm}%`}`,
					),
				);
			}

			// Excluir múltiples status
			if (input?.excludeStatuses && input.excludeStatuses.length > 0) {
				conditions.push(
					not(inArray(opportunities.status, input.excludeStatuses)),
				);
			}

			// Filtro por fuente/medio de la oportunidad
			if (input?.source) {
				conditions.push(eq(opportunities.source, input.source));
			}

			// Filtro por mes/año: oportunidades abiertas siempre visibles, cerradas por
			// la primera fecha en que llegaron a una etapa colocada (>= 90%).
			if (input?.createdMonth && input?.createdYear) {
				const { startOfMonth, endOfMonth } = getGuatemalaMonthWindow(
					input.createdYear,
					input.createdMonth,
				);

				conditions.push(
					or(
						// Oportunidades abiertas/on_hold: siempre visibles
						inArray(opportunities.status, ["open", "on_hold"]),
						// Oportunidades cerradas (won/lost): filtrar por la primera fecha
						// en que llegaron a una etapa colocada para alinear la tabla con
						// el dashboard de colocación mensual.
						and(
							inArray(opportunities.status, ["won", "lost"]),
							or(
								and(
									gte(closedAtExpression, startOfMonth),
									lt(closedAtExpression, endOfMonth),
								),
								// Fallback: si no tiene fecha de cierre, usar fecha de creación
								and(
									isNull(closedAtExpression),
									gte(opportunities.createdAt, startOfMonth),
									lt(opportunities.createdAt, endOfMonth),
								),
							),
						),
					),
				);
			}

			// Role-based filter: admin and sales_supervisor can see all, others only their own
			if (context.userRole === "sales") {
				conditions.push(eq(opportunities.assignedTo, context.userId));
			}

			if (conditions.length > 0) {
				return await baseQuery
					.where(and(...conditions))
					.orderBy(desc(opportunities.createdAt));
			}

			return await baseQuery.orderBy(desc(opportunities.createdAt));
		}),

	deleteOpportunity: crmProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				reason: z
					.string()
					.trim()
					.min(1, "El motivo de eliminación es requerido"),
			}),
		)
		.handler(async ({ input, context }) => {
			if (!PERMISSIONS.canDeleteOpportunities(context.userRole)) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para eliminar oportunidades",
				});
			}

			await db.transaction(async (tx) => {
				const [opportunity] = await tx
					.select({
						id: opportunities.id,
						title: opportunities.title,
						value: opportunities.value,
						status: opportunities.status,
						creditType: opportunities.creditType,
						source: opportunities.source,
						campaign: opportunities.campaign,
						loanPurpose: opportunities.loanPurpose,
						probability: opportunities.probability,
						expectedCloseDate: opportunities.expectedCloseDate,
						actualCloseDate: opportunities.actualCloseDate,
						notes: opportunities.notes,
						numeroCuotas: opportunities.numeroCuotas,
						tasaInteres: opportunities.tasaInteres,
						cuotaMensual: opportunities.cuotaMensual,
						fechaInicio: opportunities.fechaInicio,
						diaPagoMensual: opportunities.diaPagoMensual,
						numeroSifco: opportunities.numeroSifco,
						nit: opportunities.nit,
						assignedTo: opportunities.assignedTo,
						leadId: opportunities.leadId,
						createdAt: opportunities.createdAt,
						updatedAt: opportunities.updatedAt,
						createdBy: opportunities.createdBy,
						stage: {
							id: salesStages.id,
							name: salesStages.name,
							closurePercentage: salesStages.closurePercentage,
						},
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
						},
						assignedUser: {
							id: user.id,
							name: user.name,
							email: user.email,
						},
						client: {
							id: clients.id,
							contactPerson: clients.contactPerson,
							status: clients.status,
						},
					})
					.from(opportunities)
					.leftJoin(salesStages, eq(opportunities.stageId, salesStages.id))
					.leftJoin(leads, eq(opportunities.leadId, leads.id))
					.leftJoin(companies, eq(opportunities.companyId, companies.id))
					.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
					.leftJoin(user, eq(opportunities.assignedTo, user.id))
					.leftJoin(clients, eq(clients.opportunityId, opportunities.id))
					.where(eq(opportunities.id, input.opportunityId))
					.limit(1);

				if (!opportunity) {
					throw new ORPCError("NOT_FOUND", {
						message: "Oportunidad no encontrada",
					});
				}

				if (!opportunity.stage || opportunity.stage.closurePercentage >= 30) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"Solo se pueden eliminar oportunidades en etapas menores al 30% de cierre",
					});
				}

				const [documentsCount] = await tx
					.select({ count: count() })
					.from(opportunityDocuments)
					.where(eq(opportunityDocuments.opportunityId, input.opportunityId));
				const [coDebtorsCount] = await tx
					.select({ count: count() })
					.from(coDebtors)
					.where(eq(coDebtors.opportunityId, input.opportunityId));
				const [creditApplicationsCount] = await tx
					.select({ count: count() })
					.from(creditApplications)
					.where(eq(creditApplications.opportunityId, input.opportunityId));
				const [financialStatementsCount] = await tx
					.select({ count: count() })
					.from(financialStatements)
					.where(eq(financialStatements.opportunityId, input.opportunityId));
				const [stageHistoryCount] = await tx
					.select({ count: count() })
					.from(opportunityStageHistory)
					.where(
						eq(opportunityStageHistory.opportunityId, input.opportunityId),
					);

				const snapshot = buildDeletedOpportunitySnapshot({
					opportunity,
					stage: opportunity.stage,
					lead: opportunity.lead?.id ? opportunity.lead : null,
					company: opportunity.company?.id ? opportunity.company : null,
					vehicle: opportunity.vehicle?.id ? opportunity.vehicle : null,
					assignedUser: opportunity.assignedUser?.id
						? opportunity.assignedUser
						: null,
					client: opportunity.client?.id ? opportunity.client : null,
					relatedCounts: {
						documents: documentsCount?.count ?? 0,
						coDebtors: coDebtorsCount?.count ?? 0,
						forms:
							(creditApplicationsCount?.count ?? 0) +
							(financialStatementsCount?.count ?? 0),
						stageHistory: stageHistoryCount?.count ?? 0,
					},
				});

				const leadName = snapshot.lead?.fullName ?? null;

				await tx.insert(deletedOpportunityLogs).values({
					opportunityId: opportunity.id,
					opportunityTitle: opportunity.title,
					opportunityValue: opportunity.value,
					opportunityStatus: opportunity.status,
					opportunityStageName: opportunity.stage?.name ?? null,
					opportunityStagePercentage:
						opportunity.stage?.closurePercentage ?? null,
					opportunityCreatedAt: opportunity.createdAt,
					assignedUserId: opportunity.assignedTo,
					assignedUserName: opportunity.assignedUser?.name ?? null,
					leadId: opportunity.leadId,
					leadName,
					deletedBy: context.userId,
					deletedByName: context.user?.name ?? context.userId,
					reason: input.reason,
					snapshot,
				});

				await tx
					.update(clients)
					.set({ opportunityId: null })
					.where(eq(clients.opportunityId, input.opportunityId));

				await tx
					.delete(opportunities)
					.where(eq(opportunities.id, input.opportunityId));
			});

			return { message: "Oportunidad eliminada exitosamente" };
		}),

	createOpportunity: crmProcedure
		.input(
			z.object({
				title: z.string().min(1, "Title is required"),
				leadId: z.string().uuid().optional(),
				companyId: z.string().uuid().optional(),
				vehicleId: z.string().uuid().optional(),
				creditType: z.enum(["autocompra", "sobre_vehiculo"]),
				source: z.enum(leadSourceEnum.enumValues).optional(),
				campaign: z.string().min(1).optional(),
				loanPurpose: z.enum(["personal", "business"]).optional(),
				value: z.string().optional(), // Will be converted to decimal
				stageId: z.string().uuid(),
				probability: z.number().min(0).max(100).optional(),
				expectedCloseDate: z.string().optional(), // ISO date string
				assignedTo: z.string().optional(), // Better Auth user ID (text, not UUID)
				vendorId: z.string().uuid().optional(), // Vehicle vendor
				notes: z.string().optional(),
				force: z.boolean().optional(), // Skip duplicate check
			}),
		)
		.handler(async ({ input, context }) => {
			const assignedTo = input.assignedTo || context.userId;

			if (context.userRole === "sales" && assignedTo !== context.userId) {
				throw new ORPCError("FORBIDDEN", {
					message:
						"Los usuarios de ventas solo pueden asignarse oportunidades a sí mismos",
				});
			}

			// Check for recent opportunity with same lead (within 1 hour)
			if (input.leadId && !input.force) {
				const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
				const [recentOpportunity] = await db
					.select({
						id: opportunities.id,
						title: opportunities.title,
						createdAt: opportunities.createdAt,
					})
					.from(opportunities)
					.where(
						and(
							eq(opportunities.leadId, input.leadId),
							gte(opportunities.createdAt, oneHourAgo),
						),
					)
					.orderBy(desc(opportunities.createdAt))
					.limit(1);

				if (recentOpportunity) {
					const minutesAgo = Math.round(
						(Date.now() - new Date(recentOpportunity.createdAt!).getTime()) /
							60000,
					);
					return {
						warning: true as const,
						message: `Ya existe una oportunidad "${recentOpportunity.title}" creada hace ${minutesAgo} minutos para este lead.`,
						existingOpportunity: recentOpportunity,
					};
				}
			}

			// If a lead is provided, get the company and source from the lead
			let companyId = input.companyId;
			let source = input.source;
			let campaign = input.campaign;
			let leadNit: string | null = null;
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
					if (!campaign && lead[0].campaign) {
						campaign = lead[0].campaign;
					}
					// Copy NIT from lead to opportunity
					if (lead[0].nit) {
						leadNit = lead[0].nit;
					}
				}
			}

			const newOpportunity = await db
				.insert(opportunities)
				.values({
					...input,
					companyId,
					source,
					campaign,
					nit: leadNit,
					assignedTo,
					expectedCloseDate: input.expectedCloseDate
						? new Date(input.expectedCloseDate)
						: undefined,
					createdBy: context.userId,
					updatedAt: new Date(),
				})
				.returning();
			return { ...newOpportunity[0], warning: false as const };
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
				source: z.enum(leadSourceEnum.enumValues).optional(),
				campaign: z.string().min(1).optional(),
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
				diaPagoMensual: z.union([z.literal(15), z.literal(30)]).optional(),
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
				// Optimistic locking - prevents race conditions on concurrent updates
				expectedUpdatedAt: z.string().datetime().optional(),
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
				expectedUpdatedAt,
				...updateData
			} = input;

			// Get current opportunity to check for stage changes
			const currentOpportunity = await db
				.select()
				.from(opportunities)
				.where(eq(opportunities.id, id))
				.limit(1);

			if (!currentOpportunity[0]) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
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

				// Validate transitions from 80% - must go through jurídico approval to 85%
				if (fromPercentage === 80 && toPercentage >= 85) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"Para avanzar de 80% a la siguiente etapa, la oportunidad debe ser aprobada por el departamento jurídico desde el módulo de Jurídico.",
					});
				}

				// Validaciones para avanzar a etapa 80% (jurídica)
				if (toPercentage >= 80) {
					// Validar datos del vehículo para contratos
					if (currentOpportunity[0].vehicleId) {
						const vehicleForValidation = await db
							.select({
								isNew: vehicles.isNew,
								vinNumber: vehicles.vinNumber,
								motorNumber: vehicles.motorNumber,
								seats: vehicles.seats,
								vehicleUse: vehicles.vehicleUse,
								licensePlate: vehicles.licensePlate,
								origin: vehicles.origin,
								fuelType: vehicles.fuelType,
								transmission: vehicles.transmission,
							})
							.from(vehicles)
							.where(eq(vehicles.id, currentOpportunity[0].vehicleId))
							.limit(1);

						if (vehicleForValidation[0]) {
							// Validar campos mínimos para contratos (aplica a todos los vehículos)
							const missingForContracts = getMissingFieldsForContracts(
								vehicleForValidation[0],
							);
							if (missingForContracts.length > 0) {
								throw new ORPCError("BAD_REQUEST", {
									message: `Para avanzar a etapa jurídica (80%), el vehículo debe tener: ${formatMissingFields(missingForContracts)}`,
								});
							}

							// Para vehículos nuevos, validar campos adicionales solo al cerrar al 100%
							if (vehicleForValidation[0].isNew && toPercentage === 100) {
								const missingForCompletion = getMissingFieldsForCompletion(
									vehicleForValidation[0],
								);
								if (missingForCompletion.length > 0) {
									throw new ORPCError("BAD_REQUEST", {
										message: `Para completar la oportunidad (100%), el vehículo nuevo debe tener datos completos. Faltan: ${formatMissingFields(missingForCompletion)}`,
									});
								}
							}
						}
					}

					// Validar datos del lead para contratos
					if (currentOpportunity[0].leadId) {
						const leadForValidation = await db
							.select({
								dpi: leads.dpi,
								direccion: leads.direccion,
								maritalStatus: leads.maritalStatus,
								gender: leads.gender,
								birthDate: leads.birthDate,
								nationality: leads.nationality,
							})
							.from(leads)
							.where(eq(leads.id, currentOpportunity[0].leadId))
							.limit(1);

						if (leadForValidation[0]) {
							const missingLeadFields = getMissingLeadFieldsForContracts(
								leadForValidation[0],
							);
							if (missingLeadFields.length > 0) {
								throw new ORPCError("BAD_REQUEST", {
									message: `Para avanzar a etapa jurídica (80%), el cliente debe tener: ${formatMissingLeadFields(missingLeadFields)}`,
								});
							}
						}
					}
				}

				// Validate: 85% → 90% must use confirmContractsSigned endpoint
				if (fromPercentage === 85 && toPercentage >= 90) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"Para avanzar de 85% (Contratos en Firma) a 90%, debes confirmar que los contratos fueron firmados usando el botón de confirmación.",
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

				// Note: El cierre del crédito (creación en cartera-back, cliente, contrato)
				// se ejecuta en confirmContractsSigned (85% → 90%) en legal-contracts.ts
			}

			// Calculate new analysisStatus based on stage transition
			let newAnalysisStatus = currentOpportunity[0].analysisStatus;
			let movedToAnalysis = false;

			if (input.stageId && input.stageId !== currentOpportunity[0].stageId) {
				const targetStage = await db
					.select()
					.from(salesStages)
					.where(eq(salesStages.id, input.stageId))
					.limit(1);

				const currentStage = await db
					.select()
					.from(salesStages)
					.where(eq(salesStages.id, currentOpportunity[0].stageId))
					.limit(1);

				const fromPercentage = currentStage[0]?.closurePercentage ?? 0;
				const toPercentage = targetStage[0]?.closurePercentage ?? 0;

				// If moving TO stage 30% (analysis stage)
				if (toPercentage === 30 && fromPercentage !== 30) {
					movedToAnalysis = true;
					if (currentOpportunity[0].analysisStatus === "not_applicable") {
						newAnalysisStatus = "pending";
					} else if (currentOpportunity[0].analysisStatus === "rejected") {
						newAnalysisStatus = "resubmitted";
					} else if (currentOpportunity[0].analysisStatus === "approved") {
						// Re-analysis of previously approved opportunity
						newAnalysisStatus = "pending";
					}
				}
			}

			// Sales users can only update opportunities assigned to them
			// Admin and sales_supervisor can update any opportunity
			// Include optimistic locking check if expectedUpdatedAt is provided
			const baseWhereClause =
				context.userRole === "admin" || context.userRole === "sales_supervisor"
					? eq(opportunities.id, id)
					: and(
							eq(opportunities.id, id),
							eq(opportunities.assignedTo, context.userId),
						);

			// Add optimistic locking condition if expectedUpdatedAt is provided
			const whereClause = expectedUpdatedAt
				? and(
						baseWhereClause,
						eq(opportunities.updatedAt, new Date(expectedUpdatedAt)),
					)
				: baseWhereClause;

			// Sales users cannot reassign opportunities
			if (
				context.userRole === "sales" &&
				assignedTo &&
				assignedTo !== context.userId
			) {
				throw new ORPCError("FORBIDDEN", {
					message: "Los usuarios de ventas no pueden reasignar oportunidades",
				});
			}

			// Check if this is a stage change
			const isStageChange =
				input.stageId && input.stageId !== currentOpportunity[0].stageId;
			const vehicleChanged =
				input.vehicleId !== undefined &&
				input.vehicleId !== currentOpportunity[0].vehicleId;

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

			// If lead is being changed (not just preserved) and no explicit source provided, copy source from new lead
			if (
				input.leadId &&
				input.leadId !== currentOpportunity[0].leadId &&
				!updateData.source
			) {
				const newLead = await db
					.select({ source: leads.source })
					.from(leads)
					.where(eq(leads.id, input.leadId))
					.limit(1);
				if (newLead[0]?.source) {
					updateData.source = newLead[0].source;
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
					// Update analysisStatus if it changed during stage transition
					...(newAnalysisStatus !== currentOpportunity[0].analysisStatus && {
						analysisStatus: newAnalysisStatus,
					}),
					...(updateData.status === "won" && { actualCloseDate: new Date() }),
					updatedAt: new Date(),
				})
				.where(whereClause)
				.returning();

			if (updatedOpportunity.length === 0) {
				// If expectedUpdatedAt was provided and no rows updated, it's likely a concurrent modification
				if (expectedUpdatedAt) {
					throw new ORPCError("CONFLICT", {
						message:
							"La oportunidad fue modificada por otro usuario. Por favor recarga la página e intenta de nuevo.",
					});
				}
				throw new ORPCError("NOT_FOUND", {
					message:
						"Oportunidad no encontrada o no tienes permiso para actualizarla",
				});
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

			if (vehicleChanged) {
				await db
					.delete(analysisChecklists)
					.where(eq(analysisChecklists.opportunityId, id));
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

				// Notificar al vendedor asignado si alguien más movió su oportunidad de etapa
				if (
					currentOpportunity[0].assignedTo &&
					currentOpportunity[0].assignedTo !== context.userId
				) {
					await createNotification({
						titulo: `Oportunidad movida de etapa - ${currentOpportunity[0].title}`,
						descripcion: `Tu oportunidad "${currentOpportunity[0].title}" fue movida de etapa por otro usuario.`,
						type: "aviso",
						createdBy: context.userId,
						createdByRole: context.userRole,
						assignedToRole: "sales",
						redirectPage: "opportunity_details",
						assignedTo: currentOpportunity[0].assignedTo,
						relatedEntityType: "opportunity",
						relatedEntityId: id,
					});
				}

				// Notificar a analistas cuando una oportunidad llega a análisis (30%)
				if (movedToAnalysis) {
					await createNotification({
						titulo: `Nueva oportunidad para análisis - ${currentOpportunity[0].title}`,
						descripcion: `La oportunidad "${currentOpportunity[0].title}" fue enviada a análisis y está pendiente de revisión.`,
						type: "aviso",
						createdBy: context.userId,
						createdByRole: context.userRole,
						assignedToRole: "analyst",
						redirectPage: "analysis_details",
						relatedEntityType: "opportunity",
						relatedEntityId: id,
					});
				}
			}

			return updatedOpportunity[0];
		}),

	reassignOpportunityAndLead: crmProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				assignedTo: z.string(),
			}),
		)
		.handler(async ({ input, context }) => {
			if (
				context.userRole !== "admin" &&
				context.userRole !== "sales_supervisor"
			) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permisos para reasignar oportunidades",
				});
			}

			const [current] = await db
				.select({
					leadId: opportunities.leadId,
					closurePercentage: salesStages.closurePercentage,
				})
				.from(opportunities)
				.innerJoin(salesStages, eq(opportunities.stageId, salesStages.id))
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!current) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			if (current.closurePercentage > 30) {
				throw new ORPCError("FORBIDDEN", {
					message:
						"No se puede reasignar una oportunidad con etapa mayor al 30%",
				});
			}

			await db.transaction(async (tx) => {
				await tx
					.update(opportunities)
					.set({ assignedTo: input.assignedTo, updatedAt: new Date() })
					.where(eq(opportunities.id, input.opportunityId));

				if (current.leadId) {
					await tx
						.update(leads)
						.set({ assignedTo: input.assignedTo, updatedAt: new Date() })
						.where(eq(leads.id, current.leadId));
				}
			});
		}),

	// Analyst specific endpoints
	getOpportunitiesForAnalysis: analystProcedure
		.input(
			z
				.object({
					limit: z.number().min(1).max(100).default(20),
					offset: z.number().min(0).default(0),
					search: z.string().optional(),
				})
				.optional(),
		)
		.handler(async ({ input }) => {
			const limit = input?.limit ?? 20;
			const offset = input?.offset ?? 0;
			const search = input?.search;

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
				throw new ORPCError("NOT_FOUND", {
					message: "Etapa de análisis no encontrada",
				});
			}

			// Build conditions
			const conditions = [eq(opportunities.stageId, analysisStage[0].id)];

			// Search filter (name, license plate, opportunity ID)
			if (search && search.trim() !== "") {
				const searchTerms = search.trim().split(/\s+/);
				for (const term of searchTerms) {
					const searchPattern = `%${term}%`;
					conditions.push(
						or(
							ilike(leads.firstName, searchPattern),
							ilike(leads.lastName, searchPattern),
							ilike(vehicles.licensePlate, searchPattern),
							sql`CAST(${opportunities.id} AS TEXT) ILIKE ${searchPattern}`,
						)!,
					);
				}
			}

			// conditions always has at least one element (stageId condition)
			const whereClause = and(...conditions)!;

			// Get total count
			const [{ total }] = await db
				.select({ total: count() })
				.from(opportunities)
				.leftJoin(leads, eq(opportunities.leadId, leads.id))
				.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
				.where(whereClause);

			// Get paginated data
			const data = await db
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
					analysisStatus: opportunities.analysisStatus,
					analysisRejectionCount: opportunities.analysisRejectionCount,
					lead: {
						id: leads.id,
						firstName: leads.firstName,
						middleName: leads.middleName,
						lastName: leads.lastName,
						secondLastName: leads.secondLastName,
						dpi: leads.dpi,
						nit: leads.nit,
						email: leads.email,
						phone: leads.phone,
						age: leads.age,
						direccion: leads.direccion,
						departamento: leads.departamento,
						municipio: leads.municipio,
						zona: leads.zona,
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
						isOwned: vehicles.isOwned,
					},
					stage: {
						id: salesStages.id,
						name: salesStages.name,
						closurePercentage: salesStages.closurePercentage,
						color: salesStages.color,
					},
				})
				.from(opportunities)
				.leftJoin(leads, eq(opportunities.leadId, leads.id))
				.leftJoin(companies, eq(opportunities.companyId, companies.id))
				.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
				.leftJoin(salesStages, eq(opportunities.stageId, salesStages.id))
				.where(whereClause)
				.orderBy(opportunities.createdAt)
				.limit(limit)
				.offset(offset);

			return {
				data,
				total,
				limit,
				offset,
			};
		}),

	approveOpportunityAnalysis: analystProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				approved: z.boolean(),
				reason: z.string().optional(),
				bypassValidation: z.boolean().optional(), // Solo admin puede usar bypass
				// Optimistic locking - prevents race conditions on concurrent updates
				expectedUpdatedAt: z.string().datetime().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Get current opportunity with stage info and lead data
			const opportunity = await db
				.select({
					id: opportunities.id,
					title: opportunities.title,
					assignedTo: opportunities.assignedTo,
					updatedAt: opportunities.updatedAt,
					vehicleId: opportunities.vehicleId,
					creditType: opportunities.creditType,
					stageId: opportunities.stageId,
					notes: opportunities.notes,
					leadId: opportunities.leadId,
					clientType: leads.clientType,
					analysisStatus: opportunities.analysisStatus,
					analysisRejectionCount: opportunities.analysisRejectionCount,
				})
				.from(opportunities)
				.leftJoin(leads, eq(opportunities.leadId, leads.id))
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity[0]) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			// NUEVA VALIDACIÓN: Verificar documentos y vehículo antes de aprobar
			if (input.approved && !input.bypassValidation) {
				// Validar que tenga vehicleId y creditType
				if (!opportunity[0].vehicleId) {
					throw new ORPCError("BAD_REQUEST", {
						message: "La oportunidad debe tener un vehículo asociado",
					});
				}
				if (!opportunity[0].creditType) {
					throw new ORPCError("BAD_REQUEST", {
						message: "La oportunidad debe tener un tipo de crédito",
					});
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
						throw new ORPCError("BAD_REQUEST", {
							message: "El vehículo debe tener una inspección aprobada",
						});
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
					throw new ORPCError("BAD_REQUEST", {
						message: `Faltan documentos obligatorios: ${missingLabels}`,
					});
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
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permisos para omitir la validación",
				});
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
				throw new ORPCError("BAD_REQUEST", {
					message: "La oportunidad no está en etapa de análisis",
				});
			}

			// Validate analysisStatus is in a valid state for approval/rejection
			const validStatusesForReview = ["pending", "resubmitted"];
			if (!validStatusesForReview.includes(opportunity[0].analysisStatus)) {
				if (opportunity[0].analysisStatus === "approved") {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"Esta oportunidad ya fue aprobada. No se puede aprobar o rechazar nuevamente.",
					});
				}
				if (opportunity[0].analysisStatus === "rejected") {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"Esta oportunidad ya fue rechazada y está pendiente de corrección por el vendedor.",
					});
				}
				throw new ORPCError("BAD_REQUEST", {
					message: `Estado de análisis inválido: ${opportunity[0].analysisStatus}. Solo se pueden revisar oportunidades con estado 'pending' o 'resubmitted'.`,
				});
			}

			// Get the next stage (40% - Cierre de propuesta) for approval
			const nextStage = await db
				.select()
				.from(salesStages)
				.where(eq(salesStages.order, 5)) // "Cierre de propuesta"
				.limit(1);

			if (!nextStage[0]) {
				throw new ORPCError("NOT_FOUND", {
					message: "Siguiente etapa no encontrada",
				});
			}

			// Get the previous stage (20% - Solución y propuesta) for rejection
			const previousStage = await db
				.select()
				.from(salesStages)
				.where(eq(salesStages.name, "Solución y propuesta"))
				.limit(1);

			if (!previousStage[0]) {
				throw new ORPCError("NOT_FOUND", {
					message: "Etapa anterior (Solución y propuesta) no encontrada",
				});
			}

			// Determine new stage based on approval/rejection
			const newStageId = input.approved
				? nextStage[0].id // 40% - Cierre de propuesta
				: previousStage[0].id; // 20% - Solución y propuesta (rejection)

			if (input.approved || input.reason || !input.approved) {
				// Build where clause with optional optimistic locking
				const whereClause = input.expectedUpdatedAt
					? and(
							eq(opportunities.id, input.opportunityId),
							eq(opportunities.updatedAt, new Date(input.expectedUpdatedAt)),
						)
					: eq(opportunities.id, input.opportunityId);

				// Update opportunity with analysisStatus
				const updatedRows = await db
					.update(opportunities)
					.set({
						stageId: newStageId,
						analysisStatus: input.approved ? "approved" : "rejected",
						analysisRejectionCount: input.approved
							? opportunity[0].analysisRejectionCount
							: opportunity[0].analysisRejectionCount + 1,
						lastAnalysisRejectedAt: input.approved ? null : new Date(),
						lastAnalysisRejectedBy: input.approved ? null : context.userId,
						notes: input.reason
							? `${opportunity[0].notes || ""}\n\n[Análisis ${input.approved ? "Aprobado" : "Rechazado"}]: ${input.reason}`
							: opportunity[0].notes,
						updatedAt: new Date(),
					})
					.where(whereClause)
					.returning();

				// Check for concurrent modification
				if (updatedRows.length === 0 && input.expectedUpdatedAt) {
					throw new ORPCError("CONFLICT", {
						message:
							"La oportunidad fue modificada por otro usuario. Por favor recarga la página e intenta de nuevo.",
					});
				}

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
							: "Documentación rechazada - movida a etapa 20%"),
					isOverride: false,
				});

				if (input.approved) {
					// Notificación para el vendedor asignado
					if (opportunity[0].assignedTo) {
						await createNotification({
							titulo: `Análisis aprobado - ${opportunity[0].title}`,
							descripcion: `Tu oportunidad "${opportunity[0].title}" fue aprobada en análisis y avanzó a Cierre de propuesta (40%).`,
							type: "aviso",
							createdBy: context.userId,
							createdByRole: context.userRole,
							assignedToRole: "sales",
							assignedTo: opportunity[0].assignedTo,
							redirectPage: "opportunity_details",
							relatedEntityType: "opportunity",
							relatedEntityId: input.opportunityId,
						});
					}

					// Notificación para la supervisora de ventas
					await createNotification({
						titulo: `Análisis aprobado - ${opportunity[0].title}`,
						descripcion: `La oportunidad "${opportunity[0].title}" fue aprobada en análisis. Ya puede revisar el detalle de crédito.`,
						type: "aviso",
						createdBy: context.userId,
						createdByRole: context.userRole,
						assignedToRole: "sales_supervisor",
						redirectPage: "opportunity_details",
						relatedEntityType: "opportunity",
						relatedEntityId: input.opportunityId,
					});
				} else {
					// Notificación para el vendedor asignado de rechazo
					if (opportunity[0].assignedTo) {
						await createNotification({
							titulo: `Análisis rechazado - ${opportunity[0].title}`,
							descripcion: `Tu oportunidad "${opportunity[0].title}" fue rechazada en análisis y regresó a Solución y propuesta (20%).${input.reason ? ` Razón: ${input.reason}` : ""}`,
							type: "aviso",
							createdBy: context.userId,
							createdByRole: context.userRole,
							assignedToRole: "sales",
							redirectPage: "opportunity_details",
							assignedTo: opportunity[0].assignedTo,
							relatedEntityType: "opportunity",
							relatedEntityId: input.opportunityId,
						});
					}
				}
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
				throw new ORPCError("FORBIDDEN", {
					message:
						"Solo supervisores de ventas o administradores pueden aprobar el detalle de crédito",
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
			if (opportunity.creditDetailApproved) {
				throw new ORPCError("BAD_REQUEST", {
					message: "El detalle de crédito ya fue aprobado",
				});
			}

			const nextStage = await db
				.select()
				.from(salesStages)
				.where(eq(salesStages.order, 6)) // "Formalización" 50%
				.limit(1);

			if (!nextStage[0]) {
				throw new ORPCError("NOT_FOUND", {
					message: "Siguiente etapa no encontrada",
				});
			}

			// Update opportunity with approval
			await db
				.update(opportunities)
				.set({
					stageId: nextStage[0].id,
					creditDetailApproved: true,
					creditDetailApprovedBy: context.userId,
					creditDetailApprovedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(opportunities.id, input.opportunityId));

			// Record stage history
			await db.insert(opportunityStageHistory).values({
				opportunityId: input.opportunityId,
				fromStageId: opportunity.stageId,
				toStageId: nextStage[0].id,
				changedBy: context.userId,
				reason: "Detalle de crédito aprobado - Movido a Formalización (50%)",
				isOverride: false,
			});

			await createNotification({
				titulo: `Detalle de crédito aprobado - ${opportunity.title}`,
				descripcion: `El detalle de crédito de la oportunidad "${opportunity.title}" fue aprobado y avanzó a Formalización (50%). Está lista para la asignación de inversión.`,
				type: "aviso",
				createdBy: context.userId,
				createdByRole: context.userRole,
				assignedToRole: "analyst",
				redirectPage: "analysis_50_details",
				relatedEntityType: "opportunity",
				relatedEntityId: input.opportunityId,
			});

			return { success: true };
		}),

	// Revoke credit detail approval (back to 40%)
	revokeCreditDetailApproval: crmProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Only admin or sales_supervisor can revoke
			if (!PERMISSIONS.canApproveCreditDetail(context.userRole)) {
				throw new ORPCError("FORBIDDEN", {
					message:
						"Solo supervisores de ventas o administradores pueden cancelar la aprobación",
				});
			}

			// Get current opportunity with stage info
			const [opportunity] = await db
				.select({
					id: opportunities.id,
					title: opportunities.title,
					assignedTo: opportunities.assignedTo,
					stageId: opportunities.stageId,
					creditDetailApproved: opportunities.creditDetailApproved,
				})
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			// Validate that it's approved
			if (!opportunity.creditDetailApproved) {
				throw new ORPCError("BAD_REQUEST", {
					message: "El detalle de crédito no está aprobado",
				});
			}

			// Get current stage to check closure percentage
			const [currentStage] = await db
				.select()
				.from(salesStages)
				.where(eq(salesStages.id, opportunity.stageId))
				.limit(1);

			if (!currentStage) {
				throw new ORPCError("NOT_FOUND", {
					message: "Etapa actual no encontrada",
				});
			}

			// Cannot revoke if at 90% or higher (already sent to cartera)
			if (currentStage.closurePercentage >= 90) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"No se puede cancelar la aprobación de una oportunidad que ya fue enviada a cartera",
				});
			}

			// Get stage 40% by closurePercentage (more reliable than order)
			const [previousStage] = await db
				.select()
				.from(salesStages)
				.where(eq(salesStages.closurePercentage, 40))
				.limit(1);

			if (!previousStage) {
				throw new ORPCError("NOT_FOUND", {
					message: "Etapa 40% no encontrada",
				});
			}

			// Update opportunity and record history in a transaction for atomicity
			await db.transaction(async (tx) => {
				// Update opportunity - revoke approval
				await tx
					.update(opportunities)
					.set({
						stageId: previousStage.id,
						creditDetailApproved: false,
						creditDetailApprovedBy: null,
						creditDetailApprovedAt: null,
						updatedAt: new Date(),
					})
					.where(eq(opportunities.id, input.opportunityId));

				// Record stage history
				await tx.insert(opportunityStageHistory).values({
					opportunityId: input.opportunityId,
					fromStageId: opportunity.stageId,
					toStageId: previousStage.id,
					changedBy: context.userId,
					reason:
						"Aprobación de detalle cancelada - Regresado a Cierre de propuesta (40%)",
					isOverride: false,
				});
			});

			if (opportunity.assignedTo) {
				await createNotification({
					titulo: `Detalle de crédito rechazado - ${opportunity.title}`,
					descripcion: `El detalle de crédito de la oportunidad "${opportunity.title}" fue rechazado y regresado a la etapa de Cierre de propuesta (40%).`,
					type: "aviso",
					createdBy: context.userId,
					createdByRole: context.userRole,
					assignedToRole: "sales",
					redirectPage: "opportunity_details",
					assignedTo: opportunity.assignedTo,
					relatedEntityType: "opportunity",
					relatedEntityId: input.opportunityId,
				});
			}

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
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
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
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			// For sales users, check if they are assigned to the opportunity
			if (
				context.userRole === "sales" &&
				opportunity[0].assignedTo !== context.userId
			) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para ver esta oportunidad",
				});
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
			if (context.userRole === "sales") {
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
		if (context.userRole === "sales") {
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
				leadId: z.string().uuid().optional(),
				dateFrom: z.string().optional(),
				dateTo: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const { limit, offset, search } = input;

			const carteraCredits = await getCurrentClientCreditsFromCartera();
			const clientCreditSifcos = carteraCredits
				.map((row) => row.creditos?.numero_credito_sifco?.trim())
				.filter((sifco): sifco is string => Boolean(sifco));
			const carteraCreditBySifco = new Map(
				carteraCredits
					.map(
						(row) => [row.creditos?.numero_credito_sifco?.trim(), row] as const,
					)
					.filter((entry): entry is readonly [string, CarteraClientCredit] =>
						Boolean(entry[0]),
					),
			);

			if (clientCreditSifcos.length === 0) {
				return {
					data: [],
					total: 0,
					limit,
					offset,
				};
			}

			// Find leads with at least one credit currently active, overdue, or in agreement in cartera.
			const leadsWithClientCredits = await db
				.selectDistinct({ leadId: opportunities.leadId })
				.from(opportunities)
				.where(
					and(
						isNotNull(opportunities.leadId),
						inArray(opportunities.numeroSifco, clientCreditSifcos),
					),
				);

			const clientLeadIds = leadsWithClientCredits
				.map((r) => r.leadId)
				.filter((id): id is string => id !== null);

			// Build conditions for the main query
			const conditions: any[] = [];
			if (clientLeadIds.length > 0) {
				conditions.push(
					sql`${leads.id} IN (${sql.join(
						clientLeadIds.map((id) => sql`${id}`),
						sql`, `,
					)})`,
				);
			} else {
				conditions.push(sql`false`);
			}

			// Filter by user if not admin/sales_supervisor
			if (context.userRole === "sales") {
				conditions.push(eq(leads.assignedTo, context.userId));
			}

			// Filter by specific lead ID
			if (input.leadId) {
				conditions.push(eq(leads.id, input.leadId));
			}

			const whereClause = and(...conditions);

			// Get paginated leads
			const clientLeads = await db
				.select({
					id: leads.id,
					firstName: leads.firstName,
					middleName: leads.middleName,
					lastName: leads.lastName,
					secondLastName: leads.secondLastName,
					email: leads.email,
					phone: leads.phone,
					dpi: leads.dpi,
					nit: leads.nit,
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
					direccion: leads.direccion,
					departamento: leads.departamento,
					municipio: leads.municipio,
					zona: leads.zona,
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
				.orderBy(desc(leads.createdAt));

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
								opp.numeroSifco != null &&
								clientCreditSifcos.includes(opp.numeroSifco),
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
								maxPayment: creditAnalysis.maxPayment,
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
			const crmRows = clientLeads.flatMap((lead) => {
				const leadOpportunities = opportunitiesByLead[lead.id] || [];
				return buildCarteraMatchedClientRows({
					lead,
					leadOpportunities,
					creditAnalysis: creditAnalysisMap[lead.id] || null,
					carteraCreditBySifco,
				});
			});
			const matchedSifcos = new Set(
				crmRows
					.map((row) => row.carteraCredit?.numeroSifco)
					.filter((sifco): sifco is string => Boolean(sifco)),
			);

			const carteraOnlyRows = carteraCredits
				.filter((credit) => {
					const sifco = credit.creditos?.numero_credito_sifco?.trim();
					return sifco && !matchedSifcos.has(sifco);
				})
				.map(buildCarteraOnlyClientRow);

			const searchValue = search?.trim().toLowerCase();
			const fromDate = input.dateFrom ? new Date(input.dateFrom) : null;
			const toDate = input.dateTo ? new Date(input.dateTo) : null;
			if (toDate) toDate.setHours(23, 59, 59, 999);

			const visibleCarteraOnlyRows =
				input.leadId || context.userRole === "sales" ? [] : carteraOnlyRows;
			const allRows = [...crmRows, ...visibleCarteraOnlyRows]
				.filter((row) => {
					if (!searchValue) return true;
					return [
						row.firstName,
						(row as any).middleName,
						row.lastName,
						(row as any).secondLastName,
						row.email,
						row.phone,
						row.dpi,
						(row as any).nit,
						(row as any).carteraCredit?.numeroSifco,
					]
						.filter(Boolean)
						.some((value) => String(value).toLowerCase().includes(searchValue));
				})
				.filter((row) => {
					if (fromDate && row.createdAt < fromDate) return false;
					if (toDate && row.createdAt > toDate) return false;
					return true;
				})
				.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

			const data = allRows.slice(offset, offset + limit);

			return {
				data,
				total: allRows.length,
				limit,
				offset,
			};
		}),

	// Estadísticas de leads como clientes (totales globales, no paginados)
	getLeadsAsClientsStats: crmProcedure.handler(async ({ context }) => {
		const carteraCredits = await getCurrentClientCreditsFromCartera();
		const clientCreditSifcos = carteraCredits
			.map((row) => row.creditos?.numero_credito_sifco?.trim())
			.filter((sifco): sifco is string => Boolean(sifco));

		if (clientCreditSifcos.length === 0) {
			return {
				totalClients: 0,
				totalClosedOpportunities: 0,
				totalValue: 0,
				missingCrmCount: 0,
			};
		}

		const clientCreditOpportunityCondition = and(
			isNotNull(opportunities.leadId),
			inArray(opportunities.numeroSifco, clientCreditSifcos),
		);

		const clientCreditOpportunitiesData = await db
			.select({
				leadId: opportunities.leadId,
				numeroSifco: opportunities.numeroSifco,
				value: opportunities.value,
			})
			.from(opportunities)
			.leftJoin(leads, eq(opportunities.leadId, leads.id))
			.where(
				context.userRole === "sales"
					? and(
							clientCreditOpportunityCondition,
							eq(leads.assignedTo, context.userId),
						)
					: clientCreditOpportunityCondition,
			);

		// Calculate stats
		const uniqueLeadIds = new Set(
			clientCreditOpportunitiesData
				.map((o) => o.leadId)
				.filter((id): id is string => id !== null),
		);
		const matchedSifcos = new Set(
			clientCreditOpportunitiesData
				.map((o: any) => o.numeroSifco)
				.filter((sifco: unknown): sifco is string => typeof sifco === "string"),
		);

		return calculateCarteraClientStats({
			carteraCredits,
			matchedSifcos,
			uniqueLeadCount: uniqueLeadIds.size,
			scopedOpportunityCount: clientCreditOpportunitiesData.length,
			userRole: context.userRole,
		});
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
				throw new ORPCError("FORBIDDEN", {
					message:
						"Los usuarios de ventas solo pueden asignarse clientes a sí mismos",
				});
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
				throw new ORPCError("NOT_FOUND", {
					message:
						"Cliente no encontrado o no tienes permiso para actualizarlo",
				});
			}

			return updatedClient[0];
		}),

	// Dashboard stats
	getDashboardStats: crmProcedure
		.input(
			z.object({
				month: z.number().min(1).max(12),
				year: z.number(),
			}),
		)
		.handler(async ({ input, context }) => {
			const PLACED_STAGE_THRESHOLD = 90;
			const { startOfMonth, endOfMonth } = getGuatemalaMonthWindow(
				input.year,
				input.month,
			);

			// Helper: get placed credits stats (stage >= threshold) with optional user filter
			// Uses opportunityStageHistory.changedAt to determine when an opportunity
			// reached a placed stage, instead of opportunities.createdAt
			const getPlacedCreditsStats = async (userId?: string) => {
				const placedStages = await db
					.select({ id: salesStages.id })
					.from(salesStages)
					.where(gte(salesStages.closurePercentage, PLACED_STAGE_THRESHOLD));

				const placedStageIds = placedStages.map((s) => s.id);

				if (placedStageIds.length === 0) {
					return { placedCount: 0, placedAmount: 0 };
				}

				// Find opportunities that FIRST reached a placed stage within this month
				const movedToPlacedThisMonth = await db
					.select({ opportunityId: opportunityStageHistory.opportunityId })
					.from(opportunityStageHistory)
					.where(
						and(
							inArray(opportunityStageHistory.toStageId, placedStageIds),
							gte(opportunityStageHistory.changedAt, startOfMonth),
							lt(opportunityStageHistory.changedAt, endOfMonth),
						),
					);

				const candidateIds = [
					...new Set(movedToPlacedThisMonth.map((o) => o.opportunityId)),
				];

				// Exclude opportunities that already reached placed before this month
				const alreadyPlacedBefore =
					candidateIds.length > 0
						? await db
								.select({
									opportunityId: opportunityStageHistory.opportunityId,
								})
								.from(opportunityStageHistory)
								.where(
									and(
										inArray(
											opportunityStageHistory.opportunityId,
											candidateIds,
										),
										inArray(opportunityStageHistory.toStageId, placedStageIds),
										lt(opportunityStageHistory.changedAt, startOfMonth),
									),
								)
						: [];

				const alreadyPlacedIds = new Set(
					alreadyPlacedBefore.map((o) => o.opportunityId),
				);
				const placedOppIds = candidateIds.filter(
					(id) => !alreadyPlacedIds.has(id),
				);

				if (placedOppIds.length === 0) {
					return { placedCount: 0, placedAmount: 0 };
				}

				const conditions = [
					inArray(opportunities.id, placedOppIds),
					inArray(opportunities.stageId, placedStageIds),
					not(eq(opportunities.status, "migrate")),
				];
				if (userId) {
					conditions.push(eq(opportunities.assignedTo, userId));
				}

				const [result] = await db
					.select({
						placedCount: count(),
						placedAmount: sum(opportunities.value),
					})
					.from(opportunities)
					.where(and(...conditions));

				return {
					placedCount: result?.placedCount || 0,
					placedAmount: Number.parseFloat(result?.placedAmount ?? "0"),
				};
			};

			if (context.userRole === "admin") {
				const [totalLeads] = await db
					.select({ count: count() })
					.from(leads)
					.where(
						and(
							gte(leads.createdAt, startOfMonth),
							lt(leads.createdAt, endOfMonth),
						),
					);
				const [totalOpportunities] = await db
					.select({ count: count() })
					.from(opportunities)
					.where(
						and(
							gte(opportunities.createdAt, startOfMonth),
							lt(opportunities.createdAt, endOfMonth),
							not(eq(opportunities.status, "migrate")),
						),
					);
				const [wonOpportunities] = await db
					.select({ count: count() })
					.from(opportunities)
					.where(
						and(
							eq(opportunities.status, "won"),
							gte(opportunities.createdAt, startOfMonth),
							lt(opportunities.createdAt, endOfMonth),
						),
					);
				const [totalValue] = await db
					.select({ total: sum(opportunities.value) })
					.from(opportunities)
					.where(
						and(
							gte(opportunities.createdAt, startOfMonth),
							lt(opportunities.createdAt, endOfMonth),
							not(eq(opportunities.status, "migrate")),
						),
					);
				const [totalClients] = await db
					.select({ count: count() })
					.from(clients)
					.where(
						and(
							gte(clients.createdAt, startOfMonth),
							lt(clients.createdAt, endOfMonth),
						),
					);
				const placed = await getPlacedCreditsStats();

				return {
					totalLeads: totalLeads?.count || 0,
					totalOpportunities: totalOpportunities?.count || 0,
					wonOpportunities: wonOpportunities?.count || 0,
					totalValue: Number.parseFloat(totalValue?.total ?? "0"),
					totalClients: totalClients?.count || 0,
					placedCount: placed.placedCount,
					placedAmount: placed.placedAmount,
				};
			}

			if (context.userRole === "sales_supervisor") {
				const [totalLeads] = await db
					.select({ count: count() })
					.from(leads)
					.where(
						and(
							gte(leads.createdAt, startOfMonth),
							lt(leads.createdAt, endOfMonth),
						),
					);
				const [totalOpportunities] = await db
					.select({ count: count() })
					.from(opportunities)
					.where(
						and(
							gte(opportunities.createdAt, startOfMonth),
							lt(opportunities.createdAt, endOfMonth),
							not(eq(opportunities.status, "migrate")),
						),
					);
				const [wonOpportunities] = await db
					.select({ count: count() })
					.from(opportunities)
					.where(
						and(
							eq(opportunities.status, "won"),
							gte(opportunities.createdAt, startOfMonth),
							lt(opportunities.createdAt, endOfMonth),
						),
					);
				const [totalValue] = await db
					.select({ total: sum(opportunities.value) })
					.from(opportunities)
					.where(
						and(
							gte(opportunities.createdAt, startOfMonth),
							lt(opportunities.createdAt, endOfMonth),
							not(eq(opportunities.status, "migrate")),
						),
					);
				const [totalClients] = await db
					.select({ count: count() })
					.from(clients)
					.where(
						and(
							gte(clients.createdAt, startOfMonth),
							lt(clients.createdAt, endOfMonth),
						),
					);
				const placed = await getPlacedCreditsStats();

				return {
					teamLeads: totalLeads?.count || 0,
					teamOpportunities: totalOpportunities?.count || 0,
					wonOpportunities: wonOpportunities?.count || 0,
					totalValue: Number.parseFloat(totalValue?.total ?? "0"),
					teamClients: totalClients?.count || 0,
					placedCount: placed.placedCount,
					placedAmount: placed.placedAmount,
				};
			}

			// Sales users get their own stats
			const [myLeads] = await db
				.select({ count: count() })
				.from(leads)
				.where(
					and(
						eq(leads.assignedTo, context.userId),
						gte(leads.createdAt, startOfMonth),
						lt(leads.createdAt, endOfMonth),
					),
				);
			const [myOpportunities] = await db
				.select({ count: count() })
				.from(opportunities)
				.where(
					and(
						eq(opportunities.assignedTo, context.userId),
						gte(opportunities.createdAt, startOfMonth),
						lt(opportunities.createdAt, endOfMonth),
						not(eq(opportunities.status, "migrate")),
					),
				);
			const [myWonOpportunities] = await db
				.select({ count: count() })
				.from(opportunities)
				.where(
					and(
						eq(opportunities.assignedTo, context.userId),
						eq(opportunities.status, "won"),
						gte(opportunities.createdAt, startOfMonth),
						lt(opportunities.createdAt, endOfMonth),
					),
				);
			const [myTotalValue] = await db
				.select({ total: sum(opportunities.value) })
				.from(opportunities)
				.where(
					and(
						eq(opportunities.assignedTo, context.userId),
						gte(opportunities.createdAt, startOfMonth),
						lt(opportunities.createdAt, endOfMonth),
						not(eq(opportunities.status, "migrate")),
					),
				);
			const [myClients] = await db
				.select({ count: count() })
				.from(clients)
				.where(
					and(
						eq(clients.assignedTo, context.userId),
						gte(clients.createdAt, startOfMonth),
						lt(clients.createdAt, endOfMonth),
					),
				);
			const placed = await getPlacedCreditsStats(context.userId);

			return {
				myLeads: myLeads?.count || 0,
				myOpportunities: myOpportunities?.count || 0,
				wonOpportunities: myWonOpportunities?.count || 0,
				totalValue: Number.parseFloat(myTotalValue?.total ?? "0"),
				myClients: myClients?.count || 0,
				placedCount: placed.placedCount,
				placedAmount: placed.placedAmount,
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
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			// Para ventas, verificar que sea su oportunidad
			if (
				context.userRole === "sales" &&
				opportunity[0].assignedTo !== context.userId
			) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para ver estos documentos",
				});
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
					key: z.string(), // R2 key from presigned upload
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
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			// Admin, sales, sales_supervisor y analyst pueden subir documentos
			if (
				!["admin", "sales", "sales_supervisor", "analyst"].includes(
					context.userRole,
				)
			) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para subir documentos",
				});
			}

			// Para sales, verificar que sea su oportunidad
			if (
				context.userRole === "sales" &&
				opportunity[0].assignedTo !== context.userId
			) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para subir documentos a esta oportunidad",
				});
			}

			const uploadedFile = await verifyUploadedDocumentInR2({
				key: input.file.key,
				expectedPrefix: buildUploadPrefix(
					"opportunity_document",
					input.opportunityId,
				),
				filename: input.file.name,
				mimeType: input.file.type,
			});

			const uniqueFilename = uploadedFile.key.split("/").pop()!;

			// Guardar en base de datos
			const [newDocument] = await db
				.insert(opportunityDocuments)
				.values({
					opportunityId: input.opportunityId,
					filename: uniqueFilename,
					originalName: input.file.name,
					mimeType: uploadedFile.mimeType,
					size: uploadedFile.size,
					documentType: input.documentType,
					description: input.description,
					uploadedBy: context.userId,
					filePath: uploadedFile.key,
				})
				.returning();

			const isVehicleDocument = VEHICLE_DOCUMENT_TYPES.includes(
				input.documentType as (typeof VEHICLE_DOCUMENT_TYPES)[number],
			);

			// Si es un documento de vehículo y la oportunidad tiene vehículo asociado,
			// también guardarlo en vehicleDocuments para que aparezca en el checklist del vehículo
			if (isVehicleDocument && opportunity[0]?.vehicleId) {
				const [vehicleDoc] = await db
					.insert(vehicleDocuments)
					.values({
						vehicleId: opportunity[0].vehicleId,
						filename: uniqueFilename,
						originalName: input.file.name,
						mimeType: uploadedFile.mimeType,
						size: uploadedFile.size,
						documentType: input.documentType,
						description: input.description,
						uploadedBy: context.userId,
						filePath: uploadedFile.key,
					})
					.returning();

				// Actualizar el checklist de análisis con el documento del vehículo
				await updateChecklistForVehicleDocument(
					opportunity[0].vehicleId,
					input.documentType,
					vehicleDoc.id,
				);
			}

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
				throw new ORPCError("NOT_FOUND", {
					message: "Documento no encontrado",
				});
			}

			// Verificar permisos
			if (
				context.userRole === "admin" ||
				context.userRole === "sales_supervisor" ||
				context.userRole === "analyst" ||
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
			throw new ORPCError("FORBIDDEN", {
				message: "No tienes permiso para eliminar este documento",
			});
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
					throw new ORPCError("NOT_FOUND", {
						message: "Oportunidad no encontrada",
					});
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
				if (opp.vehicleId) {
					const inspectionResult = await getVehicleInspectionStatus(
						opp.vehicleId,
					);
					vehicleInspected = inspectionResult.isInspected;
					inspectionStatus = inspectionResult.inspectionStatus;
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
			// Phase 1: Get opportunity and check for existing checklist in parallel
			const [opportunityResult, existingChecklistResult] = await Promise.all([
				db
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
					.limit(1),
				db
					.select()
					.from(analysisChecklists)
					.where(eq(analysisChecklists.opportunityId, input.opportunityId))
					.limit(1),
			]);

			const [opportunity] = opportunityResult;
			const [existingChecklist] = existingChecklistResult;

			if (!opportunity) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			console.log("[getAnalysisChecklist] opportunity:", opportunity);

			let shouldUpdateExistingChecklist = false;

			// Phase 2: Run independent queries in parallel
			const [requiredDocs, uploadedDocs, vehicleResult, creditAnalysisResult] =
				await Promise.all([
					// Required documents for client type
					db
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
						.orderBy(documentRequirementsByClientType.order),
					// Uploaded opportunity documents
					db
						.select()
						.from(opportunityDocuments)
						.where(eq(opportunityDocuments.opportunityId, input.opportunityId)),
					// Vehicle info (if exists)
					opportunity.vehicleId
						? db
								.select()
								.from(vehicles)
								.where(eq(vehicles.id, opportunity.vehicleId))
								.limit(1)
						: Promise.resolve([]),
					// Credit analysis (if lead exists)
					opportunity.leadId
						? db
								.select()
								.from(creditAnalysis)
								.where(eq(creditAnalysis.leadId, opportunity.leadId))
								.limit(1)
						: Promise.resolve([]),
				]);

			const uploadedTypes = new Set(uploadedDocs.map((d) => d.documentType));
			const [vehicle] = vehicleResult;
			const [creditAnalysisExists] = creditAnalysisResult;

			console.log(
				"[getAnalysisChecklist] creditAnalysisExists:",
				creditAnalysisExists,
			);

			// Phase 3: Vehicle-dependent queries (if vehicle exists)
			let vehicleInspected = false;
			let inspectionId = null;
			const vehicleOwnerType = vehicle?.ownerType ?? null;
			let requiredVehicleDocs: any[] = [];
			let uploadedVehicleDocs: any[] = [];

			if (vehicle) {
				// New vehicles don't require inspection
				if (vehicle.isNew) {
					vehicleInspected = true;
				}

				// Run vehicle document queries in parallel
				const [
					inspectionResult,
					reqVehicleDocsResult,
					uploadedVehicleDocsResult,
				] = await Promise.all([
					// Inspection check (only for used vehicles)
					!vehicle.isNew
						? db
								.select()
								.from(vehicleInspections)
								.where(
									and(
										eq(vehicleInspections.vehicleId, opportunity.vehicleId!),
										eq(vehicleInspections.status, "approved"),
									),
								)
								.limit(1)
						: Promise.resolve([]),
					// Required vehicle documents
					vehicleOwnerType
						? db
								.select()
								.from(vehicleDocumentRequirements)
								.where(
									eq(vehicleDocumentRequirements.ownerType, vehicleOwnerType),
								)
								.orderBy(vehicleDocumentRequirements.order)
						: Promise.resolve([]),
					// Uploaded vehicle documents
					db
						.select()
						.from(vehicleDocuments)
						.where(eq(vehicleDocuments.vehicleId, opportunity.vehicleId!)),
				]);

				const [inspection] = inspectionResult;
				if (inspection) {
					vehicleInspected = true;
					inspectionId = inspection.id;
				}

				requiredVehicleDocs = reqVehicleDocsResult;
				uploadedVehicleDocs = uploadedVehicleDocsResult;

				// Filter out documents that don't apply to new vehicles
				if (vehicle.isNew) {
					const docsNotApplicableToNewVehicles = [
						"tarjeta_circulacion",
						"titulo_propiedad",
						"dpi_dueno",
						"pago_impuesto_circulacion",
						"consulta_sat",
						"consulta_garantias_mobiliarias",
						"usuario_sat_propietario",
						"rtu_propietario",
						"omisos_incumplimientos_propietario",
						"garantia_mobiliaria_sat",
						"garantia_mobiliaria_dpi",
						"garantia_mobiliaria_nit",
						"garantia_mobiliaria_serie",
						"multas_vehiculo",
					];
					requiredVehicleDocs = requiredVehicleDocs.filter(
						(doc) => !docsNotApplicableToNewVehicles.includes(doc.documentType),
					);
				}

				// Fallback: buscar documentos de vehículo en opportunityDocuments
				// para oportunidades existentes que subieron docs antes de la sincronización
				if (requiredVehicleDocs.length > 0) {
					const vehicleDocTypes = requiredVehicleDocs.map(
						(d) => d.documentType,
					);
					const uploadedVehicleTypesFromVehicle = new Set(
						uploadedVehicleDocs.map((d) => d.documentType),
					);

					const missingTypes = vehicleDocTypes.filter(
						(type) => !uploadedVehicleTypesFromVehicle.has(type),
					);

					if (missingTypes.length > 0) {
						const fallbackDocs = uploadedDocs.filter((d) =>
							missingTypes.includes(d.documentType),
						);
						uploadedVehicleDocs = [
							...uploadedVehicleDocs,
							...fallbackDocs.map((d) => ({
								...d,
								vehicleId: opportunity.vehicleId,
								fromOpportunity: true,
							})),
						];
					}
				}
			}

			const uploadedVehicleTypes = new Set(
				uploadedVehicleDocs.map((d) => d.documentType),
			);

			// Early return if checklist already exists and is still aligned
			if (existingChecklist) {
				if (
					hasStaleAnalysisChecklistVehicleState(
						existingChecklist.checklistData as any,
						opportunity.vehicleId,
						vehicleInspected,
					) ||
					hasStaleAnalysisChecklistDocumentState(
						existingChecklist.checklistData as any,
						uploadedTypes,
						uploadedVehicleTypes,
					)
				) {
					shouldUpdateExistingChecklist = true;
				} else {
					return existingChecklist.checklistData;
				}
			}

			// Create initial checklist structure
			const checklistData = {
				sections: {
					documentos: {
						completed:
							requiredDocs.filter((doc) => doc.required).length > 0 &&
							requiredDocs
								.filter((doc) => doc.required)
								.every((doc) => uploadedTypes.has(doc.documentType)),
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
								requiredVehicleDocs.filter((doc) => doc.required).length ===
									0 ||
								requiredVehicleDocs
									.filter((doc) => doc.required)
									.every((doc) => uploadedVehicleTypes.has(doc.documentType)),
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
									name: "Usuario SAT",
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
								...(vehicle.isNew
									? [
											{
												name: "Factura del vehículo nuevo",
												type: "factura_vehiculo_nuevo",
												required: true,
												completed: false,
											},
										]
									: []),
							],
						},
					},
				},
				overallProgress: 0,
				canApprove: false,
			};

			if (shouldUpdateExistingChecklist) {
				carryForwardAnalysisChecklistVerificationState(
					checklistData,
					existingChecklist?.checklistData,
				);
			}

			// Calculate vehicle section completion
			checklistData.sections.vehiculo.verificaciones.completed =
				checklistData.sections.vehiculo.verificaciones.items
					.filter((i) => i.required)
					.every((i) => i.completed);

			checklistData.sections.vehiculo.completed =
				vehicleInspected &&
				checklistData.sections.vehiculo.documentos.completed &&
				checklistData.sections.vehiculo.verificaciones.completed;

			// Calculate overall progress (only count required items)
			const totalItems =
				checklistData.sections.documentos.items.filter((i) => i.required)
					.length + // client docs (required only)
				checklistData.sections.verificaciones.items.filter((i) => i.required)
					.length + // client verifications
				(opportunity.vehicleId ? 1 : 0) + // vehicle inspection
				(opportunity.vehicleId
					? checklistData.sections.vehiculo.documentos.items.filter(
							(i) => i.required,
						).length
					: 0) + // vehicle docs (required only)
				(opportunity.vehicleId
					? checklistData.sections.vehiculo.verificaciones.items.filter(
							(i) => i.required,
						).length
					: 0); // vehicle verifications

			const completedItems =
				checklistData.sections.documentos.items.filter(
					(i) => i.required && i.uploaded,
				).length + // client docs uploaded (required only)
				checklistData.sections.verificaciones.items.filter(
					(i) => i.required && i.completed,
				).length + // client verifications completed
				(vehicleInspected ? 1 : 0) + // vehicle inspection
				(opportunity.vehicleId
					? checklistData.sections.vehiculo.documentos.items.filter(
							(i) => i.required && i.uploaded,
						).length
					: 0) + // vehicle docs uploaded (required only)
				(opportunity.vehicleId
					? checklistData.sections.vehiculo.verificaciones.items.filter(
							(i) => i.required && i.completed,
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

			if (shouldUpdateExistingChecklist && existingChecklist) {
				await db
					.update(analysisChecklists)
					.set({
						checklistData,
						updatedAt: new Date(),
					})
					.where(eq(analysisChecklists.id, existingChecklist.id));
			} else {
				// Save initial checklist
				await db.insert(analysisChecklists).values({
					opportunityId: input.opportunityId,
					checklistData,
				});
			}

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
				throw new ORPCError("NOT_FOUND", {
					message: "Checklist no encontrado",
				});
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
				const inspectionResult = await getVehicleInspectionStatus(
					opportunity.vehicleId,
				);
				vehicleInspected = inspectionResult.isInspected;
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
					(checklistData.sections.vehiculo.documentos?.items?.length > 0
						? (checklistData.sections.vehiculo.documentos?.completed ?? true)
						: true) &&
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
				throw new ORPCError("NOT_FOUND", {
					message: "Checklist no encontrado",
				});
			}

			const checklistData = existing.checklistData as any;

			// Verify vehicle section exists
			if (!checklistData.sections.vehiculo?.verificaciones) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"La sección de verificaciones de vehículo no existe en este checklist",
				});
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

			// Get opportunity
			const [opportunity] = await db
				.select({ vehicleId: opportunities.vehicleId })
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			let vehicleInspected = false;
			if (opportunity?.vehicleId) {
				const inspectionResult = await getVehicleInspectionStatus(
					opportunity.vehicleId,
				);
				vehicleInspected = inspectionResult.isInspected;
			}

			// Recalculate vehicle section completion
			checklistData.sections.vehiculo.completed =
				vehicleInspected &&
				(checklistData.sections.vehiculo.documentos?.items?.length > 0
					? (checklistData.sections.vehiculo.documentos?.completed ?? true)
					: true) &&
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

	// Get disbursement notes for an opportunity (lightweight, no stage check)
	getDisbursementNotes: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input }) => {
			const [checklist] = await db
				.select({ notes: disbursementChecklists.notes })
				.from(disbursementChecklists)
				.where(eq(disbursementChecklists.opportunityId, input.opportunityId))
				.limit(1);

			return { notes: checklist?.notes ?? null };
		}),

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
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			// Get stage info
			const [stage] = await db
				.select()
				.from(salesStages)
				.where(eq(salesStages.id, opportunity.stageId))
				.limit(1);

			if (!stage || stage.closurePercentage !== 90) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Esta oportunidad no está en la etapa de 90% para desembolso",
				});
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
				throw new ORPCError("NOT_FOUND", {
					message:
						"Checklist de desembolso no encontrado. Primero obtén el checklist.",
				});
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
				throw new ORPCError("BAD_REQUEST", {
					message: "Clave de item inválida",
				});
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

			// Notificar a contabilidad para que realice el desembolso
			await createNotification({
				titulo: `Desembolso aprobado - ${opportunity.title}`,
				descripcion: `La oportunidad "${opportunity.title}" fue aprobada para desembolso. Por favor suba las boletas correspondientes.`,
				type: "action_upload_files",
				createdBy: context.userId,
				createdByRole: context.userRole,
				assignedToRole: "accounting",
				relatedEntityType: "opportunity_client",
				relatedEntityId: input.opportunityId,
				redirectPage: "client_details_disbursement",
			});

			return {
				success: true,
			};
		}),

	// Get opportunities at 90% for disbursement review
	getOpportunitiesForDisbursement: analystProcedure
		.input(
			z
				.object({
					limit: z.number().min(1).max(100).default(20),
					offset: z.number().min(0).default(0),
					search: z.string().optional(),
				})
				.optional(),
		)
		.handler(async ({ input }) => {
			const limit = input?.limit ?? 20;
			const offset = input?.offset ?? 0;
			const search = input?.search;

			// Get the 90% stage
			const [stage90] = await db
				.select()
				.from(salesStages)
				.where(eq(salesStages.closurePercentage, 90))
				.limit(1);

			if (!stage90) {
				return { data: [], total: 0, limit, offset };
			}

			// Build conditions
			const conditions = [eq(opportunities.stageId, stage90.id)];

			// Search filter (name, license plate)
			if (search && search.trim() !== "") {
				const searchTerms = search.trim().split(/\s+/);
				for (const term of searchTerms) {
					const searchPattern = `%${term}%`;
					conditions.push(
						or(
							ilike(leads.firstName, searchPattern),
							ilike(leads.lastName, searchPattern),
							ilike(vehicles.licensePlate, searchPattern),
						)!,
					);
				}
			}

			// conditions always has at least one element (stageId condition)
			const whereClause = and(...conditions)!;

			// Get total count
			const [{ total }] = await db
				.select({ total: count() })
				.from(opportunities)
				.leftJoin(leads, eq(opportunities.leadId, leads.id))
				.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
				.where(whereClause);

			// Get paginated opportunities at 90%
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
				.leftJoin(leads, eq(opportunities.leadId, leads.id))
				.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
				.where(whereClause)
				.orderBy(desc(opportunities.updatedAt))
				.limit(limit)
				.offset(offset);

			if (opps.length === 0) {
				return { data: [], total, limit, offset };
			}

			// Batch fetch leads and vehicles to avoid N+1 queries
			const leadIds = opps
				.map((o) => o.leadId)
				.filter((id): id is string => id !== null);
			const vehicleIds = opps
				.map((o) => o.vehicleId)
				.filter((id): id is string => id !== null);
			const oppIds = opps.map((o) => o.id);

			// Fetch all leads in one query
			const leadsData =
				leadIds.length > 0
					? await db
							.select({
								id: leads.id,
								firstName: leads.firstName,
								lastName: leads.lastName,
								phone: leads.phone,
							})
							.from(leads)
							.where(inArray(leads.id, leadIds))
					: [];

			// Fetch all vehicles in one query
			const vehiclesData =
				vehicleIds.length > 0
					? await db
							.select({
								id: vehicles.id,
								make: vehicles.make,
								model: vehicles.model,
								year: vehicles.year,
								licensePlate: vehicles.licensePlate,
								color: vehicles.color,
								isNew: vehicles.isNew,
								isOwned: vehicles.isOwned,
							})
							.from(vehicles)
							.where(inArray(vehicles.id, vehicleIds))
					: [];

			// Fetch all checklists in one query
			const checklistsData = await db
				.select()
				.from(disbursementChecklists)
				.where(inArray(disbursementChecklists.opportunityId, oppIds));

			// Create maps for quick lookup
			const leadsMap = new Map(leadsData.map((l) => [l.id, l]));
			const vehiclesMap = new Map(vehiclesData.map((v) => [v.id, v]));
			const checklistsMap = new Map(
				checklistsData.map((c) => [c.opportunityId, c]),
			);

			// Map results
			const data = opps.map((opp) => {
				const lead = opp.leadId ? leadsMap.get(opp.leadId) : undefined;
				const vehicle = opp.vehicleId
					? vehiclesMap.get(opp.vehicleId)
					: undefined;
				const checklist = checklistsMap.get(opp.id);

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
					id: opp.id,
					value: opp.value,
					stageId: opp.stageId,
					disbursementApproved: opp.disbursementApproved,
					leadId: opp.leadId,
					vehicleId: opp.vehicleId,
					createdAt: opp.createdAt,
					updatedAt: opp.updatedAt,
					leadName: lead ? `${lead.firstName} ${lead.lastName}` : "N/A",
					leadPhone: lead?.phone,
					vehicle: vehicle || null,
					checklistProgress: progress,
					hasChecklist: !!checklist,
					stage: {
						id: stage90.id,
						name: stage90.name,
						closurePercentage: stage90.closurePercentage,
						color: stage90.color,
					},
				};
			});

			return { data, total, limit, offset };
		}),

	// Get opportunities at 50% for investment assignment
	getOpportunitiesForInvestment: analystProcedure
		.input(
			z
				.object({
					limit: z.number().min(1).max(100).default(20),
					offset: z.number().min(0).default(0),
					search: z.string().optional(),
				})
				.optional(),
		)
		.handler(async ({ input }) => {
			const limit = input?.limit ?? 20;
			const offset = input?.offset ?? 0;
			const search = input?.search;

			// Get the 50% stage
			const [stage50] = await db
				.select()
				.from(salesStages)
				.where(eq(salesStages.closurePercentage, 50))
				.limit(1);

			if (!stage50) {
				return { data: [], total: 0, limit, offset };
			}

			// Build conditions
			const conditions = [eq(opportunities.stageId, stage50.id)];

			// Search filter (name, license plate)
			if (search && search.trim() !== "") {
				const searchTerms = search.trim().split(/\s+/);
				for (const term of searchTerms) {
					const searchPattern = `%${term}%`;
					conditions.push(
						or(
							ilike(leads.firstName, searchPattern),
							ilike(leads.lastName, searchPattern),
							ilike(vehicles.licensePlate, searchPattern),
						)!,
					);
				}
			}

			// conditions always has at least one element (stageId condition)
			const whereClause = and(...conditions)!;

			// Get total count
			const [{ total }] = await db
				.select({ total: count() })
				.from(opportunities)
				.leftJoin(leads, eq(opportunities.leadId, leads.id))
				.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
				.where(whereClause);

			// Get paginated opportunities at 50%
			const opps = await db
				.select({
					id: opportunities.id,
					title: opportunities.title,
					value: opportunities.value,
					stageId: opportunities.stageId,
					inversionistas: opportunities.inversionistas,
					leadId: opportunities.leadId,
					vehicleId: opportunities.vehicleId,
					numeroCuotas: opportunities.numeroCuotas,
					tasaInteres: opportunities.tasaInteres,
					cuotaMensual: opportunities.cuotaMensual,
					categoria: opportunities.categoria,
					nit: opportunities.nit,
					diaPagoMensual: opportunities.diaPagoMensual,
					creditType: opportunities.creditType,
					createdAt: opportunities.createdAt,
					updatedAt: opportunities.updatedAt,
				})
				.from(opportunities)
				.leftJoin(leads, eq(opportunities.leadId, leads.id))
				.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
				.where(whereClause)
				.orderBy(desc(opportunities.updatedAt))
				.limit(limit)
				.offset(offset);

			if (opps.length === 0) {
				return { data: [], total, limit, offset };
			}

			// Batch fetch leads and vehicles to avoid N+1 queries
			const leadIds = opps
				.map((o) => o.leadId)
				.filter((id): id is string => id !== null);
			const vehicleIds = opps
				.map((o) => o.vehicleId)
				.filter((id): id is string => id !== null);

			// Fetch all leads in one query
			const leadsData =
				leadIds.length > 0
					? await db
							.select({
								id: leads.id,
								firstName: leads.firstName,
								lastName: leads.lastName,
								phone: leads.phone,
								dpi: leads.dpi,
								direccion: leads.direccion,
								maritalStatus: leads.maritalStatus,
								gender: leads.gender,
								birthDate: leads.birthDate,
								nationality: leads.nationality,
							})
							.from(leads)
							.where(inArray(leads.id, leadIds))
					: [];

			// Fetch all vehicles in one query
			const vehiclesData =
				vehicleIds.length > 0
					? await db
							.select({
								id: vehicles.id,
								make: vehicles.make,
								model: vehicles.model,
								year: vehicles.year,
								licensePlate: vehicles.licensePlate,
								color: vehicles.color,
								isNew: vehicles.isNew,
								isOwned: vehicles.isOwned,
								vinNumber: vehicles.vinNumber,
								motorNumber: vehicles.motorNumber,
								seats: vehicles.seats,
								vehicleUse: vehicles.vehicleUse,
							})
							.from(vehicles)
							.where(inArray(vehicles.id, vehicleIds))
					: [];

			// Create maps for quick lookup
			const leadsMap = new Map(leadsData.map((l) => [l.id, l]));
			const vehiclesMap = new Map(vehiclesData.map((v) => [v.id, v]));

			// Map results
			const data = opps.map((opp) => {
				const lead = opp.leadId ? leadsMap.get(opp.leadId) || null : null;
				const vehicle = opp.vehicleId
					? vehiclesMap.get(opp.vehicleId) || null
					: null;

				// Parse existing investors
				let existingInvestors: Array<{
					inversionista_id: number;
					nombre: string;
					porcentaje_participacion: number;
					monto_aportado: number;
					porcentaje_cash_in?: number;
				}> = [];
				if (opp.inversionistas) {
					try {
						const parsed = JSON.parse(opp.inversionistas);
						if (Array.isArray(parsed)) {
							existingInvestors = parsed;
						}
					} catch {
						existingInvestors = [];
					}
				}

				return {
					id: opp.id,
					title: opp.title,
					value: opp.value,
					hasInvestor: existingInvestors.length > 0,
					existingInvestors,
					hasCreditData: !!(
						opp.numeroCuotas &&
						opp.tasaInteres &&
						opp.cuotaMensual
					),
					// Campos adicionales para edición
					categoria: opp.categoria,
					nit: opp.nit,
					diaPagoMensual: opp.diaPagoMensual,
					createdAt: opp.createdAt,
					updatedAt: opp.updatedAt,
					creditType: opp.creditType,
					lead: lead
						? {
								id: lead.id,
								name: `${lead.firstName} ${lead.lastName}`,
								phone: lead.phone,
								direccion: lead.direccion,
								hasRequiredData: !!(
									lead.dpi &&
									lead.direccion &&
									lead.maritalStatus &&
									lead.gender &&
									lead.birthDate &&
									lead.nationality
								),
								missingFields: getMissingLeadFieldsForContracts({
									dpi: lead.dpi,
									direccion: lead.direccion,
									maritalStatus: lead.maritalStatus,
									gender: lead.gender,
									birthDate: lead.birthDate,
									nationality: lead.nationality,
								}),
							}
						: null,
					vehicle: vehicle
						? {
								id: vehicle.id,
								description: `${vehicle.make} ${vehicle.model} ${vehicle.year}`,
								licensePlate: vehicle.licensePlate,
								isNew: vehicle.isNew,
								isOwned: vehicle.isOwned,
								hasRequiredData: !!(
									vehicle.vinNumber &&
									vehicle.seats &&
									vehicle.vehicleUse
								),
								missingFields: getMissingFieldsForContracts({
									vinNumber: vehicle.vinNumber,
									seats: vehicle.seats,
									vehicleUse: vehicle.vehicleUse,
								}),
							}
						: null,
					stage: {
						id: stage50.id,
						name: stage50.name,
						closurePercentage: stage50.closurePercentage,
						color: stage50.color,
					},
				};
			});

			return { data, total, limit, offset };
		}),

	// Assign investor and advance to 80%
	assignInvestorAndAdvance: analystProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				inversionistas: z.string().optional(), // JSON string with NEW investors array (optional if already has investors)
				categoria: z.enum([
					"Contraseña",
					"CV Vehículo",
					"CV Vehículo nuevo",
					"Fiduciario",
					"Hipotecario",
					"Vehículo",
				]),
				nit: z.string(),
				diaPagoMensual: z.union([z.literal(15), z.literal(30)]),
			}),
		)
		.handler(async ({ input, context }) => {
			// Get the opportunity
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

			// Validate opportunity is at 50%
			const [currentStage] = await db
				.select()
				.from(salesStages)
				.where(eq(salesStages.id, opportunity.stageId))
				.limit(1);

			if (!currentStage || currentStage.closurePercentage !== 50) {
				throw new ORPCError("BAD_REQUEST", {
					message: "La oportunidad debe estar en la etapa del 50%",
				});
			}

			// Parse existing investors from DB
			let existingInvestors: Array<{
				inversionista_id: number;
				nombre: string;
				monto_aportado?: number;
				porcentaje_participacion?: number;
			}> = [];
			if (opportunity.inversionistas) {
				try {
					const parsed = JSON.parse(opportunity.inversionistas);
					if (Array.isArray(parsed)) {
						existingInvestors = parsed;
					}
				} catch {
					// Invalid JSON, treat as no existing investors
				}
			}

			// Parse and validate new investors (if provided)
			let newInversionistas: Array<{
				inversionista_id: number;
				nombre: string;
				monto_aportado?: number;
				porcentaje_participacion?: number;
			}> = [];

			if (input.inversionistas) {
				try {
					newInversionistas = JSON.parse(input.inversionistas);
					if (!Array.isArray(newInversionistas)) {
						throw new ORPCError("BAD_REQUEST", {
							message: "Lista de inversionistas inválida",
						});
					}
					if (newInversionistas.length > 20) {
						throw new ORPCError("BAD_REQUEST", {
							message: "Demasiados inversionistas",
						});
					}
				} catch (e) {
					const message =
						e instanceof Error && e.message === "Demasiados inversionistas"
							? "No se pueden asignar más de 20 inversionistas por oportunidad"
							: "Formato de inversionistas inválido";
					throw new ORPCError("BAD_REQUEST", { message });
				}
			}

			// Combine existing + new investors
			const allInvestors = [...existingInvestors, ...newInversionistas];

			// Validate we have at least one investor (existing or new)
			if (allInvestors.length === 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Debe haber al menos un inversionista asignado",
				});
			}

			if (allInvestors.length > 20) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"No se pueden tener más de 20 inversionistas por oportunidad",
				});
			}

			// Validate total participation equals 100%
			const totalParticipacion = allInvestors.reduce(
				(sum, inv) => sum + (inv.porcentaje_participacion || 0),
				0,
			);
			if (Math.abs(totalParticipacion - 100) > 0.01) {
				throw new ORPCError("BAD_REQUEST", {
					message: `La suma de porcentajes de participación debe ser exactamente 100% (actual: ${totalParticipacion}%)`,
				});
			}

			// Validate minimum data for contracts
			const validationErrors: string[] = [];

			// Validate lead data
			if (opportunity.leadId) {
				const [lead] = await db
					.select({
						dpi: leads.dpi,
						direccion: leads.direccion,
						maritalStatus: leads.maritalStatus,
						gender: leads.gender,
						birthDate: leads.birthDate,
						nationality: leads.nationality,
					})
					.from(leads)
					.where(eq(leads.id, opportunity.leadId))
					.limit(1);

				if (lead) {
					const missingLeadFields = getMissingLeadFieldsForContracts(lead);
					if (missingLeadFields.length > 0) {
						validationErrors.push(
							`Cliente: Faltan ${formatMissingLeadFields(missingLeadFields)}`,
						);
					}
				}
			} else {
				validationErrors.push("No hay cliente asociado a la oportunidad");
			}

			// Validate vehicle data
			if (opportunity.vehicleId) {
				const [vehicle] = await db
					.select({
						vinNumber: vehicles.vinNumber,
						seats: vehicles.seats,
						vehicleUse: vehicles.vehicleUse,
					})
					.from(vehicles)
					.where(eq(vehicles.id, opportunity.vehicleId))
					.limit(1);

				if (vehicle) {
					const missingVehicleFields = getMissingFieldsForContracts(vehicle);
					if (missingVehicleFields.length > 0) {
						validationErrors.push(
							`Vehículo: Faltan ${formatMissingFields(missingVehicleFields)}`,
						);
					}
				}
			} else {
				validationErrors.push("No hay vehículo asociado a la oportunidad");
			}

			// Validate credit data
			const creditMissing: string[] = [];
			if (!opportunity.value) creditMissing.push("Monto del crédito");
			if (!opportunity.cuotaMensual) creditMissing.push("Cuota mensual");
			if (!opportunity.numeroCuotas) creditMissing.push("Número de cuotas");
			if (!opportunity.tasaInteres) creditMissing.push("Tasa de interés");
			if (!opportunity.categoria && !input.categoria)
				creditMissing.push("Categoría de crédito");
			if (!opportunity.nit && !input.nit) creditMissing.push("NIT");
			if (!opportunity.diaPagoMensual && !input.diaPagoMensual)
				creditMissing.push("Día de pago mensual");

			if (creditMissing.length > 0) {
				validationErrors.push(`Crédito: Faltan ${creditMissing.join(", ")}`);
			}

			if (validationErrors.length > 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: `No se puede avanzar a 80%. ${validationErrors.join(". ")}`,
				});
			}

			// Get the 80% stage
			const [stage80] = await db
				.select()
				.from(salesStages)
				.where(eq(salesStages.closurePercentage, 80))
				.limit(1);

			if (!stage80) {
				throw new ORPCError("NOT_FOUND", {
					message: "No se encontró la etapa del 80%",
				});
			}

			// Update opportunity and record history in a transaction for atomicity
			await db.transaction(async (tx) => {
				// Update opportunity with combined investors and move to 80%
				await tx
					.update(opportunities)
					.set({
						inversionistas: JSON.stringify(allInvestors),
						stageId: stage80.id,
						categoria: input.categoria,
						nit: input.nit,
						diaPagoMensual: input.diaPagoMensual,
						updatedAt: new Date(),
					})
					.where(eq(opportunities.id, input.opportunityId));

				// Record stage history
				await tx.insert(opportunityStageHistory).values({
					opportunityId: input.opportunityId,
					fromStageId: opportunity.stageId,
					toStageId: stage80.id,
					changedBy: context.userId,
					reason: "Inversión asignada - Avance a etapa jurídica",
				});
			});

			// Notificar a jurídico que hay una nueva oportunidad para contratos
			await createNotification({
				titulo: `Nueva oportunidad para contratos - ${opportunity.title}`,
				descripcion: `La oportunidad "${opportunity.title}" avanzó a la etapa del 80% y está lista para la creación o carga de contratos legales.`,
				type: "aviso",
				createdBy: context.userId,
				createdByRole: context.userRole,
				assignedToRole: "juridico",
				relatedEntityType: "opportunity",
				relatedEntityId: input.opportunityId,
				redirectPage: "contract_details",
			});

			return {
				success: true,
				message: "Inversionista asignado y oportunidad avanzada a 80%",
			};
		}),

	updateOpportunityInvestors: analystProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				inversionistas: z.string(), // JSON string with full investors array
			}),
		)
		.handler(async ({ input }) => {
			// Get the opportunity
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

			// Validate opportunity is at 50%
			const [currentStage] = await db
				.select()
				.from(salesStages)
				.where(eq(salesStages.id, opportunity.stageId))
				.limit(1);

			if (!currentStage || currentStage.closurePercentage !== 50) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Solo se pueden editar inversionistas en la etapa del 50%",
				});
			}

			// Parse and validate investors
			let parsedInvestors: Array<{
				inversionista_id: number;
				nombre: string;
				monto_aportado: number;
				porcentaje_participacion: number;
				porcentaje_cash_in?: number;
			}>;

			try {
				parsedInvestors = JSON.parse(input.inversionistas);
				if (!Array.isArray(parsedInvestors)) {
					throw new Error("Not an array");
				}
			} catch {
				throw new ORPCError("BAD_REQUEST", {
					message: "Formato de inversionistas inválido",
				});
			}

			if (parsedInvestors.length === 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Debe haber al menos un inversionista",
				});
			}

			if (parsedInvestors.length > 20) {
				throw new ORPCError("BAD_REQUEST", {
					message: "No se pueden asignar más de 20 inversionistas",
				});
			}

			// Validate each investor has required fields
			for (const inv of parsedInvestors) {
				if (!inv.inversionista_id || !inv.nombre || inv.monto_aportado <= 0) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"Cada inversionista debe tener ID, nombre y monto mayor a 0",
					});
				}
				if (
					inv.porcentaje_participacion < 0 ||
					inv.porcentaje_participacion > 100
				) {
					throw new ORPCError("BAD_REQUEST", {
						message: "El porcentaje de participación debe estar entre 0 y 100",
					});
				}
				if (
					inv.porcentaje_cash_in !== undefined &&
					(inv.porcentaje_cash_in < 0 || inv.porcentaje_cash_in > 100)
				) {
					throw new ORPCError("BAD_REQUEST", {
						message: "El porcentaje de cash-in debe estar entre 0 y 100",
					});
				}
			}

			// Validate total participation equals 100%
			const totalParticipacion = parsedInvestors.reduce(
				(sum, inv) => sum + (inv.porcentaje_participacion || 0),
				0,
			);
			if (Math.abs(totalParticipacion - 100) > 0.01) {
				throw new ORPCError("BAD_REQUEST", {
					message: `La suma de porcentajes de participación debe ser exactamente 100% (actual: ${totalParticipacion}%)`,
				});
			}

			// Update
			await db
				.update(opportunities)
				.set({
					inversionistas: JSON.stringify(parsedInvestors),
					updatedAt: new Date(),
				})
				.where(eq(opportunities.id, input.opportunityId));

			return {
				success: true,
				message: "Inversionistas actualizados correctamente",
			};
		}),

	// ── Credit Scoring ──────────────────────────────────────────────────
	scoreLead: crmProcedure
		.input(
			z.object({
				leadId: z.string().uuid(),
				opportunityId: z.string().uuid().optional(),
			}),
		)
		.handler(async ({ input }) => {
			return await scoreLead(input.leadId, input.opportunityId);
		}),

	// ── Co-Debtors (Co-deudores) ─────────────────────────────────────────
	getCoDebtorsByOpportunity: crmProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			const coDebtorsList = await db
				.select()
				.from(coDebtors)
				.where(eq(coDebtors.opportunityId, input.opportunityId))
				.orderBy(coDebtors.createdAt);

			return coDebtorsList;
		}),

	createCoDebtor: crmProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				fullName: z.string().min(1, "El nombre completo es requerido"),
				dpi: z.string().min(1, "El DPI es requerido"),
				age: z.number().int().positive().optional(),
				gender: z.enum(["male", "female"]).optional(),
				maritalStatus: z
					.enum(["single", "married", "divorced", "widowed"])
					.optional(),
				profession: z.string().optional(),
				nationality: z.string().optional(),
				email: z.string().email("Email inválido").optional(),
				phone: z.string().optional(),
				occupation: z.enum(["owner", "employee"]).optional(),
				notes: z.string().optional(),
			}),
		)
		.handler(async ({ input }) => {
			// Validar DPI del co-deudor
			const resultadoDpi = validarDpi(input.dpi);
			if (!resultadoDpi.valid) {
				throw new ORPCError("BAD_REQUEST", {
					message: resultadoDpi.error,
				});
			}

			// Verificar que la oportunidad existe
			const [opportunity] = await db
				.select({ id: opportunities.id })
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			const [newCoDebtor] = await db
				.insert(coDebtors)
				.values({
					opportunityId: input.opportunityId,
					fullName: input.fullName,
					dpi: resultadoDpi.dpiLimpio,
					age: input.age,
					gender: input.gender,
					maritalStatus: input.maritalStatus,
					profession: input.profession,
					nationality: input.nationality,
					email: input.email,
					phone: input.phone,
					occupation: input.occupation,
					notes: input.notes,
				})
				.returning();

			return newCoDebtor;
		}),

	updateCoDebtor: crmProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				fullName: z
					.string()
					.min(1, "El nombre completo es requerido")
					.optional(),
				dpi: z.string().min(1, "El DPI es requerido").optional(),
				age: z.number().int().positive().nullable().optional(),
				gender: z.enum(["male", "female"]).nullable().optional(),
				maritalStatus: z
					.enum(["single", "married", "divorced", "widowed"])
					.nullable()
					.optional(),
				profession: z.string().nullable().optional(),
				nationality: z.string().nullable().optional(),
				email: z.string().email("Email inválido").nullable().optional(),
				phone: z.string().nullable().optional(),
				occupation: z.enum(["owner", "employee"]).nullable().optional(),
				notes: z.string().nullable().optional(),
				score: z.string().nullable().optional(),
				fit: z.boolean().nullable().optional(),
				scoredAt: z.date().nullable().optional(),
			}),
		)
		.handler(async ({ input }) => {
			const { id, ...updateData } = input;

			// Validar DPI si se envía
			if (updateData.dpi) {
				const resultadoDpi = validarDpi(updateData.dpi);
				if (!resultadoDpi.valid) {
					throw new ORPCError("BAD_REQUEST", {
						message: resultadoDpi.error,
					});
				}
				updateData.dpi = resultadoDpi.dpiLimpio;
			}

			const [updatedCoDebtor] = await db
				.update(coDebtors)
				.set({
					...updateData,
					updatedAt: new Date(),
				})
				.where(eq(coDebtors.id, id))
				.returning();

			if (!updatedCoDebtor) {
				throw new ORPCError("NOT_FOUND", {
					message: "Co-deudor no encontrado",
				});
			}

			return updatedCoDebtor;
		}),

	deleteCoDebtor: crmProcedure
		.input(
			z.object({
				id: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			// Eliminar el credit analysis asociado al co-deudor si existe
			await db
				.delete(creditAnalysis)
				.where(eq(creditAnalysis.coDebtorId, input.id));

			const [deletedCoDebtor] = await db
				.delete(coDebtors)
				.where(eq(coDebtors.id, input.id))
				.returning();

			if (!deletedCoDebtor) {
				throw new ORPCError("NOT_FOUND", {
					message: "Co-deudor no encontrado",
				});
			}

			return { success: true, message: "Co-deudor eliminado correctamente" };
		}),

	// ── Análisis de Capacidad de Pago Consolidado ────────────────────────
	getConsolidatedCreditAnalysis: crmProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			// 1. Obtener la oportunidad con el leadId
			const [opportunity] = await db
				.select({
					id: opportunities.id,
					leadId: opportunities.leadId,
				})
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			// 2. Obtener análisis del lead (si existe)
			let leadAnalysis = null;
			if (opportunity.leadId) {
				const [analysis] = await db
					.select()
					.from(creditAnalysis)
					.where(eq(creditAnalysis.leadId, opportunity.leadId))
					.limit(1);
				leadAnalysis = analysis || null;
			}

			// 3. Obtener co-deudores de la oportunidad
			const coDebtorsList = await db
				.select()
				.from(coDebtors)
				.where(eq(coDebtors.opportunityId, input.opportunityId));

			// 4. Obtener análisis de cada co-deudor
			const coDebtorsWithAnalysis = await Promise.all(
				coDebtorsList.map(async (coDebtor) => {
					const [analysis] = await db
						.select()
						.from(creditAnalysis)
						.where(eq(creditAnalysis.coDebtorId, coDebtor.id))
						.limit(1);
					return {
						coDebtor,
						analysis: analysis || null,
					};
				}),
			);

			// 5. Calcular totales consolidados
			const parseDecimal = (value: string | null | undefined): number => {
				if (!value) return 0;
				const num = Number.parseFloat(value);
				return Number.isNaN(num) ? 0 : num;
			};

			// Datos del lead
			const leadData = {
				monthlyFixedIncome: parseDecimal(leadAnalysis?.monthlyFixedIncome),
				monthlyVariableIncome: parseDecimal(
					leadAnalysis?.monthlyVariableIncome,
				),
				monthlyFixedExpenses: parseDecimal(leadAnalysis?.monthlyFixedExpenses),
				monthlyVariableExpenses: parseDecimal(
					leadAnalysis?.monthlyVariableExpenses,
				),
				economicAvailability: parseDecimal(leadAnalysis?.economicAvailability),
				maxPayment: parseDecimal(leadAnalysis?.maxPayment),
				maxCreditAmount: parseDecimal(leadAnalysis?.maxCreditAmount),
				hasAnalysis: leadAnalysis?.analyzedAt != null,
			};

			// Suma de co-deudores
			const coDebtorsTotals = coDebtorsWithAnalysis.reduce(
				(acc, { analysis }) => {
					if (analysis?.analyzedAt) {
						acc.monthlyFixedIncome += parseDecimal(analysis.monthlyFixedIncome);
						acc.monthlyVariableIncome += parseDecimal(
							analysis.monthlyVariableIncome,
						);
						acc.monthlyFixedExpenses += parseDecimal(
							analysis.monthlyFixedExpenses,
						);
						acc.monthlyVariableExpenses += parseDecimal(
							analysis.monthlyVariableExpenses,
						);
						acc.economicAvailability += parseDecimal(
							analysis.economicAvailability,
						);
						acc.maxPayment += parseDecimal(analysis.maxPayment);
						acc.maxCreditAmount += parseDecimal(analysis.maxCreditAmount);
						acc.count += 1;
					}
					return acc;
				},
				{
					monthlyFixedIncome: 0,
					monthlyVariableIncome: 0,
					monthlyFixedExpenses: 0,
					monthlyVariableExpenses: 0,
					economicAvailability: 0,
					maxPayment: 0,
					maxCreditAmount: 0,
					count: 0,
				},
			);

			// Totales consolidados (lead + co-deudores)
			const consolidated = {
				monthlyFixedIncome:
					leadData.monthlyFixedIncome + coDebtorsTotals.monthlyFixedIncome,
				monthlyVariableIncome:
					leadData.monthlyVariableIncome +
					coDebtorsTotals.monthlyVariableIncome,
				monthlyFixedExpenses:
					leadData.monthlyFixedExpenses + coDebtorsTotals.monthlyFixedExpenses,
				monthlyVariableExpenses:
					leadData.monthlyVariableExpenses +
					coDebtorsTotals.monthlyVariableExpenses,
				economicAvailability:
					leadData.economicAvailability + coDebtorsTotals.economicAvailability,
				maxPayment: leadData.maxPayment + coDebtorsTotals.maxPayment,
				maxCreditAmount:
					leadData.maxCreditAmount + coDebtorsTotals.maxCreditAmount,
				totalIncome:
					leadData.monthlyFixedIncome +
					leadData.monthlyVariableIncome +
					coDebtorsTotals.monthlyFixedIncome +
					coDebtorsTotals.monthlyVariableIncome,
				totalExpenses:
					leadData.monthlyFixedExpenses +
					leadData.monthlyVariableExpenses +
					coDebtorsTotals.monthlyFixedExpenses +
					coDebtorsTotals.monthlyVariableExpenses,
			};

			return {
				lead: {
					...leadData,
				},
				coDebtors: coDebtorsWithAnalysis.map(({ coDebtor, analysis }) => ({
					id: coDebtor.id,
					fullName: coDebtor.fullName,
					hasAnalysis: analysis?.analyzedAt != null,
					monthlyFixedIncome: parseDecimal(analysis?.monthlyFixedIncome),
					monthlyVariableIncome: parseDecimal(analysis?.monthlyVariableIncome),
					monthlyFixedExpenses: parseDecimal(analysis?.monthlyFixedExpenses),
					monthlyVariableExpenses: parseDecimal(
						analysis?.monthlyVariableExpenses,
					),
					economicAvailability: parseDecimal(analysis?.economicAvailability),
					maxPayment: parseDecimal(analysis?.maxPayment),
					maxCreditAmount: parseDecimal(analysis?.maxCreditAmount),
				})),
				coDebtorsCount: coDebtorsList.length,
				coDebtorsWithAnalysisCount: coDebtorsTotals.count,
				consolidated,
				hasAnyAnalysis: leadData.hasAnalysis || coDebtorsTotals.count > 0,
			};
		}),

	// Dashboard chart data — optimized aggregations for graphs
	getDashboardChartData: crmProcedure
		.input(
			z.object({
				month: z.number().min(1).max(12),
				year: z.number(),
			}),
		)
		.handler(async ({ input, context }) => {
			const PLACED_STAGE_THRESHOLD = 90;
			const { startOfMonth, endOfMonth } = getGuatemalaMonthWindow(
				input.year,
				input.month,
			);

			// Only admin and sales_supervisor see global charts
			const isGlobal =
				context.userRole === "admin" || context.userRole === "sales_supervisor";
			const userFilter = isGlobal ? undefined : context.userId;

			// 1) Pipeline por Etapa: count + sum(value) grouped by stage
			const pipelineRows = await db
				.select({
					stageId: salesStages.id,
					stageName: salesStages.name,
					stageColor: salesStages.color,
					stageOrder: salesStages.order,
					cantidad: count(),
					valor: sql<string>`coalesce(sum(${opportunities.value}), 0)`,
				})
				.from(opportunities)
				.innerJoin(salesStages, eq(opportunities.stageId, salesStages.id))
				.where(
					and(
						eq(opportunities.status, "open"),
						gte(opportunities.createdAt, startOfMonth),
						lt(opportunities.createdAt, endOfMonth),
						userFilter ? eq(opportunities.assignedTo, userFilter) : undefined,
					),
				)
				.groupBy(
					salesStages.id,
					salesStages.name,
					salesStages.color,
					salesStages.order,
				)
				.orderBy(salesStages.order);

			const pipeline = pipelineRows.map((r) => ({
				name: r.stageName,
				cantidad: r.cantidad,
				valor: Number.parseFloat(r.valor) || 0,
				color: r.stageColor,
			}));

			// 2) Ranking vendedores por monto colocado (stage >= threshold)
			// Uses opportunityStageHistory.changedAt to determine when placement happened
			const placedStages = await db
				.select({ id: salesStages.id })
				.from(salesStages)
				.where(gte(salesStages.closurePercentage, PLACED_STAGE_THRESHOLD));
			const placedStageIds = placedStages.map((s) => s.id);

			let ranking: { name: string; monto: number }[] = [];
			let byTipoCredito: { name: string; monto: number }[] = [];
			let byMarca: { name: string; monto: number; cantidad: number }[] = [];
			let byMedio: { name: string; monto: number }[] = [];
			if (placedStageIds.length > 0) {
				// Find opportunities that moved to a placed stage within this month
				const placedThisMonth = await db
					.select({ opportunityId: opportunityStageHistory.opportunityId })
					.from(opportunityStageHistory)
					.where(
						and(
							inArray(opportunityStageHistory.toStageId, placedStageIds),
							gte(opportunityStageHistory.changedAt, startOfMonth),
							lt(opportunityStageHistory.changedAt, endOfMonth),
						),
					);

				const candidateIds = [
					...new Set(placedThisMonth.map((o) => o.opportunityId)),
				];

				// Exclude opportunities that already reached placed before this month
				const alreadyPlacedBefore =
					candidateIds.length > 0
						? await db
								.select({
									opportunityId: opportunityStageHistory.opportunityId,
								})
								.from(opportunityStageHistory)
								.where(
									and(
										inArray(
											opportunityStageHistory.opportunityId,
											candidateIds,
										),
										inArray(opportunityStageHistory.toStageId, placedStageIds),
										lt(opportunityStageHistory.changedAt, startOfMonth),
									),
								)
						: [];

				const alreadyPlacedIds = new Set(
					alreadyPlacedBefore.map((o) => o.opportunityId),
				);
				const placedOppIds = candidateIds.filter(
					(id) => !alreadyPlacedIds.has(id),
				);

				if (placedOppIds.length > 0) {
					const rankingConditions = [
						inArray(opportunities.id, placedOppIds),
						inArray(opportunities.stageId, placedStageIds),
						not(eq(opportunities.status, "migrate")),
					];
					if (userFilter) {
						rankingConditions.push(eq(opportunities.assignedTo, userFilter));
					}

					const rankingRows = await db
						.select({
							userName: user.name,
							monto: sql<string>`coalesce(sum(${opportunities.value}), 0)`,
						})
						.from(opportunities)
						.innerJoin(user, eq(opportunities.assignedTo, user.id))
						.where(and(...rankingConditions))
						.groupBy(user.id, user.name)
						.orderBy(desc(sql`sum(${opportunities.value})`));

					ranking = rankingRows.map((r) => ({
						name: r.userName || "Sin asignar",
						monto: Number.parseFloat(r.monto) || 0,
					}));

					// 4) Monto colocado por tipo de crédito
					const tipoCreditoConditions = [
						inArray(opportunities.id, placedOppIds),
						inArray(opportunities.stageId, placedStageIds),
						not(eq(opportunities.status, "migrate")),
					];
					if (userFilter) {
						tipoCreditoConditions.push(
							eq(opportunities.assignedTo, userFilter),
						);
					}
					const tipoCreditoRows = await db
						.select({
							creditType: opportunities.creditType,
							monto: sql<string>`coalesce(sum(${opportunities.value}), 0)`,
						})
						.from(opportunities)
						.where(and(...tipoCreditoConditions))
						.groupBy(opportunities.creditType);

					const CREDIT_TYPE_LABELS: Record<string, string> = {
						autocompra: "Autocompra",
						sobre_vehiculo: "Sobre Vehículo",
					};
					byTipoCredito = tipoCreditoRows.map((r) => ({
						name: CREDIT_TYPE_LABELS[r.creditType] || r.creditType,
						monto: Number.parseFloat(r.monto) || 0,
					}));

					// 5) Monto colocado y cantidad por marca de vehículo
					const marcaConditions = [
						inArray(opportunities.id, placedOppIds),
						inArray(opportunities.stageId, placedStageIds),
						not(eq(opportunities.status, "migrate")),
						isNotNull(opportunities.vehicleId),
					];
					if (userFilter) {
						marcaConditions.push(eq(opportunities.assignedTo, userFilter));
					}
					const marcaNorm = sql<string>`upper(trim(${vehicles.make}))`;
					const marcaRows = await db
						.select({
							make: marcaNorm,
							monto: sql<string>`coalesce(sum(${opportunities.value}), 0)`,
							cantidad: count(),
						})
						.from(opportunities)
						.innerJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
						.where(and(...marcaConditions))
						.groupBy(marcaNorm)
						.orderBy(desc(sql`sum(${opportunities.value})`));

					byMarca = marcaRows.map((r) => ({
						name: r.make || "Sin marca",
						monto: Number.parseFloat(r.monto) || 0,
						cantidad: r.cantidad,
					}));

					// 6) Monto colocado por medio/fuente
					const medioConditions = [
						inArray(opportunities.id, placedOppIds),
						inArray(opportunities.stageId, placedStageIds),
						not(eq(opportunities.status, "migrate")),
					];
					if (userFilter) {
						medioConditions.push(eq(opportunities.assignedTo, userFilter));
					}
					const medioRows = await db
						.select({
							source: opportunities.source,
							monto: sql<string>`coalesce(sum(${opportunities.value}), 0)`,
						})
						.from(opportunities)
						.where(and(...medioConditions))
						.groupBy(opportunities.source)
						.orderBy(desc(sql`sum(${opportunities.value})`));

					byMedio = medioRows.map((r) => ({
						name: getLeadSourceLabel(r.source),
						monto: Number.parseFloat(r.monto) || 0,
					}));
				}
			}

			// 3) Actividad por vendedor: open vs cerradas (won + lost)
			const activityRows = await db
				.select({
					userName: user.name,
					status: opportunities.status,
					cantidad: count(),
				})
				.from(opportunities)
				.innerJoin(user, eq(opportunities.assignedTo, user.id))
				.where(
					and(
						inArray(opportunities.status, ["open", "won", "lost"]),
						gte(opportunities.createdAt, startOfMonth),
						lt(opportunities.createdAt, endOfMonth),
						userFilter ? eq(opportunities.assignedTo, userFilter) : undefined,
					),
				)
				.groupBy(user.id, user.name, opportunities.status);

			const activityMap = new Map<
				string,
				{ name: string; abiertas: number; cerradas: number }
			>();
			for (const row of activityRows) {
				const name = row.userName || "Sin asignar";
				const curr = activityMap.get(name) || {
					name,
					abiertas: 0,
					cerradas: 0,
				};
				if (row.status === "open") curr.abiertas += row.cantidad;
				else curr.cerradas += row.cantidad;
				activityMap.set(name, curr);
			}
			const activity = [...activityMap.values()].sort(
				(a, b) => b.abiertas + b.cerradas - (a.abiertas + a.cerradas),
			);

			return { pipeline, ranking, activity, byTipoCredito, byMarca, byMedio };
		}),
};
