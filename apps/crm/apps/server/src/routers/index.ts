import { publicProcedure } from "../lib/orpc";
import { authRouter } from "./auth";
import { adminRouter } from "./admin";

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
};

export type AppRouter = typeof appRouter;
