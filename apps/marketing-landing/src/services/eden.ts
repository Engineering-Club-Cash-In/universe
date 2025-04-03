import type { App } from "backend-2";
import { BACKEND_ENVIRONMENTS } from "@/lib/utils";
import { treaty } from "@elysiajs/eden";

// Interface matching the expected input from the Clients.tsx form state
interface ClientFormData {
  ready: string; // 'si' or 'no'
  firstName: string;
  lastName: string;
  phoneNumber: string;
  loanType: string; // 'carLoan' or 'vehicleLoan'
  carLoanInfo?: string; // 'continue' or 'cancel'
  hasStatements?: string; // 'yes' or 'no'
  vehicleLoanInfo?: string; // 'continue' or 'cancel'
  vehicleDetails?: string;
  loanAmount?: string;
}

const environment = process.env.NODE_ENV || "DEV";
const client = treaty<App>(
  environment === "production"
    ? BACKEND_ENVIRONMENTS.PROD
    : BACKEND_ENVIRONMENTS.DEV
);

// Use the ClientFormData interface for the input parameter
export const saveClientLead = async (lead: ClientFormData) => {
  // Construct the object matching the expected body shape for the API endpoint
  // This intermediate object uses strings as defined in the router's t.Object
  const apiBody = {
    ready: lead.ready, // Keep as 'si'/'no' string
    firstName: lead.firstName,
    lastName: lead.lastName,
    phoneNumber: lead.phoneNumber,
    loanType: lead.loanType,
    carLoanInfo: lead.carLoanInfo,
    hasStatements: lead.hasStatements,
    vehicleLoanInfo: lead.vehicleLoanInfo,
    vehicleDetails: lead.vehicleDetails,
    loanAmount: lead.loanAmount,
  };

  // The backend router will handle converting 'si'/'yes' to boolean and nulling fields
  return client.landing["submit-client-lead"].post(apiBody);
};

interface InvestorFormData {
  email: string;
  fullName: string;
  phoneNumber: string;
  hasInvested: string;
  hasBankAccount: string;
  investmentRange: string;
  contactMethod: string;
}

export const saveInvestorLead = async (lead: InvestorFormData) => {
  return client.landing["submit-investor-lead"].post(lead);
};

// New service to get all investor leads
export const getAllInvestorLeads = async () => {
  return client.landing["investor-leads"].get();
};

// New service to get all client leads
export const getAllClientLeads = async () => {
  return client.landing["client-leads"].get();
};
