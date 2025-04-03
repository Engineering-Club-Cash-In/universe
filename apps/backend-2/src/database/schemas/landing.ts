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

// New schema for investor leads
export const investorLeadsTable = pgTable("investor_leads", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  fullName: text("full_name").notNull(),
  phoneNumber: text("phone_number").notNull(),
  email: text("email").notNull(),
  hasInvested: boolean("has_invested").notNull(),
  hasBankAccount: boolean("has_bank_account").notNull(),
  investmentRange: text("investment_range").notNull(),
  contactMethod: text("contact_method").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type InvestorLead = typeof investorLeadsTable.$inferSelect;
export type InsertInvestorLead = typeof investorLeadsTable.$inferInsert;

// New schema for client leads from Clients.tsx
export const clientLeadsTable = pgTable("client_leads", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  ready: boolean("ready").notNull(), // From the 'si'/'no' radio
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phoneNumber: text("phone_number").notNull(),
  loanType: text("loan_type").notNull(), // 'carLoan' or 'vehicleLoan'

  // Fields specific to carLoan
  carLoanInfoAction: text("car_loan_info_action"), // 'continue' or 'cancel'
  hasStatements: boolean("has_statements"), // Nullable if not carLoan or if cancelled

  // Fields specific to vehicleLoan
  vehicleLoanInfoAction: text("vehicle_loan_info_action"), // 'continue' or 'cancel'
  vehicleDetails: text("vehicle_details"), // Nullable if not vehicleLoan or if cancelled
  loanAmount: text("loan_amount"), // Storing as text as it's entered, can be parsed later. Nullable.

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type ClientLead = typeof clientLeadsTable.$inferSelect;
export type InsertClientLead = typeof clientLeadsTable.$inferInsert;
