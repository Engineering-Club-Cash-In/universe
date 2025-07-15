import { and, asc, count, desc, eq, gte, ilike, lte, sum } from "drizzle-orm";
import db from "../db";
import { clients, companies, leads, opportunities } from "../db/schema/crm";

// Leads controllers

export const getAllLeads = async () => {
	const foundLeads = await db.select().from(leads);
	return foundLeads;
};

export const getLeadById = async (id: string) => {
	const foundLead = await db.select().from(leads).where(eq(leads.id, id));
	return foundLead;
};

export const getTopLeads = async (
	limit = 10,
	orderBy: keyof typeof leads.$inferSelect = "createdAt",
	order: "asc" | "desc" = "desc",
) => {
	const orderFunction = order === "asc" ? asc : desc;
	const topLeads = await db
		.select()
		.from(leads)
		.orderBy(orderFunction(leads[orderBy]))
		.limit(limit);
	return topLeads;
};

export const searchLeads = async (filters: {
	firstName?: string;
	lastName?: string;
	email?: string;
	companyId?: string;
	source?:
		| "website"
		| "referral"
		| "cold_call"
		| "email"
		| "social_media"
		| "event"
		| "other";
	status?: "new" | "contacted" | "qualified" | "unqualified" | "converted";
	assignedTo?: string;
	createdBy?: string;
	createdAfter?: string;
	createdBefore?: string;
}) => {
	const conditions = [];
	if (filters.firstName)
		conditions.push(ilike(leads.firstName, `%${filters.firstName}%`));
	if (filters.lastName)
		conditions.push(ilike(leads.lastName, `%${filters.lastName}%`));
	if (filters.email) conditions.push(ilike(leads.email, `%${filters.email}%`));
	if (filters.companyId)
		conditions.push(eq(leads.companyId, filters.companyId));
	if (filters.source) conditions.push(eq(leads.source, filters.source));
	if (filters.status) conditions.push(eq(leads.status, filters.status));
	if (filters.assignedTo)
		conditions.push(eq(leads.assignedTo, filters.assignedTo));
	if (filters.createdBy)
		conditions.push(eq(leads.createdBy, filters.createdBy));
	if (filters.createdAfter)
		conditions.push(gte(leads.createdAt, new Date(filters.createdAfter)));
	if (filters.createdBefore)
		conditions.push(lte(leads.createdAt, new Date(filters.createdBefore)));

	if (conditions.length === 0) {
		return [];
	}

	const foundLeads = await db
		.select()
		.from(leads)
		.where(and(...conditions));
	return foundLeads;
};

// Opportunities controllers

export const getAllOpportunities = async () => {
	const foundOpportunities = await db.select().from(opportunities);
	return foundOpportunities;
};

export const getOpportunityById = async (id: string) => {
	const foundOpportunity = await db
		.select()
		.from(opportunities)
		.where(eq(opportunities.id, id));
	return foundOpportunity;
};

export const getTopOpportunities = async (
	limit = 10,
	orderBy: keyof typeof opportunities.$inferSelect = "value",
	order: "asc" | "desc" = "desc",
) => {
	const orderFunction = order === "asc" ? asc : desc;
	const topOpportunities = await db
		.select()
		.from(opportunities)
		.orderBy(orderFunction(opportunities[orderBy]))
		.limit(limit);
	return topOpportunities;
};

export const searchOpportunities = async (filters: {
	title?: string;
	companyId?: string;
	minValue?: number;
	maxValue?: number;
	status?: "open" | "won" | "lost" | "on_hold";
	assignedTo?: string;
	expectedCloseAfter?: string;
	expectedCloseBefore?: string;
}) => {
	const conditions = [];
	if (filters.title)
		conditions.push(ilike(opportunities.title, `%${filters.title}%`));
	if (filters.companyId)
		conditions.push(eq(opportunities.companyId, filters.companyId));
	if (filters.minValue)
		conditions.push(gte(opportunities.value, String(filters.minValue)));
	if (filters.maxValue)
		conditions.push(lte(opportunities.value, String(filters.maxValue)));
	if (filters.status) conditions.push(eq(opportunities.status, filters.status));
	if (filters.assignedTo)
		conditions.push(eq(opportunities.assignedTo, filters.assignedTo));
	if (filters.expectedCloseAfter)
		conditions.push(
			gte(
				opportunities.expectedCloseDate,
				new Date(filters.expectedCloseAfter),
			),
		);
	if (filters.expectedCloseBefore)
		conditions.push(
			lte(
				opportunities.expectedCloseDate,
				new Date(filters.expectedCloseBefore),
			),
		);

	if (conditions.length === 0) {
		return [];
	}

	const foundOpportunities = await db
		.select()
		.from(opportunities)
		.where(and(...conditions));
	return foundOpportunities;
};

// Companies controllers

export const getAllCompanies = async () => {
	const foundCompanies = await db.select().from(companies);
	return foundCompanies;
};

export const getCompanyById = async (id: string) => {
	const foundCompany = await db
		.select()
		.from(companies)
		.where(eq(companies.id, id));
	return foundCompany;
};

export const getTopCompaniesByOpportunitiesValue = async (limit = 3) => {
	const result = await db
		.select({
			companyId: companies.id,
			companyName: companies.name,
			totalValue: sum(opportunities.value),
		})
		.from(companies)
		.leftJoin(opportunities, eq(companies.id, opportunities.companyId))
		.where(eq(opportunities.status, "won"))
		.groupBy(companies.id, companies.name)
		.orderBy(desc(sum(opportunities.value)))
		.limit(limit);
	return result;
};

export const getTopCompaniesByClientCount = async (limit = 3) => {
	const result = await db
		.select({
			companyId: companies.id,
			companyName: companies.name,
			clientCount: count(clients.id),
		})
		.from(companies)
		.leftJoin(clients, eq(companies.id, clients.companyId))
		.groupBy(companies.id, companies.name)
		.orderBy(desc(count(clients.id)))
		.limit(limit);

	return result;
};

export const searchCompanies = async (filters: {
	name?: string;
	industry?: string;
	size?: string;
	createdAfter?: string;
	createdBefore?: string;
}) => {
	const conditions = [];
	if (filters.name) conditions.push(ilike(companies.name, `%${filters.name}%`));
	if (filters.industry)
		conditions.push(ilike(companies.industry, `%${filters.industry}%`));
	if (filters.size) conditions.push(eq(companies.size, filters.size));
	if (filters.createdAfter)
		conditions.push(gte(companies.createdAt, new Date(filters.createdAfter)));
	if (filters.createdBefore)
		conditions.push(lte(companies.createdAt, new Date(filters.createdBefore)));

	if (conditions.length === 0) {
		return [];
	}

	const foundCompanies = await db
		.select()
		.from(companies)
		.where(and(...conditions));
	return foundCompanies;
};

// Clients controllers

export const getAllClients = async () => {
	const foundClients = await db.select().from(clients);
	return foundClients;
};

export const getClientById = async (id: string) => {
	const foundClient = await db.select().from(clients).where(eq(clients.id, id));
	return foundClient;
};

export const getTopClientsByContractValue = async (
	limit = 10,
	order: "asc" | "desc" = "desc",
) => {
	const orderFunction = order === "asc" ? asc : desc;
	const topClients = await db
		.select()
		.from(clients)
		.orderBy(orderFunction(clients.contractValue))
		.limit(limit);
	return topClients;
};

export const searchClients = async (filters: {
	companyId?: string;
	contactPerson?: string;
	minContractValue?: number;
	maxContractValue?: number;
	status?: "active" | "inactive" | "churned";
	assignedTo?: string;
	startAfter?: string;
	startBefore?: string;
}) => {
	const conditions = [];
	if (filters.companyId)
		conditions.push(eq(clients.companyId, filters.companyId));
	if (filters.contactPerson)
		conditions.push(ilike(clients.contactPerson, `%${filters.contactPerson}%`));
	if (filters.minContractValue)
		conditions.push(
			gte(clients.contractValue, String(filters.minContractValue)),
		);
	if (filters.maxContractValue)
		conditions.push(
			lte(clients.contractValue, String(filters.maxContractValue)),
		);
	if (filters.status) conditions.push(eq(clients.status, filters.status));
	if (filters.assignedTo)
		conditions.push(eq(clients.assignedTo, filters.assignedTo));
	if (filters.startAfter)
		conditions.push(gte(clients.startDate, new Date(filters.startAfter)));
	if (filters.startBefore)
		conditions.push(lte(clients.startDate, new Date(filters.startBefore)));

	if (conditions.length === 0) {
		return [];
	}

	const foundClients = await db
		.select()
		.from(clients)
		.where(and(...conditions));
	return foundClients;
};
