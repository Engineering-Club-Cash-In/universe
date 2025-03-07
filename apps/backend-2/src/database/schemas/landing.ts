import type { Root } from "@cci/ts-schemas";
import {
  integer,
  real,
  pgTable,
  timestamp,
  text,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";

export interface MissingPayments {
  fit: boolean;
  probability: number;
}

// This are the users that will be inserting their dpi and other information
// And want to know if they qualify for a loan

export const leadsTable = pgTable("leads", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  desiredAmount: integer("desired_amount"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type Lead = typeof leadsTable.$inferSelect;
export type InsertLead = typeof leadsTable.$inferInsert;

export const creditRecordsTable = pgTable("credit_records", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  leadId: integer("lead_id").references(() => leadsTable.id),
  threadId: text("thread_id"),
  runId: text("run_id"),
  result: jsonb("result").$type<Root>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type CreditRecord = typeof creditRecordsTable.$inferSelect;
export type InsertCreditRecord = typeof creditRecordsTable.$inferInsert;

export const creditRecordResultsTable = pgTable("credit_record_results", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  creditRecordId: integer("credit_record_id").references(
    () => creditRecordsTable.id
  ),
  minPayment: real("min_payment"),
  maxPayment: real("max_payment"),
  maxAdjustedPayment: real("max_adjusted_payment"),
  maximumCredit: real("maximum_credit"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type CreditRecordResult = typeof creditRecordResultsTable.$inferSelect;
export type InsertCreditRecordResult =
  typeof creditRecordResultsTable.$inferInsert;

export const creditScoresTable = pgTable("credit_scores", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  creditRecordId: integer("credit_record_id").references(
    () => creditRecordsTable.id
  ),
  fit: boolean("fit"),
  probability: real("probability"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type CreditScore = typeof creditScoresTable.$inferSelect;
export type InsertCreditScore = typeof creditScoresTable.$inferInsert;
