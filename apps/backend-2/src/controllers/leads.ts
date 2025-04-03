import type {
  InsertLead,
  InsertInvestorLead,
  InsertClientLead,
} from "../database/schemas/landing";
import {
  createLead,
  getLeads,
  getLeadById,
  getLeadByPhone,
  getLeadByEmail,
  deleteLead,
  deleteLeadByPhone,
  deleteLeadByEmail,
  createInvestorLead,
  getAllInvestorLeads,
  createClientLead,
  getAllClientLeads,
} from "../database/queries/landing";

export const saveLead = async (lead: InsertLead) => {
  return createLead(lead);
};

export const saveInvestorLead = async (lead: InsertInvestorLead) => {
  return createInvestorLead(lead);
};

export const saveClientLead = async (lead: InsertClientLead) => {
  return createClientLead(lead);
};

export const updateLead = async (lead: InsertLead) => {
  return createLead(lead);
};

export const listAllLeads = async () => {
  return getLeads();
};

export const findLeadById = async (id: number) => {
  return getLeadById(id);
};

export const findLeadByPhone = async (phone: string) => {
  return getLeadByPhone(phone);
};

export const findLeadByEmail = async (email: string) => {
  return getLeadByEmail(email);
};

export const removeLeadById = async (id: number) => {
  return deleteLead(id);
};

export const removeLeadByPhone = async (phone: string) => {
  return deleteLeadByPhone(phone);
};

export const removeLeadByEmail = async (email: string) => {
  return deleteLeadByEmail(email);
};

export const listAllInvestorLeads = async () => {
  return getAllInvestorLeads();
};

export const listAllClientLeads = async () => {
  return getAllClientLeads();
};
