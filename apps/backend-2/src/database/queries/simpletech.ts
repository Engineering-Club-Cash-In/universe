import { db } from "../index";
import {
  leadsTable,
  InsertLead,
  Lead,
  creditScoresTable,
  InsertCreditScore,
  CreditScore,
  InsertCreditProfile,
  creditProfilesTable,
  CreditProfile,
} from "../schemas/simpletech";
import { eq } from "drizzle-orm";

export const findDuplicateLeads = async (phone: string) => {
  const leads = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.phone, phone));
  return leads;
};

export const insertLead = async (lead: InsertLead) => {
  const newLead = await db.insert(leadsTable).values(lead).returning();
  return newLead;
};

export const updateLeadByCrmId = async (
  lead: Omit<Lead, "id" | "phone" | "createdAt">
) => {
  const updatedLead = await db
    .update(leadsTable)
    .set(lead)
    .where(eq(leadsTable.crmId, lead.crmId))
    .returning();
  return updatedLead;
};

export const getLead = async (id: number) => {
  const lead = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
  return lead;
};

export const getLeadByCrmId = async (crmId: string) => {
  const lead = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.crmId, crmId));
  return lead;
};

export const insertCreditScore = async (creditScore: InsertCreditScore) => {
  const newCreditScore = await db
    .insert(creditScoresTable)
    .values(creditScore)
    .returning();
  return newCreditScore;
};

export const insertCreditProfile = async (
  creditProfile: InsertCreditProfile
) => {
  const newCreditProfile = await db
    .insert(creditProfilesTable)
    .values(creditProfile)
    .returning();
  return newCreditProfile;
};

export const updateCreditProfile = async ({
  leadId,
  minPayment,
  maxPayment,
  maxAdjustedPayment,
  maximumCredit,
  updatedAt,
}: {
  leadId: number;
  minPayment: number;
  maxPayment: number;
  maxAdjustedPayment: number;
  maximumCredit: number;
  updatedAt: Date;
}) => {
  if (!leadId) {
    throw new Error("Lead ID is required");
  }
  const updatedCreditProfile = await db
    .update(creditProfilesTable)
    .set({
      leadId,
      minPayment,
      maxPayment,
      maxAdjustedPayment,
      maximumCredit,
      updatedAt,
    })
    .where(eq(creditProfilesTable.leadId, leadId))
    .returning();
  return updatedCreditProfile;
};

export const getCreditProfile = async (id: number) => {
  const creditProfile = await db
    .select()
    .from(creditProfilesTable)
    .where(eq(creditProfilesTable.id, id));
  return creditProfile;
};

export const getCreditProfileByLeadId = async (leadId: number) => {
  const creditProfile = await db
    .select()
    .from(creditProfilesTable)
    .where(eq(creditProfilesTable.leadId, leadId));
  return creditProfile;
};
