// Imports
import { fetchWithRetry } from './fetchWithRetry';
import { ValidationError, ServerError } from './errors';

// Types
export interface DocumentType {
  enum: string
  label: string
}

export interface DocumentsResponse {
  success: boolean
  total: number
  data: DocumentType[]
}

export interface DocumentField {
  key: string
  value: string
}

export interface Contracts {
  contractType: string
  data: Record<string, string>
  emails?: string[]
  options: {
    gender: "male" | "female"
    generatePdf: boolean
    filenamePrefix: string
  }
}

export interface DocumentSubmission {
  contracts: Contracts[]
}

export interface DocumentValue {
  field: string
  value: string | number | null
}

export interface DocumentSubmissionData {
  id: number
  slug: string
  uuid: string
  name: string | null
  email: string
  phone: string | null
  completed_at: string | null
  declined_at: string | null
  external_id: string | null
  submission_id: number
  metadata: Record<string, unknown>
  opened_at: string | null
  sent_at: string
  created_at: string
  updated_at: string
  status: string
  application_key: string | null
  values: DocumentValue[]
  preferences: {
    send_email: boolean
    send_sms: boolean
  }
  role: string
  embed_src: string
}

export interface DocumentResult {
  templateId: number
  success: boolean
  nameDocument: DocumentType[]
  data: DocumentSubmissionData[]
  signing_links?: string[]
}

export interface GenerateDocumentsResponse {
  success: boolean
  message?: string
  results?: DocumentResult[]
}

// API Service
const API_URL = import.meta.env.VITE_API_URL
const DOCUMENTS_API_URL = import.meta.env.VITE_API_URL_DOCUMENTS

export const documentsService = {
  // Obtener todos los tipos de documentos disponibles
  getDocumentTypes: async (): Promise<DocumentsResponse> => {
    try {
      const response = await fetchWithRetry(
        `${API_URL}/docuSeal/documents`,
        {
          maxRetries: 2,
          timeout: 10000, // 10 segundos
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new ServerError(
          errorData.message || 'Error al obtener tipos de documentos',
          response.status,
          errorData
        );
      }

      const data = await response.json();

      // Validar estructura de respuesta
      if (!data || typeof data.success !== 'boolean') {
        throw new ValidationError(
          'Respuesta inválida del servidor',
          [{ field: 'response', error: 'Estructura de datos incorrecta' }]
        );
      }

      return data;

    } catch (error) {
      // Re-lanzar errores personalizados
      if (
        error instanceof ValidationError ||
        error instanceof ServerError
      ) {
        throw error;
      }

      // Convertir otros errores
      console.error('Error inesperado al obtener documentos:', error);
      throw new ServerError(
        'Error inesperado al obtener documentos',
        500,
        error
      );
    }
  },

  // Generar documentos
  generateDocuments: async (
    payload: DocumentSubmission
  ): Promise<GenerateDocumentsResponse> => {
    try {
      // Validación básica del payload
      const response = await fetchWithRetry(
        `${DOCUMENTS_API_URL}/contracts/batch`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          maxRetries: 2,
          timeout: 120000, // 120 segundos para generación de documentos
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        // Manejar errores de validación del servidor (400)
        if (response.status === 400 && errorData.errors) {
          throw new ValidationError(
            'Errores de validación en los datos',
            errorData.errors
          );
        }

        throw new ServerError(
          errorData.message || 'Error al generar documentos',
          response.status,
          errorData
        );
      }

      const data = await response.json();

      // Validar estructura de respuesta
      if (!data || typeof data.success !== 'boolean') {
        throw new ValidationError(
          'Respuesta inválida del servidor',
          [{ field: 'response', error: 'Estructura de datos incorrecta' }]
        );
      }

      return data;

    } catch (error) {
      if (
        error instanceof ValidationError ||
        error instanceof ServerError
      ) {
        throw error;
      }

      console.error('Error inesperado al generar documentos:', error);
      throw new ServerError(
        'Error inesperado al generar documentos',
        500,
        error
      );
    }
  },
}

// React Query Keys
export const documentsKeys = {
  all: ['documents'] as const,
  types: () => [...documentsKeys.all, 'types'] as const,
}
