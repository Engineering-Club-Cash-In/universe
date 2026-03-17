import type { FormLeadsValues } from "../hooks/useForm";
import { apiCRM } from "@/lib/api/apiCRM";

interface LeadPayload {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dpi: string;
  creditType: string;
  loanPurpose: string;
  notes: string;
  source?: string;
}

export const sendLead = async (data: FormLeadsValues, source?: string) => {
  // Separar nombre completo en firstName y lastName
  const nameParts = data.nombreCompleto.trim().split(" ");
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  const payload: LeadPayload = {
    firstName,
    lastName,
    email: data.correo,
    phone: data.telefono,
    dpi: data.dpi,
    creditType: data.creditType,
    loanPurpose: "personal",
    notes: data.descripcion || "",
  };

  if (source) {
    payload.source = source;
  }

  const response = await apiCRM.post("/api/public/lead", payload);
  return response.data;
};
