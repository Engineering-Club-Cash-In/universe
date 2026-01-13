/**
 * Re-export de todos los servicios del CRM
 */

// Profile / Lead
export {
  getProfile,
  updateLead,
  getNumbersSifco,
  sendLead,
  type ProfileData,
  type VehiclePhoto,
  type Vehicle,
  type Opportunity,
  type UpdateFieldResponse,
  type UpdateLeadPayload,
  type SendLeadPayload,
} from "./profile.service";

// Documents
export {
  getPersonalDocuments,
  getContracts,
  getDocumentTypeLabel,
  type DocumentType,
  type ContractType,
  type ContractStatus,
  type Document,
  type Contract,
  type DocumentsResponse,
  type ContractsResponse,
} from "./documents.service";

// Credits
export {
  getCredits,
  getCreditByNumeroSifco,
  type CreditStatus,
  type CreditType,
  type FormatoCredito,
  type CuotaStatus,
  type Credito,
  type Usuario,
  type Cuota,
  type CreditoResponse,
} from "./credits.service";
