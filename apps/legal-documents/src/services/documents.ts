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

export interface DocumentSubmission {
  id: number
  email: string
  fields: DocumentField[]
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
}

export interface GenerateDocumentsResponse {
  success: boolean
  message?: string
  results?: DocumentResult[]
}

// API Service
const API_URL = import.meta.env.VITE_API_URL

export const documentsService = {
  // Obtener todos los tipos de documentos disponibles
  getDocumentTypes: async (): Promise<DocumentsResponse> => {
    const response = await fetch(`${API_URL}/docuSeal/documents`)
    
    if (!response.ok) {
      throw new Error(`Error fetching documents: ${response.status} ${response.statusText}`)
    }
    
    const data = await response.json()
    return data
  },

  // Generar documentos
  generateDocuments: async (payload: DocumentSubmission[]): Promise<GenerateDocumentsResponse> => {
    const response = await fetch(`${API_URL}/docuSeal/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      throw new Error(`Error generating documents: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    return data
  }
}

// React Query Keys
export const documentsKeys = {
  all: ['documents'] as const,
  types: () => [...documentsKeys.all, 'types'] as const,
}
