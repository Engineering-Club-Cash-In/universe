import { protectedProcedure, publicProcedure } from "../lib/orpc";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { eq } from "drizzle-orm";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),
  privateData: protectedProcedure.handler(({ context }) => {
    return {
      message: "This is private",
      user: context.session?.user,
    };
  }),
  getUserProfile: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session?.user?.id;
    if (!userId) {
      throw new Error("User not found");
    }
    
    const userData = await db.select().from(user).where(eq(user.id, userId)).limit(1);
    return userData[0] || null;
  }),
  adminOnlyData: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session?.user?.id;
    if (!userId) {
      throw new Error("User not found");
    }
    
    const userData = await db.select().from(user).where(eq(user.id, userId)).limit(1);
    const userRole = userData[0]?.role;
    
    if (userRole !== 'admin') {
      throw new Error("Access denied: Admin role required");
    }
    
    return {
      message: "This is admin-only data",
      adminStats: {
        totalUsers: 42,
        totalSales: 150,
        revenue: "$50,000"
      }
    };
  }),
};
export type AppRouter = typeof appRouter;
