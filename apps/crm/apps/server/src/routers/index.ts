import { publicProcedure } from "../lib/orpc";
import { accountingRouter } from "./accounting";
import { adminRouter } from "./admin";
import { adminImportRouter } from "./admin-import";
import { adminMiniagentRouter } from "./admin-miniagent";
import { auctionRouter } from "./auctionVehicles"; // Import the auction router
import { authRouter } from "./auth";
import { bankAnalysisRouter } from "./bank-analysis";
import { checksRouter } from "./checks";
import { clientFormsRouter } from "./client-forms";
import { cobrosRouter } from "./cobros";
import { contractGenerationRouter } from "./contract-generation";
import { crmRouter } from "./crm";
import { insuranceRouter } from "./insurance";
import { juridicoDashboardRouter } from "./juridico-dashboard";
import { legalContractsRouter } from "./legal-contracts";
import { locationsRouter } from "./locations";
import { miniagentRouter } from "./miniagent";
import { notesRouter } from "./notes";
import { notificationsRouter } from "./notifications";
import { quotationsRouter } from "./quotations";
import { reportesCarteraRouter } from "./reportes-cartera";
import * as reportsRouter from "./reports";
import { uploadRouter } from "./upload";
import { vehiclesRouter } from "./vehicles";
import { vendorsRouter } from "./vendors";
export const appRouter = {
	healthCheck: publicProcedure.handler(() => {
		return "OK";
	}),

	// Auth routes
	...authRouter,

	// Admin routes (prefixed for clarity)
	adminOnlyData: adminRouter.getStats,
	getAllUsers: adminRouter.getAllUsers,
	updateUserRole: adminRouter.updateUserRole,
	toggleUserSuspension: adminRouter.toggleUserSuspension,
	deleteUser: adminRouter.deleteUser,
	createUser: adminRouter.createUser,

	// Admin Import routes
	setupImportacion: adminImportRouter.setupImportacion,
	analizarImportacionCreditos: adminImportRouter.analizarImportacionCreditos,

	// CRM routes
	getSalesStages: crmRouter.getSalesStages,
	getCrmUsers: crmRouter.getCrmUsers,
	getCompanies: crmRouter.getCompanies,
	createCompany: crmRouter.createCompany,
	updateCompany: crmRouter.updateCompany,
	getLeads: crmRouter.getLeads,
	getLeadById: crmRouter.getLeadById,
	getLeadsStats: crmRouter.getLeadsStats,
	createLead: crmRouter.createLead,
	updateLead: crmRouter.updateLead,
	getCreditAnalysisByLeadId: crmRouter.getCreditAnalysisByLeadId,
	upsertCreditAnalysis: crmRouter.upsertCreditAnalysis,
	resetCreditAnalysis: crmRouter.resetCreditAnalysis,
	getOpportunities: crmRouter.getOpportunities,
	createOpportunity: crmRouter.createOpportunity,
	updateOpportunity: crmRouter.updateOpportunity,
	getOpportunitiesForAnalysis: crmRouter.getOpportunitiesForAnalysis,
	approveOpportunityAnalysis: crmRouter.approveOpportunityAnalysis,
	approveCreditDetail: crmRouter.approveCreditDetail,
	revokeCreditDetailApproval: crmRouter.revokeCreditDetailApproval,
	getCreditDetailApprovalStatus: crmRouter.getCreditDetailApprovalStatus,
	getOpportunityHistory: crmRouter.getOpportunityHistory,
	validateOpportunityDocuments: crmRouter.validateOpportunityDocuments,
	getOpportunityDocuments: crmRouter.getOpportunityDocuments,
	uploadOpportunityDocument: crmRouter.uploadOpportunityDocument,
	deleteOpportunityDocument: crmRouter.deleteOpportunityDocument,
	getDocumentRequirementsByClientType:
		crmRouter.getDocumentRequirementsByClientType,
	getAnalysisChecklist: crmRouter.getAnalysisChecklist,
	updateAnalysisChecklistVerification:
		crmRouter.updateAnalysisChecklistVerification,
	updateAnalysisChecklistVehicleVerification:
		crmRouter.updateAnalysisChecklistVehicleVerification,
	// Disbursement checklist (90% → 100%)
	getDisbursementChecklist: crmRouter.getDisbursementChecklist,
	updateDisbursementChecklistItem: crmRouter.updateDisbursementChecklistItem,
	updateDisbursementChecklistNotes: crmRouter.updateDisbursementChecklistNotes,
	approveDisbursement: crmRouter.approveDisbursement,
	getOpportunitiesForDisbursement: crmRouter.getOpportunitiesForDisbursement,
	// Investment assignment (50% → 80%)
	getOpportunitiesForInvestment: crmRouter.getOpportunitiesForInvestment,
	assignInvestorAndAdvance: crmRouter.assignInvestorAndAdvance,
	updateOpportunityInvestors: crmRouter.updateOpportunityInvestors,
	getClients: crmRouter.getClients,
	getClientsStats: crmRouter.getClientsStats,
	getLeadsAsClients: crmRouter.getLeadsAsClients,
	getLeadsAsClientsStats: crmRouter.getLeadsAsClientsStats,
	createClient: crmRouter.createClient,
	updateClient: crmRouter.updateClient,
	getDashboardStats: crmRouter.getDashboardStats,
	getDashboardChartData: crmRouter.getDashboardChartData,
	scoreLead: crmRouter.scoreLead,
	// Co-debtors (Co-firmantes)
	getCoDebtorsByOpportunity: crmRouter.getCoDebtorsByOpportunity,
	createCoDebtor: crmRouter.createCoDebtor,
	updateCoDebtor: crmRouter.updateCoDebtor,
	deleteCoDebtor: crmRouter.deleteCoDebtor,
	getConsolidatedCreditAnalysis: crmRouter.getConsolidatedCreditAnalysis,

	// Client Forms routes (Formularios del cliente - link público)
	generateFormToken: clientFormsRouter.generateFormToken,
	validateFormToken: clientFormsRouter.validateFormToken,
	submitCreditApplication: clientFormsRouter.submitCreditApplication,
	signCreditApplication: clientFormsRouter.signCreditApplication,
	submitFinancialStatement: clientFormsRouter.submitFinancialStatement,
	getClientFormData: clientFormsRouter.getClientFormData,
	getFormTokenByOpportunity: clientFormsRouter.getFormTokenByOpportunity,

	// Bank Analysis routes (Análisis de estados de cuenta)
	analyzeBankStatements: bankAnalysisRouter.analyzeBankStatements,

	// Vehicles routes
	getVehicles: vehiclesRouter.getAll,
	getVehicleById: vehiclesRouter.getById,
	createVehicle: vehiclesRouter.create,
	createNewVehicle: vehiclesRouter.createNewVehicle,
	updateVehicle: vehiclesRouter.update,
	deleteVehicle: vehiclesRouter.delete,
	searchVehicles: vehiclesRouter.search,
	createVehicleInspection: vehiclesRouter.createInspection,
	updateVehicleInspection: vehiclesRouter.updateInspection,
	uploadVehiclePhoto: vehiclesRouter.uploadPhoto,
	deleteVehiclePhoto: vehiclesRouter.deletePhoto,
	getVehicleInspectionById: vehiclesRouter.getInspectionById,
	getLatestInspectionByVehicleId: vehiclesRouter.getLatestInspectionByVehicleId,
	getVehicleStatistics: vehiclesRouter.getStatistics,
	createFullVehicleInspection: vehiclesRouter.createFullInspection,
	processVehicleRegistrationOCR: vehiclesRouter.processVehicleRegistrationOCR,
	getAIVehicleValuation: vehiclesRouter.getAIVehicleValuation,
	getVehicleDocuments: vehiclesRouter.getVehicleDocuments,
	uploadVehicleDocument: vehiclesRouter.uploadVehicleDocument,
	deleteVehicleDocument: vehiclesRouter.deleteVehicleDocument,
	validateLicensePlate: vehiclesRouter.validateLicensePlate,

	// Cobros routes
	getCobrosDashboardStats: cobrosRouter.getDashboardStats,
	getCasosCobros: cobrosRouter.getCasosCobros,
	getCasoCobroById: cobrosRouter.getCasoCobroById,
	createContactoCobros: cobrosRouter.createContactoCobros,
	getHistorialContactos: cobrosRouter.getHistorialContactos,
	createConvenioPago: cobrosRouter.createConvenioPago,
	getConveniosPago: cobrosRouter.getConveniosPago,
	asignarResponsableCobros: cobrosRouter.asignarResponsableCobros,
	getUsuariosCobros: cobrosRouter.getUsuariosCobros,
	getHistorialPagos: cobrosRouter.getHistorialPagos,
	getRecuperacionVehiculo: cobrosRouter.getRecuperacionVehiculo,
	getTodosLosCreditos: cobrosRouter.getTodosLosCreditos,
	getDetallesContrato: cobrosRouter.getDetallesContrato,
	getDetallesCreditoCarteraBack: cobrosRouter.getDetallesCreditoCarteraBack,
	// Cartera-back integration endpoints
	registrarPago: cobrosRouter.registrarPago,
	getHistorialPagosCarteraBack: cobrosRouter.getHistorialPagosCarteraBack,
	getCreditoCarteraBack: cobrosRouter.getCreditoCarteraBack,
	sincronizarCasosCobros: cobrosRouter.sincronizarCasosCobros,
	getHistorialSincronizaciones: cobrosRouter.getHistorialSincronizaciones,
	getInversionistas: cobrosRouter.getInversionistas,
	getDetalleInversionista: cobrosRouter.getDetalleInversionista,
	getInversionistasDelCredito: cobrosRouter.getInversionistasDelCredito,
	getAsesores: cobrosRouter.getAsesores,
	updateContactInfoCobros: cobrosRouter.updateContactInfoCobros,
	updateEtiquetasCobros: cobrosRouter.updateEtiquetasCobros,
	getReferencias: cobrosRouter.getReferencias,
	createReferencia: cobrosRouter.createReferencia,
	updateReferencia: cobrosRouter.updateReferencia,
	deleteReferencia: cobrosRouter.deleteReferencia,
	// Metas de mora
	getMetasMora: cobrosRouter.getMetasMora,
	getMetasMoraAnual: cobrosRouter.getMetasMoraAnual,
	upsertMetasMora: cobrosRouter.upsertMetasMora,

	// Legal Contracts routes (Jurídico)
	createLegalContract: legalContractsRouter.createLegalContract,
	updateLegalContract: legalContractsRouter.updateLegalContract,
	deleteLegalContract: legalContractsRouter.deleteLegalContract,
	listLegalContractsByLead: legalContractsRouter.listLegalContractsByLead,
	listLegalContractsByOpportunity:
		legalContractsRouter.listLegalContractsByOpportunity,
	getLegalContract: legalContractsRouter.getLegalContract,
	assignOpportunityToContract: legalContractsRouter.assignOpportunityToContract,
	updateContractStatus: legalContractsRouter.updateContractStatus,
	deleteContract: legalContractsRouter.deleteContract,
	getOpportunitiesByLead: legalContractsRouter.getOpportunitiesByLead,
	getUserPermissions: legalContractsRouter.getUserPermissions,
	getLeadsWithContracts: legalContractsRouter.getLeadsWithContracts,
	getOpportunitiesForContracts:
		legalContractsRouter.getOpportunitiesForContracts,
	approveOpportunityLegal: legalContractsRouter.approveOpportunityLegal,
	confirmContractsSigned: legalContractsRouter.confirmContractsSigned,

	// Contract Generation routes (Generación automática de contratos)
	getContractTypes: contractGenerationRouter.getContractTypes,
	getDocumentsByDpi: contractGenerationRouter.getDocumentsByDpi,
	getContractPreviewData: contractGenerationRouter.getContractPreviewData,
	validateForContractGeneration:
		contractGenerationRouter.validateForContractGeneration,
	enrichLeadFromRenap: contractGenerationRouter.enrichLeadFromRenap,
	generateContracts: contractGenerationRouter.generateContracts,
	generateContractsDirect: contractGenerationRouter.generateContractsDirect,
	linkContractsToOpportunity:
		contractGenerationRouter.linkContractsToOpportunity,
	getGeneratedContracts: contractGenerationRouter.getGeneratedContracts,
	getGenerationSnapshot: contractGenerationRouter.getGenerationSnapshot,
	regenerateContracts: contractGenerationRouter.regenerateContracts,

	// Vendors routes
	getVendors: vendorsRouter.getAll,
	getVendorById: vendorsRouter.getById,
	getVendorByVehicleId: vendorsRouter.getByVehicleId,
	createVendor: vendorsRouter.create,
	updateVendor: vendorsRouter.update,
	deleteVendor: vendorsRouter.delete,
	searchVendors: vendorsRouter.search,

	// Notes routes
	getEntityNotes: notesRouter.getEntityNotes,
	createNote: notesRouter.createNote,
	updateNote: notesRouter.updateNote,
	togglePinNote: notesRouter.togglePinNote,
	deleteNote: notesRouter.deleteNote,

	// Notifications routes
	getUnreadNotificationCount: notificationsRouter.getUnreadNotificationCount,
	getAllNotifications: notificationsRouter.getAllNotifications,
	getNotificationsByRole: notificationsRouter.getNotificationsByRole,
	getNotificationsByAssign: notificationsRouter.getNotificationsByAssign,
	getNotificationsByRoles: notificationsRouter.getNotificationsByRoles,
	changeNotificationStatus: notificationsRouter.changeNotificationStatus,
	getNotificationDocuments: notificationsRouter.getNotificationDocuments,
	addDocumentToNotification: notificationsRouter.addDocumentToNotification,
	getAccountDocumentsByOpportunities:
		notificationsRouter.getAccountDocumentsByOpportunities,
	markAllNotificationsAsRead: notificationsRouter.markAllNotificationsAsRead,

	// Quotations routes
	createQuotation: quotationsRouter.createQuotation,
	getQuotations: quotationsRouter.getQuotations,
	getQuotationById: quotationsRouter.getQuotationById,
	updateQuotation: quotationsRouter.updateQuotation,
	deleteQuotation: quotationsRouter.deleteQuotation,
	listQuotationsByOpportunity: quotationsRouter.listQuotationsByOpportunity,

	// Credit Checks routes (Emisión de Cheques)
	createCheck: checksRouter.createCheck,
	getChecksByOpportunity: checksRouter.getChecksByOpportunity,
	getChecksByQuotation: checksRouter.getChecksByQuotation,
	updateCheck: checksRouter.updateCheck,
	deleteCheck: checksRouter.deleteCheck,
	getChecksSummary: checksRouter.getChecksSummary,

	// Guatemala Locations routes (Catálogo de ubicaciones)
	getDepartamentos: locationsRouter.getDepartamentos,
	getMunicipiosByDepartamento: locationsRouter.getMunicipiosByDepartamento,
	getAllLocations: locationsRouter.getAllLocations,
	seedLocations: locationsRouter.seedLocations,

	// Insurance routes
	getInsuranceCost: insuranceRouter.getInsuranceCost,

	// Auction routes (subastas 🚗💸)
	createAuction: auctionRouter.createAuction,
	closeAuction: auctionRouter.closeAuction,
	getAuctions: auctionRouter.getAuctions,
	addAuctionExpense: auctionRouter.addAuctionExpense,
	cancelAuction: auctionRouter.cancelAuction,

	// Reports routes (reportes 📊)
	getDashboardExecutivo: reportsRouter.getDashboardExecutivo,
	getReporteCobranza: reportsRouter.getReporteCobranza,
	getReporteCartera: reportsRouter.getReporteCartera,
	getReporteInventario: reportsRouter.getReporteInventario,
	getReporteSubastas: reportsRouter.getReporteSubastas,
	// Reportes unificados (cartera-back + CRM)
	getReporteCarteraCompleto: reportesCarteraRouter.getReporteCarteraCompleto,
	getReporteEficienciaCobros: reportesCarteraRouter.getReporteEficienciaCobros,

	// MiniAgent routes
	getMiniAgentCredentials: miniagentRouter.getMiniAgentCredentials,

	// Admin MiniAgent routes
	adminListUsersWithCredentials: adminMiniagentRouter.listUsersWithCredentials,
	adminSetMiniAgentCredentials: adminMiniagentRouter.setMiniAgentCredentials,
	adminDeleteMiniAgentCredentials:
		adminMiniagentRouter.deleteMiniAgentCredentials,

	// Accounting routes (Contabilidad)
	getResumenGlobalInversionistas:
		accountingRouter.getResumenGlobalInversionistas,
	createBoleta: accountingRouter.createBoleta,
	liquidateInversionista: accountingRouter.liquidateInversionista,
};

// Investment routes exported separately to avoid TS7056 with declaration emit.
// The investmentsRouter type is too complex for TypeScript to serialize in a
// single appRouter declaration. Client merges both types.
// See: https://orpc.dev/docs/advanced/exceeds-the-maximum-length-problem

// Disbursement routes exported separately to avoid TS7056 with declaration emit.
export const disbursementRouter = {
	getDisbursementForOpportunity:
		notificationsRouter.getDisbursementForOpportunity,
	deleteNotificationDocument: notificationsRouter.deleteNotificationDocument,
	notifyDisbursementCompleted: notificationsRouter.notifyDisbursementCompleted,

	// Upload (presigned URLs) — placed here to avoid TS7056 in appRouter
	getUploadPresignedUrl: uploadRouter.getUploadPresignedUrl,

	// Dashboard jurídico manual
	getJuridicoDashboardSnapshot: juridicoDashboardRouter.getSnapshot,
	updateJuridicoDashboardSnapshot: juridicoDashboardRouter.updateSnapshot,
};

export type AppRouter = typeof appRouter;
