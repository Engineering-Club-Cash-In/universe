import { initTRPC } from "@trpc/server";
/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
const t = initTRPC.create();
/**
 * Export reusable router and procedure helpers
 * that can be used throughout the router
 */
export const router = t.router;

export const publicProcedureWithLogger = t.procedure.use(async (opts) => {
  console.log(`[tRPC Request] Path: ${opts.path}, Type: ${opts.type}`);
  const startTime = Date.now();
  const result = await opts.next();
  const responseTime = Date.now() - startTime;
  console.log(
    `[tRPC Response] Path: ${opts.path}, Type: ${opts.type}, Response Time: ${responseTime}ms`
  );
  return result;
});
export const publicProcedure = t.procedure;
