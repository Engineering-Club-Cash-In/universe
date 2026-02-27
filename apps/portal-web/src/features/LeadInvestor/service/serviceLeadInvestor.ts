import type { FormInvestorValues } from "../hooks/useFormInvestor";
import { apiCRM } from "@/lib/api/apiCRM";

interface LeadInvestorPayload {
  profileType: string;
  firstName: string;
  lastName: string;
  companyName?: string;
  legalRepresentative?: string;
  email: string;
  phone: string;
  dpi: string;
  investmentExperience: string;
  notes: string;
}

export const sendLeadInvestor = async (data: FormInvestorValues) => {
  const payload: LeadInvestorPayload = {
    profileType: data.profileType,
    firstName: "",
    lastName: "",
    email: data.correo,
    phone: data.telefono,
    dpi: data.dpi,
    investmentExperience: data.experiencia,
    notes: data.mensaje || "",
  };

  if (data.profileType === "individual") {
    const nameParts = data.nombreCompleto.trim().split(" ");
    payload.firstName = nameParts[0] || "";
    payload.lastName = nameParts.slice(1).join(" ") || "";
  } else {
    payload.companyName = data.nombreSociedad;
    payload.legalRepresentative = data.representanteLegal;
  }

  const response = await apiCRM.post("/api/public/lead-investor", payload);
  return response.data;
};
