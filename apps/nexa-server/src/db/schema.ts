import { boolean, index, integer, jsonb, numeric, pgEnum, pgSequence, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const tokenIdentifierSequence = pgSequence("nexa_token_identifier_seq", {
  startWith: 100_000_000,
  increment: 1,
  minValue: 100_000_000,
  maxValue: 999_999_999,
});

export const processingStatus = pgEnum("nexa_processing_status", ["PENDING", "APPLIED", "REJECTED", "FAILED"]);
export const reviewStatus = pgEnum("nexa_review_status", ["APPROVED", "REJECTED"]);
export const pollRunStatus = pgEnum("nexa_poll_run_status", ["RUNNING", "COMPLETED", "FAILED"]);

export const nexaPaymentTokens = pgTable("nexa_payment_tokens", {
  id: serial("id").primaryKey(),
  nexaTokenId: integer("nexa_token_id").notNull().unique(),
  prefix: varchar("prefix", { length: 7 }).notNull(),
  account: varchar("account", { length: 40 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const nexaTokenUsers = pgTable("nexa_token_users", {
  id: serial("id").primaryKey(),
  paymentTokenId: integer("payment_token_id").notNull().references(() => nexaPaymentTokens.id),
  nexaUserId: integer("nexa_user_id").notNull().unique(),
  creditoId: integer("credito_id").notNull().unique(),
  identifier: varchar("identifier", { length: 9 }).notNull().unique(),
  token: varchar("token", { length: 32 }).notNull().unique(),
  description: varchar("description", { length: 200 }).notNull(),
  nationalId: varchar("national_id", { length: 20 }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tokenIdx: uniqueIndex("nexa_token_users_token_idx").on(table.token),
  creditoIdx: uniqueIndex("nexa_token_users_credito_idx").on(table.creditoId),
}));

export const nexaPaymentTransactions = pgTable("nexa_payment_transactions", {
  id: serial("id").primaryKey(),
  reference: varchar("reference", { length: 80 }).notNull().unique(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  bank: varchar("bank", { length: 80 }).notNull(),
  comments: text("comments").notNull().default(""),
  currency: varchar("currency", { length: 3 }).notNull(),
  account: varchar("account", { length: 80 }).notNull(),
  token: varchar("token", { length: 32 }).notNull(),
  tokenDate: varchar("token_date", { length: 80 }).notNull(),
  tokenIdentifier: varchar("token_identifier", { length: 9 }).notNull(),
  tokenName: varchar("token_name", { length: 200 }).notNull(),
  tokenPrefix: varchar("token_prefix", { length: 7 }).notNull(),
  wasReturn: integer("was_return").notNull(),
  transactionId: varchar("transaction_id", { length: 120 }).notNull().default(""),
  processingStatus: processingStatus("processing_status").notNull().default("PENDING"),
  carteraPaymentId: integer("cartera_payment_id"),
  failureReason: text("failure_reason"),
  rawPayload: jsonb("raw_payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  referenceIdx: uniqueIndex("nexa_payment_transactions_reference_idx").on(table.reference),
  tokenIdx: index("nexa_payment_transactions_token_idx").on(table.token),
  statusIdx: index("nexa_payment_transactions_status_idx").on(table.processingStatus),
}));

export const nexaPollRuns = pgTable("nexa_poll_runs", {
  id: serial("id").primaryKey(),
  date: varchar("date", { length: 10 }).notNull(),
  status: pollRunStatus("status").notNull().default("RUNNING"),
  transactionsFound: integer("transactions_found").notNull().default(0),
  transactionsCreated: integer("transactions_created").notNull().default(0),
  transactionsApplied: integer("transactions_applied").notNull().default(0),
  transactionsRejected: integer("transactions_rejected").notNull().default(0),
  transactionsSkipped: integer("transactions_skipped").notNull().default(0),
  transactionsFailed: integer("transactions_failed").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const nexaReviews = pgTable("nexa_reviews", {
  id: serial("id").primaryKey(),
  transactionId: integer("transaction_id").notNull().references(() => nexaPaymentTransactions.id),
  reference: varchar("reference", { length: 80 }).notNull(),
  status: reviewStatus("status").notNull(),
  requestPayload: jsonb("request_payload").notNull(),
  responsePayload: jsonb("response_payload"),
  attempts: integer("attempts").notNull().default(1),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const mockCarteraCredits = pgTable("mock_cartera_credits", {
  id: serial("id").primaryKey(),
  creditoId: integer("credito_id").notNull().unique(),
  borrowerName: varchar("borrower_name", { length: 160 }).notNull().default("Cliente prueba"),
  installmentAmount: numeric("installment_amount", { precision: 18, scale: 2 }).notNull(),
  initialBalance: numeric("initial_balance", { precision: 18, scale: 2 }).notNull(),
  currentBalance: numeric("current_balance", { precision: 18, scale: 2 }).notNull(),
  totalPaid: numeric("total_paid", { precision: 18, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
