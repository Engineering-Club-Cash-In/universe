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
  large_spacing: boolean;
  count_doble_line: number;
}

export type FieldType = "text" | "select" | "list";

export interface FieldOption {
  value: string;
  label: string;
}

export interface Field {
  name: string;
  key: string;
  regex: string;
  required: boolean;
  iddocuments: number[];
  relation: string;
  description: string | null;
  default: string | null;
  is_double_line: boolean;
  type?: FieldType;
  options?: FieldOption[] | null;
}

interface DocumentByDpiResponse {
  success: boolean;
  message: string;
  /** null cuando RENAP no tiene a la persona y el genero se eligio a mano */
  renapData: RenapData | null;
  documents: Document[];
  campos: Field[];
  renapUnavailable?: boolean;
  renapError?: string | null;
}

/** Genero que se manda cuando RENAP no devuelve a la persona */
export type GeneroManual = "hombre" | "mujer";

/**
 * Error de la consulta de DPI. `renapUnavailable` marca el caso en que RENAP
 * no encontro a la persona, que es el unico donde tiene sentido ofrecer
 * continuar eligiendo el genero a mano.
 */
export class DpiLookupError extends Error {
  readonly renapUnavailable: boolean;

  constructor(message: string, renapUnavailable: boolean) {
    super(message);
    this.name = "DpiLookupError";
    this.renapUnavailable = renapUnavailable;
  }
}

interface Step2Props {
  readonly data: {
    dpi?: string;
    documentTypes?: string[];
    renapData?: RenapData;
    documents?: Document[];
    fields?: Field[];
    manualGender?: "M" | "F";
  };
  readonly onChange: (
    field: string,
    value: string | RenapData | Document[] | Field[] | null
  ) => void;
}

// API Service
const API_URL = import.meta.env.VITE_API_URL;

const getDocumentByDpi = async (
  dpi: string,
  documentNames: string[],
  genero?: GeneroManual
): Promise<DocumentByDpiResponse> => {
  const response = await fetch(`${API_URL}/docuSeal/document-by-dpi`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ dpi, documentNames, ...(genero ? { genero } : {}) }),
  });

  if (!response.ok) {
    throw new Error(`Error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as DocumentByDpiResponse;

  // La API responde 200 aunque falle (success:false). Sin esto el wizard se
  // quedaba mudo: no avanzaba y tampoco mostraba el motivo.
  if (!data.success) {
    throw new DpiLookupError(
      data.message || "No se pudieron obtener los documentos para ese DPI",
      Boolean(data.renapError)
    );
  }

  return data;
};

export const useStep2 = ({ data, onChange }: Step2Props) => {
  const [dpiInput, setDpiInput] = useState(data.dpi || "");
  // Genero elegido a mano cuando RENAP no tiene el DPI
  const [generoManual, setGeneroManual] = useState<GeneroManual | "">("");

  // Mutation para consultar el DPI
  const dpiMutation = useMutation({
    mutationFn: ({ dpi, genero }: { dpi: string; genero?: GeneroManual }) =>
      getDocumentByDpi(dpi, data.documentTypes || [], genero),
    onSuccess: (response, variables) => {
      onChange("dpi", variables.dpi);
      onChange("renapData", response.renapData ?? null);
      onChange("documents", response.documents);
      onChange("fields", response.campos);
      // Sin RENAP, el genero elegido a mano es lo unico que define la
      // plantilla y el trato en los documentos: hay que conservarlo.
      if (response.renapData) {
        onChange("manualGender", null);
      } else {
        onChange("manualGender", variables.genero === "mujer" ? "F" : "M");
      }
    },
  });

  const handleSubmitDpi = (e: React.FormEvent) => {
    e.preventDefault();
    if (dpiInput.trim()) {
      dpiMutation.mutate({ dpi: dpiInput.trim() });
    }
  };

  // RENAP no encontro a la persona: se puede seguir eligiendo el genero
  const renapUnavailable =
    dpiMutation.error instanceof DpiLookupError &&
    dpiMutation.error.renapUnavailable;

  const handleContinueWithoutRenap = () => {
    if (!generoManual || !dpiInput.trim()) return;
    dpiMutation.mutate({ dpi: dpiInput.trim(), genero: generoManual });
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
    generoManual,
    setGeneroManual,
    renapUnavailable,
    handleContinueWithoutRenap,
  };
};
