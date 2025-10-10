import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

// Types
interface RenapData {
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

interface DocumentByDpiResponse {
  success: boolean;
  message: string;
  renapData: RenapData;
}

interface Step2Props {
  readonly data: {
    dpi?: string;
    renapData?: RenapData;
  };
  readonly onChange: (field: string, value: string | RenapData) => void;
}

// API Service
const API_URL = import.meta.env.VITE_API_URL;

const getDocumentByDpi = async (
  dpi: string
): Promise<DocumentByDpiResponse> => {
  const response = await fetch(`${API_URL}/docuSeal/document-by-dpi`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ dpi, documentName: "carta_emision_cheques" }),
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
    mutationFn: getDocumentByDpi,
    onSuccess: (response) => {
      if (response.success) {
        onChange("dpi", dpiInput);
        onChange("renapData", response.renapData);
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
  };
};
