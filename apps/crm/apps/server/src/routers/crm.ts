import { ORPCError } from "@orpc/server";
import {
	and,
	asc,
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
	vehicleVendors,
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
import { licenseQrVerifications } from "../db/schema/license-verification";
import { quotations } from "../db/schema/quotations";
import {
	carryForwardAnalysisChecklistVerificationState,
	hasStaleAnalysisChecklistDocumentState,
	hasStaleAnalysisChecklistVehicleState,
} from "../lib/analysis-checklist";
import { type AuditEntry, auditedTransaction, auditRecord } from "../lib/audit";
import {
	isReservedBankCoverageDescription,
	redactBankStatementCoverageEvidence,
} from "../lib/bank-statement-documents";
import {
	rebuildClientDocumentChecklistInTransaction,
	refreshChecklistForClientDocuments,
	updateChecklistForClientDocument,
	updateChecklistForVehicleDocument,
} from "../lib/checklist";
import { mergeCompanyRelationshipStats } from "../lib/company-relationship-stats";
import {
	assertOpportunityBelongsToLead,
	canWriteOpportunityCreditAnalysis,
	getCreditAnalysisOwnerCondition,
} from "../lib/credit-analysis-ownership";
import { buildDeletedOpportunitySnapshot } from "../lib/deleted-opportunity-audit";
import { isImmutableDocumentIntegrityEvidencePath } from "../lib/document-integrity/evidence-path";
import { eqDpi } from "../lib/dpi-lookup";
import {
	calcularAjusteFechaIdeal,
	getDiaPagoOriginalSistema,
} from "../lib/fecha-ideal-pago-ajuste";
import {
	puedeAsignarInversionistas,
	puedeCambiarDiaPago,
	requiereCongelarEtapaParaCambioDia,
} from "../lib/fecha-ideal-pago-edicion";
import {
	calcularRegeneracionCotizacionFechaIdeal,
	aplicarDeltaMontosInversionistas,
} from "../lib/fecha-ideal-cotizacion";
import {
	esDpiEnBlanco,
	evaluarGateMoraDpi,
	MENSAJE_DPI_EN_BLANCO,
	MENSAJE_GATE_APAGADO,
	requiereConsultaDeMora,
	resolverEdicionConMora,
} from "../lib/gate-mora-dpi";
import {
	getGuatemalaMonthWindow,
	toDateStrGT,
} from "../lib/guatemala-month-window";
import {
	conLaEtapaDeDestino,
	dpiCambia,
	elExpedienteNoAcumulaEvidencia,
	etapaQueCanda,
	evaluarCandadoBorradoCoDeudor,
	evaluarCandadoDpi,
	evidenciaAcumuladaDelExpediente,
	mensajeCambioDeLeadConEvidencia,
	mensajeCandadoCambioDeLead,
	noExisteOportunidadCandanteDelLead,
	noExisteOportunidadCandantePorId,
	obtenerOportunidadesParaCandadoDpi,
	PORCENTAJE_CANDADO_DPI,
	type ResultadoCandadoDpi,
} from "../lib/lead-dpi-lock";
import {
	formatMissingLeadFields,
	getMissingLeadFieldsForContracts,
} from "../lib/lead-helpers";
import { canSyncNitToOpportunity } from "../lib/lead-nit-sync";
import { getLeadSourceLabel } from "../lib/lead-sources";
import {
	numerosSifcoConocidosPorDpi,
	numerosSifcoDelDpiYDeLaOportunidad,
	numerosSifcoDelDpiYDelLead,
} from "../lib/numeros-sifco-por-dpi";
import { buildOpportunityCompanyPatch } from "../lib/opportunity-company-patch";
import {
	buildOpportunityRelationshipInvariantCondition,
	buildWonOpportunityFrozenFieldError,
	getStageLeadRequirementError,
	getStageVehicleRequirementError,
	getWonOpportunityFrozenFieldChanges,
	getWonOpportunityLockError,
	getWonOpportunityRevokeError,
	stripUnchangedFrozenFields,
	type WonOpportunityFrozenField,
} from "../lib/opportunity-stage-guard";
import { analystProcedure, crmProcedure } from "../lib/orpc";
import {
	type DecisionRevalidacion,
	decidirRevalidacion,
	documentosDeIdentidadVigentes,
	ErrorRevalidacionIncompleta,
	faltaPorIdentidadRevalidada,
	MENSAJE_DPI_DESACTUALIZADO,
	MOTIVO_AVISO,
	type OportunidadParaRevalidar,
	obtenerEtapaDeAnalisis,
	PORCENTAJE_ETAPA_ANALISIS,
	parcheDeIdentidadInvalidada,
	parcheDeRevalidacion,
	RAZON_TRANSICION_REVALIDACION,
	revalidarOportunidades,
	saleDeLaPerdida,
} from "../lib/revalidacion-oportunidad";
import { PERMISSIONS } from "../lib/roles";
import {
	buildUploadPrefix,
	deleteFileFromR2,
	getFileUrl,
	verifyUploadedDocumentInR2,
} from "../lib/storage";
import { resolverValidacionMora } from "../lib/validacion-mora";
import {
	formatMissingFields,
	getMissingFieldsForCompletion,
	getMissingFieldsForContracts,
} from "../lib/vehicle-helpers";
import { carteraBackClient } from "../services/cartera-back-client";
import { isCarteraBackEnabled } from "../services/cartera-back-integration";
import {
	DocumentIntegrityError,
	upsertOpportunityCreditAnalysis,
	withOpportunityDocumentMutationLock,
} from "../services/document-integrity";
import { scoreLead } from "../services/lead-scoring";
import {
	ejecutarValidaciones,
	resolverExencionPorBot,
} from "../services/opportunity-validations";
import {
	ConsultaMoraNoDisponibleError,
	type StatusCreditEnum,
} from "../types/cartera-back";
import { normalizarDpi, validarDpi } from "../utils/cui-validation";
import { resetBankStatementCreditAnalysis } from "./bank-analysis";
import { BankStatementCoverageSaveError } from "./bank-analysis-coverage";
import { buildLeadDuplicateConflict } from "./lead-duplicate-conflict";
import { createNotification } from "./notifications";
import {
	getManualBankUploadCleanupDescription,
	isBankStatementChecklistType,
	isManualBankDocumentCleanupDescription,
	OpportunityDocumentMutationError,
	runOpportunityDocumentDeleteCore,
	runOpportunityDocumentUploadCore,
} from "./opportunity-document-core";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

type ClientCreditPageFetcher = (params: {
	mes: number;
	anio: number;
	estado: ClientCreditCarteraStatus;
	page: number;
	perPage: number;
	nombre_usuario?: string;
	numero_credito_sifco?: string;
	numeros_credito_sifco?: string[];
}) => Promise<{
	data: CarteraClientCredit[];
	totalCount?: number | null;
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
	assignedTo?: string | null;
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

export async function getCurrentClientCreditsFromCartera(
	fetchCredits: ClientCreditFetcher = (params) =>
		carteraBackClient.getAllCreditos(params),
) {
	return getClientCreditsFromCartera(fetchCredits, { mes: 0, anio: 0 });
}

/**
 * Las dependencias de producción del gate de mora. La regla vive en
 * `lib/gate-mora-dpi.ts` sin saber de HTTP ni de bitácora; acá se le enchufan.
 */
const depsGateMora = {
	consultar: (dpi: string, numerosCreditoConocidos?: string[]) =>
		carteraBackClient.consultarMoraPorDpi(dpi, numerosCreditoConocidos),
	numerosCreditoConocidos: numerosSifcoConocidosPorDpi,
	// La palanca de emergencia de siempre: la misma bandera con la que el resto
	// del CRM degrada cuando cartera no está. Apagarla deja pasar sin consultar
	// —fail-open deliberado, ver `habilitado` en `lib/gate-mora-dpi.ts`— y cada
	// paso así queda en la bitácora.
	habilitado: isCarteraBackEnabled,
	anotar: auditRecord,
};

const CARTERA_PAGE_FETCH_SIZE = 100;

/**
 * Trae SOLO la ventana [offset, offset+limit) del portafolio vigente.
 *
 * En cartera-back, `estado: "ACTIVO"` SIN `cuotas_atrasadas` ya devuelve
 * `statusCredit IN ('ACTIVO','MOROSO','EN_CONVENIO')` — es decir, todos los
 * créditos vigentes en una sola consulta (ver apps/cartera-back credits.ts).
 * Por eso NO se itera por estado: una sola corriente paginada, sin doble conteo
 * ni filas duplicadas. Pide solo las páginas que la ventana toca y usa el
 * `totalCount` que ya devuelve `getAllCreditos`.
 */
export async function getClientCreditsPageFromCartera(
	params: {
		offset: number;
		limit: number;
		nombreUsuario?: string;
		sifcoExacto?: string;
		sifcos?: string[];
	},
	fetchCredits: ClientCreditPageFetcher = (p) =>
		carteraBackClient.getAllCreditos(p),
): Promise<{ credits: CarteraClientCredit[]; total: number }> {
	const perPage = CARTERA_PAGE_FETCH_SIZE;
	const filtros = {
		mes: 0,
		anio: 0,
		// ACTIVO (sin cuotas_atrasadas) = ACTIVO + MOROSO + EN_CONVENIO en origen.
		estado: "ACTIVO" as ClientCreditCarteraStatus,
		...(params.nombreUsuario ? { nombre_usuario: params.nombreUsuario } : {}),
		...(params.sifcoExacto ? { numero_credito_sifco: params.sifcoExacto } : {}),
		...(params.sifcos && params.sifcos.length > 0
			? { numeros_credito_sifco: params.sifcos }
			: {}),
	};

	// Solo se necesita el conteo (p. ej. para las stats): sonda mínima.
	if (params.limit <= 0) {
		const probe = await fetchCredits({ ...filtros, page: 1, perPage: 1 });
		return { credits: [], total: probe.totalCount ?? probe.data.length };
	}

	const credits: CarteraClientCredit[] = [];
	let need = params.limit;
	let cursor = Math.max(0, params.offset);
	let page = Math.floor(cursor / perPage) + 1;
	let resp = await fetchCredits({ ...filtros, page, perPage });
	const total = resp.totalCount ?? resp.data.length;

	// Recolectar desde `cursor` hasta agotar `need` o el total.
	while (need > 0 && cursor < total) {
		const pageStart = (page - 1) * perPage;
		const slice = resp.data.slice(
			cursor - pageStart,
			cursor - pageStart + need,
		);
		if (slice.length === 0) break;
		credits.push(...slice);
		need -= slice.length;
		cursor += slice.length;
		if (need > 0 && cursor < total) {
			page += 1;
			resp = await fetchCredits({ ...filtros, page, perPage });
		}
	}

	return { credits, total };
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
	creditAnalysisByOpportunityId: ReadonlyMap<string, unknown>;
	carteraCreditBySifco: Map<string, CarteraClientCredit>;
	opportunityOwnerId?: string;
}): MatchedClientRow[] {
	const rows: MatchedClientRow[] = [];
	const leadOpportunities = params.opportunityOwnerId
		? params.leadOpportunities.filter(
				(opportunity) => opportunity.assignedTo === params.opportunityOwnerId,
			)
		: params.leadOpportunities;

	for (const [sifco, credit] of params.carteraCreditBySifco) {
		const matchingOpportunities = leadOpportunities.filter(
			(opp) => opp.numeroSifco === sifco,
		);
		if (matchingOpportunities.length === 0) continue;
		const matchingOpportunity =
			matchingOpportunities.length === 1 ? matchingOpportunities[0] : null;

		rows.push({
			...params.lead,
			rowId: `${params.lead.id}-${sifco}`,
			opportunities: leadOpportunities,
			creditAnalysis: matchingOpportunity
				? (params.creditAnalysisByOpportunityId.get(matchingOpportunity.id) ??
					null)
				: null,
			totalClosedValue: getCarteraCreditAmount(credit),
			closedOpportunitiesCount: leadOpportunities.filter((opp) => opp.isClosed)
				.length,
			crmMatchStatus: "matched",
			carteraCredit: buildCarteraOnlyClientRow(credit).carteraCredit,
		});
	}

	return rows;
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
		// Supervisors manage the complete sales directory; sales users see their own.
		if (PERMISSIONS.canManageAllCompanies(context.userRole)) {
			return await db.select().from(companies).orderBy(companies.createdAt);
		}
		return await db
			.select()
			.from(companies)
			.where(eq(companies.createdBy, context.userId))
			.orderBy(companies.createdAt);
	}),

	// Catálogo completo para asignar la agencia del vehículo (análisis y
	// detalle de la oportunidad): getCompanies filtra por creador y a los
	// analistas y asesores les devolvería casi vacío. Son las agencias y
	// predios con los que se trabaja, no información de clientes.
	getCompaniesForContracts: crmProcedure.handler(async () => {
		return await db
			.select({
				id: companies.id,
				name: companies.name,
				razonSocial: companies.razonSocial,
			})
			.from(companies)
			.orderBy(companies.name);
	}),

	getCompanyRelationshipStats: crmProcedure.handler(async ({ context }) => {
		const leadsOwnerCondition =
			context.userRole === "sales"
				? eq(leads.assignedTo, context.userId)
				: undefined;
		const opportunitiesOwnerCondition =
			context.userRole === "sales"
				? eq(opportunities.assignedTo, context.userId)
				: undefined;
		const clientsOwnerCondition =
			context.userRole === "sales"
				? eq(clients.assignedTo, context.userId)
				: undefined;

		const [leadRows, opportunityRows, clientRows] = await Promise.all([
			db
				.select({ companyId: leads.companyId, total: count(leads.id) })
				.from(leads)
				.where(and(isNotNull(leads.companyId), leadsOwnerCondition))
				.groupBy(leads.companyId),
			db
				.select({
					companyId: opportunities.companyId,
					total: count(opportunities.id),
				})
				.from(opportunities)
				.where(
					and(isNotNull(opportunities.companyId), opportunitiesOwnerCondition),
				)
				.groupBy(opportunities.companyId),
			db
				.select({ companyId: clients.companyId, total: count(clients.id) })
				.from(clients)
				.where(and(isNotNull(clients.companyId), clientsOwnerCondition))
				.groupBy(clients.companyId),
		]);

		return mergeCompanyRelationshipStats({
			leads: leadRows,
			opportunities: opportunityRows,
			clients: clientRows,
		});
	}),

	createCompany: crmProcedure
		.input(
			z.object({
				name: z.string().min(1, "Company name is required"),
				razonSocial: z.string().trim().optional(),
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
			// crmProcedure deja pasar a jurídico, que no da de alta empresas
			if (!PERMISSIONS.canCreateCompanies(context.userRole)) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para crear empresas",
				});
			}
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

	/**
	 * Completar el nombre legal de una agencia desde el detalle de la
	 * oportunidad. Va aparte de updateCompany porque ese limita a las empresas
	 * creadas por uno y las agencias son de todos; aquí solo se escribe la
	 * razón social, que es el dato que el contrato necesita.
	 */
	/**
	 * Asignar o quitar las partes del contrato (vendedor del vehículo y agencia)
	 * desde el detalle de la oportunidad. Va aparte de updateOpportunity porque
	 * ese limita las ediciones al asesor asignado, y quien prepara los datos
	 * para jurídico suele ser el analista, que no es el dueño de la
	 * oportunidad. Solo toca esas dos columnas.
	 */
	setOpportunityContractParty: crmProcedure
		.meta({ audit: { entity: "opportunity", action: "update" } })
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				// null desasigna la parte; ausente la deja como está
				vendorId: z.string().uuid().nullable().optional(),
				companyId: z.string().uuid().nullable().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const [oportunidad] = await db
				.select({
					id: opportunities.id,
					assignedTo: opportunities.assignedTo,
					status: opportunities.status,
					vendorId: opportunities.vendorId,
					companyId: opportunities.companyId,
				})
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);
			if (!oportunidad) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			// Análisis (admin, analista y supervisor de ventas) prepara los datos
			// de contratos; el asesor puede hacerlo sobre las suyas.
			const puedeEditar =
				PERMISSIONS.canAccessAnalysis(context.userRole) ||
				oportunidad.assignedTo === context.userId;
			if (!puedeEditar) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para editar esta oportunidad",
				});
			}

			// Ganada = ya se firmaron los contratos y el crédito viajó a cartera:
			// el vendedor y la empresa son campos congelados, igual que en
			// updateOpportunity. Reasignar el mismo valor no cuenta como cambio.
			const cambiosCongelados = getWonOpportunityFrozenFieldChanges(
				{
					...(input.vendorId !== undefined && { vendorId: input.vendorId }),
					...(input.companyId !== undefined && { companyId: input.companyId }),
				},
				oportunidad,
			);
			const wonLockError = getWonOpportunityLockError(
				oportunidad.status,
				context.userRole,
				cambiosCongelados,
			);
			if (wonLockError) {
				throw new ORPCError("FORBIDDEN", { message: wonLockError });
			}

			// Las lecturas de arriba pudieron quedar viejas, así que las dos
			// condiciones se repiten en el predicado: Postgres las re-evalúa
			// después de esperar a la escritura rival. Si closeOpportunity la marca
			// ganada, o un supervisor se la reasigna a otro asesor, el cambio ya no
			// entra.
			// La condición se exige por cualquier parte enviada, no solo por las que
			// se veían distintas: si otro cambió el vendedor y cerró la oportunidad
			// entre la lectura y esta escritura, mandar "el mismo valor" que se leyó
			// la restauraría sobre una oportunidad ya ganada.
			const camposEnviados: WonOpportunityFrozenField[] = [
				...(input.vendorId !== undefined
					? (["vendorId"] as const)
					: ([] as const)),
				...(input.companyId !== undefined
					? (["companyId"] as const)
					: ([] as const)),
			];
			const exigirNoGanada =
				camposEnviados.length > 0 &&
				!PERMISSIONS.canAccessAdmin(context.userRole ?? "");
			const soloPorSerElAsesor = !PERMISSIONS.canAccessAnalysis(
				context.userRole,
			);
			const condiciones = [eq(opportunities.id, input.opportunityId)];
			if (exigirNoGanada) {
				condiciones.push(not(eq(opportunities.status, "won")));
			}
			if (soloPorSerElAsesor) {
				condiciones.push(eq(opportunities.assignedTo, context.userId));
			}
			const [actualizada] = await db
				.update(opportunities)
				.set({
					...(input.vendorId !== undefined && { vendorId: input.vendorId }),
					...(input.companyId !== undefined && { companyId: input.companyId }),
					updatedAt: new Date(),
				})
				.where(and(...condiciones))
				.returning({
					id: opportunities.id,
					vendorId: opportunities.vendorId,
					companyId: opportunities.companyId,
				});
			if (!actualizada) {
				// Distinguir el motivo: la fila cambió entre la lectura y el UPDATE
				const [ahora] = await db
					.select({
						status: opportunities.status,
						assignedTo: opportunities.assignedTo,
					})
					.from(opportunities)
					.where(eq(opportunities.id, input.opportunityId))
					.limit(1);
				if (soloPorSerElAsesor && ahora?.assignedTo !== context.userId) {
					throw new ORPCError("FORBIDDEN", {
						message:
							"La oportunidad se reasignó a otra persona mientras editabas",
					});
				}
				throw new ORPCError("FORBIDDEN", {
					message: buildWonOpportunityFrozenFieldError(
						cambiosCongelados.length > 0 ? cambiosCongelados : camposEnviados,
					),
				});
			}
			// El meta solo cubre los fallos: la escritura buena se anota aquí, que
			// es como se reconstruye después quién puso al vendedor o la agencia.
			auditRecord({
				entity: "opportunity",
				id: input.opportunityId,
				action: "update",
			});
			return actualizada;
		}),

	setCompanyRazonSocial: crmProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				razonSocial: z.string().trim().min(1),
			}),
		)
		.handler(async ({ input, context }) => {
			if (!PERMISSIONS.canCreateCompanies(context.userRole)) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permiso para editar empresas",
				});
			}
			// Solo se completa lo que está vacío: el nombre legal es compartido por
			// todas las oportunidades de esa agencia, así que si otro lo guardó
			// mientras esta pantalla estaba abierta, no se le pisa con lo viejo.
			const [empresa] = await db
				.update(companies)
				.set({ razonSocial: input.razonSocial, updatedAt: new Date() })
				.where(
					and(
						eq(companies.id, input.id),
						sql`coalesce(btrim(${companies.razonSocial}), '') = ''`,
					),
				)
				.returning({
					id: companies.id,
					name: companies.name,
					razonSocial: companies.razonSocial,
				});
			if (!empresa) {
				const [actual] = await db
					.select({ razonSocial: companies.razonSocial })
					.from(companies)
					.where(eq(companies.id, input.id))
					.limit(1);
				if (!actual) {
					throw new ORPCError("NOT_FOUND", {
						message: "Empresa no encontrada",
					});
				}
				throw new ORPCError("CONFLICT", {
					message: `Otra persona ya guardó la razón social de esta empresa ("${actual.razonSocial}"). Recarga para verla.`,
				});
			}
			return empresa;
		}),

	updateCompany: crmProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				name: z.string().min(1, "Company name is required").optional(),
				razonSocial: z.string().trim().optional(),
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

			// Supervisors can update the complete sales directory.
			const whereClause = PERMISSIONS.canManageAllCompanies(context.userRole)
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

			// Excluir leads migrados del listado (solo se muestran en la sección de
			// clientes migrados). Cuando se pide un lead puntual por id no aplica:
			// el detalle se abre desde un link directo y debe poder mostrarlo.
			if (!id) {
				conditions.push(not(eq(leads.status, "migrate")));
			}

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
		.meta({ audit: { entity: "lead", action: "create" } })
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

			// 🔴 El duplicado se revisa ANTES del gate, y el orden importa. Si el DPI
			// ya es de un lead existente que está en mora, correr el gate primero
			// devolvía el error del gate ("cliente con saldo en mora") en vez del
			// CONFLICT con el payload que el front usa para mostrar el lead
			// existente y ofrecer ir a su ficha: el asesor quedaba sin la salida que
			// esa pantalla ya tiene resuelta. Y de paso se pagaba un viaje a SIFCO
			// para averiguar algo que no iba a cambiar el resultado — acá no se está
			// dando de alta a nadie, ya está adentro.
			// Validar DPI duplicado
			if (normalizedDpi) {
				// Se traen todos los leads del DPI, no uno solo: mientras queden
				// duplicados sin depurar, el proceso activo puede estar colgado de
				// cualquiera de ellos, y revisar uno arbitrario haría reasignar un
				// cliente que otro asesor ya está atendiendo.
				const matchingLeads = await db
					.select({
						id: leads.id,
						firstName: leads.firstName,
						middleName: leads.middleName,
						lastName: leads.lastName,
						secondLastName: leads.secondLastName,
						assignedTo: leads.assignedTo,
						assignedToName: user.name,
					})
					.from(leads)
					.innerJoin(user, eq(leads.assignedTo, user.id))
					.where(eqDpi(leads.dpi, normalizedDpi))
					.orderBy(asc(leads.createdAt));

				if (matchingLeads.length > 0) {
					// Verificar si alguno tiene oportunidades activas (open u on_hold)
					const [activeOpportunity] = await db
						.select({
							id: opportunities.id,
							leadId: opportunities.leadId,
						})
						.from(opportunities)
						.where(
							and(
								inArray(
									opportunities.leadId,
									matchingLeads.map((lead) => lead.id),
								),
								inArray(opportunities.status, ["open", "on_hold"]),
							),
						)
						.orderBy(desc(opportunities.createdAt))
						.limit(1);

					throw new ORPCError("CONFLICT", {
						message: "Ya existe un lead con este DPI",
						data: buildLeadDuplicateConflict(
							matchingLeads,
							activeOpportunity ?? null,
							context.userId,
						),
					});
				}
			}

			// El gate, ya con el alta decidida: es un DPI que de verdad va a entrar
			// al sistema por primera vez. Siempre se consulta y es fail-closed — si
			// cartera no contesta, no entra nadie.
			if (normalizedDpi) {
				const gate = await evaluarGateMoraDpi(normalizedDpi, depsGateMora);
				if (gate.rechazado) {
					throw new ORPCError("BAD_REQUEST", { message: gate.mensaje });
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
			auditRecord({ entity: "lead", id: newLead[0].id, action: "create" });
			return newLead[0];
		}),

	updateLead: crmProcedure
		.meta({ audit: { entity: "lead", action: "update" } })
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

			// La fila de bitácora del override de admin, si lo hubo. Se escribe
			// DESPUÉS de confirmar que el UPDATE tocó una fila: anotarla antes
			// dejaba overrides `ok: true` de cambios que nunca ocurrieron (lead
			// inexistente, o sin permiso sobre él). Ver `resolverEdicionConMora`.
			let overrideDeMora: AuditEntry | null = null;

			// 🔴 El DPI en blanco se rechaza ANTES que nada: sin esto, `dpi: ""` se
			// saltaba la validación y el gate por falsy y el `.set` lo escribía
			// igual, dejando al moroso invisible para siempre. Ver
			// `MENSAJE_DPI_EN_BLANCO`.
			if (esDpiEnBlanco(updateData.dpi)) {
				throw new ORPCError("BAD_REQUEST", { message: MENSAJE_DPI_EN_BLANCO });
			}

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

			// El NIT y el DPI que el lead tenía ANTES de esta edición. El NIT es la
			// referencia para distinguir las oportunidades que siguen con la copia de
			// las que alguien corrigió a mano; el DPI, para saber si esta edición lo
			// cambia de verdad. Hay que leerlos antes del UPDATE.
			const [leadAntesDelUpdate] =
				updateData.nit !== undefined || updateData.dpi !== undefined
					? await db
							.select({ nit: leads.nit, dpi: leads.dpi })
							.from(leads)
							.where(eq(leads.id, id))
							.limit(1)
					: [];

			const editaAdmin = context.userRole === "admin";
			// ¿Esta edición cambia el DPI de verdad? Lo decide el mismo predicado
			// que usa el candado: el formulario manda `dpi` en toda edición, también
			// cuando el usuario solo tocó el teléfono.
			const elDpiCambia =
				updateData.dpi !== undefined &&
				dpiCambia(leadAntesDelUpdate?.dpi, updateData.dpi);

			// El veredicto del candado sobrevive al bloque: si el admin usó la
			// válvula hay que cobrarle el costo DESPUÉS del UPDATE (ver F9 abajo).
			let candadoDpi: ResultadoCandadoDpi | null = null;

			if (updateData.dpi !== undefined) {
				// El candado va ANTES que el gate de mora: es una consulta local
				// barata, y si el DPI ya no se puede cambiar (solicitud pasada del
				// 30%) no tiene sentido pagar el viaje a SIFCO.
				candadoDpi = await evaluarCandadoDpi({
					dpiActual: leadAntesDelUpdate?.dpi,
					dpiNuevo: updateData.dpi,
					sujeto: "lead",
					esAdmin: editaAdmin,
					leadId: id,
				});
				if (candadoDpi.bloqueado) {
					throw new ORPCError("BAD_REQUEST", { message: candadoDpi.message });
				}

				// 🔴 Solo se consulta la mora si el DPI es nuevo o cambia. Si se
				// consultara en toda edición, un cliente que ya está en mora quedaría
				// imposible de editar y nadie podría corregirle el teléfono ni la
				// dirección — y son justamente las fichas que cobranza toca a diario.
				// El borrado (`dpi: ""`) no llega hasta acá: se rechaza con 400 al
				// entrar al handler. Ver `MENSAJE_DPI_EN_BLANCO`.
				if (requiereConsultaDeMora(updateData.dpi, leadAntesDelUpdate?.dpi)) {
					// 🔴 La pregunta lleva los números del DPI NUEVO **y** los del lead
					// que se está editando. Con solo los del DPI nuevo, el lead que
					// tiene su propio crédito moroso —un `CRM-<uuid>` o un `insoluto-N`,
					// invisibles para SIFCO— salía del gate tecleando un DPI virgen:
					// cartera contestaba CLIENTE_NO_ENCONTRADO y el cambio pasaba para
					// cualquiera. Su propia deuda quedaba fuera de su propia evaluación.
					const gate = await evaluarGateMoraDpi(updateData.dpi, {
						...depsGateMora,
						numerosCreditoConocidos: (dpiConsultado) =>
							numerosSifcoDelDpiYDelLead(dpiConsultado, id),
					});
					// Válvula de corrección: un DPI mal tecleado cuyo valor correcto
					// pertenece a alguien con mora sería incorregible para siempre. Solo
					// admin, y queda anotado. Ver `resolverEdicionConMora`.
					const resolucion = resolverEdicionConMora(gate, context.userRole, {
						entity: "lead",
						id,
						dpi: updateData.dpi,
					});
					if (!resolucion.permitir) {
						throw new ORPCError("BAD_REQUEST", {
							message: resolucion.mensaje,
						});
					}
					overrideDeMora = resolucion.anotacionPendiente;
				}
			}

			// 🔴 El candado de arriba y este UPDATE no son atómicos: entre los dos,
			// otra transacción puede aprobar el análisis (30 → 40) y el DPI se
			// escribiría igual sobre un expediente que acaba de quedar atado a la
			// identidad vieja. Postgres re-evalúa el predicado tras esperar a la
			// escritura rival, así que la condición viaja DENTRO de la sentencia.
			// Mismo patrón que `approveOpportunityAnalysis`.
			//
			// Solo cuando el DPI cambia de verdad: este UPDATE escribe también
			// teléfono, dirección y demás cuando `dpi` ni siquiera viene, y esas
			// ediciones no tienen por qué trabarse por una solicitud avanzada.
			// El admin queda fuera: su válvula sigue abierta (y sale marcada).
			const candadoEnElPredicado = elDpiCambia && !editaAdmin;
			const whereDelUpdate = candadoEnElPredicado
				? and(whereClause, noExisteOportunidadCandanteDelLead(id))
				: whereClause;

			// 🔴 El cambio de DPI y su revalidación van en UNA transacción.
			//
			// En dos transacciones separadas, una revalidación que falle dejaba el
			// DPI nuevo COMMITEADO con las oportunidades todavía aprobadas contra la
			// identidad vieja: el expediente sobreviviente afirma cosas sobre una
			// persona que ya no es la del DPI. Es exactamente el estado que el reset
			// existe para impedir, y se alcanzaba con que la revalidación se cayera.
			//
			// Ahora o entran las dos escrituras o no entra ninguna. `auditedTransaction`
			// descarta además las anotaciones de lo que el rollback se llevó.
			const updatedLead = await auditedTransaction(async (tx) => {
				// 🔴 Lock ANTES del predicado. El NOT EXISTS del candado lee
				// `opportunities` bajo el snapshot MVCC del UPDATE a `leads`: no
				// bloquea la fila de la oportunidad, así que podía ver 30%, escribir
				// el DPI, y dejar que una aprobación 30→40 ya en vuelo commiteara
				// después. Con el FOR UPDATE, la escritura del DPI espera a que esa
				// aprobación termine (o viceversa) y el predicado decide sobre el
				// estado real, no sobre una foto.
				if (elDpiCambia) {
					await tx
						.select({ id: opportunities.id })
						.from(opportunities)
						.where(eq(opportunities.leadId, id))
						.for("update");
				}

				const filas = await tx
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
					.where(whereDelUpdate)
					.returning();

				// Cero filas se resuelve afuera (necesita leer el candado ya
				// comprometido); acá solo se sale sin escribir nada más.
				if (filas.length === 0) return filas;

				// 🔴 El override del admin sobre el candado no es gratis. La válvula
				// existe para corregir un DPI mal tecleado, pero cuando se usa, RENAP,
				// buró y los documentos de las oportunidades candantes quedaron hechos
				// contra el DPI VIEJO. Se las manda de vuelta a análisis: corregir el
				// DPI a esta altura cuesta re-validar.
				//
				// Las salvaguardas (won y ≥90% no se tocan, solo se avisa) viven dentro
				// de `revalidarOportunidades`. Si no puede completarse, lanza y este
				// mismo `tx` revierte el DPI que se acaba de escribir.
				if (candadoDpi?.overrideAdmin && candadoDpi.candantes?.length) {
					await revalidarOportunidades({
						oportunidades: candadoDpi.candantes,
						accion: "candado_override_revalidacion",
						detalle:
							"un administrador cambió el DPI del lead pese al candado; la validación de identidad de esta oportunidad se hizo contra el DPI anterior",
						datosExtra: { leadId: id, dpiNuevo: updateData.dpi },
						anotar: auditRecord,
						cambiadaPor: context.userId,
						database: tx,
					});
				}

				return filas;
			});
			if (updatedLead.length === 0) {
				// Con la condición puesta, cero filas puede significar que el candado
				// se cerró en el medio. Responder NOT_FOUND ahí mandaría a buscar un
				// lead que existe; se contesta como el candado, con su mismo mensaje.
				if (candadoEnElPredicado) {
					const candadoAhora = await evaluarCandadoDpi({
						dpiActual: leadAntesDelUpdate?.dpi,
						dpiNuevo: updateData.dpi,
						sujeto: "lead",
						esAdmin: false,
						leadId: id,
					});
					if (candadoAhora.bloqueado) {
						throw new ORPCError("BAD_REQUEST", {
							message: candadoAhora.message,
						});
					}
				}

				throw new ORPCError("NOT_FOUND", {
					message: "Lead no encontrado o no tienes permiso para actualizarlo",
				});
			}

			// Después del chequeo: con cero filas no hubo escritura que anotar.
			auditRecord({ entity: "lead", id: id, action: "update" });

			// El override recién existe si el cambio existió. Va después del
			// `auditRecord` del update por el mismo motivo: son la misma escritura.
			if (overrideDeMora) {
				auditRecord(overrideDeMora);
			}

			// Sync NIT to associated opportunities.
			// Solo a las que siguen con la copia del NIT del lead: el que viaja a
			// cartera es el de la oportunidad y se corrige por aparte en el detalle
			// de crédito (40%) y al asignar inversión (50%). Ver `lead-nit-sync`.
			if (updateData.nit !== undefined) {
				const leadOpportunities = await db
					.select({ id: opportunities.id, nit: opportunities.nit })
					.from(opportunities)
					.where(eq(opportunities.leadId, id));

				const sincronizables = leadOpportunities.filter((o) =>
					canSyncNitToOpportunity(o.nit, leadAntesDelUpdate?.nit),
				);

				if (sincronizables.length > 0) {
					await db
						.update(opportunities)
						.set({ nit: updateData.nit || null, updatedAt: new Date() })
						.where(
							inArray(
								opportunities.id,
								sincronizables.map((o) => o.id),
							),
						);
					// El NIT que viaja a cartera es el de la oportunidad, no el del lead.
					for (const oportunidad of sincronizables) {
						auditRecord({
							entity: "opportunity",
							id: oportunidad.id,
							action: "sync_nit",
							data: { leadId: id, nit: updateData.nit || null },
						});
					}
				}

				const conservadas = leadOpportunities.length - sincronizables.length;
				if (conservadas > 0) {
					console.log(
						`[updateLead] NIT del lead ${id} actualizado: ${sincronizables.length} oportunidad(es) sincronizada(s), ${conservadas} conservada(s) por tener el NIT corregido a mano`,
					);
				}
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
					auditRecord({
						entity: "opportunity",
						id: activeOpportunity.id,
						action: "sync_source_campaign",
						data: {
							leadId: id,
							source: updateData.source,
							campaign: updateData.campaign,
						},
					});
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
					opportunityId: z.string().uuid().optional(),
					coDebtorId: z.string().uuid().optional(),
				})
				.refine((data) => data.leadId || data.coDebtorId, {
					message: "Debe proporcionar leadId o coDebtorId",
				})
				.refine((data) => !(data.leadId && data.coDebtorId), {
					message: "No puede consultar un lead y un co-deudor a la vez",
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

				if (!input.opportunityId) {
					return null;
				}

				const [opportunity] = await db
					.select({
						leadId: opportunities.leadId,
						assignedTo: opportunities.assignedTo,
					})
					.from(opportunities)
					.where(eq(opportunities.id, input.opportunityId))
					.limit(1);
				if (!opportunity) {
					throw new ORPCError("NOT_FOUND", {
						message: "Oportunidad no encontrada",
					});
				}
				try {
					assertOpportunityBelongsToLead(opportunity, input.leadId);
				} catch (error) {
					throw new ORPCError("BAD_REQUEST", {
						message: error instanceof Error ? error.message : String(error),
					});
				}
				if (
					!canWriteOpportunityCreditAnalysis(
						context.userRole,
						context.userId,
						opportunity.assignedTo,
					)
				) {
					throw new ORPCError("FORBIDDEN", {
						message: "No tienes permiso para ver este análisis",
					});
				}

				const analysis = await db
					.select()
					.from(creditAnalysis)
					.where(
						getCreditAnalysisOwnerCondition({
							leadId: input.leadId,
							opportunityId: input.opportunityId,
						}),
					)
					.limit(1);

				return analysis[0]
					? {
							...analysis[0],
							fullAnalysis: redactBankStatementCoverageEvidence(
								analysis[0].fullAnalysis,
							),
						}
					: null;
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

				return analysis[0]
					? {
							...analysis[0],
							fullAnalysis: redactBankStatementCoverageEvidence(
								analysis[0].fullAnalysis,
							),
						}
					: null;
			}

			return null;
		}),

	upsertCreditAnalysis: crmProcedure
		.input(
			z
				.object({
					leadId: z.string().uuid().optional(),
					opportunityId: z.string().uuid().optional(),
					coDebtorId: z.string().uuid().optional(),
					monthlyFixedIncome: z.number().min(0).optional(),
					monthlyVariableIncome: z.number().min(0).optional(),
					monthlyFixedExpenses: z.number().min(0).optional(),
					monthlyVariableExpenses: z.number().min(0).optional(),
					economicAvailability: z.number().optional(),
					maxPayment: z.number().min(0).optional(),
					maxCreditAmount: z.number().min(0).optional(),
				})
				.refine(
					(data) => data.coDebtorId || (data.leadId && data.opportunityId),
					{
						message: "Debe proporcionar leadId y opportunityId, o coDebtorId",
					},
				)
				.refine((data) => !(data.leadId && data.coDebtorId), {
					message: "No puede guardar un lead y un co-deudor a la vez",
				}),
		)
		.handler(async ({ input, context }) => {
			const { leadId, opportunityId, coDebtorId, ...analysisData } = input;

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

				const [opportunity] = await db
					.select({
						leadId: opportunities.leadId,
						assignedTo: opportunities.assignedTo,
					})
					.from(opportunities)
					.where(eq(opportunities.id, opportunityId!))
					.limit(1);
				if (!opportunity) {
					throw new ORPCError("NOT_FOUND", {
						message: "Oportunidad no encontrada",
					});
				}
				try {
					assertOpportunityBelongsToLead(opportunity, leadId);
				} catch (error) {
					throw new ORPCError("BAD_REQUEST", {
						message: error instanceof Error ? error.message : String(error),
					});
				}
				if (
					!canWriteOpportunityCreditAnalysis(
						context.userRole,
						context.userId,
						opportunity.assignedTo,
					)
				) {
					throw new ORPCError("FORBIDDEN", {
						message: "No tienes permiso para actualizar este análisis",
					});
				}

				try {
					return await upsertOpportunityCreditAnalysis({
						leadId,
						opportunityId: opportunityId!,
						userId: context.userId,
						analysisData: dataForDb,
					});
				} catch (error) {
					if (error instanceof DocumentIntegrityError) {
						throw new ORPCError("PRECONDITION_FAILED", {
							message: error.message,
						});
					}
					throw error;
				}
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
					opportunityId: z.string().uuid().optional(),
					coDebtorId: z.string().uuid().optional(),
				})
				.refine(
					(data) => data.coDebtorId || (data.leadId && data.opportunityId),
					{
						message: "Debe proporcionar leadId y opportunityId, o coDebtorId",
					},
				)
				.refine((data) => !(data.leadId && data.coDebtorId), {
					message: "No puede resetear un lead y un co-deudor a la vez",
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

			if (input.leadId) {
				const [opportunity] = await db
					.select({ leadId: opportunities.leadId })
					.from(opportunities)
					.where(eq(opportunities.id, input.opportunityId!))
					.limit(1);
				if (!opportunity) {
					throw new ORPCError("NOT_FOUND", {
						message: "Oportunidad no encontrada",
					});
				}
				try {
					assertOpportunityBelongsToLead(opportunity, input.leadId);
				} catch (error) {
					throw new ORPCError("BAD_REQUEST", {
						message: error instanceof Error ? error.message : String(error),
					});
				}
			}

			let deleted: { id: string } | null;
			if (input.leadId) {
				try {
					deleted = await resetBankStatementCreditAnalysis({
						opportunityId: input.opportunityId!,
						leadId: input.leadId,
					});
				} catch (error) {
					if (
						error instanceof DocumentIntegrityError ||
						error instanceof BankStatementCoverageSaveError
					) {
						throw new ORPCError("PRECONDITION_FAILED", {
							message: error.message,
						});
					}
					throw error;
				}
			} else {
				const [coDebtorAnalysis] = await db
					.delete(creditAnalysis)
					.where(eq(creditAnalysis.coDebtorId, input.coDebtorId!))
					.returning({ id: creditAnalysis.id });
				deleted = coDebtorAnalysis ?? null;
			}

			if (!deleted) {
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
						sql<Date>`min(${opportunityStageHistory.changedAt})`
							.mapWith(opportunityStageHistory.changedAt)
							.as("first_closed_stage_at"),
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
						sql<Date>`max(${opportunityStageHistory.changedAt})`
							.mapWith(opportunityStageHistory.changedAt)
							.as("latest_stage_changed_at"),
				})
				.from(opportunityStageHistory)
				.groupBy(opportunityStageHistory.opportunityId)
				.as("latest_stage_history");

			const closedAtExpression =
				sql<Date | null>`coalesce(${firstClosedStageDates.firstClosedStageAt}, ${opportunities.actualCloseDate})`.mapWith(
					opportunities.actualCloseDate,
				);

			const selectFields = {
				id: opportunities.id,
				title: opportunities.title,
				vehicleId: opportunities.vehicleId,
				vendorId: opportunities.vendorId,
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
					sql<Date>`coalesce(${latestStageHistory.latestStageChangedAt}, ${opportunities.createdAt})`
						.mapWith(opportunities.createdAt)
						.as("latest_stage_changed_at"),
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
				diaPagoOriginalSistema: opportunities.diaPagoOriginalSistema,
				// Additional credit fields
				seguro: opportunities.seguro,
				gps: opportunities.gps,
				insuranceProvider: opportunities.insuranceProvider,
				customerInsuranceCost: opportunities.customerInsuranceCost,
				internalInsuranceCost: opportunities.internalInsuranceCost,
				insuranceSavingsToMembership:
					opportunities.insuranceSavingsToMembership,
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
					razonSocial: companies.razonSocial,
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
					vendorId: vehicles.vendorId,
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
		.meta({ audit: { entity: "opportunity", action: "delete" } })
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

			await auditedTransaction(async (tx) => {
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
						diaPagoOriginalSistema: opportunities.diaPagoOriginalSistema,
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

				// Se necesita antes del snapshot (para archivar las verificaciones) y
				// antes del delete de abajo (para no reventar la FK NO ACTION) — una
				// sola consulta para ambos usos.
				const opportunityCoDebtors = await tx
					.select({ id: coDebtors.id })
					.from(coDebtors)
					.where(eq(coDebtors.opportunityId, input.opportunityId));

				const licenseVerificationCondition = or(
					eq(licenseQrVerifications.opportunityId, input.opportunityId),
					opportunityCoDebtors.length > 0
						? inArray(
								licenseQrVerifications.coDebtorId,
								opportunityCoDebtors.map((c) => c.id),
							)
						: undefined,
				);

				// Se archivan las filas completas ANTES de borrarlas — si no, borrar
				// una oportunidad temprana destruye para siempre la trazabilidad
				// (QR, respuesta de Tránsito, motivo de fallo) que este feature
				// existe para conservar.
				const licenseVerificationRows = await tx
					.select()
					.from(licenseQrVerifications)
					.where(licenseVerificationCondition);

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
					licenseVerifications: licenseVerificationRows.map((row) => ({
						id: row.id,
						subjectType: row.leadId ? ("lead" as const) : ("coDebtor" as const),
						subjectId: (row.leadId ?? row.coDebtorId)!,
						result: row.result,
						qrRawUrl: row.qrRawUrl,
						qrDomainValid: row.qrDomainValid,
						cardCode: row.cardCode,
						apiResponseCode: row.apiResponseCode,
						licenseHolderName: row.licenseHolderName,
						licenseNumber: row.licenseNumber,
						licenseExpiresAt: row.licenseExpiresAt,
						identityMatchScore: row.identityMatchScore,
						failureReason: row.failureReason,
						documentKey: row.documentKey,
						rawResponse: row.rawResponse,
						createdAt: row.createdAt,
						createdBy: row.createdBy,
					})),
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

				// FK NO ACTION: sin este delete, el de abajo revienta si hay
				// verificaciones asociadas. Ya se archivaron arriba (licenseVerificationRows)
				// antes de llegar acá.
				await tx
					.delete(licenseQrVerifications)
					.where(licenseVerificationCondition);

				await tx
					.delete(opportunities)
					.where(eq(opportunities.id, input.opportunityId));
				auditRecord({
					entity: "opportunity",
					id: input.opportunityId,
					action: "delete",
				});
			});

			return { message: "Oportunidad eliminada exitosamente" };
		}),

	createOpportunity: crmProcedure
		.meta({ audit: { entity: "opportunity", action: "create" } })
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

			// 🔴 Una oportunidad no puede NACER por encima del umbral del candado.
			//
			// El candado de identidad —el del DPI y el del `leadId`— se apoya en dos
			// señales: la etapa de hoy y la más alta que la oportunidad tocó, según
			// `opportunity_stage_history`. Nacer directamente en una etapa candante
			// dejaba el expediente arriba del umbral SIN la fila de historial que lo
			// prueba: bastaba bajarlo al 30% —una sola fila `from=40, to=30`— para
			// que el máximo histórico diera 30, el candado se abriera, se colgara
			// otro lead, y volver a subir. `ALTURA_DE_LA_TRANSICION` arregla la
			// lectura de esa fila; este tope saca la precondición, para que por esta
			// puerta el expediente no llegue a existir arriba del umbral.
			//
			// El tope no rompe ningún flujo vivo: el selector "Etapa Inicial" del CRM
			// solo ofrece etapas de 1% a 20% y la conversión desde leads crea siempre
			// en el 1%. Los nacimientos legítimos por encima del umbral —la migración
			// automática de créditos de Cartera-Back, que nace en la última etapa, y
			// los seeds— insertan directo en la base y no pasan por este procedure.
			//
			// De paso, buscar la etapa da un 400 claro cuando el `stageId` no existe,
			// que hasta ahora reventaba recién contra la foreign key.
			const [etapaInicial] = await db
				.select({
					name: salesStages.name,
					closurePercentage: salesStages.closurePercentage,
				})
				.from(salesStages)
				.where(eq(salesStages.id, input.stageId))
				.limit(1);

			if (!etapaInicial) {
				throw new ORPCError("BAD_REQUEST", {
					message: "La etapa inicial seleccionada no existe.",
				});
			}

			if (etapaInicial.closurePercentage > PORCENTAJE_CANDADO_DPI) {
				throw new ORPCError("BAD_REQUEST", {
					message: `No se puede crear una oportunidad directamente en ${etapaInicial.name} (${etapaInicial.closurePercentage}%): a partir del ${PORCENTAJE_CANDADO_DPI}% el expediente queda con la identidad congelada, y nacer ahí lo dejaría sin el rastro de por dónde pasó. Creála en una etapa inicial y avanzála.`,
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
			auditRecord({
				entity: "opportunity",
				id: newOpportunity[0].id,
				action: "create",
			});
			return { ...newOpportunity[0], warning: false as const };
		}),

	updateOpportunity: crmProcedure
		.meta({ audit: { entity: "opportunity", action: "update" } })
		.input(
			z
				.object({
					id: z.string().uuid(),
					title: z.string().min(1, "Title is required").optional(),
					leadId: z.string().uuid().nullable().optional(),
					companyId: z.string().uuid().nullable().optional(),
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
					// Vehicle vendor. Sigue siendo opcional: null lo desasigna, y
					// permite corregirlo cuando no se eligió al crear la oportunidad.
					vendorId: z.string().uuid().nullable().optional(),
					// Credit terms
					numeroCuotas: z.number().int().positive().optional(),
					tasaInteres: z.string().optional(),
					cuotaMensual: z.string().optional(),
					fechaInicio: z.string().optional(),
					diaPagoMensual: z.number().int().min(1).max(31).optional(),
					// Marca si el día viene de la opción "recomendado por IA" del select,
					// aunque coincida numéricamente con 15/30. Se revalida server-side
					// contra suggestedPaymentDays. Requerido cuando se envía diaPagoMensual
					// (ver .refine() abajo). No es columna de opportunities — se destructura
					// fuera de updateData más abajo.
					elegidoDesdeRecomendacionIA: z.boolean().optional(),
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
				})
				.refine(
					(data) =>
						data.diaPagoMensual === undefined ||
						data.elegidoDesdeRecomendacionIA !== undefined,
					{
						message:
							"elegidoDesdeRecomendacionIA es requerido cuando se envía diaPagoMensual",
						path: ["elegidoDesdeRecomendacionIA"],
					},
				),
		)
		.handler(async ({ input, context }) => {
			const {
				id,
				assignedTo,
				companyId,
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
				elegidoDesdeRecomendacionIA,
				...updateDataWithoutCompany
			} = input;
			const updateData = {
				...updateDataWithoutCompany,
				...buildOpportunityCompanyPatch(companyId),
			};

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

			// Una oportunidad pasa a "won" en el 90% y de ahí todavía avanza al 100%
			// con ajustes operativos, así que no se congela el update completo: solo
			// los datos con los que se firmaron los contratos.
			const frozenFieldChanges = getWonOpportunityFrozenFieldChanges(
				input,
				currentOpportunity[0],
			);
			const wonLockError = getWonOpportunityLockError(
				currentOpportunity[0].status,
				context.userRole,
				frozenFieldChanges,
			);
			if (wonLockError) {
				throw new ORPCError("FORBIDDEN", { message: wonLockError });
			}
			// El chequeo de arriba leyó la fila antes del UPDATE: si closeOpportunity
			// la marca ganada en el medio, el cambio entraría igual. Cuando se tocan
			// campos congelados, el predicado lo vuelve a exigir en la misma
			// sentencia (Postgres lo re-evalúa tras esperar a la escritura rival).
			const enforceNotWonInPredicate =
				frozenFieldChanges.length > 0 &&
				!PERMISSIONS.canAccessAdmin(context.userRole ?? "");

			if (input.leadId === null) {
				const [currentStageForLead] = await db
					.select({ closurePercentage: salesStages.closurePercentage })
					.from(salesStages)
					.where(eq(salesStages.id, currentOpportunity[0].stageId))
					.limit(1);
				const leadRequirementError = getStageLeadRequirementError(
					currentStageForLead?.closurePercentage ?? 0,
					input.leadId,
				);

				if (leadRequirementError) {
					throw new ORPCError("BAD_REQUEST", {
						message: leadRequirementError,
					});
				}
			}

			// 🔴 Cambiar `leadId` cambia la identidad del expediente sin tocar
			// ningún DPI, así que no lo veía ni el candado (que protege al lead) ni
			// el gate de mora (que no se llama desde acá). Ver
			// `mensajeCandadoCambioDeLead` para el agujero completo.
			//
			// Desasignar (`null`) también cuenta: es la primera mitad de la maniobra
			// en dos pasos —soltar el lead ahora, colgar otro después—, y por sí
			// sola ya deja el expediente avanzado sin dueño. Cualquier valor
			// distinto del actual paga lo mismo.
			//
			// `!== undefined` y no `"leadId" in input`: los formularios reenvían el
			// objeto entero y un `leadId: undefined` significa "no lo toqué", no
			// "desasignalo". Es el mismo criterio que ya usaba `leadIdCambio` más
			// abajo, que ahora se lee de acá para que no se separen.
			const cambiaElLeadDeLaOportunidad =
				input.leadId !== undefined &&
				input.leadId !== currentOpportunity[0].leadId;

			/**
			 * El formulario reenvía el `leadId` que la oportunidad YA tenía.
			 *
			 * `cambiaElLeadDeLaOportunidad` compara contra la fila LEÍDA, así que ese
			 * request da falso y no corre nada del candado: ni la etapa, ni la
			 * evidencia, ni la invalidación de identidad. Si además el campo viajara
			 * en el `SET`, sería el rebote: el request A lee la oportunidad con el
			 * lead X, el request B se la cambia a Y pagando todas las guardas, y
			 * después A aterriza y reescribe `lead = X` por un camino sin candado,
			 * deshaciendo el cambio de B y dejando pegada la invalidación que B pagó.
			 * `expectedUpdatedAt` es opcional, así que tampoco lo frena.
			 *
			 * ⚠️ Hoy ese campo NO llega al `SET`, pero por prestado:
			 * `stripUnchangedFrozenFields` lo saca porque `leadId` está en
			 * `WON_OPPORTUNITY_FROZEN_FIELD_LABELS`, o sea por ser dato congelado de
			 * una oportunidad ganada, no por ser la identidad del expediente. El día
			 * que alguien saque al cliente de esa lista —no es un término del
			 * contrato, es un argumento razonable— el rebote se abre solo y sin que
			 * nada lo señale. Por eso la bandera existe y se aplica acá también: la
			 * protección de la identidad no puede depender de la lista de otro guard.
			 *
			 * Se saca del `SET` en vez de exigirlo en el WHERE: escribir el mismo
			 * valor que se leyó no aporta nada, y un predicado sobre el lead vivo
			 * para CUALQUIER request que traiga el campo le haría fallar el guardado
			 * al asesor cada vez que otro corrigiera el cliente en paralelo —los
			 * formularios de este CRM reenvían el objeto entero, así que lo pagarían
			 * todas las ediciones, no las que cambian el cliente—. El predicado sí
			 * va, pero sólo en el camino donde el lead de verdad cambia: ver
			 * `elLeadVivoSigueSiendoElLeido`.
			 */
			const reenvioDelMismoLead =
				input.leadId !== undefined && !cambiaElLeadDeLaOportunidad;

			if (cambiaElLeadDeLaOportunidad) {
				// 🔴 Lo que decide es la etapa EFECTIVA de destino —`input.stageId` si
				// viene, y si no la guardada—, no sólo el estado persistido.
				//
				// Mirando nada más lo guardado, un SOLO request que cambiara `leadId`
				// Y `stageId` a la vez cruzaba el candado entero: una oportunidad en el
				// 30% con el análisis aprobado para el lead A recibía
				// `{ leadId: B, stageId: <etapa 40%> }`, el chequeo veía 30 —el que la
				// sube por encima del umbral es ESTE MISMO UPDATE— y la sentencia
				// reemplazaba al cliente y cruzaba el umbral de una, conservando la
				// aprobación y la evidencia (RENAP, buró, documentos) de A. Es la
				// maniobra en dos pasos que este candado cerró, comprimida en uno.
				//
				// La consulta extra sólo la paga el request que ADEMÁS mueve la etapa
				// mientras cambia el lead, que es el caso raro.
				const [etapaDestino] = input.stageId
					? await db
							.select({
								name: salesStages.name,
								closurePercentage: salesStages.closurePercentage,
							})
							.from(salesStages)
							.where(eq(salesStages.id, input.stageId))
							.limit(1)
					: [];

				// La misma consulta y el mismo predicado que usa el candado del DPI:
				// una sola fila, la de esta oportunidad. `etapaQueCanda` ya deja
				// pasar a las `lost` —que no candan por decisión de producto— y esas
				// pagan su costo al reabrirse, con `parcheDeRevalidacion`.
				const candante = etapaQueCanda(
					(await obtenerOportunidadesParaCandadoDpi({ opportunityId: id })).map(
						(oportunidad) => conLaEtapaDeDestino(oportunidad, etapaDestino),
					),
				);

				if (candante) {
					throw new ORPCError("FORBIDDEN", {
						message: mensajeCandadoCambioDeLead(candante),
					});
				}

				// 🔴 El candado de arriba mira la ETAPA, y por debajo del umbral deja
				// pasar el cambio cobrando `parcheDeIdentidadInvalidada`. Ese parche
				// invalida la aprobación y los documentos de identidad, pero NO los
				// comprobantes de ingresos, estados de cuenta, recibos ni formularios
				// del cliente anterior, que sobreviven y vuelven a aprobar el
				// expediente bajo otra persona. Ver `evidenciaAcumuladaDelExpediente`.
				//
				// Las perdidas NO están exceptuadas: la marca de revalidación que
				// cobra la reapertura sólo caduca los documentos de identidad, así que
				// «perder y reabrir» era el mismo agujero en tres pasos.
				const evidenciaDelExpediente = await evidenciaAcumuladaDelExpediente({
					opportunityId: id,
				});

				if (evidenciaDelExpediente.length > 0) {
					throw new ORPCError("FORBIDDEN", {
						message: mensajeCambioDeLeadConEvidencia(evidenciaDelExpediente),
					});
				}
			}

			// diaPagoMensual solo puede ser 15, 30, o uno de los días recomendados
			// por el análisis de esta oportunidad Y del lead que quedará asignado
			// (si leadId también cambia, el análisis del lead anterior ya no aplica).
			//
			// diaPagoOriginalSistema (día que el sistema hubiera asignado por
			// default) se recalcula cuando diaPagoMensual cambia por esta vía, o
			// cuando cambia la intención con el mismo día (el flag entrante difiere
			// de si el estado actual ya implica IA). Se compara contra el valor y el
			// flag ACTUALES en DB, no solo contra "input presente": los forms
			// (opportunities.tsx, CreditDetailView) reenvían diaPagoMensual en cada
			// guardado reflejando el estado vigente, así que un guardado que no
			// tocó este campo nunca dispara una recaptura accidental.
			const cambioDeIntencion =
				input.diaPagoMensual !== undefined &&
				input.elegidoDesdeRecomendacionIA !==
					(currentOpportunity[0].diaPagoOriginalSistema != null);
			// Si leadId cambia, revalidar aunque día/flag no cambien (analisis del lead anterior ya no aplica).
			const leadIdCambio = cambiaElLeadDeLaOportunidad;
			const requiereCongelarEtapa =
				input.diaPagoMensual !== undefined &&
				requiereCongelarEtapaParaCambioDia(
					input.diaPagoMensual !== currentOpportunity[0].diaPagoMensual,
					cambioDeIntencion,
					leadIdCambio,
				);
			let diaPagoOriginalSistemaUpdate: number | null | undefined;
			if (requiereCongelarEtapa) {
				const [paymentDayStage] = await db
					.select({ closurePercentage: salesStages.closurePercentage })
					.from(salesStages)
					.where(eq(salesStages.id, currentOpportunity[0].stageId))
					.limit(1);
				if (
					!paymentDayStage ||
					!puedeCambiarDiaPago(paymentDayStage.closurePercentage)
				) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"El día de pago no puede cambiar después de asignar inversionistas",
					});
				}

				const effectiveLeadId =
					"leadId" in input ? input.leadId : currentOpportunity[0].leadId;
				// Se consulta sin importar si el día es 15/30: esDiaIA (más abajo)
				// necesita saber si la IA recomendó justo ese día aunque no requiera
				// validación contra suggestedDays.
				let suggestedDays: Array<{ dia: number; porcentaje: number }> | null =
					null;
				if (effectiveLeadId) {
					const [analysis] = await db
						.select({
							suggestedPaymentDays: creditAnalysis.suggestedPaymentDays,
						})
						.from(creditAnalysis)
						.where(
							and(
								eq(creditAnalysis.opportunityId, id),
								eq(creditAnalysis.leadId, effectiveLeadId),
							),
						)
						.limit(1);
					suggestedDays = analysis?.suggestedPaymentDays ?? null;
				}

				if (input.diaPagoMensual !== 15 && input.diaPagoMensual !== 30) {
					const isRecommended = suggestedDays?.some(
						(d) => d.dia === input.diaPagoMensual,
					);
					if (!isRecommended) {
						throw new ORPCError("BAD_REQUEST", {
							message:
								"El día de pago mensual debe ser 15, 30, o uno de los días recomendados por el análisis de capacidad de pago",
						});
					}
				}

				// No 15/30 ya probó su origen IA al pasar la validación de arriba.
				const esDiaIA =
					input.diaPagoMensual !== 15 && input.diaPagoMensual !== 30
						? true
						: elegidoDesdeRecomendacionIA &&
							(suggestedDays?.some((d) => d.dia === input.diaPagoMensual) ??
								false);
				diaPagoOriginalSistemaUpdate = esDiaIA
					? getDiaPagoOriginalSistema()
					: null;
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
				const effectiveLeadId =
					"leadId" in input ? input.leadId : currentOpportunity[0].leadId;
				const effectiveVehicleId =
					input.vehicleId !== undefined
						? input.vehicleId
						: currentOpportunity[0].vehicleId;
				const vehicleRequirementError =
					input.stageId !== currentOpportunity[0].stageId
						? getStageVehicleRequirementError(
								fromPercentage,
								toPercentage,
								effectiveVehicleId,
							)
						: null;

				if (vehicleRequirementError) {
					throw new ORPCError("BAD_REQUEST", {
						message: vehicleRequirementError,
					});
				}

				const leadRequirementError = getStageLeadRequirementError(
					toPercentage,
					effectiveLeadId,
				);
				if (leadRequirementError) {
					throw new ORPCError("BAD_REQUEST", {
						message: leadRequirementError,
					});
				}

				// Bloquear cualquier retroceso una vez alcanzada Formalización Final (90%+)
				if (fromPercentage >= 90 && toPercentage < fromPercentage) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"La oportunidad ya alcanzó Formalización Final (90%) y no puede retroceder de etapa.",
					});
				}

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
					if (effectiveLeadId) {
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
							.where(eq(leads.id, effectiveLeadId))
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

			// Sales users can only update opportunities assigned to them.
			// Admin and sales_supervisor can update any opportunity.
			const canUpdateOpportunity =
				context.userRole === "admin" ||
				context.userRole === "sales_supervisor" ||
				currentOpportunity[0].assignedTo === context.userId;
			const baseWhereClause =
				context.userRole === "admin" || context.userRole === "sales_supervisor"
					? eq(opportunities.id, id)
					: and(
							eq(opportunities.id, id),
							eq(opportunities.assignedTo, context.userId),
						);

			// PostgreSQL re-evaluates this predicate after waiting for a concurrent
			// row update, so lead/stage edits cannot jointly persist an invalid state.
			//
			// 🔴 El `leadId` entra al invariante sólo si de verdad viaja en el `SET`.
			// Cuando es el reenvío del mismo valor no viaja (ver
			// `reenvioDelMismoLead`), y evaluar el invariante contra el literal del
			// formulario mientras la columna queda como está era dar por bueno lo que
			// no se iba a escribir: si otro request dejó la oportunidad sin cliente,
			// el `$1::uuid IS NOT NULL` pasaba igual y la misma sentencia la subía a
			// 80% o más sin cliente, que es justo lo que este invariante prohíbe.
			// Omitiéndolo, el predicado mira la columna VIVA, que es el valor con el
			// que la fila va a quedar.
			const relationshipInvariantCondition =
				buildOpportunityRelationshipInvariantCondition({
					...(input.stageId ? { stageId: input.stageId } : {}),
					...("leadId" in input && !reenvioDelMismoLead
						? { leadId: input.leadId }
						: {}),
				});
			const invariantWhereClause = requiereCongelarEtapa
				? and(
						baseWhereClause,
						relationshipInvariantCondition,
						eq(opportunities.stageId, currentOpportunity[0].stageId),
					)
				: and(baseWhereClause, relationshipInvariantCondition);
			const wonLockWhereClause = enforceNotWonInPredicate
				? and(invariantWhereClause, not(eq(opportunities.status, "won")))
				: invariantWhereClause;
			// El chequeo de arriba leyó la fila antes del UPDATE: entre la lectura y
			// la escritura otra transacción puede subir la oportunidad por encima del
			// 30% y el lead nuevo entraría igual. Postgres re-evalúa el predicado
			// después de esperar a la escritura rival, así que la condición viaja
			// dentro de la misma sentencia. Solo cuando el lead cambia: ninguna otra
			// edición tiene por qué pagarlo.
			//
			// 🔴 La etapa de destino viaja ADENTRO del predicado, no sólo en el
			// chequeo de arriba. Sin ella, el `not exists` leía el estado persistido
			// —todavía por debajo del umbral, porque el que lo cruza es esta misma
			// sentencia— y dejaba pasar el cambio de lead que sube de etapa en el
			// mismo viaje. Es la contraparte SQL de `conLaEtapaDeDestino`.
			//
			// Lo mismo vale para la evidencia acumulada: el chequeo de arriba la
			// leyó antes del UPDATE, y entre la lectura y la escritura el analista
			// puede subir un documento o terminar el formulario. La condición viaja
			// también adentro (`elExpedienteNoAcumulaEvidencia`).
			//
			// 🔴 Y el cambio se aplica sobre el lead que SE LEYÓ, no sobre el que
			// haya quedado. Entre la lectura y la escritura otro request pudo
			// cambiar el cliente: sin esto el segundo lo pisa sin que sus guardas
			// hayan visto ese estado, y la bitácora anota un `leadAnterior` que ya
			// no era el real. Cero filas ⇒ CONFLICT, que es exactamente lo que
			// pasó. Sólo en este camino: la edición que no cambia el cliente no
			// paga nada, porque ya ni siquiera escribe el campo.
			const elLeadVivoSigueSiendoElLeido =
				currentOpportunity[0].leadId === null
					? isNull(opportunities.leadId)
					: eq(opportunities.leadId, currentOpportunity[0].leadId);
			const leadSwapWhereClause = cambiaElLeadDeLaOportunidad
				? and(
						wonLockWhereClause,
						elLeadVivoSigueSiendoElLeido,
						noExisteOportunidadCandantePorId(id, input.stageId),
						elExpedienteNoAcumulaEvidencia(id),
					)
				: wonLockWhereClause;
			const whereClause = expectedUpdatedAt
				? and(
						leadSwapWhereClause,
						eq(opportunities.updatedAt, new Date(expectedUpdatedAt)),
					)
				: leadSwapWhereClause;

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

			const currentInsuranceProvider =
				currentOpportunity[0].insuranceProvider ?? "universales";
			const insuranceFallback =
				seguro !== undefined
					? {
							insuranceProvider: currentInsuranceProvider,
							customerInsuranceCost: String(seguro),
							internalInsuranceCost:
								currentInsuranceProvider === "gyt"
									? currentOpportunity[0].internalInsuranceCost
									: String(seguro),
							insuranceSavingsToMembership:
								currentInsuranceProvider === "gyt"
									? currentOpportunity[0].insuranceSavingsToMembership
									: "0",
						}
					: {};

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

			// Se saca SIEMPRE, no solo si la lectura la vio ganada: reescribir un
			// campo congelado con el mismo valor que se acaba de leer no aporta
			// nada, y si en el medio la oportunidad se gana y alguien lo corrige,
			// esta sentencia le pisaría la corrección con un dato ya viejo.
			// 🔴 Reabrir una perdida avanzada vuelve a mandarla a análisis.
			//
			// Las oportunidades `lost` NO candan el DPI, y eso es deliberado: un
			// crédito que no se dio no puede dejar al cliente con el DPI fijo para
			// siempre. Pero entonces, mientras está perdida, el DPI se puede
			// cambiar. Reabrirla con la etapa avanzada intacta dejaba RENAP, buró y
			// los documentos pegados a lo que se validó ANTES de perderse: si el DPI
			// cambió en el medio, el expediente miente. La escapatoria completa era
			// perder la oportunidad, cambiar el DPI y reabrirla.
			//
			// No se prohíbe reabrir: se le pone precio. Reabrir cuesta re-validar, y
			// así la maniobra deja de pagar.
			//
			// El reset viaja en ESTE MISMO UPDATE, junto al cambio de status: en dos
			// sentencias quedaría una ventana con la oportunidad ya reabierta y
			// todavía marcada como validada.
			// 🔴 CUALQUIER salida de `lost`, no solo `lost → open`: el schema admite
			// `on_hold` y en dos saltos (`lost → on_hold → open`) la revalidación no
			// se disparaba nunca. Ver `saleDeLaPerdida`.
			const reabreUnaPerdida = saleDeLaPerdida(
				currentOpportunity[0].status,
				updateData.status,
			);

			let parcheRevalidacion: ReturnType<typeof parcheDeRevalidacion> | null =
				null;
			/** La etapa a la que vuelve, para la fila de `opportunityStageHistory`. */
			let etapaDeAnalisisId: string | null = null;
			let decisionRevalidacion: DecisionRevalidacion = { tipo: "nada" };
			let oportunidadRevalidada: OportunidadParaRevalidar | null = null;

			if (reabreUnaPerdida) {
				// La señal del candado: ¿cruzó el 30% hoy o alguna vez? Se pregunta
				// por la oportunidad concreta, así que trae una sola fila.
				const [comoEsta] = await obtenerOportunidadesParaCandadoDpi({
					opportunityId: id,
				});

				if (comoEsta) {
					// La decisión se toma sobre el status al que VUELVE, no sobre el
					// "lost" del que sale: es el estado con el que va a quedar. Y es el
					// status REAL de la request, no un "open" fijo — con `lost → won`
					// la salvaguarda de las ganadas tiene que poder reconocerla.
					oportunidadRevalidada = {
						...comoEsta,
						status: updateData.status ?? comoEsta.status,
					};
					decisionRevalidacion = decidirRevalidacion(oportunidadRevalidada);

					if (decisionRevalidacion.tipo === "resetear") {
						const etapaDeAnalisis = await obtenerEtapaDeAnalisis();
						if (etapaDeAnalisis) {
							parcheRevalidacion = parcheDeRevalidacion(etapaDeAnalisis.id);
							etapaDeAnalisisId = etapaDeAnalisis.id;
						} else {
							// 🔴 Sin etapa de análisis no hay a dónde mandarla, y eso es un
							// FALLO: seguir dejaba la perdida REABIERTA con su validación
							// vieja intacta, que es justo la escapatoria que este reset
							// existe para cerrar. Mismo criterio que
							// `revalidarOportunidades`: o se revalida, o no se cambia.
							throw new ErrorRevalidacionIncompleta(
								`No se pudo revalidar la identidad al reabrir la oportunidad: no existe la etapa de análisis (closurePercentage=${PORCENTAJE_ETAPA_ANALISIS}). La reapertura no se aplicó.`,
							);
						}
					}
				}
			}

			const safeUpdateData = stripUnchangedFrozenFields(
				updateData,
				currentOpportunity[0],
			);
			// Ver `reenvioDelMismoLead`: el valor que reenvió el formulario es el
			// mismo que se leyó, así que escribirlo no cambia nada de esta fila y lo
			// único que podría lograr es pisar el cambio de al lado por un camino sin
			// candado. Hoy la línea es redundante —`stripUnchangedFrozenFields` ya lo
			// sacó, por estar `leadId` en la lista de campos congelados— y es a
			// propósito: acá se saca por identidad, y así sigue saliendo aunque esa
			// lista cambie por razones de contratos, que no son éstas.
			if (reenvioDelMismoLead) delete safeUpdateData.leadId;

			/**
			 * 🔴 Cambiar el lead cuesta revalidar SIEMPRE, no sólo pasado el umbral.
			 *
			 * El candado bloquea el cambio de lead a partir del 30%, pero EN el 30%
			 * lo deja pasar a propósito —la comparación es `> 30`— y hasta ahora
			 * pasar no invalidaba nada: `leadId` se reemplazaba y `analysisStatus`,
			 * `creditDetailApproved` e `identityRevalidatedAt` quedaban intactos. La
			 * maniobra se partía en dos peticiones que, una por una, son legales:
			 *
			 * 1. Oportunidad en EXACTAMENTE 30% con `analysisStatus: "approved"`. Se
			 *    cambia SÓLO el lead → pasa, porque 30 no canda.
			 * 2. Otra petición mueve SÓLO la etapa al 40% → pasa, porque no se toca
			 *    el lead.
			 *
			 * El lead nuevo heredaba el expediente aprobado del anterior —RENAP,
			 * buró, documentos y análisis de capacidad de pago de otra persona— y de
			 * ahí seguía a Formalización con `approveCreditDetail`. Es la tercera
			 * variante del mismo bypass, después de la del historial y la del
			 * request único que cambia lead y etapa a la vez.
			 *
			 * No se prohíbe el cambio en toda etapa: se le pone precio, igual que a
			 * reabrir una perdida o al override del admin. Operaciones tiene que
			 * poder corregir un lead mal asignado en etapas tempranas sin perder la
			 * oportunidad y reabrirla, y ahí el parche no cuesta nada porque todavía
			 * no hay nada aprobado que invalidar; sólo pesa cuando de verdad lo hay.
			 *
			 * 🔴 Se aplica INCONDICIONALMENTE cuando el lead cambia, y no bajo un
			 * `if (analysisStatus === "approved" || creditDetailApproved)` de este
			 * lado, por dos razones. Una, ese `if` miraría la foto leída antes del
			 * UPDATE: una aprobación que entrara en el medio sobreviviría al cambio
			 * de lead, que es la misma carrera que el resto del candado cierra
			 * metiendo la condición en la sentencia. Y dos, `creditDetailApproved`
			 * admite NULL en las filas viejas, así que un predicado `= false` las
			 * dejaría justo afuera. Lo que decide qué se degrada es el `case` de
			 * `parcheDeIdentidadInvalidada`, que lo evalúa la fila VIVA al escribir.
			 *
			 * Va en el MISMO `.set()` que escribe `leadId`: es UNA sentencia, así que
			 * no existe una ventana en la que el cliente nuevo esté puesto y la
			 * aprobación vieja siga en pie.
			 *
			 * ⚠️ SIN el retroceso de etapa de `parcheDeRevalidacion`: acá la
			 * oportunidad está en 30% o menos —más arriba el candado ya bloqueó—, así
			 * que mandarla a la etapa de análisis la haría AVANZAR, no retroceder, y
			 * una de 10% terminaría en la cola del analista sin haber pasado por
			 * ventas. El único caso que sí llega hasta acá por encima del 30% es la
			 * oportunidad `lost` (las perdidas no candan, por decisión de producto),
			 * y ésa paga el retroceso completo al reabrirse, más abajo.
			 */
			const invalidacionPorCambioDeLead = cambiaElLeadDeLaOportunidad
				? parcheDeIdentidadInvalidada()
				: {};

			// La reapertura y su fila de transición van en UNA transacción: el
			// timeline no puede quedar sin el retroceso que sí se escribió.
			const updatedOpportunity = await auditedTransaction(async (tx) => {
				// 🔴 La reapertura no puede aplicar un parche calculado sobre una foto
				// vieja: sin `expectedUpdatedAt`, entre el cálculo y este UPDATE otra
				// transacción pudo reabrir y avanzar la misma fila (≥90% o won), y el
				// reset la regresaría igual — con la fila de historial registrando un
				// `fromStageId` que ya no era el real. Lock + relectura bajo el lock:
				// si la premisa murió, se falla claro en vez de escribir sobre viejo.
				let etapaRealAntesDelReset = currentOpportunity[0].stageId;
				if (parcheRevalidacion) {
					const [bajoLock] = await tx
						.select({
							status: opportunities.status,
							stageId: opportunities.stageId,
							pct: salesStages.closurePercentage,
						})
						.from(opportunities)
						.innerJoin(salesStages, eq(salesStages.id, opportunities.stageId))
						.where(eq(opportunities.id, id))
						.for("update", { of: opportunities });

					if (!bajoLock || bajoLock.status !== "lost" || bajoLock.pct >= 90) {
						throw new ORPCError("CONFLICT", {
							message:
								"La oportunidad cambió mientras se editaba y la reapertura ya no aplica tal como se calculó. Recarga y volvé a intentar.",
						});
					}
					etapaRealAntesDelReset = bajoLock.stageId;
				}

				const filas = await tx
					.update(opportunities)
					.set({
						...safeUpdateData,
						...(assignedTo && { assignedTo }),
						...(expectedCloseDate && {
							expectedCloseDate: new Date(expectedCloseDate),
						}),
						// `fechaInicio` se destructura fuera de `updateData`, así que
						// `stripUnchangedFrozenFields` no la ve: se omite acá cuando no
						// cambia, para no reescribir un campo congelado con el mismo valor.
						...(fechaInicio &&
							frozenFieldChanges.includes("fechaInicio") && {
								fechaInicio: new Date(fechaInicio),
							}),
						// Convert numeric fields to strings for decimal columns
						...(seguro !== undefined && { seguro: String(seguro) }),
						...insuranceFallback,
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
						...(diaPagoOriginalSistemaUpdate !== undefined && {
							diaPagoOriginalSistema: diaPagoOriginalSistemaUpdate,
						}),
						// El precio de cambiar el lead; ver `invalidacionPorCambioDeLead`.
						// ⚠️ La línea de abajo va DESPUÉS a propósito: si el mismo request
						// además manda la oportunidad al 30%, ese valor es el que
						// corresponde —`pending` o `resubmitted`, nunca `approved`— y pisa
						// al `case` sin devolverle la aprobación a nadie.
						...invalidacionPorCambioDeLead,
						// Update analysisStatus if it changed during stage transition
						...(newAnalysisStatus !== currentOpportunity[0].analysisStatus && {
							analysisStatus: newAnalysisStatus,
						}),
						...(updateData.status === "won" && { actualCloseDate: new Date() }),
						// Va al final a propósito: si la reapertura manda a análisis, eso
						// gana sobre cualquier `stageId` que venga en la misma request. La
						// revalidación no es negociable en el mismo viaje que la dispara.
						...(parcheRevalidacion ?? {}),
						updatedAt: new Date(),
					})
					.where(whereClause)
					.returning();

				// 🔴 El reset cambiaba `stageId` sin dejar la transición: para los
				// timelines y para `latestStageChangedAt` la oportunidad seguía en la
				// etapa avanzada, así que el retroceso era invisible y el tiempo en
				// etapa se seguía contando desde una transición que ya no era la real.
				if (parcheRevalidacion && etapaDeAnalisisId && filas.length > 0) {
					await tx.insert(opportunityStageHistory).values({
						opportunityId: id,
						// La etapa leída BAJO el lock, no la del snapshot de la request.
						fromStageId: etapaRealAntesDelReset,
						toStageId: etapaDeAnalisisId,
						changedBy: context.userId,
						reason: `${RAZON_TRANSICION_REVALIDACION}: se reabrió una oportunidad perdida que ya había cruzado el 30%`,
						isOverride: false,
					});
				}

				return filas;
			});
			if (updatedOpportunity.length === 0) {
				if (enforceNotWonInPredicate) {
					// Pudo ser la carrera con closeOpportunity: distinguirlo del
					// conflicto de concurrencia para no mandar a "recargá e intentá".
					const [latest] = await db
						.select({ status: opportunities.status })
						.from(opportunities)
						.where(eq(opportunities.id, id))
						.limit(1);
					if (latest?.status === "won") {
						throw new ORPCError("FORBIDDEN", {
							message: buildWonOpportunityFrozenFieldError(frozenFieldChanges),
						});
					}
				}
				if (canUpdateOpportunity) {
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

			// Después del chequeo de conflicto: con cero filas no hubo escritura.
			auditRecord({ entity: "opportunity", id: id, action: "update" });

			// El cambio de lead deja su propia fila. Sin esto, quien encuentre el
			// expediente de vuelta sin aprobación ve un retroceso sin causa y parece
			// un error de alguien; y al revés, un cambio de identidad de un
			// expediente avanzado es exactamente lo que se va a querer buscar
			// después.
			if (cambiaElLeadDeLaOportunidad) {
				auditRecord({
					entity: "opportunity",
					id,
					action: "cambio_de_lead_revalidacion",
					data: {
						leadAnterior: currentOpportunity[0].leadId,
						leadNuevo: input.leadId ?? null,
						detalle:
							"se cambió el cliente de la oportunidad; la validación de identidad (RENAP/buró/documentos/análisis) que había era del cliente anterior",
						resultado:
							"analysisStatus vuelve a pending si estaba aprobado, detalle de crédito sin aprobar y marca de revalidación puesta (la etapa NO se mueve: está en el umbral o por debajo)",
					},
				});
			}

			// La reapertura deja su propia fila, tanto cuando revalidó como cuando
			// las salvaguardas lo impidieron: en ese segundo caso el aviso es lo
			// único que queda para saber que la validación es vieja.
			if (reabreUnaPerdida && decisionRevalidacion.tipo !== "nada") {
				const detalle =
					"se reabrió una oportunidad que ya había cruzado el 30%; su validación de identidad (RENAP/buró/documentos) es anterior a la pérdida y el DPI pudo cambiar mientras estuvo perdida";

				auditRecord({
					entity: "opportunity",
					id,
					action: "reabrir_oportunidad_revalidacion",
					data: {
						porcentajeActual: oportunidadRevalidada?.closurePercentage,
						porcentajeMaximoHistorico:
							oportunidadRevalidada?.maxHistoricoClosurePercentage,
						detalle,
						resultado:
							decisionRevalidacion.tipo === "resetear"
								? "vuelve a la etapa de análisis (30%), analysisStatus pending y detalle de crédito sin aprobar"
								: `NO se revalidó: ${MOTIVO_AVISO[decisionRevalidacion.razon]}`,
					},
					...(decisionRevalidacion.tipo === "solo_aviso" ? { ok: false } : {}),
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
				auditRecord({
					entity: "lead",
					id: currentOpportunity[0].leadId,
					action: "update_direccion",
					data: { opportunityId: id, direccion },
				});
			}

			if (vehicleChanged) {
				await db
					.delete(analysisChecklists)
					.where(eq(analysisChecklists.opportunityId, id));
			}

			// Record stage history if stage changed.
			// ⚠️ No cuando la revalidación se llevó puesto el `stageId` pedido: el
			// parche va al final del `.set()`, así que la etapa con la que quedó la
			// oportunidad es la de análisis y no la de la request. Esta fila diría
			// que fue a una etapa a la que nunca llegó; la transición real ya la
			// escribió la transacción de arriba.
			if (isStageChange && input.stageId && !parcheRevalidacion) {
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
		.meta({ audit: { entity: "opportunity", action: "reassign" } })
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

			// La reasignación arrastra al lead, así que si el lead sostiene procesos
			// vivos de OTRO asesor el cambio se los movería por debajo: sus
			// oportunidades quedarían colgando de un lead ajeno y la siguiente
			// entrada del cliente seguiría al nuevo dueño del lead. Las que ya son
			// del asesor destino no estorban — ahí la reasignación justamente alinea
			// al cliente en vez de partirlo, que es como se reparan estos casos.
			if (current.leadId) {
				const oportunidadesDeOtroAsesor = await db
					.select({
						title: opportunities.title,
						asesor: user.name,
					})
					.from(opportunities)
					.leftJoin(user, eq(opportunities.assignedTo, user.id))
					.where(
						and(
							eq(opportunities.leadId, current.leadId),
							not(eq(opportunities.id, input.opportunityId)),
							not(eq(opportunities.assignedTo, input.assignedTo)),
							inArray(opportunities.status, ["open", "on_hold"]),
						),
					);

				if (oportunidadesDeOtroAsesor.length > 0) {
					const detalle = oportunidadesDeOtroAsesor
						.map((o) => `"${o.title}" (${o.asesor ?? "sin asesor"})`)
						.join(", ");

					throw new ORPCError("BAD_REQUEST", {
						message:
							`No se puede reasignar: el lead tiene ${oportunidadesDeOtroAsesor.length} oportunidad(es) activa(s) de otro asesor — ${detalle}. ` +
							"Reasignar esta movería el lead y dejaría esas oportunidades con otro dueño. Depurá primero las que no correspondan.",
					});
				}
			}

			await auditedTransaction(async (tx) => {
				await tx
					.update(opportunities)
					.set({ assignedTo: input.assignedTo, updatedAt: new Date() })
					.where(eq(opportunities.id, input.opportunityId));
				auditRecord({
					entity: "opportunity",
					id: input.opportunityId,
					action: "reassign",
				});

				if (current.leadId) {
					await tx
						.update(leads)
						.set({ assignedTo: input.assignedTo, updatedAt: new Date() })
						.where(eq(leads.id, current.leadId));
					// La reasignación arrastra al lead: sin esto su historial no
					// muestra el cambio de dueño.
					auditRecord({
						entity: "lead",
						id: current.leadId,
						action: "reassign",
					});
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
			const conditions = [
				eq(opportunities.stageId, analysisStage[0].id),
				// Solo mostrar oportunidades abiertas (excluir perdidas, ganadas, etc.)
				eq(opportunities.status, "open"),
			];

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
		.meta({ audit: { entity: "opportunity", action: "approve_analysis" } })
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
					source: opportunities.source,
					leadSource: leads.source,
					leadDpi: leads.dpi,
					clientType: leads.clientType,
					analysisStatus: opportunities.analysisStatus,
					analysisRejectionCount: opportunities.analysisRejectionCount,
					// Para no dar por válido el DPI de la identidad anterior: ver
					// `documentosDeIdentidadVigentes`.
					identityRevalidatedAt: opportunities.identityRevalidatedAt,
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

				// 🔴 El DPI de la identidad VIEJA no cuenta. Si la oportunidad se
				// revalidó (reapertura u override del candado), el documento de
				// identidad subido antes de esa marca es de la persona anterior: sigue
				// en el expediente pero deja de satisfacer el requisito. Sin esto, el
				// reset se deshacía aprobando otra vez con el mismo escaneo.
				const docsDeIdentidadVigentes = documentosDeIdentidadVigentes(
					uploadedDocs,
					opportunity[0].identityRevalidatedAt,
				);

				const uploadedTypes = new Set(
					docsDeIdentidadVigentes.map((d) => d.documentType),
				);
				const requiredTypes = requiredDocs.map((r) => r.documentType);
				const missingDocs = requiredTypes.filter((t) => !uploadedTypes.has(t));

				// Falta el DPI pero SÍ hay uno subido: quedó viejo por la
				// revalidación. El mensaje genérico ("faltan documentos") mandaría al
				// analista a buscar un archivo que está ahí.
				if (
					faltaPorIdentidadRevalidada(
						missingDocs,
						uploadedDocs.map((d) => d.documentType),
					)
				) {
					throw new ORPCError("BAD_REQUEST", {
						message: MENSAJE_DPI_DESACTUALIZADO,
					});
				}

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
			const validStatusesForReview: ("pending" | "resubmitted")[] = [
				"pending",
				"resubmitted",
			];
			if (
				!validStatusesForReview.some(
					(estado) => estado === opportunity[0].analysisStatus,
				)
			) {
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

			// Validaciones RENAP + Buró para oportunidades que NO provienen del
			// bot de WhatsApp (el bot ya las ejecuta en su propio flujo). Va
			// después de los chequeos de etapa y estado para no gastar llamadas
			// a las fuentes externas en aprobaciones que igual van a fallar.
			// El UPDATE de aprobación se condiciona a que el lead siga teniendo
			// este DPI, tanto si se validó como si quedó exenta
			let dpiVerificado: string | null = null;

			if (input.approved && !input.bypassValidation) {
				// La exención se resuelve en el servicio: `source` es editable por el
				// usuario, así que además exige evidencia de que el bot validó.
				const exencion = await resolverExencionPorBot({
					opportunityId: input.opportunityId,
					source: opportunity[0].source,
					leadSource: opportunity[0].leadSource,
					leadId: opportunity[0].leadId,
					leadDpi: opportunity[0].leadDpi,
				});

				// Vale para los dos caminos: el validado y el exento. Una oportunidad
				// exenta siempre tiene DPI, porque la evidencia del bot lo exige
				if (opportunity[0].leadDpi) {
					dpiVerificado = normalizarDpi(opportunity[0].leadDpi);
				}

				if (!exencion.exento) {
					// El DPI como texto es obligatorio en la ficha del lead,
					// en paralelo al documento DPI exigido arriba
					if (!opportunity[0].leadDpi) {
						throw new ORPCError("BAD_REQUEST", {
							message:
								"Para aprobar el análisis, el cliente debe tener su número de DPI capturado en la ficha del lead.",
						});
					}

					const resultadoValidaciones = await ejecutarValidaciones({
						opportunityId: input.opportunityId,
						userId: context.userId,
						reusarVigente: true,
					});

					// Un fallo técnico (API caída, timeout, sin respuesta) sí
					// bloquea: ninguna oportunidad no-bot pasa a 40% sin
					// validación ejecutada con veredicto
					if (resultadoValidaciones.errorTecnico) {
						throw new ORPCError("BAD_REQUEST", {
							message: `No se pudo completar la validación de Buró/RENAP: ${resultadoValidaciones.mensaje ?? "error desconocido"}. Intenta nuevamente o contacta al administrador.`,
						});
					}

					// El DPI pudo cambiar mientras corrían las validaciones: el
					// veredicto sería de otra persona
					const [leadActual] = await db
						.select({ dpi: leads.dpi })
						.from(opportunities)
						.leftJoin(leads, eq(opportunities.leadId, leads.id))
						.where(eq(opportunities.id, input.opportunityId))
						.limit(1);

					if (
						normalizarDpi(leadActual?.dpi ?? "") !==
						normalizarDpi(opportunity[0].leadDpi)
					) {
						throw new ORPCError("BAD_REQUEST", {
							message:
								"El DPI del cliente cambió mientras se ejecutaban las validaciones. Vuelve a ejecutarlas antes de aprobar.",
						});
					}

					// Ni el rechazo del buró ni la ausencia de registro bloquean:
					// quedan en la bitácora y visibles en la página de análisis
					// para que el analista decida bajo su criterio
				}
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
				// Solo se actualiza si sigue pendiente: dos aprobaciones simultáneas
				// no pueden duplicar historial de etapa ni notificaciones
				const condicionesBase = input.expectedUpdatedAt
					? and(
							eq(opportunities.id, input.opportunityId),
							eq(opportunities.updatedAt, new Date(input.expectedUpdatedAt)),
							inArray(opportunities.analysisStatus, validStatusesForReview),
						)
					: and(
							eq(opportunities.id, input.opportunityId),
							inArray(opportunities.analysisStatus, validStatusesForReview),
						);

				// Cuando hubo validaciones, el chequeo de DPI queda dentro del
				// mismo UPDATE: si el lead cambia de DPI entre la verificación y
				// la escritura, no se afecta ninguna fila y la aprobación falla
				// en vez de aprobar con el veredicto de otra persona
				const whereClause = dpiVerificado
					? and(
							condicionesBase,
							sql`exists (
								select 1 from ${leads}
								where ${leads.id} = ${opportunities.leadId}
									and ${eqDpi(leads.dpi, dpiVerificado)}
							)`,
						)
					: condicionesBase;

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
				if (updatedRows.length === 0) {
					// Con el chequeo atómico de DPI, 0 filas también significa que el
					// DPI del lead cambió después de validar: se relee para dar el
					// mensaje correcto en vez del de conflicto genérico
					if (dpiVerificado) {
						const [leadAlMomento] = await db
							.select({ dpi: leads.dpi })
							.from(opportunities)
							.leftJoin(leads, eq(opportunities.leadId, leads.id))
							.where(eq(opportunities.id, input.opportunityId))
							.limit(1);

						if (normalizarDpi(leadAlMomento?.dpi ?? "") !== dpiVerificado) {
							throw new ORPCError("BAD_REQUEST", {
								message:
									"El DPI del cliente cambió mientras se aprobaba. Vuelve a ejecutar las validaciones antes de aprobar.",
							});
						}
					}

					throw new ORPCError("CONFLICT", {
						message:
							"La oportunidad fue modificada por otro usuario. Por favor recarga la página e intenta de nuevo.",
					});
				}

				// Después del chequeo de conflicto: con cero filas no hubo escritura.
				auditRecord({
					entity: "opportunity",
					id: input.opportunityId,
					action: "approve_analysis",
					data: { approved: input.approved, reason: input.reason },
				});

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
		.meta({ audit: { entity: "opportunity", action: "approve_credit_detail" } })
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

			// 🔴 Este procedure empuja la solicitud a Formalización (50%), y hasta
			// acá el único requisito era que el detalle no estuviera aprobado
			// todavía. Eso deja abierto justo lo que `parcheDeRevalidacion` acababa
			// de cerrar: cuando una oportunidad revalida su identidad —se corrigió
			// el DPI con el override del admin, o se reabrió una perdida— vuelve al
			// 30% con `analysisStatus: "pending"` y `creditDetailApproved: false`, y
			// ese `false` era precisamente el permiso para llamar acá. La solicitud
			// llegaba al 50% con la identidad NUEVA y sin un documento de DPI nuevo,
			// sin RENAP y sin buró.
			//
			// El criterio no se inventa acá: `analysisStatus === "approved"` es la
			// señal que el propio stack usa para decir "el análisis está hecho y es
			// de ESTA identidad". El único que la escribe es
			// `approveOpportunityAnalysis`, que en el camino normal exige etapa de
			// análisis, documentos de identidad POSTERIORES a
			// `identityRevalidatedAt` (ver `documentosDeIdentidadVigentes`) y
			// RENAP/buró contra el DPI vigente. Y el reset la devuelve a `pending`.
			// Por eso alcanza con exigir `approved`: releer los documentos contra la
			// marca sería repetir de este lado una comprobación que el estado ya
			// resume.
			//
			// ⚠️ Con una salvedad conocida y FUERA del alcance de este cambio: en
			// `approveOpportunityAnalysis` el `bypassValidation` de un admin saltea
			// el bloque entero de documentos —`documentosDeIdentidadVigentes`
			// incluido— y también el de RENAP/buró. O sea que un `approved` puede
			// existir sin documento de identidad nuevo, y este guard lo va a aceptar.
			// Cerrar eso es decisión del dueño del flujo, no de este guard.
			if (opportunity.analysisStatus !== "approved") {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"No se puede aprobar el detalle de crédito: el análisis de esta oportunidad no está aprobado (o se invalidó al revalidarse la identidad). Tiene que volver a pasar por análisis antes de avanzar a Formalización.",
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
			//
			// 🔴 El estado se releyó arriba y el UPDATE corre después: en el medio
			// una revalidación puede dejar el análisis en `pending` y este UPDATE la
			// empujaría igual al 50%. El predicado lo vuelve a exigir en la misma
			// sentencia —Postgres lo re-evalúa tras esperar a la escritura rival—,
			// que es el mismo patrón de `sqlCandanteDeLaOportunidad` y
			// `sqlResetPermitido`. `creditDetailApproved` NO va en el predicado a
			// propósito: la columna admite NULL en filas viejas y un `= false`
			// dejaría fuera a las que sí hay que aprobar.
			const aprobadas = await db
				.update(opportunities)
				.set({
					stageId: nextStage[0].id,
					creditDetailApproved: true,
					creditDetailApprovedBy: context.userId,
					creditDetailApprovedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(opportunities.id, input.opportunityId),
						eq(opportunities.analysisStatus, "approved"),
					),
				)
				.returning({ id: opportunities.id });

			if (aprobadas.length === 0) {
				throw new ORPCError("CONFLICT", {
					message:
						"La oportunidad cambió mientras se aprobaba el detalle de crédito y su análisis ya no está aprobado. Recarga la página e intenta de nuevo.",
				});
			}
			auditRecord({
				entity: "opportunity",
				id: input.opportunityId,
				action: "approve_credit_detail",
			});

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
		.meta({ audit: { entity: "opportunity", action: "revoke_credit_detail" } })
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
					status: opportunities.status,
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

			// Lo de arriba mira la etapa, y una oportunidad puede estar ganada sin
			// haber llegado al 90%: `confirmContractsSigned` crea el crédito en
			// cartera y recién después mueve la etapa, así que si eso falla queda
			// ganada en el 85%. Ahí cancelar la devolvería al 40% y dejaría el
			// detalle de crédito editable con el crédito ya creado.
			const revokeError = getWonOpportunityRevokeError(opportunity.status);
			if (revokeError) {
				throw new ORPCError("FORBIDDEN", { message: revokeError });
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
			await auditedTransaction(async (tx) => {
				// Update opportunity - revoke approval
				const revocadas = await tx
					.update(opportunities)
					.set({
						stageId: previousStage.id,
						creditDetailApproved: false,
						creditDetailApprovedBy: null,
						creditDetailApprovedAt: null,
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(opportunities.id, input.opportunityId),
							// El chequeo de arriba leyó la fila antes del UPDATE: si se
							// gana en el medio, esta condición lo frena en la misma
							// sentencia.
							not(eq(opportunities.status, "won")),
						),
					)
					.returning({ id: opportunities.id });

				if (revocadas.length === 0) {
					throw new ORPCError("FORBIDDEN", {
						message:
							"La oportunidad se marcó como ganada mientras se cancelaba la aprobación. El crédito ya existe en cartera.",
					});
				}
				auditRecord({
					entity: "opportunity",
					id: input.opportunityId,
					action: "revoke_credit_detail",
				});

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

	// Desglose del ingreso adicional por fecha ideal de pago. null si el
	// crédito aún no existe en cartera-back o no tuvo ajuste.
	getAjusteFechaIdealPago: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input }) => {
			const [opportunity] = await db
				.select({ numeroSifco: opportunities.numeroSifco })
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			if (!opportunity.numeroSifco) {
				return { ajuste: null };
			}

			try {
				const credito = await carteraBackClient.getCredito(
					opportunity.numeroSifco,
				);
				return { ajuste: credito.ajusteFechaIdeal ?? null };
			} catch (error) {
				console.error(
					`[getAjusteFechaIdealPago] No se pudo consultar cartera-back para ${opportunity.numeroSifco}:`,
					error,
				);
				return { ajuste: null };
			}
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
			const { limit, offset } = input;
			const opportunityOwnerCondition =
				context.userRole === "sales"
					? eq(opportunities.assignedTo, context.userId)
					: undefined;
			const searchValue = input.search?.trim();
			// Solo se busca por nombre o por No. SIFCO (no email ni teléfono). El
			// filtro lo hace cartera: nombre vía nombre_usuario y, si el término es
			// solo dígitos (largo), como SIFCO exacto.
			const looksLikeSifco =
				!!searchValue && /^\d{6,}$/.test(searchValue.replace(/\s/g, ""));
			const nombreUsuario =
				searchValue && !looksLikeSifco ? searchValue : undefined;
			const sifcoExacto = looksLikeSifco
				? searchValue?.replace(/\s/g, "")
				: undefined;

			// Vistas acotadas: en lugar de bajar toda la cartera, resolvemos en la
			// DB local los SIFCOs relevantes y se los pasamos a cartera para que
			// pagine solo ese subconjunto.
			//  - leadId: solo los créditos de ese lead (modal de detalle)
			//  - rol sales: solo los créditos de las oportunidades asignadas al asesor
			let scopedSifcos: string[] | undefined;
			if (input.leadId) {
				// Un asesor solo puede abrir las oportunidades asignadas a él.
				// Admin/supervisor pueden ver cualquiera.
				const leadConditions = [
					eq(opportunities.leadId, input.leadId),
					isNotNull(opportunities.numeroSifco),
				];
				if (opportunityOwnerCondition) {
					leadConditions.push(opportunityOwnerCondition);
				}
				const opps = await db
					.select({ numeroSifco: opportunities.numeroSifco })
					.from(opportunities)
					.where(and(...leadConditions));
				scopedSifcos = opps
					.map((o) => o.numeroSifco)
					.filter((s): s is string => Boolean(s));
			} else if (context.userRole === "sales") {
				const opps = await db
					.select({ numeroSifco: opportunities.numeroSifco })
					.from(opportunities)
					.where(
						and(
							opportunityOwnerCondition,
							isNotNull(opportunities.numeroSifco),
						),
					);
				scopedSifcos = opps
					.map((o) => o.numeroSifco)
					.filter((s): s is string => Boolean(s));
			}

			// Vista acotada sin créditos => nada que mostrar (no consultar cartera).
			if (scopedSifcos && scopedSifcos.length === 0) {
				return { data: [], total: 0, limit, offset };
			}

			// Búsqueda por SIFCO exacto dentro de una vista acotada (sales/leadId):
			// cartera-back prioriza la lista `numeros_credito_sifco` sobre el SIFCO
			// único, así que NO se mandan ambos. Si el SIFCO buscado está en el
			// alcance, se manda solo ese (sin la lista); si no, no hay resultado.
			// La búsqueda por nombre sí va siempre a cartera junto al alcance (AND).
			let effectiveSifcos = scopedSifcos;
			if (sifcoExacto && scopedSifcos) {
				if (!scopedSifcos.includes(sifcoExacto)) {
					return { data: [], total: 0, limit, offset };
				}
				effectiveSifcos = undefined;
			}

			// Traer SOLO la ventana visible desde cartera. El nombre y el SIFCO se
			// filtran en el origen (cartera); el alcance sales/leadId va por SIFCOs.
			const { credits, total } = await getClientCreditsPageFromCartera({
				offset,
				limit,
				nombreUsuario,
				sifcoExacto,
				sifcos: effectiveSifcos,
			});

			const pageSifcos = credits
				.map((c) => c.creditos?.numero_credito_sifco?.trim())
				.filter((s): s is string => Boolean(s));

			// Enriquecer SOLO la página con datos del CRM.
			// 1) Oportunidades cuyo numeroSifco está en la página -> sifco -> leadId
			const matchingOpps =
				pageSifcos.length > 0
					? await db
							.select({
								numeroSifco: opportunities.numeroSifco,
								leadId: opportunities.leadId,
							})
							.from(opportunities)
							.where(
								and(
									inArray(opportunities.numeroSifco, pageSifcos),
									opportunityOwnerCondition,
								),
							)
					: [];

			const sifcoToLeadId = new Map<string, string>();
			for (const o of matchingOpps) {
				if (o.numeroSifco && o.leadId && !sifcoToLeadId.has(o.numeroSifco)) {
					sifcoToLeadId.set(o.numeroSifco, o.leadId);
				}
			}
			const matchedLeadIds = Array.from(new Set(sifcoToLeadId.values()));

			// 2) Datos completos de esos leads
			const leadsData =
				matchedLeadIds.length > 0
					? await db
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
							.where(inArray(leads.id, matchedLeadIds))
					: [];
			const leadById = new Map(leadsData.map((l) => [l.id, l]));

			// 3) Todas las oportunidades de esos leads (para la lista del row)
			const leadsOpportunities =
				matchedLeadIds.length > 0
					? await db
							.select({
								id: opportunities.id,
								title: opportunities.title,
								leadId: opportunities.leadId,
								assignedTo: opportunities.assignedTo,
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
								and(
									inArray(opportunities.leadId, matchedLeadIds),
									opportunityOwnerCondition,
								),
							)
							.orderBy(desc(opportunities.createdAt))
					: [];

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
							assignedTo: opp.assignedTo,
							value: opp.value,
							creditType: opp.creditType,
							numeroSifco: opp.numeroSifco,
							status: opp.status,
							createdAt: opp.createdAt,
							stage: opp.stage,
							// Una oportunidad cuenta como "colocada" cuando tiene número
							// SIFCO (se generó al desembolsar el crédito en cartera).
							isClosed: opp.numeroSifco != null,
						});
					}
					return acc;
				},
				{} as Record<string, any[]>,
			);

			// 4) Análisis de crédito de las oportunidades que corresponden a esos SIFCO
			const matchedOpportunityIds = leadsOpportunities.map(
				(opportunity) => opportunity.id,
			);
			const creditAnalysisByOpportunity =
				matchedOpportunityIds.length > 0
					? await db
							.select({
								opportunityId: creditAnalysis.opportunityId,
								monthlyFixedIncome: creditAnalysis.monthlyFixedIncome,
								monthlyVariableIncome: creditAnalysis.monthlyVariableIncome,
								monthlyFixedExpenses: creditAnalysis.monthlyFixedExpenses,
								monthlyVariableExpenses: creditAnalysis.monthlyVariableExpenses,
								economicAvailability: creditAnalysis.economicAvailability,
								maxPayment: creditAnalysis.maxPayment,
								maxCreditAmount: creditAnalysis.maxCreditAmount,
								suggestedPaymentDays: creditAnalysis.suggestedPaymentDays,
								analyzedAt: creditAnalysis.analyzedAt,
							})
							.from(creditAnalysis)
							.where(
								inArray(creditAnalysis.opportunityId, matchedOpportunityIds),
							)
					: [];
			const creditAnalysisByOpportunityId = creditAnalysisByOpportunity.reduce(
				(acc, ca) => {
					if (ca.opportunityId) {
						acc.set(ca.opportunityId, ca);
					}
					return acc;
				},
				new Map<string, (typeof creditAnalysisByOpportunity)[0]>(),
			);

			// 5) Construir filas en el orden en que cartera devolvió los créditos.
			const data = credits.flatMap<
				MatchedClientRow | ReturnType<typeof buildCarteraOnlyClientRow>
			>((credit) => {
				const sifco = credit.creditos?.numero_credito_sifco?.trim();
				if (!sifco) return [];
				const leadId = sifcoToLeadId.get(sifco);
				const lead = leadId ? leadById.get(leadId) : undefined;
				if (leadId && lead) {
					return buildCarteraMatchedClientRows({
						lead,
						leadOpportunities: opportunitiesByLead[leadId] || [],
						creditAnalysisByOpportunityId,
						carteraCreditBySifco: new Map([[sifco, credit]]),
						opportunityOwnerId:
							context.userRole === "sales" ? context.userId : undefined,
					});
				}
				// Sin match CRM: las filas "sólo cartera" no aplican en vistas acotadas.
				if (scopedSifcos) return [];
				return [buildCarteraOnlyClientRow(credit)];
			});

			return { data, total, limit, offset };
		}),

	// Estadísticas de clientes (baratas: no barren toda la cartera).
	getLeadsAsClientsStats: crmProcedure.handler(async ({ context }) => {
		// Para asesores la vista está acotada a sus créditos.
		let scopedSifcos: string[] | undefined;
		if (context.userRole === "sales") {
			const opps = await db
				.select({ numeroSifco: opportunities.numeroSifco })
				.from(opportunities)
				.where(
					and(
						eq(opportunities.assignedTo, context.userId),
						isNotNull(opportunities.numeroSifco),
					),
				);
			scopedSifcos = opps
				.map((o) => o.numeroSifco)
				.filter((s): s is string => Boolean(s));
			if (scopedSifcos.length === 0) {
				return { totalClients: 0, totalValue: null };
			}
		}

		// Total de clientes vigentes: el helper con limit=0 solo hace una sonda de
		// conteo contra cartera (estado ACTIVO ya incluye los 3 vigentes).
		const { total } = await getClientCreditsPageFromCartera({
			offset: 0,
			limit: 0,
			sifcos: scopedSifcos,
		});

		// Valor total: stats agregadas de cartera (suma de capital de la cartera
		// activa). Solo para vistas globales; para asesores no hay un agregado
		// barato acotado, así que se devuelve null y el front oculta la tarjeta.
		let totalValue: number | null = null;
		if (context.userRole !== "sales") {
			totalValue = 0;
			try {
				const stats = await carteraBackClient.getStats();
				totalValue = Object.values(stats.porCuotasAtrasadas).reduce(
					(sum, bucket) =>
						sum + (Number.parseFloat(bucket?.sumaCapital ?? "0") || 0),
					0,
				);
			} catch (error) {
				console.error("[getLeadsAsClientsStats] getStats falló:", error);
			}
		}

		return { totalClients: total, totalValue };
	}),

	// Export para marketing (base lookalike): CRM-only, sin verificar cartera.
	// Una fila por cliente (lead) que alguna vez cerró crédito (oportunidad con
	// numeroSifco). Valor del vehículo = insured_amount de la cotización más
	// reciente de su oportunidad más reciente; si no hay cotización, opp.value.
	exportClientsForMarketing: crmProcedure.handler(async ({ context }) => {
		if (!PERMISSIONS.canExportReports(context.userRole)) {
			throw new ORPCError("FORBIDDEN", {
				message: "No tienes permiso para exportar la base de clientes",
			});
		}

		// Oportunidades que se volvieron crédito (tienen numeroSifco), con su lead.
		const rows = await db
			.select({
				oppId: opportunities.id,
				leadId: opportunities.leadId,
				value: opportunities.value,
				createdAt: opportunities.createdAt,
				firstName: leads.firstName,
				middleName: leads.middleName,
				lastName: leads.lastName,
				secondLastName: leads.secondLastName,
				phone: leads.phone,
				email: leads.email,
			})
			.from(opportunities)
			.innerJoin(leads, eq(opportunities.leadId, leads.id))
			.where(isNotNull(opportunities.numeroSifco))
			// Más reciente en cerrarse primero (fecha de cierre; createdAt si falta).
			.orderBy(
				sql`coalesce(${opportunities.actualCloseDate}, ${opportunities.createdAt}) desc`,
			);

		// Una fila por lead: su oportunidad más reciente en cerrarse (el stream ya
		// viene ordenado por fecha de cierre desc, así que la primera gana).
		const latestByLead = new Map<string, (typeof rows)[number]>();
		for (const row of rows) {
			if (row.leadId && !latestByLead.has(row.leadId)) {
				latestByLead.set(row.leadId, row);
			}
		}
		const selected = Array.from(latestByLead.values());

		// Valor del vehículo: insured_amount de la cotización más reciente por opp.
		const oppIds = selected.map((r) => r.oppId);
		const insuredByOpp = new Map<string, string>();
		if (oppIds.length > 0) {
			const quotes = await db
				.select({
					opportunityId: quotations.opportunityId,
					insuredAmount: quotations.insuredAmount,
					createdAt: quotations.createdAt,
				})
				.from(quotations)
				.where(inArray(quotations.opportunityId, oppIds))
				.orderBy(desc(quotations.createdAt));
			for (const q of quotes) {
				if (q.opportunityId && !insuredByOpp.has(q.opportunityId)) {
					insuredByOpp.set(q.opportunityId, q.insuredAmount);
				}
			}
		}

		const data = selected.map((r) => ({
			nombre: [r.firstName, r.middleName, r.lastName, r.secondLastName]
				.filter((p) => p?.trim())
				.join(" "),
			telefono: r.phone ?? "",
			correo: r.email ?? "",
			valorVehiculo: insuredByOpp.get(r.oppId) ?? r.value ?? "",
		}));

		return { data, total: data.length };
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
						description: isManualBankDocumentCleanupDescription(doc.description)
							? null
							: doc.description,
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
			if (
				isReservedBankCoverageDescription(input.description) ||
				isManualBankDocumentCleanupDescription(input.description)
			) {
				throw new ORPCError("BAD_REQUEST", {
					message: "La descripción usa una etiqueta reservada por el sistema",
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

			if (isBankStatementChecklistType(input.documentType)) {
				try {
					return await runOpportunityDocumentUploadCore({
						opportunityId: input.opportunityId,
						actorId: context.userId,
						documentType: input.documentType,
						uploadedKey: uploadedFile.key,
						withOpportunityLock: withOpportunityDocumentMutationLock,
						findExistingBankSlot: async (tx) => {
							const [existing] = await tx
								.select({ id: opportunityDocuments.id })
								.from(opportunityDocuments)
								.where(
									and(
										eq(opportunityDocuments.opportunityId, input.opportunityId),
										eq(opportunityDocuments.documentType, input.documentType),
									),
								)
								.limit(1);
							return existing ?? null;
						},
						insertDocument: async (tx) => {
							const [newDocument] = await tx
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
							if (!newDocument) {
								throw new Error("No se pudo registrar el documento.");
							}
							return newDocument;
						},
						refreshChecklist: async (tx) => {
							await rebuildClientDocumentChecklistInTransaction(
								tx,
								input.opportunityId,
								!!opportunity[0]?.vehicleId,
							);
						},
						deleteUploadedFile: deleteFileFromR2,
						persistCleanupDebt: async (debt) => {
							const description = getManualBankUploadCleanupDescription(debt);
							const [existing] = await db
								.select({ id: opportunityDocuments.id })
								.from(opportunityDocuments)
								.where(
									and(
										eq(opportunityDocuments.opportunityId, debt.opportunityId),
										eq(opportunityDocuments.filePath, debt.key),
									),
								)
								.limit(1);
							if (existing) return;
							await db.insert(opportunityDocuments).values({
								opportunityId: debt.opportunityId,
								filename: uniqueFilename,
								originalName: input.file.name,
								mimeType: uploadedFile.mimeType,
								size: uploadedFile.size,
								documentType: "other",
								description,
								uploadedBy: debt.actorId,
								filePath: debt.key,
							});
						},
					});
				} catch (error) {
					if (error instanceof OpportunityDocumentMutationError) {
						throw new ORPCError(
							error.code === "NOT_FOUND" ? "NOT_FOUND" : "BAD_REQUEST",
							{ message: error.message },
						);
					}
					if (error instanceof DocumentIntegrityError) {
						throw new ORPCError(error.code, { message: error.message });
					}
					throw error;
				}
			}

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
				if (
					isBankStatementChecklistType(document.documentType) ||
					isReservedBankCoverageDescription(document.description) ||
					document.description?.startsWith("[bank-coverage-debt:") ||
					isManualBankDocumentCleanupDescription(document.description)
				) {
					try {
						await runOpportunityDocumentDeleteCore({
							documentId: input.documentId,
							opportunityId: document.opportunityId,
							actorId: context.userId,
							documentType: document.documentType,
							description: document.description,
							withOpportunityLock: withOpportunityDocumentMutationLock,
							runTransaction: <R>(operation: (tx: Transaction) => Promise<R>) =>
								db.transaction(operation),
							readDocument: async (tx) => {
								const [current] = await tx
									.select()
									.from(opportunityDocuments)
									.where(
										and(
											eq(opportunityDocuments.id, input.documentId),
											eq(
												opportunityDocuments.opportunityId,
												document.opportunityId,
											),
										),
									)
									.limit(1);
								return current ?? null;
							},
							quarantineAndRefresh: async (tx, current, cleanupTag) => {
								const [updated] = await tx
									.update(opportunityDocuments)
									.set({ documentType: "other", description: cleanupTag })
									.where(
										and(
											eq(opportunityDocuments.id, current.id),
											eq(
												opportunityDocuments.opportunityId,
												current.opportunityId,
											),
										),
									)
									.returning({ id: opportunityDocuments.id });
								if (!updated) throw new Error("Documento no encontrado");
								const [currentOpportunity] = await tx
									.select({ vehicleId: opportunities.vehicleId })
									.from(opportunities)
									.where(eq(opportunities.id, current.opportunityId))
									.limit(1);
								await rebuildClientDocumentChecklistInTransaction(
									tx,
									current.opportunityId,
									!!currentOpportunity?.vehicleId,
								);
							},
							deleteStoredFile: async (current) => {
								const immutable = isImmutableDocumentIntegrityEvidencePath({
									filePath: current.filePath,
									bankStatementPrefix: buildUploadPrefix(
										"bank_statement",
										current.opportunityId,
									),
								});
								if (!immutable) await deleteFileFromR2(current.filePath);
							},
							deleteDocumentAndRefresh: async (tx, current) => {
								await tx
									.delete(opportunityDocuments)
									.where(
										and(
											eq(opportunityDocuments.id, current.id),
											eq(
												opportunityDocuments.opportunityId,
												current.opportunityId,
											),
										),
									);
								const [currentOpportunity] = await tx
									.select({ vehicleId: opportunities.vehicleId })
									.from(opportunities)
									.where(eq(opportunities.id, current.opportunityId))
									.limit(1);
								await rebuildClientDocumentChecklistInTransaction(
									tx,
									current.opportunityId,
									!!currentOpportunity?.vehicleId,
								);
							},
						});
						return { success: true };
					} catch (error) {
						if (error instanceof OpportunityDocumentMutationError) {
							throw new ORPCError(
								error.code === "NOT_FOUND" ? "NOT_FOUND" : "BAD_REQUEST",
								{ message: error.message },
							);
						}
						if (error instanceof DocumentIntegrityError) {
							throw new ORPCError(error.code, { message: error.message });
						}
						throw error;
					}
				}

				// Si el archivo es la evidencia inmutable de una validación de
				// integridad documental, no se borra de R2: esa misma ruta queda
				// referenciada por document_integrity_validations para auditoría.
				const isDocumentIntegrityEvidence =
					isImmutableDocumentIntegrityEvidencePath({
						filePath: document.filePath,
						bankStatementPrefix: buildUploadPrefix(
							"bank_statement",
							document.opportunityId,
						),
					});

				if (!isDocumentIntegrityEvidence) {
					// Eliminar de R2
					await deleteFileFromR2(document.filePath);
				}

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
					// Credit analysis for this opportunity only
					db
						.select()
						.from(creditAnalysis)
						.where(
							and(
								eq(creditAnalysis.opportunityId, input.opportunityId),
								isNotNull(creditAnalysis.analyzedAt),
							),
						)
						.limit(1),
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
				const savedCapacityItem = (
					existingChecklist.checklistData as {
						sections?: {
							verificaciones?: {
								items?: Array<{
									type?: string;
									completed?: boolean;
									analysisId?: string;
								}>;
							};
						};
					}
				).sections?.verificaciones?.items?.find(
					(item) => item.type === "capacidad_pago",
				);
				const hasStaleCreditAnalysis =
					(savedCapacityItem?.completed ?? false) !== !!creditAnalysisExists ||
					(savedCapacityItem?.analysisId ?? null) !==
						(creditAnalysisExists?.id ?? null);
				if (
					hasStaleCreditAnalysis ||
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
								...(vehicle?.isNew
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
		.meta({ audit: { entity: "opportunity", action: "approve_disbursement" } })
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
			auditRecord({
				entity: "opportunity",
				id: input.opportunityId,
				action: "approve_disbursement",
			});

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
					diaPagoOriginalSistema: opportunities.diaPagoOriginalSistema,
					creditType: opportunities.creditType,
					vendorId: opportunities.vendorId,
					companyId: opportunities.companyId,
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

			// Fetch suggested payment days (fecha ideal de pago) del análisis de esta oportunidad
			const opportunityIds = opps.map((o) => o.id);
			const creditAnalysisData =
				opportunityIds.length > 0
					? await db
							.select({
								opportunityId: creditAnalysis.opportunityId,
								leadId: creditAnalysis.leadId,
								suggestedPaymentDays: creditAnalysis.suggestedPaymentDays,
							})
							.from(creditAnalysis)
							.where(inArray(creditAnalysis.opportunityId, opportunityIds))
					: [];

			// Create maps for quick lookup
			const leadsMap = new Map(leadsData.map((l) => [l.id, l]));
			const vehiclesMap = new Map(vehiclesData.map((v) => [v.id, v]));
			// Partes del contrato ya asignadas. El vendedor sale solo de la
			// oportunidad, igual que en la generación de contratos.
			const vendorIdDeLaParte = (opp: (typeof opps)[number]) =>
				opp.vendorId ?? null;

			const vendorIds = [
				...new Set(
					opps.map(vendorIdDeLaParte).filter((id): id is string => !!id),
				),
			];
			const companyIds = [
				...new Set(
					opps.map((o) => o.companyId).filter((id): id is string => !!id),
				),
			];
			const vendorsData =
				vendorIds.length > 0
					? await db
							.select({
								id: vehicleVendors.id,
								name: vehicleVendors.name,
								dpi: vehicleVendors.dpi,
								gender: vehicleVendors.gender,
							})
							.from(vehicleVendors)
							.where(inArray(vehicleVendors.id, vendorIds))
					: [];
			const companiesData =
				companyIds.length > 0
					? await db
							.select({
								id: companies.id,
								name: companies.name,
								razonSocial: companies.razonSocial,
							})
							.from(companies)
							.where(inArray(companies.id, companyIds))
					: [];
			const vendorsMap = new Map(vendorsData.map((v) => [v.id, v]));
			const companiesMap = new Map(companiesData.map((c) => [c.id, c]));

			// Se guarda también el leadId del análisis: si la oportunidad fue
			// reasignada a otro lead sin volver a vincular el análisis, no se debe
			// mostrar el día recomendado del cliente anterior.
			const creditAnalysisMap = new Map(
				creditAnalysisData
					.filter(
						(ca): ca is typeof ca & { opportunityId: string } =>
							!!ca.opportunityId,
					)
					.map((ca) => [
						ca.opportunityId,
						{
							leadId: ca.leadId,
							suggestedPaymentDays: ca.suggestedPaymentDays,
						},
					]),
			);

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
					diaPagoOriginalSistema: opp.diaPagoOriginalSistema,
					suggestedPaymentDays:
						creditAnalysisMap.get(opp.id)?.leadId === opp.leadId
							? (creditAnalysisMap.get(opp.id)?.suggestedPaymentDays ?? null)
							: null,
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
					vendedor: (() => {
						const id = vendorIdDeLaParte(opp);
						return id ? (vendorsMap.get(id) ?? null) : null;
					})(),
					empresa: opp.companyId
						? (companiesMap.get(opp.companyId) ?? null)
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
		.meta({ audit: { entity: "opportunity", action: "assign_investor" } })
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
				diaPagoMensual: z.number().int().min(1).max(31),
				// Marca si el día viene de la opción "recomendado por IA" del select,
				// aunque coincida numéricamente con 15/30 (ver esDiaIA). Se revalida
				// server-side contra suggestedPaymentDays. Requerido, sin default.
				elegidoDesdeRecomendacionIA: z.boolean(),
				// Partes del contrato. Opcionales: si faltan, jurídico las llena a
				// mano. Carro usado: el dueño que vende. Carro nuevo: la agencia.
				// La selección llega aunque le falte el género o la razón social,
				// para no dejar asignada la parte anterior.
				// Igual que agencia: null = se quitó a propósito, hay que
				// desasignar el vendedor. undefined = no viene, no se toca.
				vendedor: z
					.object({
						dpi: z.string(),
						nombre: z.string().trim().min(1, "El nombre es requerido"),
						genero: z.enum(["male", "female"]).optional(),
					})
					.nullable()
					.optional(),
				// null = la agencia se quitó a propósito en la pantalla, hay que
				// desasignarla. undefined = no viene en la petición, no se toca.
				agencia: z
					.object({
						companyId: z.string().uuid(),
						razonSocial: z.string().trim().min(1).optional(),
					})
					.nullable()
					.optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Un DPI inválido no bloquea el avance: el vendedor es opcional y hay
			// registros viejos cuyo DPI solo se validó por largo.
			const dpiVendedor = input.vendedor
				? validarDpi(input.vendedor.dpi)
				: null;

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

			// Se consulta siempre (no solo si el día no es 15/30): también decide
			// esDiaIA más abajo.
			let suggestedDays: Array<{ dia: number; porcentaje: number }> | null =
				null;
			if (opportunity.leadId) {
				const [analysis] = await db
					.select({
						suggestedPaymentDays: creditAnalysis.suggestedPaymentDays,
					})
					.from(creditAnalysis)
					.where(
						and(
							eq(creditAnalysis.opportunityId, input.opportunityId),
							eq(creditAnalysis.leadId, opportunity.leadId),
						),
					)
					.limit(1);
				suggestedDays = analysis?.suggestedPaymentDays ?? null;
			}

			// diaPagoMensual solo puede ser 15, 30, o uno de los días recomendados
			// por el análisis de esta oportunidad Y del lead actual (si la oportunidad
			// fue reasignada a otro lead, el análisis anterior ya no aplica).
			if (input.diaPagoMensual !== 15 && input.diaPagoMensual !== 30) {
				const isRecommended = suggestedDays?.some(
					(d) => d.dia === input.diaPagoMensual,
				);
				if (!isRecommended) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"El día de pago mensual debe ser 15, 30, o uno de los días recomendados por el análisis de capacidad de pago",
					});
				}
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

			// No 15/30 ya probó su origen IA al pasar la validación de arriba.
			const esDiaIA =
				input.diaPagoMensual !== 15 && input.diaPagoMensual !== 30
					? true
					: input.elegidoDesdeRecomendacionIA &&
						(suggestedDays?.some((d) => d.dia === input.diaPagoMensual) ??
							false);

			const fechaReferencia = new Date();
			const diaPagoOriginalSistema = esDiaIA
				? getDiaPagoOriginalSistema(fechaReferencia)
				: null;

			// Update opportunity, quotation and history atomically.
			await auditedTransaction(async (tx) => {
				const [lockedOpportunity] = await tx
					.select({ stageId: opportunities.stageId })
					.from(opportunities)
					.where(eq(opportunities.id, input.opportunityId))
					.limit(1)
					.for("update");
				if (!lockedOpportunity) {
					throw new ORPCError("NOT_FOUND", {
						message: "Oportunidad no encontrada",
					});
				}
				const [lockedStage] = await tx
					.select({ closurePercentage: salesStages.closurePercentage })
					.from(salesStages)
					.where(eq(salesStages.id, lockedOpportunity.stageId))
					.limit(1);
				if (
					!lockedStage ||
					!puedeAsignarInversionistas(lockedStage.closurePercentage)
				) {
					throw new ORPCError("BAD_REQUEST", {
						message: "La oportunidad debe estar en la etapa del 50%",
					});
				}

				const [quotation] = await tx
					.select()
					.from(quotations)
					.where(eq(quotations.opportunityId, input.opportunityId))
					.orderBy(
						desc(eq(quotations.status, "accepted")),
						desc(quotations.createdAt),
					)
					.limit(1)
					.for("update");

				if (esDiaIA && !quotation) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"No se puede financiar el ajuste de fecha ideal sin una cotización",
					});
				}

				let regenerated:
					| ReturnType<typeof calcularRegeneracionCotizacionFechaIdeal>
					| undefined;
				let idealPaymentDateAdjustment = 0;
				let idealPaymentDateAdjustmentDays = 0;
				let investorsToPersist = allInvestors;

				if (quotation) {
					const previousAdjustment = Number(
						quotation.idealPaymentDateAdjustment ?? 0,
					);
					const baseCapital =
						Number(quotation.totalFinanced) - previousAdjustment;
					if (baseCapital <= 0) {
						throw new ORPCError("BAD_REQUEST", {
							message: "El monto base de la cotización no es válido",
						});
					}

					const adjustment =
						esDiaIA && diaPagoOriginalSistema != null
							? calcularAjusteFechaIdeal({
									diaPagoOriginalSistema,
									diaPagoMensualElegido: input.diaPagoMensual,
									capital: baseCapital,
									porcentajeInteres: Number(quotation.interestRate),
									membresiaMensual: Number(quotation.membershipCost ?? 0),
									seguroMensual: Number(quotation.insuranceCost ?? 0),
									gpsMensual: Number(quotation.gpsCost ?? 0),
									fechaReferencia,
								})
							: null;
					idealPaymentDateAdjustment = adjustment?.montoTotal ?? 0;
					idealPaymentDateAdjustmentDays = adjustment?.diasDiferencia ?? 0;
					regenerated = calcularRegeneracionCotizacionFechaIdeal({
						adminCost: Number(quotation.adminCost),
						totalFinanced: Number(quotation.totalFinanced),
						extraAdminCost: Number(quotation.extraAdminCost ?? 600),
						interestRate: Number(quotation.interestRate),
						termMonths: quotation.termMonths,
						insuranceCost: Number(quotation.insuranceCost),
						gpsCost: Number(quotation.gpsCost),
						ajusteAnterior: previousAdjustment,
						ajusteNuevo: idealPaymentDateAdjustment,
					});
					investorsToPersist = aplicarDeltaMontosInversionistas(
						allInvestors,
						regenerated.delta,
					);

					await tx
						.update(quotations)
						.set({
							adminCost: regenerated.adminCost.toFixed(2),
							totalFinanced: regenerated.totalFinanced.toFixed(2),
							monthlyPayment: regenerated.monthlyPayment.toFixed(2),
							extraAdminCost: regenerated.extraAdminCost.toFixed(2),
							idealPaymentDateAdjustment:
								idealPaymentDateAdjustment.toFixed(2),
							idealPaymentDateAdjustmentDays,
							idealPaymentDateAdjustmentReferenceDate:
								esDiaIA
									? toDateStrGT(fechaReferencia)
									: null,
							updatedAt: fechaReferencia,
						})
						.where(eq(quotations.id, quotation.id));
				}

				// El vendedor se identifica por DPI: si ya existe se actualiza con lo
				// capturado (nombre legal y género) en vez de duplicarlo. Con un DPI
				// inválido solo se reusa el vendedor que ya lo tenga registrado; no
				// se crea uno nuevo con ese DPI y el avance sigue sin vendedor.
				// null desasigna el vendedor; undefined lo deja como está
				let vendorId: string | null | undefined =
					input.vendedor === null ? null : undefined;
				if (input.vendedor && dpiVendedor) {
					const [existente] = await tx
						.select({
							id: vehicleVendors.id,
							gender: vehicleVendors.gender,
						})
						.from(vehicleVendors)
						.where(
							eqDpi(
								vehicleVendors.dpi,
								dpiVendedor.valid ? dpiVendedor.dpiLimpio : input.vendedor.dpi,
							),
						)
						.limit(1);

					if (existente) {
						// Un vendedor ya registrado solo se COMPLETA: el nombre y el
						// género llegan precargados de la pantalla, así que
						// reescribirlos pisaría con datos viejos lo que otro haya
						// corregido, y ese vendedor es el mismo en todas las
						// oportunidades con ese DPI. Para corregirlo está el alta
						// rápida (RENAP) o la página de Vendedores.
						if (input.vendedor.genero && !existente.gender) {
							// La condición va también en el predicado: dos avances a la
							// vez leen el género vacío y el segundo pisaría al primero.
							// Postgres re-evalúa el WHERE tras esperar a la otra
							// transacción, así que solo el primero escribe.
							await tx
								.update(vehicleVendors)
								.set({
									gender: input.vendedor.genero,
									updatedAt: new Date(),
								})
								.where(
									and(
										eq(vehicleVendors.id, existente.id),
										sql`coalesce(btrim(${vehicleVendors.gender}), '') = ''`,
									),
								);
						}
						vendorId = existente.id;
					} else if (dpiVendedor.valid) {
						const [nuevo] = await tx
							.insert(vehicleVendors)
							.values({
								name: input.vendedor.nombre,
								dpi: dpiVendedor.dpiLimpio,
								gender: input.vendedor.genero ?? null,
								vendorType: "individual",
							})
							.returning({ id: vehicleVendors.id });
						vendorId = nuevo.id;
					}
				}

				if (input.agencia) {
					const [empresa] = await tx
						.select({
							id: companies.id,
							razonSocial: companies.razonSocial,
						})
						.from(companies)
						.where(eq(companies.id, input.agencia.companyId))
						.limit(1);
					if (!empresa) {
						throw new ORPCError("NOT_FOUND", {
							message: "La empresa (agencia) no existe",
						});
					}
					// La razón social aquí solo se COMPLETA. La pantalla la trae
					// precargada, así que sobrescribirla pisaría con un valor viejo la
					// corrección que otro haya hecho mientras tanto, y el nombre legal
					// es compartido por todas las oportunidades de esa agencia.
					if (input.agencia.razonSocial && !empresa.razonSocial?.trim()) {
						// Igual que el género: la condición se repite en el predicado
						// para que dos avances simultáneos no se pisen el nombre legal.
						await tx
							.update(companies)
							.set({
								razonSocial: input.agencia.razonSocial,
								updatedAt: new Date(),
							})
							.where(
								and(
									eq(companies.id, input.agencia.companyId),
									sql`coalesce(btrim(${companies.razonSocial}), '') = ''`,
								),
							);
					}
				}

				const updatedOpportunities = await tx
					.update(opportunities)
					.set({
						...(vendorId !== undefined && { vendorId }),
						...(input.agencia !== undefined && {
							companyId: input.agencia?.companyId ?? null,
						}),
						inversionistas: JSON.stringify(investorsToPersist),
						stageId: stage80.id,
						categoria: input.categoria,
						nit: input.nit,
						diaPagoMensual: input.diaPagoMensual,
						diaPagoOriginalSistema,
						...(regenerated
							? {
									value: regenerated.totalFinanced.toFixed(2),
									cuotaMensual: regenerated.monthlyPayment.toFixed(2),
									gastosAdministrativos:
										regenerated.extraAdminCost.toFixed(2),
								}
							: {}),
						updatedAt: fechaReferencia,
					})
					.where(
						and(
							eq(opportunities.id, input.opportunityId),
							eq(opportunities.stageId, lockedOpportunity.stageId),
						),
					)
					.returning({ id: opportunities.id });
				if (updatedOpportunities.length !== 1) {
					throw new ORPCError("CONFLICT", {
						message: "La oportunidad cambió mientras se asignaban inversionistas",
					});
				}
				auditRecord({
					entity: "opportunity",
					id: input.opportunityId,
					action: "assign_investor",
					data: {
						categoria: input.categoria,
						vendedor: input.vendedor,
						agencia: input.agencia,
						idealPaymentDateAdjustment,
						idealPaymentDateAdjustmentDays,
					},
				});

				// Record stage history
				await tx.insert(opportunityStageHistory).values({
					opportunityId: input.opportunityId,
					fromStageId: lockedOpportunity.stageId,
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
		.meta({ audit: { entity: "opportunity", action: "update_investors" } })
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
			auditRecord({
				entity: "opportunity",
				id: input.opportunityId,
				action: "update_investors",
			});

			return {
				success: true,
				message: "Inversionistas actualizados correctamente",
			};
		}),

	// ── Credit Scoring ──────────────────────────────────────────────────
	scoreLead: crmProcedure
		.meta({ audit: { entity: "lead", action: "score" } })
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

			// La oportunidad se verifica ANTES del gate: con un id inexistente no
			// hay alta posible, y correr el gate primero convertía el NOT_FOUND en
			// un rechazo por mora (o en "no disponible" si cartera estaba caída),
			// gastando además el viaje a SIFCO y una fila de bitácora por nada.
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

			// Alta de co-deudor: siempre se consulta. Un co-deudor moroso respalda
			// el crédito igual de mal que un titular moroso.
			const gateCoDeudor = await evaluarGateMoraDpi(
				resultadoDpi.dpiLimpio,
				depsGateMora,
			);
			if (gateCoDeudor.rechazado) {
				throw new ORPCError("BAD_REQUEST", { message: gateCoDeudor.mensaje });
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
				// 🔴 El `min(1)` NO es cosmético: es lo que impide dejar el DPI en
				// blanco, que en `updateLead` hubo que rechazar a mano. Blanquearlo
				// vuelve invisible al moroso para siempre (ver `MENSAJE_DPI_EN_BLANCO`).
				dpi: z.string().min(1, MENSAJE_DPI_EN_BLANCO).optional(),
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
		.handler(async ({ input, context }) => {
			const { id, ...updateData } = input;

			// Igual que en `updateLead`: el override se anota después de confirmar
			// que el UPDATE tocó una fila. Ver `resolverEdicionConMora`.
			let overrideDeMora: AuditEntry | null = null;

			// El mismo rechazo que en `updateLead`. El `min(1)` del schema ya para el
			// `""`, pero no el `"   "`, y los dos son el mismo intento: dejar sin DPI
			// a alguien para que el gate no lo vuelva a encontrar.
			if (esDpiEnBlanco(updateData.dpi)) {
				throw new ORPCError("BAD_REQUEST", { message: MENSAJE_DPI_EN_BLANCO });
			}

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

			const editaAdmin = context.userRole === "admin";
			let coDebtorAntesDelUpdate:
				| { dpi: string | null; opportunityId: string }
				| undefined;
			// Igual que en `updateLead`: el veredicto sobrevive al bloque porque el
			// override del admin se cobra DESPUÉS del UPDATE.
			let candadoDpi: ResultadoCandadoDpi | null = null;

			if (updateData.dpi !== undefined) {
				[coDebtorAntesDelUpdate] = await db
					.select({
						dpi: coDebtors.dpi,
						opportunityId: coDebtors.opportunityId,
					})
					.from(coDebtors)
					.where(eq(coDebtors.id, id))
					.limit(1);

				if (coDebtorAntesDelUpdate) {
					// El candado va ANTES que el gate de mora: consulta local barata
					// contra el viaje a SIFCO. El co-deudor cuelga de una oportunidad:
					// el candado se evalúa sobre ESA, no sobre las demás del lead.
					candadoDpi = await evaluarCandadoDpi({
						dpiActual: coDebtorAntesDelUpdate.dpi,
						dpiNuevo: updateData.dpi,
						sujeto: "codeudor",
						esAdmin: editaAdmin,
						opportunityId: coDebtorAntesDelUpdate.opportunityId,
					});
					if (candadoDpi.bloqueado) {
						throw new ORPCError("BAD_REQUEST", {
							message: candadoDpi.message,
						});
					}
				}

				// Igual que en `updateLead`: la mora solo se consulta si el DPI es
				// nuevo o cambia, para no dejar congelada la ficha de un co-deudor que
				// ya está en mora.
				if (
					requiereConsultaDeMora(updateData.dpi, coDebtorAntesDelUpdate?.dpi)
				) {
					// Mismo agujero que en `updateLead`, con el equivalente del
					// co-deudor: su cartera propia no es la de un lead sino la de su
					// oportunidad (una sola). Ver `numerosSifcoDelDpiYDeLaOportunidad`.
					const oportunidadDelCoDeudor = coDebtorAntesDelUpdate?.opportunityId;
					const gate = await evaluarGateMoraDpi(updateData.dpi, {
						...depsGateMora,
						numerosCreditoConocidos: (dpiConsultado) =>
							oportunidadDelCoDeudor
								? numerosSifcoDelDpiYDeLaOportunidad(
										dpiConsultado,
										oportunidadDelCoDeudor,
									)
								: numerosSifcoConocidosPorDpi(dpiConsultado),
					});
					// Misma válvula que en `updateLead`: el DPI del co-deudor también se
					// tipea mal y también hay que poder corregirlo. `id` va en `null`
					// porque la bitácora solo conoce lead/opportunity/vehicle y este es
					// un co-deudor; su uuid viaja en el detalle.
					const resolucion = resolverEdicionConMora(gate, context.userRole, {
						entity: "lead",
						id: null,
						dpi: updateData.dpi,
						datosExtra: { coDebtorId: id },
					});
					if (!resolucion.permitir) {
						throw new ORPCError("BAD_REQUEST", {
							message: resolucion.mensaje,
						});
					}
					overrideDeMora = resolucion.anotacionPendiente;
				}
			}

			// Misma carrera que en `updateLead`: entre el candado y esta sentencia,
			// otra transacción puede aprobar el análisis de la oportunidad que
			// respalda y el DPI del co-deudor se escribiría igual. La condición
			// viaja adentro; Postgres la re-evalúa tras esperar a la escritura
			// rival. El admin queda fuera: su válvula sigue abierta.
			const candadoEnElPredicado =
				coDebtorAntesDelUpdate !== undefined &&
				!editaAdmin &&
				dpiCambia(coDebtorAntesDelUpdate.dpi, updateData.dpi);
			const whereDelUpdate =
				candadoEnElPredicado && coDebtorAntesDelUpdate
					? and(
							eq(coDebtors.id, id),
							noExisteOportunidadCandantePorId(
								coDebtorAntesDelUpdate.opportunityId,
							),
						)
					: eq(coDebtors.id, id);

			// Igual que en `updateLead`: el cambio de DPI del co-deudor y la
			// revalidación que cuesta van en UNA transacción. Separadas, una
			// revalidación caída dejaba el DPI nuevo commiteado con la oportunidad
			// aprobada contra la identidad vieja.
			const [updatedCoDebtor] = await auditedTransaction(async (tx) => {
				// 🔴 Mismo lock que en `updateLead`: el NOT EXISTS lee bajo snapshot
				// y no frena una aprobación 30→40 en vuelo. FOR UPDATE sobre SU
				// oportunidad serializa las dos escrituras.
				if (
					coDebtorAntesDelUpdate &&
					updateData.dpi !== undefined &&
					dpiCambia(coDebtorAntesDelUpdate.dpi, updateData.dpi)
				) {
					await tx
						.select({ id: opportunities.id })
						.from(opportunities)
						.where(eq(opportunities.id, coDebtorAntesDelUpdate.opportunityId))
						.for("update");
				}

				const filas = await tx
					.update(coDebtors)
					.set({
						...updateData,
						updatedAt: new Date(),
					})
					.where(whereDelUpdate)
					.returning();

				if (filas.length === 0) return filas;

				// Mismo costo que en `updateLead`: si el admin abrió el candado, la
				// oportunidad que respalda vuelve a análisis, porque su validación de
				// identidad se hizo contra el DPI anterior del co-deudor. Es una sola
				// oportunidad: el co-deudor cuelga de una, no de un lead. Si no puede
				// completarse, lanza y este `tx` revierte el DPI recién escrito.
				if (candadoDpi?.overrideAdmin && candadoDpi.candantes?.length) {
					await revalidarOportunidades({
						oportunidades: candadoDpi.candantes,
						accion: "candado_override_revalidacion",
						detalle:
							"un administrador cambió el DPI del co-deudor pese al candado; la validación de identidad de esta oportunidad se hizo contra el DPI anterior",
						datosExtra: { coDebtorId: id, dpiNuevo: updateData.dpi },
						anotar: auditRecord,
						cambiadaPor: context.userId,
						database: tx,
					});
				}

				return filas;
			});

			if (!updatedCoDebtor) {
				// Cero filas con la condición puesta puede ser el candado cerrándose
				// en el medio: se contesta como el candado y no como NOT_FOUND.
				if (candadoEnElPredicado && coDebtorAntesDelUpdate) {
					const candadoAhora = await evaluarCandadoDpi({
						dpiActual: coDebtorAntesDelUpdate.dpi,
						dpiNuevo: updateData.dpi,
						sujeto: "codeudor",
						esAdmin: false,
						opportunityId: coDebtorAntesDelUpdate.opportunityId,
					});
					if (candadoAhora.bloqueado) {
						throw new ORPCError("BAD_REQUEST", {
							message: candadoAhora.message,
						});
					}
				}

				throw new ORPCError("NOT_FOUND", {
					message: "Co-deudor no encontrado",
				});
			}

			// Recién acá: el override existe si el cambio existió.
			if (overrideDeMora) {
				auditRecord(overrideDeMora);
			}

			return updatedCoDebtor;
		}),

	deleteCoDebtor: crmProcedure
		.input(
			z.object({
				id: z.string().uuid(),
			}),
		)
		.handler(async ({ input, context }) => {
			// 🔴 Borrar al co-deudor es la otra forma de reemplazar una identidad
			// candada: el candado de `updateCoDebtor` impide cambiarle el DPI, pero
			// borrarlo y crear otro con otro DPI dejaba el expediente respaldado por
			// alguien distinto de quien pasó por RENAP, buró y documentos.
			//
			// Se cierra por acá y no en `createCoDebtor`: agregar un co-deudor tarde
			// es un flujo legítimo —el analista pide refuerzo justo cuando la
			// solicitud ya avanzó—. El REEMPLAZO exige borrar primero, así que con
			// el borrado candado la maniobra queda cerrada sin romper el flujo bueno.
			const [coDeudorABorrar] = await db
				.select({ opportunityId: coDebtors.opportunityId })
				.from(coDebtors)
				.where(eq(coDebtors.id, input.id))
				.limit(1);

			const esAdmin = context.userRole === "admin";
			const candado = coDeudorABorrar
				? await evaluarCandadoBorradoCoDeudor({
						opportunityId: coDeudorABorrar.opportunityId,
						esAdmin,
					})
				: null;

			if (candado?.bloqueado) {
				throw new ORPCError("BAD_REQUEST", { message: candado.message });
			}

			// 🔴 Todo el borrado en UNA transacción, con el candado DENTRO del WHERE.
			//
			// Antes el chequeo del candado vivía fuera de la escritura y la evidencia
			// (análisis y verificación de licencia) se borraba sin transacción: una
			// aprobación concurrente podía candar la oportunidad entre el chequeo y
			// los deletes, y el co-deudor se iba igual — o peor, se quedaba en el
			// expediente pero SIN su análisis ni su QR, que ya estaban borrados.
			//
			// Ahora el candado viaja en el WHERE del delete de `coDebtors`: Postgres
			// re-evalúa el predicado tras esperar a la escritura rival, así que la
			// carrera se cierra. Y cero filas por el predicado aborta la transacción:
			// la evidencia vuelve, el expediente queda entero.
			//
			// ⚠️ La evidencia se borra ANTES que el co-deudor y no después, aunque la
			// decisión sea del co-deudor: `creditAnalysis.co_debtor_id` y
			// `licenseQrVerifications.co_debtor_id` son FK NO ACTION y NO deferidas,
			// así que Postgres las verifica al final de CADA sentencia — borrar al
			// padre primero revienta en el acto cuando tiene análisis. Lo que hace que
			// el orden ya no importe es la transacción: si el predicado no deja borrar
			// al co-deudor, el throw de adentro revierte también estos dos deletes.
			// `auditedTransaction` y no `db.transaction`: ahora se anota DENTRO de la
			// transacción (el override del admin y su revalidación), así que si algo
			// revierte, esas anotaciones tienen que irse con la escritura.
			await auditedTransaction(async (tx) => {
				// 🔴 Lock de SU oportunidad antes de tocar nada: el predicado del
				// candado lee bajo snapshot y no frena una aprobación 30→40 en vuelo.
				if (coDeudorABorrar) {
					await tx
						.select({ id: opportunities.id })
						.from(opportunities)
						.where(eq(opportunities.id, coDeudorABorrar.opportunityId))
						.for("update");
				}

				await tx
					.delete(creditAnalysis)
					.where(eq(creditAnalysis.coDebtorId, input.id));

				await tx
					.delete(licenseQrVerifications)
					.where(eq(licenseQrVerifications.coDebtorId, input.id));

				// El admin conserva su válvula: sin predicado. El costo se cobra
				// abajo, revalidando la oportunidad.
				const where =
					!esAdmin && coDeudorABorrar
						? and(
								eq(coDebtors.id, input.id),
								noExisteOportunidadCandantePorId(coDeudorABorrar.opportunityId),
							)
						: eq(coDebtors.id, input.id);

				const [deletedCoDebtor] = await tx
					.delete(coDebtors)
					.where(where)
					.returning();

				if (deletedCoDebtor) {
					// El paso del admin no es silencioso, igual que el del gate de mora:
					// después hay que poder preguntar por qué salió ese co-deudor.
					if (candado?.overrideAdmin && coDeudorABorrar) {
						auditRecord({
							entity: "opportunity",
							id: coDeudorABorrar.opportunityId,
							action: "candado_dpi_override_admin",
							data: {
								coDebtorId: input.id,
								detalle:
									"un administrador eliminó al co-deudor de una solicitud que ya pasó del 30%",
							},
						});

						// 🔴 Y cuesta lo mismo que corregir el DPI: la oportunidad vuelve
						// a análisis. Antes del override solo quedaba la bitácora y la
						// solicitud seguía aprobada, con la evidencia de identidad
						// producida contra un respaldo que ya no existe. Borrar al
						// co-deudor analizado es el mismo costo que cambiarle el DPI
						// (decisión del dueño del producto).
						//
						// 🔴 Va DENTRO de esta transacción —antes corría después de que
						// cerrara—: si la revalidación no puede completarse, el borrado
						// del co-deudor se revierte con ella. Si no, el respaldo
						// desaparecía y la solicitud quedaba viva y aprobada sin él.
						if (candado.candantes?.length) {
							await revalidarOportunidades({
								oportunidades: candado.candantes,
								accion: "candado_override_revalidacion",
								detalle:
									"un administrador eliminó al co-deudor pese al candado; la validación de identidad de esta oportunidad se hizo con ese respaldo",
								datosExtra: { coDebtorId: input.id },
								anotar: auditRecord,
								cambiadaPor: context.userId,
								database: tx,
							});
						}
					}

					return;
				}

				// Cero filas con la condición puesta puede ser el candado cerrándose
				// en el medio: se distingue del NOT_FOUND preguntando si la fila sigue
				// ahí. Cualquiera de los dos throws revierte los deletes de arriba.
				const [sigueVivo] = await tx
					.select({ id: coDebtors.id })
					.from(coDebtors)
					.where(eq(coDebtors.id, input.id))
					.limit(1);

				if (sigueVivo && coDeudorABorrar) {
					// Lee por fuera de la transacción a propósito: pregunta por el
					// estado ya comprometido de la oportunidad, que es el que ganó la
					// carrera. Solo se consultan `opportunities` y `salesStages`, que
					// esta transacción no escribió.
					const candadoAhora = await evaluarCandadoBorradoCoDeudor({
						opportunityId: coDeudorABorrar.opportunityId,
						esAdmin: false,
					});

					throw new ORPCError("BAD_REQUEST", {
						message:
							candadoAhora.message ??
							"No se pudo eliminar al co-deudor: la solicitud cambió de estado mientras se procesaba. Volvé a intentarlo.",
					});
				}

				throw new ORPCError("NOT_FOUND", {
					message: "Co-deudor no encontrado",
				});
			});

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
			const [analysis] = await db
				.select()
				.from(creditAnalysis)
				.where(eq(creditAnalysis.opportunityId, input.opportunityId))
				.limit(1);
			leadAnalysis = analysis || null;

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
				suggestedPaymentDays: leadAnalysis?.suggestedPaymentDays ?? null,
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

	/**
	 * ¿Este DPI ya es cliente y está en mora?
	 *
	 * Consulta de solo lectura contra cartera, para que la pantalla pueda avisar
	 * antes de que alguien llene un formulario entero. NO es el gate: el corte
	 * duro vive en `evaluarGateMoraDpi` (`lib/gate-mora-dpi.ts`) y ya está
	 * enganchado en los puntos donde el CRM da de alta o cambia el DPI de una
	 * persona. Este procedure existe aparte porque informa sin bloquear.
	 *
	 * 🔴 **Pero tiene que contestar lo MISMO que va a contestar el gate**, o el
	 * aviso es peor que no avisar: anticipar "todo bien" y que el formulario
	 * reviente al guardar es exactamente el trabajo perdido que esta pantalla
	 * existe para ahorrar. De ahí las dos cosas que copia del gate: manda los
	 * números de crédito que el CRM conoce del DPI (sin ellos, un deudor que solo
	 * existe en el CRM salía CLIENTE_NO_ENCONTRADO → "seguí"), y respeta el kill
	 * switch (con la integración apagada el gate deja pasar, así que anunciar un
	 * bloqueo acá sería inventarlo).
	 *
	 * **Fail-closed.** Si cartera o SIFCO no contestan, la respuesta es
	 * `puedeContinuar: false` con motivo `SERVICIO_NO_DISPONIBLE`. Nunca se
	 * traduce un fallo a "sin mora": el cliente HTTP lanza
	 * `ConsultaMoraNoDisponibleError` justamente para que acá no haya forma de
	 * confundir las dos cosas.
	 *
	 * **Las tres salidas quedan en la bitácora, no dos.** Bloqueado, limpio y
	 * —la importante— no se pudo consultar. Con fail-closed una caída del core
	 * frena TODAS las solicitudes, y sin esa tercera fila la auditoría no podría
	 * distinguir "hubo 40 morosos esta mañana" de "SIFCO estuvo caído media
	 * hora". La fila de servicio caído va con `ok: false`, así que además se
	 * cuenta aparte de los bloqueos legítimos.
	 *
	 * La decisión vive en `lib/validacion-mora.ts` y acá solo se la cablea; de
	 * ahí que las anotaciones de este procedure no salgan de este archivo.
	 *
	 * 🔴 **La respuesta se recorta por rol.** El veredicto completo trae el
	 * expediente crediticio de un tercero: nombre, código de cliente SIFCO,
	 * cada crédito con su estado, su monto en mora y sus cuotas atrasadas, y el
	 * historial. `crmProcedure` deja entrar a `canAccessClients` —ventas,
	 * analista, contabilidad, jurídico…—, así que sin recorte cualquier asesor
	 * tecleando un DPI ajeno se lleva la ficha de deuda de esa persona, sin que
	 * medie ninguna relación con un lead suyo.
	 *
	 * El criterio es `PERMISSIONS.canAccessCobros` (admin, cobros y supervisor
	 * de cobros): es el predicado que el repo ya usa para "esta gente gestiona
	 * la deuda en cartera", y son quienes tienen motivo para ver el detalle.
	 * Los demás reciben solo el veredicto —`puedeContinuar`, `motivo`,
	 * `mensaje`, `consultadoEn`—, que es exactamente lo que necesitan: la
	 * pregunta que este procedure contesta es "¿sigo con este formulario?", y
	 * para eso el detalle no aporta nada. `mensaje` ya dice "tiene mora activa
	 * en 2 créditos" sin nombrar ni un número de crédito.
	 */
	validarMoraPorDpi: crmProcedure
		.meta({ audit: { entity: "lead", action: "validar_mora_dpi" } })
		.input(z.object({ dpi: z.string().min(1, "El DPI es requerido") }))
		.handler(async ({ input, context }) => {
			// El DPI se valida SIEMPRE, incluso con la integración apagada: un DPI
			// mal formado es un error del formulario y no tiene nada que ver con
			// cartera.
			const validacion = validarDpi(input.dpi);
			if (!validacion.valid) {
				throw new ORPCError("BAD_REQUEST", { message: validacion.error });
			}
			const dpiNormalizado = validacion.dpiLimpio;

			// 🔴 El kill switch manda también acá. Con la integración apagada el gate
			// deja pasar sin consultar (fail-open deliberado), así que si este
			// preflight respondiera "bloqueado" le estaría anunciando al asesor un
			// corte que después no ocurre — y al revés, un "no se pudo consultar"
			// eterno en una pantalla donde nada está fallando. Misma anotación que
			// usa el gate: mientras la bandera esté abajo entra gente sin validar y
			// hay que poder saber quiénes.
			if (!isCarteraBackEnabled()) {
				auditRecord({
					entity: "lead",
					id: null,
					action: "validar_mora_dpi_apagado",
					data: {
						dpi: dpiNormalizado,
						detalle:
							"la integración con cartera está desactivada (ENABLE_CARTERA_BACK_INTEGRATION); no se consultó la mora",
					},
				});
				return {
					puedeContinuar: true,
					motivo: "SIN_MORA" as const,
					mensaje: MENSAJE_GATE_APAGADO,
					consultadoEn: new Date().toISOString(),
				};
			}

			const resultado = await resolverValidacionMora(dpiNormalizado, {
				// Ya se validó arriba; revalidar solo abriría la puerta a que las dos
				// validaciones se separen.
				validar: (dpi) => ({ valid: true as const, dpiLimpio: dpi }),
				consultar: async (dpi) => {
					// 🔴 Los mismos números que manda el gate, o el preflight miente.
					// Cartera resuelve el DPI preguntándole a SIFCO, que no conoce los
					// créditos nacidos acá (`CRM-<uuid>`, `insoluto-N`): preguntando
					// solo por DPI, a un deudor que solo existe en el CRM este
					// procedure le contestaba CLIENTE_NO_ENCONTRADO con
					// `puedeContinuar: true` y el gate lo rechazaba dos pantallas
					// después. Ver `lib/numeros-sifco-por-dpi.ts`.
					let numerosConocidos: string[];
					try {
						numerosConocidos = await numerosSifcoConocidosPorDpi(dpi);
					} catch (error) {
						// Fail-closed igual que el gate, y por el camino que este
						// procedure ya tiene: sin esos números la consulta vería menos
						// cartera de la que hay, y un "sin mora" armado sobre media
						// cartera es peor que un "no se pudo consultar". Lanzarlo así
						// deja la misma fila `validar_mora_dpi_no_disponible`.
						throw new ConsultaMoraNoDisponibleError(
							"no se pudieron reunir los números de crédito que el CRM asocia al DPI",
							error,
						);
					}

					return carteraBackClient.consultarMoraPorDpi(dpi, numerosConocidos);
				},
				anotar: auditRecord,
			});

			if (resultado.tipo === "dpi_invalido") {
				throw new ORPCError("BAD_REQUEST", { message: resultado.error });
			}

			const { veredicto } = resultado;

			if (!PERMISSIONS.canAccessCobros(context.userRole ?? "")) {
				return {
					puedeContinuar: veredicto.puedeContinuar,
					motivo: veredicto.motivo,
					mensaje: veredicto.mensaje,
					consultadoEn: veredicto.consultadoEn,
				};
			}

			return veredicto;
		}),
};
