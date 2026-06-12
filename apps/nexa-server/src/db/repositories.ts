import { eq, sql } from "drizzle-orm";
import type { TokenTransaction } from "../nexa/schemas";
import type { MockCreditLedger } from "../payments/mock-ledger";
import type { PaymentTransactionRepository, TokenUserRepository } from "../payments/repositories";
import type { TokenUserCreationRepository } from "../tokens/service";
import type { NexaDb } from "./index";
import { mockCarteraCredits, nexaPaymentTokens, nexaPaymentTransactions, nexaPollRuns, nexaTokenUsers } from "./schema";

export class PaymentTokenRepository {
  constructor(private readonly db: NexaDb) {}

  async findActive() {
    const [token] = await this.db.select().from(nexaPaymentTokens).where(eq(nexaPaymentTokens.active, true)).limit(1);
    return token ?? null;
  }

  async create(input: { nexaTokenId: number; prefix: string; account: string; name: string }) {
    const [token] = await this.db.insert(nexaPaymentTokens).values(input).returning();
    return token;
  }
}

export class DbTokenUserRepository implements TokenUserRepository, TokenUserCreationRepository {
  constructor(private readonly db: NexaDb) {}

  async nextIdentifierSequence() {
    const result = await this.db.execute(sql<{ value: string }>`select nextval('nexa_token_identifier_seq')::text as value`);
    return Number(result.rows[0]?.value);
  }

  async createTokenUser(user: {
    paymentTokenId: number;
    creditoId: number;
    identifier: string;
    description: string;
    nationalId: string;
    nexaUserId: number;
    token: string;
  }) {
    const [created] = await this.db.insert(nexaTokenUsers).values(user).returning();
    return created;
  }

  async findByToken(token: string) {
    const [user] = await this.db.select().from(nexaTokenUsers).where(eq(nexaTokenUsers.token, token)).limit(1);
    return user ? { creditoId: user.creditoId } : null;
  }

  async list() {
    return this.db.select().from(nexaTokenUsers).orderBy(nexaTokenUsers.id);
  }
}

export class DbPaymentTransactionRepository implements PaymentTransactionRepository {
  constructor(private readonly db: NexaDb) {}

  async existsByReference(reference: string) {
    const [transaction] = await this.db.select({ id: nexaPaymentTransactions.id }).from(nexaPaymentTransactions).where(eq(nexaPaymentTransactions.reference, reference)).limit(1);
    return Boolean(transaction);
  }

  async createPending(transaction: TokenTransaction) {
    const [created] = await this.db.insert(nexaPaymentTransactions).values({
      reference: String(transaction.reference),
      amount: String(transaction.amount),
      bank: transaction.bank,
      comments: transaction.comments ?? "",
      currency: transaction.currency,
      account: transaction.account,
      token: transaction.token,
      tokenDate: transaction.tokenDate,
      tokenIdentifier: transaction.tokenIdentifier,
      tokenName: transaction.tokenName,
      tokenPrefix: transaction.tokenPrefix,
      wasReturn: transaction.wasReturn,
      transactionId: transaction.transactionId,
      rawPayload: transaction,
    }).returning();

    return { id: created.id, ...transaction };
  }

  async markApplied(id: number, paymentId: number) {
    await this.db.update(nexaPaymentTransactions).set({ processingStatus: "APPLIED", carteraPaymentId: paymentId, updatedAt: new Date() }).where(eq(nexaPaymentTransactions.id, id));
  }

  async markRejected(id: number, reason: string) {
    await this.db.update(nexaPaymentTransactions).set({ processingStatus: "REJECTED", failureReason: reason, updatedAt: new Date() }).where(eq(nexaPaymentTransactions.id, id));
  }

  async markFailed(id: number, reason: string) {
    await this.db.update(nexaPaymentTransactions).set({ processingStatus: "FAILED", failureReason: reason, updatedAt: new Date() }).where(eq(nexaPaymentTransactions.id, id));
  }

  async list() {
    return this.db.select().from(nexaPaymentTransactions).orderBy(nexaPaymentTransactions.id);
  }
}

export class PollRunRepository {
  constructor(private readonly db: NexaDb) {}

  async run<T>(date: string, callback: () => Promise<T & { found: number; created: number; applied: number; rejected: number; skipped: number; failed: number }>) {
    const [run] = await this.db.insert(nexaPollRuns).values({ date, status: "RUNNING" }).returning();
    try {
      const result = await callback();
      await this.db.update(nexaPollRuns).set({
        status: "COMPLETED",
        transactionsFound: result.found,
        transactionsCreated: result.created,
        transactionsApplied: result.applied,
        transactionsRejected: result.rejected,
        transactionsSkipped: result.skipped,
        transactionsFailed: result.failed,
        finishedAt: new Date(),
      }).where(eq(nexaPollRuns.id, run.id));
      return result;
    } catch (error) {
      await this.db.update(nexaPollRuns).set({ status: "FAILED", error: error instanceof Error ? error.message : String(error), finishedAt: new Date() }).where(eq(nexaPollRuns.id, run.id));
      throw error;
    }
  }
}

export class MockCreditRepository implements MockCreditLedger {
  constructor(private readonly db: NexaDb) {}

  async upsert(input: { creditoId: number; borrowerName: string; initialBalance: number; installmentAmount: number }) {
    const values = {
      creditoId: input.creditoId,
      borrowerName: input.borrowerName,
      initialBalance: String(input.initialBalance),
      currentBalance: String(input.initialBalance),
      installmentAmount: String(input.installmentAmount),
      totalPaid: "0",
      updatedAt: new Date(),
    };
    const [credit] = await this.db
      .insert(mockCarteraCredits)
      .values(values)
      .onConflictDoUpdate({ target: mockCarteraCredits.creditoId, set: values })
      .returning();
    return credit;
  }

  async list() {
    return this.db.select().from(mockCarteraCredits).orderBy(mockCarteraCredits.id);
  }

  async applyPayment(input: { creditoId: number; amount: number; reference: string }) {
    const [credit] = await this.db.select().from(mockCarteraCredits).where(eq(mockCarteraCredits.creditoId, input.creditoId)).limit(1);
    if (!credit) {
      throw new Error(`Mock credit ${input.creditoId} not found`);
    }

    const currentBalance = Math.max(0, Number(credit.currentBalance) - input.amount);
    const totalPaid = Number(credit.totalPaid) + input.amount;
    const [updated] = await this.db
      .update(mockCarteraCredits)
      .set({ currentBalance: String(currentBalance), totalPaid: String(totalPaid), updatedAt: new Date() })
      .where(eq(mockCarteraCredits.creditoId, input.creditoId))
      .returning();

    return {
      paymentId: Number(input.reference),
      creditoId: updated.creditoId,
      currentBalance,
      totalPaid,
    };
  }
}
