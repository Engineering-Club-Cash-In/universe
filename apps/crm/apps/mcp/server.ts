import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import "dotenv/config";
import {
	getAllClients,
	getAllCompanies,
	getAllLeads,
	getAllOpportunities,
	getClientById,
	getCompanyById,
	getLeadById,
	getOpportunityById,
	getTopClientsByContractValue,
	getTopCompaniesByClientCount,
	getTopCompaniesByOpportunitiesValue,
	getTopLeads,
	getTopOpportunities,
	searchClients,
	searchCompanies,
	searchLeads,
	searchOpportunities,
} from "./controllers/crm";

const server = new McpServer({
	name: "cci-mcp-server",
	version: "0.0.1",
});

// List tools

server.registerTool(
	"sayHello",
	{
		title: "Say hello",
		description: "Say hello to a person",
		inputSchema: {
			name: z.string().describe("The user name to say hello to"),
		},
	},
	async ({ name }) => {
		return {
			content: [{ type: "text", text: `Hello ${name}!` }],
		};
	},
);

// CRM tools
// Leads tools

server.tool("getAllLeads", {}, async () => {
	const leads = await getAllLeads();
	return {
		content: [{ type: "text", text: JSON.stringify(leads) }],
	};
});

server.tool(
	"getLeadById",
	{
		id: z.string().describe("The ID of the lead to retrieve"),
	},
	async ({ id }) => {
		const lead = await getLeadById(id);
		return {
			content: [{ type: "text", text: JSON.stringify(lead) }],
		};
	},
);

server.tool(
	"getTopLeads",
	{
		limit: z
			.number()
			.optional()
			.describe("The number of leads to return. Defaults to 10."),
		orderBy: z
			.enum([
				"id",
				"firstName",
				"lastName",
				"email",
				"phone",
				"jobTitle",
				"companyId",
				"source",
				"status",
				"assignedTo",
				"notes",
				"convertedAt",
				"createdAt",
				"updatedAt",
				"createdBy",
			])
			.optional()
			.describe("The field to order by. Defaults to createdAt."),
		order: z
			.enum(["asc", "desc"])
			.optional()
			.describe("The order to sort by. Defaults to desc."),
	},
	async (params) => {
		// Use params to avoid shadowing
		const topLeads = await getTopLeads(
			params.limit,
			params.orderBy,
			params.order,
		);
		return {
			content: [{ type: "text", text: JSON.stringify(topLeads) }],
		};
	},
);

server.tool(
	"searchLeads",
	{
		filters: z.object({
			firstName: z.string().optional(),
			lastName: z.string().optional(),
			email: z.string().optional(),
			companyId: z.string().optional(),
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
			assignedTo: z.string().optional(),
			createdBy: z.string().optional(),
			createdAfter: z
				.string()
				.optional()
				.describe("Date string in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)"),
			createdBefore: z
				.string()
				.datetime()
				.optional()
				.describe("Date string in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)"),
		}),
	},
	async ({ filters }) => {
		const leads = await searchLeads(filters);
		return {
			content: [{ type: "text", text: JSON.stringify(leads) }],
		};
	},
);

// Opportunities tools
server.tool("getAllOpportunities", {}, async () => {
	const opportunities = await getAllOpportunities();
	return {
		content: [{ type: "text", text: JSON.stringify(opportunities) }],
	};
});

server.tool(
	"getOpportunityById",
	{
		id: z.string().describe("The ID of the opportunity to retrieve"),
	},
	async ({ id }) => {
		const opportunity = await getOpportunityById(id);
		return {
			content: [{ type: "text", text: JSON.stringify(opportunity) }],
		};
	},
);

server.tool(
	"getTopOpportunities",
	{
		limit: z
			.number()
			.optional()
			.describe("The number of opportunities to return. Defaults to 10."),
		orderBy: z
			.enum([
				"id",
				"title",
				"leadId",
				"companyId",
				"value",
				"stageId",
				"probability",
				"expectedCloseDate",
				"actualCloseDate",
				"status",
				"assignedTo",
				"notes",
				"createdAt",
				"updatedAt",
				"createdBy",
			])
			.optional()
			.describe("The field to order by. Defaults to value."),
		order: z
			.enum(["asc", "desc"])
			.optional()
			.describe("The order to sort by. Defaults to desc."),
	},
	async (params) => {
		const topOpportunities = await getTopOpportunities(
			params.limit,
			params.orderBy,
			params.order,
		);
		return {
			content: [{ type: "text", text: JSON.stringify(topOpportunities) }],
		};
	},
);

server.tool(
	"searchOpportunities",
	{
		filters: z.object({
			title: z.string().optional(),
			companyId: z.string().optional(),
			minValue: z.number().optional(),
			maxValue: z.number().optional(),
			status: z.enum(["open", "won", "lost", "on_hold"]).optional(),
			assignedTo: z.string().optional(),
			expectedCloseAfter: z
				.string()
				.optional()
				.describe("Date string in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)"),
			expectedCloseBefore: z
				.string()
				.optional()
				.describe("Date string in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)"),
		}),
	},
	async ({ filters }) => {
		const opportunities = await searchOpportunities(filters);
		return {
			content: [{ type: "text", text: JSON.stringify(opportunities) }],
		};
	},
);

// Companies tools
server.tool("getAllCompanies", {}, async () => {
	const companies = await getAllCompanies();
	return {
		content: [{ type: "text", text: JSON.stringify(companies) }],
	};
});

server.tool(
	"getCompanyById",
	{
		id: z.string().describe("The ID of the company to retrieve"),
	},
	async ({ id }) => {
		const company = await getCompanyById(id);
		return {
			content: [{ type: "text", text: JSON.stringify(company) }],
		};
	},
);

server.tool(
	"getTopCompaniesByOpportunitiesValue",
	{
		limit: z
			.number()
			.optional()
			.describe("The number of companies to return. Defaults to 3."),
	},
	async ({ limit }) => {
		const companies = await getTopCompaniesByOpportunitiesValue(limit);
		return {
			content: [{ type: "text", text: JSON.stringify(companies) }],
		};
	},
);

server.tool(
	"getTopCompaniesByClientCount",
	{
		limit: z
			.number()
			.optional()
			.describe("The number of companies to return. Defaults to 3."),
	},
	async ({ limit }) => {
		const companies = await getTopCompaniesByClientCount(limit);
		return {
			content: [{ type: "text", text: JSON.stringify(companies) }],
		};
	},
);

server.tool(
	"searchCompanies",
	{
		filters: z.object({
			name: z.string().optional(),
			industry: z.string().optional(),
			size: z.string().optional(),
			createdAfter: z
				.string()
				.optional()
				.describe("Date string in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)"),
			createdBefore: z
				.string()
				.optional()
				.describe("Date string in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)"),
		}),
	},
	async ({ filters }) => {
		const companies = await searchCompanies(filters);
		return {
			content: [{ type: "text", text: JSON.stringify(companies) }],
		};
	},
);

// Clients tools
server.tool("getAllClients", {}, async () => {
	const clients = await getAllClients();
	return {
		content: [{ type: "text", text: JSON.stringify(clients) }],
	};
});

server.tool(
	"getClientById",
	{
		id: z.string().describe("The ID of the client to retrieve"),
	},
	async ({ id }) => {
		const client = await getClientById(id);
		return {
			content: [{ type: "text", text: JSON.stringify(client) }],
		};
	},
);

server.tool(
	"getTopClientsByContractValue",
	{
		limit: z
			.number()
			.optional()
			.describe("The number of clients to return. Defaults to 10."),
		order: z
			.enum(["asc", "desc"])
			.optional()
			.describe("The order to sort by. Defaults to desc."),
	},
	async (params) => {
		const topClients = await getTopClientsByContractValue(
			params.limit,
			params.order,
		);
		return {
			content: [{ type: "text", text: JSON.stringify(topClients) }],
		};
	},
);

server.tool(
	"searchClients",
	{
		filters: z.object({
			companyId: z.string().optional(),
			contactPerson: z.string().optional(),
			minContractValue: z.number().optional(),
			maxContractValue: z.number().optional(),
			status: z.enum(["active", "inactive", "churned"]).optional(),
			assignedTo: z.string().optional(),
			startAfter: z
				.string()
				.optional()
				.describe("Date string in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)"),
			startBefore: z
				.string()
				.optional()
				.describe("Date string in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)"),
		}),
	},
	async ({ filters }) => {
		const clients = await searchClients(filters);
		return {
			content: [{ type: "text", text: JSON.stringify(clients) }],
		};
	},
);

const transport = new StdioServerTransport();
await server.connect(transport);
