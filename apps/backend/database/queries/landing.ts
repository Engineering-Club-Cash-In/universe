import { db } from "../index";
import {
  creditRecordsTable,
  creditRecordResultsTable,
  leadsTable,
  type InsertCreditRecord,
  type InsertLead,
  type InsertCreditRecordResult,
  type CreditRecord,
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
  return db.select().from(leadsTable);
};

export const getLeadById = async (id: number) => {
  return db.select().from(leadsTable).where(eq(leadsTable.id, id));
};

export const getLeadByPhone = async (phone: string) => {
  return db.select().from(leadsTable).where(eq(leadsTable.phone, phone));
};

export const getLeadByEmail = async (email: string) => {
  return db.select().from(leadsTable).where(eq(leadsTable.email, email));
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
  return db.delete(leadsTable).where(eq(leadsTable.id, id));
};

export const deleteLeadByPhone = async (phone: string) => {
  return db.delete(leadsTable).where(eq(leadsTable.phone, phone));
};

export const deleteLeadByEmail = async (email: string) => {
  return db.delete(leadsTable).where(eq(leadsTable.email, email));
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
  return db.insert(creditRecordsTable).values(creditRecord);
};

export const findAllPendingCreditRecords = async () => {
  return db
    .select()
    .from(creditRecordsTable)
    .where(isNull(creditRecordsTable.result));
};

export const updateCreditRecord = async (creditRecord: CreditRecord) => {
  let { id, ...rest } = creditRecord;
  rest.updatedAt = new Date();
  return db
    .update(creditRecordsTable)
    .set(rest)
    .where(eq(creditRecordsTable.id, id));
};

// Credit Record Results
export const createCreditRecordResult = async (
  creditRecordResult: InsertCreditRecordResult
) => {
  return db.insert(creditRecordResultsTable).values(creditRecordResult);
};

export const getCreditRecordResults = async () => {
  return db.select().from(creditRecordResultsTable);
};
