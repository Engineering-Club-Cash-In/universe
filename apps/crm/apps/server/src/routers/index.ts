import { publicProcedure } from "../lib/orpc";
import { authRouter } from "./auth";
import { adminRouter } from "./admin";
import { crmRouter } from "./crm";

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
  getOpportunities: crmRouter.getOpportunities,
  createOpportunity: crmRouter.createOpportunity,
  getClients: crmRouter.getClients,
  createClient: crmRouter.createClient,
  updateClient: crmRouter.updateClient,
  getDashboardStats: crmRouter.getDashboardStats,
};

export type AppRouter = typeof appRouter;
