import type { FormInvestorValues } from "../hooks/useFormInvestor";
import { apiCRM } from "@/lib/api/apiCRM";
import { normalizeInvestmentLeadSource } from "@/lib/leadAttribution";

interface LeadInvestorPayload {
  profileType: string;
  name?: string;
  companyName?: string;
  legalRepresentative?: string;
  email: string;
  phones: string;
  dpi: string;
  investmentExperience: string;
  proposedAmount: number;
  notes: string;
  source?: string;
  campaign?: string;
}

export const sendLeadInvestor = async (
  data: FormInvestorValues,
  source?: string,
  campaign?: string
) => {
  const payload: LeadInvestorPayload = {
    profileType: data.profileType,
    name: data.nombreCompleto,
    email: data.correo,
    phones: data.telefono,
    dpi: data.dpi,
    investmentExperience: data.experiencia,
    proposedAmount: Number(data.proposedAmount),
    notes: data.mensaje || "",
  };

  if (data.profileType === "individual") {
    payload.name = data.nombreCompleto;
  } else {
    payload.companyName = data.nombreSociedad;
    payload.name = data.representanteLegal;
  }

  const normalizedSource = normalizeInvestmentLeadSource(source);

  if (normalizedSource) {
    payload.source = normalizedSource;
  }

  if (campaign) {
    payload.campaign = campaign;
  }

  const response = await apiCRM.post("/api/public/investment-lead", payload);
  return response.data;
};
