import { db } from "../index";
import {
  creditRecordsTable,
  creditRecordResultsTable,
  leadsTable,
  type InsertCreditRecord,
  type InsertLead,
  type InsertCreditRecordResult,
  type CreditRecord,
  creditScoresTable,
} from "../schemas/landing";
import { eq, isNull } from "drizzle-orm";

// Leads
export const createLead = async (lead: InsertLead) => {
  const result = await db.insert(leadsTable).values(lead).returning();
  return {
    success: true,
    data: result[0],
    error: null,
    message: "Lead created successfully",
  };
};

export const getLeads = async () => {
  return await db.select().from(leadsTable);
};

export const getLeadById = async (id: number) => {
  return await db.select().from(leadsTable).where(eq(leadsTable.id, id));
};

export const getLeadByPhone = async (phone: string) => {
  return await db.select().from(leadsTable).where(eq(leadsTable.phone, phone));
};

export const getLeadByEmail = async (email: string) => {
  return await db.select().from(leadsTable).where(eq(leadsTable.email, email));
};

export const getLeadByCreditRecordId = async (creditRecordId: number) => {
  const result = await db
    .select()
    .from(leadsTable)
    .innerJoin(creditRecordsTable, eq(leadsTable.id, creditRecordsTable.leadId))
    .where(eq(creditRecordsTable.id, creditRecordId));
  return result[0];
};

export const deleteLead = async (id: number) => {
  return await db.delete(leadsTable).where(eq(leadsTable.id, id));
};

export const deleteLeadByPhone = async (phone: string) => {
  return await db.delete(leadsTable).where(eq(leadsTable.phone, phone));
};

export const deleteLeadByEmail = async (email: string) => {
  return await db.delete(leadsTable).where(eq(leadsTable.email, email));
};

export const getDesiredAmountByCreditRecordId = async (
  creditRecordId: number
) => {
  const result = await db
    .select({
      desiredAmount: leadsTable.desiredAmount,
    })
    .from(creditRecordsTable)
    .innerJoin(leadsTable, eq(creditRecordsTable.leadId, leadsTable.id))
    .where(eq(creditRecordsTable.id, creditRecordId));
  return result[0]?.desiredAmount;
};

// Credit Records
export const createCreditRecord = async (creditRecord: InsertCreditRecord) => {
  return await db.insert(creditRecordsTable).values(creditRecord);
};

export const findAllPendingCreditRecords = async () => {
  return await db
    .select()
    .from(creditRecordsTable)
    .where(isNull(creditRecordsTable.result));
};

export const updateCreditRecord = async (creditRecord: CreditRecord) => {
  let { id, ...rest } = creditRecord;
  rest.updatedAt = new Date();
  return await db
    .update(creditRecordsTable)
    .set(rest)
    .where(eq(creditRecordsTable.id, id));
};

export const deleteCreditRecord = async (id: number) => {
  return await db
    .delete(creditRecordsTable)
    .where(eq(creditRecordsTable.id, id));
};

// Credit Record Results
export const createCreditRecordResult = async (
  creditRecordResult: InsertCreditRecordResult
) => {
  return await db.insert(creditRecordResultsTable).values(creditRecordResult);
};

export const getCreditRecordResults = async () => {
  return await db.select().from(creditRecordResultsTable);
};

export const createCreditScore = async (
  leadId: number,
  fit: boolean,
  probability: number
) => {
  try {
    const creditRecord = await db
      .select()
      .from(creditRecordsTable)
      .where(eq(creditRecordsTable.leadId, leadId));

    if (!creditRecord) {
      throw new Error(`Credit record not found for leadId: ${leadId}`);
    }
    console.log("Credit record:", creditRecord);
    return await db.insert(creditScoresTable).values({
      creditRecordId: creditRecord[0].id,
      fit: fit,
      probability: probability,
    });
  } catch (error) {
    console.error("Error setting credit record score:", error);
    throw error;
  }
};
export const getCreditScoreAndRecordByLeadEmail = async (email: string) => {
  // First find the lead by email
  const lead = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.email, email));
  // Then find the credit record by lead id
  const creditRecord = await db
    .select({
      id: creditRecordsTable.id,
    })
    .from(creditRecordsTable)
    .where(eq(creditRecordsTable.leadId, lead[0].id));
  // Then find the credit score by credit record id
  const score = await db
    .select({
      fit: creditScoresTable.fit,
      probability: creditScoresTable.probability,
    })
    .from(creditScoresTable)
    .where(eq(creditScoresTable.creditRecordId, creditRecord[0].id));
  const result = await db
    .select({
      minPayment: creditRecordResultsTable.minPayment,
      maxPayment: creditRecordResultsTable.maxPayment,
      maxAdjustedPayment: creditRecordResultsTable.maxAdjustedPayment,
      maximumCredit: creditRecordResultsTable.maximumCredit,
    })
    .from(creditRecordResultsTable)
    .where(eq(creditRecordResultsTable.creditRecordId, creditRecord[0].id));
  return {
    creditScore: score[0],
    creditRecord: creditRecord[0],
    creditRecordResult: result[0],
  };
};
