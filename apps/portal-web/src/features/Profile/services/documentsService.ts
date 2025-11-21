const baseURL = import.meta.env.VITE_API_URL;

// Tipos
export type ContractType = "prestamo" | "inversion" | "credito";
export type PersonalDocumentType = "dpi" | "estado_cuenta";

// Interfaces
export interface Contract {
  id: string;
  nombre: string;
  fechaRealizado: string;
  url: string;
  tipo: ContractType;
}

export interface PersonalDocument {
  id: string;
  tipo: PersonalDocumentType;
  nombre: string;
  fechaCarga: string;
  url: string;
}

export interface PersonalDocuments {
  dpi: PersonalDocument | null;
  estadosCuenta: PersonalDocument[];
}

export interface UploadDocumentResponse {
  success: boolean;
  message: string;
  document?: PersonalDocument;
}

// Datos mock
const mockContracts: Contract[] = [
  {
    id: "CON-001",
    nombre: "Contrato de Préstamo Vehicular - Toyota Corolla 2023",
    fechaRealizado: "2024-01-15",
    url: "https://example.com/contracts/prestamo-001.pdf",
    tipo: "prestamo",
  },
  {
    id: "CON-002",
    nombre: "Contrato de Inversión - Plan Premium",
    fechaRealizado: "2024-03-20",
    url: "https://example.com/contracts/inversion-001.pdf",
    tipo: "inversion",
  },
  {
    id: "CON-003",
    nombre: "Contrato de Préstamo Vehicular - Ford Ranger XLT 2022",
    fechaRealizado: "2023-08-20",
    url: "https://example.com/contracts/prestamo-002.pdf",
    tipo: "prestamo",
  },
  {
    id: "CON-004",
    nombre: "Contrato de Inversión - Plan Básico",
    fechaRealizado: "2024-05-10",
    url: "https://example.com/contracts/inversion-002.pdf",
    tipo: "credito",
  },
];

const mockPersonalDocuments: PersonalDocuments = {
  dpi: {
    id: "DPI-001",
    tipo: "dpi",
    nombre: "DPI - Juan Pérez",
    fechaCarga: "2024-01-10",
    url: "https://example.com/documents/dpi-001.pdf",
  },
  estadosCuenta: [
    {
      id: "EC-001",
      tipo: "estado_cuenta",
      nombre: "Estado de Cuenta - Enero 2024",
      fechaCarga: "2024-02-05",
      url: "https://example.com/documents/estado-cuenta-001.pdf",
    },
    {
      id: "EC-002",
      tipo: "estado_cuenta",
      nombre: "Estado de Cuenta - Febrero 2024",
      fechaCarga: "2024-03-05",
      url: "https://example.com/documents/estado-cuenta-002.pdf",
    },
    {
      id: "EC-003",
      tipo: "estado_cuenta",
      nombre: "Estado de Cuenta - Marzo 2024",
      fechaCarga: "2024-04-05",
      url: "https://example.com/documents/estado-cuenta-003.pdf",
    },
  ],
};

// Servicios

/**
 * Obtiene todos los contratos del usuario (préstamos e inversiones)
 */
export const getContracts = async (userId: string): Promise<Contract[]> => {
  try {
    const response = await fetch(`${baseURL}/api/documents/contracts/${userId}`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Error al cargar los contratos");
    }

    const result = await response.json();
    return result.data as Contract[];
  } catch (error) {
    console.error("Error al obtener contratos, usando datos mockeados:", error);
    return mockContracts;
  }
};

/**
 * Obtiene los documentos personales del usuario (DPI y estados de cuenta)
 */
export const getPersonalDocuments = async (
  userId: string
): Promise<PersonalDocuments> => {
  try {
    const response = await fetch(
      `${baseURL}/api/documents/personal/${userId}`,
      {
        credentials: "include",
      }
    );

    if (!response.ok) {
      throw new Error("Error al cargar los documentos personales");
    }

    const result = await response.json();
    return result.data as PersonalDocuments;
  } catch (error) {
    console.error(
      "Error al obtener documentos personales, usando datos mockeados:",
      error
    );
    return mockPersonalDocuments;
  }
};

/**
 * Carga un documento personal (DPI o estado de cuenta)
 */
export const uploadPersonalDocument = async (
  userId: string,
  tipo: PersonalDocumentType,
  file: File
): Promise<UploadDocumentResponse> => {
  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("tipo", tipo);

    const response = await fetch(
      `${baseURL}/api/documents/personal/${userId}/upload`,
      {
        method: "POST",
        credentials: "include",
        body: formData,
      }
    );

    if (!response.ok) {
      throw new Error("Error al cargar el documento");
    }

    const result = await response.json();
    return result as UploadDocumentResponse;
  } catch (error) {
    console.error("Error al cargar documento, usando respuesta mockeada:", error);
    
    // Mock response
    return {
      success: true,
      message: "Documento cargado exitosamente (mock)",
      document: {
        id: `DOC-${Date.now()}`,
        tipo,
        nombre: file.name,
        fechaCarga: new Date().toISOString(),
        url: URL.createObjectURL(file),
      },
    };
  }
};

/**
 * Obtiene un contrato específico por ID
 */
export const getContractById = async (
  userId: string,
  contractId: string
): Promise<Contract | undefined> => {
  const contracts = await getContracts(userId);
  return contracts.find((contract) => contract.id === contractId);
};
