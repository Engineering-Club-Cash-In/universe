import {
  pgTable,
  text,
  integer,
  timestamp,
  boolean,
  real,
} from "drizzle-orm/pg-core";

export const leadsTable = pgTable("st_leads", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  crmId: text("crm_id").notNull(),
  phone: text("phone").notNull(),
  age: integer("age"),
  civilStatus: text("civil_status"), // SOLTERO, CASADO, VIUDO
  economicDependents: integer("economic_dependents"),
  monthlyIncome: integer("monthly_income"),
  financingAmount: integer("financing_amount"),
  occupation: text("occupation"), // PROPIETARIO, COLABORADOR
  workTime: text("work_time"), // ONETOFIVE, FIVETOTEN, TENPLUS
  moneyUsage: text("money_usage"), // PERSONAL, TRABAJO
  hasOwnHouse: boolean("has_own_house"),
  hasOwnVehicle: boolean("has_own_vehicle"),
  hasCreditCard: boolean("has_credit_card"),
  name: text("name"), // From DPI OCR
  documentNumber: text("document_number"), // From DPI OCR
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type Lead = typeof leadsTable.$inferSelect;
export type InsertLead = typeof leadsTable.$inferInsert;

export const creditScoresTable = pgTable("st_credit_scores", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  leadId: integer("lead_id").references(() => leadsTable.id),
  fit: boolean("fit").notNull(),
  probability: real("probability").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type CreditScore = typeof creditScoresTable.$inferSelect;
export type InsertCreditScore = typeof creditScoresTable.$inferInsert;

export const creditProfilesTable = pgTable("st_credit_profiles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  leadId: integer("lead_id").references(() => leadsTable.id),
  firstStatementUrl: text("first_statement_url").notNull(),
  secondStatementUrl: text("second_statement_url").notNull(),
  thirdStatementUrl: text("third_statement_url").notNull(),
  minPayment: real("min_payment"),
  maxPayment: real("max_payment"),
  maxAdjustedPayment: real("max_adjusted_payment"),
  maximumCredit: real("maximum_credit"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type CreditProfile = typeof creditProfilesTable.$inferSelect;
export type InsertCreditProfile = typeof creditProfilesTable.$inferInsert;
