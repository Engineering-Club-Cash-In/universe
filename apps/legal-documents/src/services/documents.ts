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

export interface GenerateDocumentsResponse {
  success: boolean
  message?: string
  data?: unknown
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
