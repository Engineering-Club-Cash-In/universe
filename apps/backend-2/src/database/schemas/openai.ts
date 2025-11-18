import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
} from "drizzle-orm/pg-core";
import { leadsTable } from "./simpletech";

export const openaiRunsTable = pgTable("openai_runs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  leadId: integer("lead_id").references(() => leadsTable.id),
  threadId: text("thread_id").notNull(),
  runId: text("run_id").notNull(),
  status: boolean("status").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type OpenaiRun = typeof openaiRunsTable.$inferSelect;
export type InsertOpenaiRun = typeof openaiRunsTable.$inferInsert;
