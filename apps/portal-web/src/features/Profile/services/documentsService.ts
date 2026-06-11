/**
 * Servicio de documentos y contratos - Proxy a través de Better Auth API
 */

import apiAuth from "@/lib/api/apiAuth";
import type { AxiosError } from "axios";

// Tipos de documentos según el enum del backend
export type DocumentType =
  // Documentos específicos para análisis (Individual y Comerciante)
  | "dpi" // DPI vigente
  | "licencia" // Licencia vigente
  | "recibo_luz" // Recibo de luz (no mayor a 2 meses)
  | "recibo_adicional" // Recibo adicional con misma dirección
  | "formularios" // Formularios completamente llenos
  | "estados_cuenta_1" // Estado de cuenta mes 1
  | "estados_cuenta_2" // Estado de cuenta mes 2
  | "estados_cuenta_3" // Estado de cuenta mes 3
  // Documentos para comerciantes
  | "patente_comercio" // Patente de comercio
  // Documentos para empresas (S.A)
  | "representacion_legal" // Representación Legal
  | "constitucion_sociedad" // Constitución de sociedad
  | "patente_mercantil" // Patente de comercio y mercantil
  | "iva_1" // Formulario IVA mes 1
  | "iva_2" // Formulario IVA mes 2
  | "iva_3" // Formulario IVA mes 3
  | "estado_financiero" // Estado financiero último año
  | "clausula_consentimiento" // Cláusula de consentimiento de la empresa
  | "minutas" // Minutas
  // Documentos específicos de vehículos
  | "tarjeta_circulacion" // Tarjeta de circulación del vehículo
  | "titulo_propiedad" // Título de propiedad del vehículo
  | "dpi_dueno" // DPI del dueño (cuando vehículo a nombre de individual)
  | "patente_comercio_vehiculo" // Patente de comercio (empresa individual)
  | "representacion_legal_vehiculo" // Representación legal (S.A)
  | "dpi_representante_legal_vehiculo" // DPI del representante legal (S.A)
  | "pago_impuesto_circulacion" // Comprobante de pago de impuesto de circulación
  | "consulta_sat" // Captura de pantalla de consulta SAT
  | "consulta_garantias_mobiliarias" // Certificación de garantías mobiliarias (RGM)
  // Categorías generales (legacy - mantener por compatibilidad)
  | "identification" // DPI, pasaporte
  | "income_proof" // Comprobantes de ingresos
  | "bank_statement" // Estados de cuenta
  | "business_license" // Patente de comercio
  | "property_deed" // Escrituras
  | "vehicle_title" // Tarjeta de circulación
  | "credit_report" // Reporte crediticio
  | "other" // Otros documentos
  // Documento de detalle de análisis
  | "detalle_analisis"; // Archivo Excel con detalle del crédito

export type ContractType =
  | "cobertura_inrexsa"
  | "pagare"
  | "contrato_credito"
  | "other";

export type ContractStatus = "pending" | "signed" | "completed" | "cancelled";

// Interfaces basadas en la respuesta del API
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
    pdfLink: string | null;
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

// Servicios

/**
 * Obtiene todos los documentos personales del usuario
 */
export const getPersonalDocuments = async (
  email: string,
  dpi: string = ""
): Promise<Document[]> => {
  try {
    const response = await apiAuth.get<DocumentsResponse>(
      `/api/crm/documents?email=${encodeURIComponent(email)}&dpi=${encodeURIComponent(dpi)}`
    );
    return response.data.data;
  } catch (error) {
    const axiosError = error as AxiosError;
    const customError: any = new Error("Error al cargar los documentos");
    customError.status = axiosError.response?.status;
    throw customError;
  }
};

/**
 * Obtiene todos los contratos del usuario
 */
export const getContracts = async (
  email: string,
  dpi: string = ""
): Promise<Contract[]> => {
  try {
    const response = await apiAuth.get<ContractsResponse>(
      `/api/crm/contracts?email=${encodeURIComponent(email)}&dpi=${encodeURIComponent(dpi)}`
    );
    return response.data.data;
  } catch (error) {
    const axiosError = error as AxiosError;
    const customError: any = new Error("Error al cargar los contratos");
    customError.status = axiosError.response?.status;
    throw customError;
  }
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
