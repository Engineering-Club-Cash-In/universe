import { publicProcedure } from "../lib/orpc";
import { adminRouter } from "./admin";
import { adminMiniagentRouter } from "./admin-miniagent";
import { auctionRouter } from "./auctionVehicles"; // Import the auction router
import { authRouter } from "./auth";
import { cobrosRouter } from "./cobros";
import { crmRouter } from "./crm";
import { insuranceRouter } from "./insurance";
import { legalContractsRouter } from "./legal-contracts";
import { miniagentRouter } from "./miniagent";
import { notesRouter } from "./notes";
import { quotationsRouter } from "./quotations";
import { reportesCarteraRouter } from "./reportes-cartera";
import * as reportsRouter from "./reports";
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
	deleteUser: adminRouter.deleteUser,
	createUser: adminRouter.createUser,

	// CRM routes
	getSalesStages: crmRouter.getSalesStages,
	getCrmUsers: crmRouter.getCrmUsers,
	getCompanies: crmRouter.getCompanies,
	createCompany: crmRouter.createCompany,
	updateCompany: crmRouter.updateCompany,
	getLeads: crmRouter.getLeads,
	createLead: crmRouter.createLead,
	updateLead: crmRouter.updateLead,
	getCreditAnalysisByLeadId: crmRouter.getCreditAnalysisByLeadId,
	getOpportunities: crmRouter.getOpportunities,
	createOpportunity: crmRouter.createOpportunity,
	updateOpportunity: crmRouter.updateOpportunity,
	getOpportunitiesForAnalysis: crmRouter.getOpportunitiesForAnalysis,
	approveOpportunityAnalysis: crmRouter.approveOpportunityAnalysis,
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
	getClients: crmRouter.getClients,
	createClient: crmRouter.createClient,
	updateClient: crmRouter.updateClient,
	getDashboardStats: crmRouter.getDashboardStats,

	// Vehicles routes
	getVehicles: vehiclesRouter.getAll,
	getVehicleById: vehiclesRouter.getById,
	createVehicle: vehiclesRouter.create,
	updateVehicle: vehiclesRouter.update,
	deleteVehicle: vehiclesRouter.delete,
	searchVehicles: vehiclesRouter.search,
	createVehicleInspection: vehiclesRouter.createInspection,
	updateVehicleInspection: vehiclesRouter.updateInspection,
	uploadVehiclePhoto: vehiclesRouter.uploadPhoto,
	deleteVehiclePhoto: vehiclesRouter.deletePhoto,
	getVehicleInspectionById: vehiclesRouter.getInspectionById,
	getVehicleStatistics: vehiclesRouter.getStatistics,
	createFullVehicleInspection: vehiclesRouter.createFullInspection,
	processVehicleRegistrationOCR: vehiclesRouter.processVehicleRegistrationOCR,
	getAIVehicleValuation: vehiclesRouter.getAIVehicleValuation,

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
	getTodosLosContratos: cobrosRouter.getTodosLosContratos,
	getDetallesContrato: cobrosRouter.getDetallesContrato,
	// Cartera-back integration endpoints
	registrarPago: cobrosRouter.registrarPago,
	getHistorialPagosCarteraBack: cobrosRouter.getHistorialPagosCarteraBack,
	getCreditoCarteraBack: cobrosRouter.getCreditoCarteraBack,
	sincronizarCasosCobros: cobrosRouter.sincronizarCasosCobros,
	getHistorialSincronizaciones: cobrosRouter.getHistorialSincronizaciones,
	getInversionistas: cobrosRouter.getInversionistas,
	getDetalleInversionista: cobrosRouter.getDetalleInversionista,
	getInversionistasDelCredito: cobrosRouter.getInversionistasDelCredito,

	// Legal Contracts routes (Jurídico)
	createLegalContract: legalContractsRouter.createLegalContract,
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

	// Vendors routes
	getVendors: vendorsRouter.getAll,
	getVendorById: vendorsRouter.getById,
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

	// Quotations routes
	createQuotation: quotationsRouter.createQuotation,
	getQuotations: quotationsRouter.getQuotations,
	getQuotationById: quotationsRouter.getQuotationById,
	updateQuotation: quotationsRouter.updateQuotation,
	deleteQuotation: quotationsRouter.deleteQuotation,

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
};

export type AppRouter = typeof appRouter;
