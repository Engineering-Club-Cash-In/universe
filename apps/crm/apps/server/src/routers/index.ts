import { publicProcedure } from "../lib/orpc";
import { adminRouter } from "./admin";
import { authRouter } from "./auth";
import { crmRouter } from "./crm";
import { vehiclesRouter } from "./vehicles";
import { cobrosRouter } from "./cobros";
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
	getClients: crmRouter.getClients,
	createClient: crmRouter.createClient,
	updateClient: crmRouter.updateClient,
	getDashboardStats: crmRouter.getDashboardStats,
	
	// Document Management
	getOpportunityDocuments: crmRouter.getOpportunityDocuments,
	uploadOpportunityDocument: crmRouter.uploadOpportunityDocument,
	deleteOpportunityDocument: crmRouter.deleteOpportunityDocument,

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

	// Vendors routes
	getVendors: vendorsRouter.getAll,
	getVendorById: vendorsRouter.getById,
	createVendor: vendorsRouter.create,
	updateVendor: vendorsRouter.update,
	deleteVendor: vendorsRouter.delete,
	searchVendors: vendorsRouter.search,
};

export type AppRouter = typeof appRouter;
