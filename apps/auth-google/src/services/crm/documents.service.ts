/**
 * Servicio para operaciones del CRM - Documentos y Contratos
 */

import { env } from "../../config/env";

// ============================================
// TIPOS DE DOCUMENTOS
// ============================================

export type DocumentType =
  // Documentos específicos para análisis (Individual y Comerciante)
  | "dpi"
  | "licencia"
  | "recibo_luz"
  | "recibo_adicional"
  | "formularios"
  | "estados_cuenta_1"
  | "estados_cuenta_2"
  | "estados_cuenta_3"
  // Documentos para comerciantes
  | "patente_comercio"
  // Documentos para empresas (S.A)
  | "representacion_legal"
  | "constitucion_sociedad"
  | "patente_mercantil"
  | "iva_1"
  | "iva_2"
  | "iva_3"
  | "estado_financiero"
  | "clausula_consentimiento"
  | "minutas"
  // Documentos específicos de vehículos
  | "tarjeta_circulacion"
  | "titulo_propiedad"
  | "dpi_dueno"
  | "patente_comercio_vehiculo"
  | "representacion_legal_vehiculo"
  | "dpi_representante_legal_vehiculo"
  | "pago_impuesto_circulacion"
  | "consulta_sat"
  | "consulta_garantias_mobiliarias"
  // Categorías generales (legacy)
  | "identification"
  | "income_proof"
  | "bank_statement"
  | "business_license"
  | "property_deed"
  | "vehicle_title"
  | "credit_report"
  | "other"
  | "detalle_analisis";

export type ContractType =
  | "cobertura_inrexsa"
  | "pagare"
  | "contrato_credito"
  | "other";

export type ContractStatus = "pending" | "signed" | "completed" | "cancelled";

// ============================================
// INTERFACES
// ============================================

export interface Document {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  documentType: DocumentType;
  description: string | null;
  uploadedAt: string;
  filePath: string;
  opportunityId: string;
  uploadedBy: {
    id: string;
    name: string;
  };
  url: string;
  opportunity: {
    id: string;
    title: string;
  };
}

export interface Contract {
  contract: {
    id: string;
    leadId: string;
    opportunityId: string | null;
    contractType: ContractType;
    contractName: string;
    clientSigningLink: string | null;
    representativeSigningLink: string | null;
    additionalSigningLinks: string | null;
    templateId: number;
    apiResponse: any;
    status: ContractStatus;
    generatedBy: string;
    generatedAt: string;
    createdAt: string;
    updatedAt: string;
  };
  lead: {
    id: string;
    firstName: string;
    lastName: string;
    dpi: string;
    email: string;
    phone: string;
  };
  opportunity: {
    id: string;
    title: string;
  } | null;
}

export interface DocumentsResponse {
  success: boolean;
  data: Document[];
}

export interface ContractsResponse {
  success: boolean;
  data: Contract[];
}

// ============================================
// FUNCIONES
// ============================================

/**
 * Obtiene todos los documentos personales del usuario
 */
export const getPersonalDocuments = async (
  email: string,
  dpi: string,
  token?: string
): Promise<Document[]> => {
  const response = await fetch(
    `${env.CRM_API_URL}/api/portal/lead/documents?email=${encodeURIComponent(email)}&dpi=${encodeURIComponent(dpi)}`,
    {
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    }
  );

  if (!response.ok) {
    throw new Error("Error al cargar los documentos");
  }

  const result = (await response.json()) as DocumentsResponse;
  return result.data;
};

/**
 * Obtiene todos los contratos del usuario
 */
export const getContracts = async (
  email: string,
  dpi: string,
  token?: string
): Promise<Contract[]> => {
  const response = await fetch(
    `${env.CRM_API_URL}/api/portal/lead/contracts?email=${encodeURIComponent(email)}&dpi=${encodeURIComponent(dpi)}`,
    {
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    }
  );

  if (!response.ok) {
    throw new Error("Error al cargar los contratos");
  }

  const result = (await response.json()) as ContractsResponse;
  return result.data;
};

/**
 * Función helper para obtener el label en español de un tipo de documento
 */
export const getDocumentTypeLabel = (type: DocumentType): string => {
  const labels: Record<DocumentType, string> = {
    dpi: "DPI Vigente",
    licencia: "Licencia Vigente",
    recibo_luz: "Recibo de Luz",
    recibo_adicional: "Recibo Adicional",
    formularios: "Formularios",
    estados_cuenta_1: "Estado de Cuenta Mes 1",
    estados_cuenta_2: "Estado de Cuenta Mes 2",
    estados_cuenta_3: "Estado de Cuenta Mes 3",
    patente_comercio: "Patente de Comercio",
    representacion_legal: "Representación Legal",
    constitucion_sociedad: "Constitución de Sociedad",
    patente_mercantil: "Patente Mercantil",
    iva_1: "Formulario IVA Mes 1",
    iva_2: "Formulario IVA Mes 2",
    iva_3: "Formulario IVA Mes 3",
    estado_financiero: "Estado Financiero",
    clausula_consentimiento: "Cláusula de Consentimiento",
    minutas: "Minutas",
    tarjeta_circulacion: "Tarjeta de Circulación",
    titulo_propiedad: "Título de Propiedad",
    dpi_dueno: "DPI del Dueño",
    patente_comercio_vehiculo: "Patente de Comercio (Vehículo)",
    representacion_legal_vehiculo: "Representación Legal (Vehículo)",
    dpi_representante_legal_vehiculo: "DPI Representante Legal (Vehículo)",
    pago_impuesto_circulacion: "Pago Impuesto de Circulación",
    consulta_sat: "Consulta SAT",
    consulta_garantias_mobiliarias: "Garantías Mobiliarias (RGM)",
    identification: "Identificación",
    income_proof: "Comprobante de Ingresos",
    bank_statement: "Estado de Cuenta Bancario",
    business_license: "Licencia de Negocio",
    property_deed: "Escritura de Propiedad",
    vehicle_title: "Título de Vehículo",
    credit_report: "Reporte Crediticio",
    other: "Otros",
    detalle_analisis: "Detalle de Análisis",
  };

  return labels[type] || type;
};
