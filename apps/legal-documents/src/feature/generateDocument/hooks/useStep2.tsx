import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

// Types
export interface RenapData {
  dpi: string;
  firstName: string;
  secondName: string;
  thirdName: string;
  firstLastName: string;
  secondLastName: string;
  marriedLastName: string;
  picture: string;
  birthDate: string;
  gender: string;
  civil_status: string;
  nationality: string;
  borned_in: string;
  department_borned_in: string;
  municipality_borned_in: string;
  deathDate: string;
  ocupation: string;
  cedula_order: string;
  cedula_register: string;
  dpi_expiracy_date: string;
}

export interface Document {
  id: number;
  nombre_documento: string;
  descripcion: string;
  genero: string;
  serialid: string;
  url_insercion: string;
}

export interface Field {
  name: string;
  key: string;
  regex: string;
  required: boolean;
  iddocuments: string[];
  relation: string;
  description: string | null;
  default: string | null;
}

interface DocumentByDpiResponse {
  success: boolean;
  message: string;
  renapData: RenapData;
  documents: Document[];
  campos: Field[];
}

interface Step2Props {
  readonly data: {
    dpi?: string;
    documentTypes?: string[];
    renapData?: RenapData;
    documents?: Document[];
    fields?: Field[];
  };
  readonly onChange: (
    field: string,
    value: string | RenapData | Document[] | Field[]
  ) => void;
}

// API Service
const API_URL = import.meta.env.VITE_API_URL;

const getDocumentByDpi = async (
  dpi: string,
  documentNames: string[]
): Promise<DocumentByDpiResponse> => {
  const response = await fetch(`${API_URL}/docuSeal/document-by-dpi`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ dpi, documentNames }),
  });

  if (!response.ok) {
    throw new Error(`Error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data;
};

export const useStep2 = ({ data, onChange }: Step2Props) => {
  const [dpiInput, setDpiInput] = useState(data.dpi || "");

  // Mutation para consultar el DPI
  const dpiMutation = useMutation({
    mutationFn: (dpi: string) =>
      getDocumentByDpi(dpi, data.documentTypes || []),
    onSuccess: (response) => {
      if (response.success) {
        onChange("dpi", dpiInput);
        onChange("renapData", response.renapData);
        onChange("documents", response.documents);
        onChange("fields", response.campos);
      }
    },
  });

  const handleSubmitDpi = (e: React.FormEvent) => {
    e.preventDefault();
    if (dpiInput.trim()) {
      dpiMutation.mutate(dpiInput.trim());
    }
  };

  const formatDpi = (value: string) => {
    // Remover caracteres no numéricos
    const cleaned = value.replace(/\D/g, "");
    // Limitar a 13 dígitos
    return cleaned.slice(0, 13);
  };

  const handleDpiChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatDpi(e.target.value);
    setDpiInput(formatted);
  };

  const getGenderLabel = (gender: string) => {
    if (gender === "M") return "Masculino";
    if (gender === "F") return "Femenino";
    return "No especificado";
  };

  const getCivilStatusLabel = (status: string) => {
    const statusMap: Record<string, string> = {
      S: "Soltero/a",
      C: "Casado/a",
      D: "Divorciado/a",
      V: "Viudo/a",
      U: "Unido/a",
    };
    return statusMap[status] || "No especificado";
  };

  return {
    dpiInput,
    setDpiInput,
    handleDpiChange,
    handleSubmitDpi,
    dpiMutation,
    getGenderLabel,
    getCivilStatusLabel,
    renapData: data.renapData,
    documents: data.documents,
    fields: data.fields,
  };
};
