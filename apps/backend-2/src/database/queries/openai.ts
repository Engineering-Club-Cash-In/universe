import { db } from "../index";
import { type InsertOpenaiRun, openaiRunsTable } from "../schemas/openai";
import { eq } from "drizzle-orm";
export const createOpenaiRun = async (run: InsertOpenaiRun) => {
  return await db.insert(openaiRunsTable).values(run);
};
export const getAllPendingOpenaiRuns = async () => {
  return await db
    .select()
    .from(openaiRunsTable)
    .where(eq(openaiRunsTable.status, false));
};

export const setOpenaiRunCompleted = async (runId: number) => {
  return await db
    .update(openaiRunsTable)
    .set({ status: true })
    .where(eq(openaiRunsTable.id, runId));
};
