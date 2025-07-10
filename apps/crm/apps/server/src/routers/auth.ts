import { protectedProcedure, publicProcedure } from "../lib/orpc";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { eq } from "drizzle-orm";

export const authRouter = {
  getUserProfile: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session?.user?.id;
    if (!userId) {
      throw new Error("User not found");
    }
    
    const userData = await db.select().from(user).where(eq(user.id, userId)).limit(1);
    return userData[0] || null;
  }),
  
  privateData: protectedProcedure.handler(({ context }) => {
    return {
      message: "This is private",
      user: context.session?.user,
    };
  }),
};