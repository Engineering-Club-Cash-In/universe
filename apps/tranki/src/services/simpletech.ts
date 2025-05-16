import { treaty } from "@elysiajs/eden";
import type { App } from "@repo/backend-2";

import { BACKEND_ENVIRONMENTS } from "../utils/constants";
const environment = import.meta.env.APP_ENV || "DEV";
const client = treaty<App>(
  environment === "production"
    ? BACKEND_ENVIRONMENTS.PROD
    : BACKEND_ENVIRONMENTS.DEV
);

export const healthCheck = async () => {
  const response = await client.simpletech.get();
  return response.data;
};

export const createLead = async (phone: string) => {
  const response = await client.simpletech.createLead.post({ phone });
  if (response.status !== 200) {
    throw new Error(response.data?.message || "Error creating lead");
  }
  return response.data?.data.leadId;
};

export interface FillLeadBody {
  name: string;
  leadId: string;
  age: number;
  civilStatus: "SINGLE" | "MARRIED" | "DIVORCED" | "WIDOWER";
  documentNumber: string;
  economicDependents: number;
  monthlyIncome: number;
  amountToFinance: number;
  ocupation: "OWNER" | "EMPLOYEE";
  timeEmployed: "1TO5" | "5TO10" | "10PLUS";
  hasCreditCard: boolean;
  hasVehicle: boolean;
  moneyPurpose: "PERSONAL" | "BUSINESS";
  ownsHouse: boolean;
  ownsVehicle: boolean;
}
export const createCreditScore = async (body: FillLeadBody) => {
  const response = await client.simpletech["create-credit-score"].post(body);
  if (response.status !== 200) {
    throw new Error(response.data?.message || "Error filling lead");
  }
  return response.data?.data.probability;
};

export interface CreateCreditProfileBody {
  leadId: string;
  firstStatement: string;
  secondStatement: string;
  thirdStatement: string;
}
export const createCreditProfile = async (body: CreateCreditProfileBody) => {
  const response = await client.simpletech["create-credit-profile"].post(body);
  if (response.status !== 200) {
    throw new Error(response.data?.message || "Error filling lead");
  }
  return response.data?.data.leadId;
};
