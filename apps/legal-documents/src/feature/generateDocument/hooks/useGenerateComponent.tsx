import { useState, useEffect, useCallback } from "react";
import { type Document, type Field, type RenapData } from "./useStep2";
import {
  documentsService,
  type Contracts,
  type DocumentSubmission,
  type GenerateDocumentsResponse,
} from "@/services/documents";
import {
  NetworkError,
  ValidationError,
  ServerError,
  TimeoutError,
} from "@/services/errors";

// Clave para guardar datos en localStorage
const STORAGE_KEY = "legal-documents-wizard-state";

interface DocumentData {
  // Step 1
  documentTypes?: string[];
  // Step 2
  dpi?: string;
  renapData?: RenapData;
  documents?: Document[];
  fields?: Field[];
  // Step 3
  fieldValues?: Record<string, string>;
  selectedDocuments?: number[];
  documentDescription?: string;
  projectValue?: string;
  duration?: string;
  paymentTerms?: string;
  includeIntellectualProperty?: boolean;
  includeTermination?: boolean;
  additionalClauses?: string;
}

// Función para cargar estado desde localStorage
const loadStateFromStorage = (): { step: number; data: DocumentData } | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    
    const parsed = JSON.parse(stored);
    console.log("📂 Estado cargado desde localStorage:", parsed);
    return parsed;
  } catch (error) {
    console.error("❌ Error cargando estado desde localStorage:", error);
    return null;
  }
};

// Función para guardar estado en localStorage
const saveStateToStorage = (step: number, data: DocumentData) => {
  try {
    const state = { step, data };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    console.log("💾 Estado guardado en localStorage:", state);
  } catch (error) {
    console.error("❌ Error guardando estado en localStorage:", error);
  }
};

// Función para limpiar localStorage
const clearStorage = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    console.log("🗑️ Estado limpiado de localStorage");
  } catch (error) {
    console.error("❌ Error limpiando localStorage:", error);
  }
};

export function useGenerateComponent() {
  // Inicializar desde localStorage si existe
  const [initialState] = useState(() => loadStateFromStorage());
  const [currentStep, setCurrentStep] = useState(initialState?.step || 1);
  const [formData, setFormData] = useState<DocumentData>(initialState?.data || {});
  const [isLoading, setIsLoading] = useState(false);
  const [step3Valid, setStep3Valid] = useState(false);
  const [shouldValidateStep3, setShouldValidateStep3] = useState(false);
  const [documentsResponse, setDocumentsResponse] =
    useState<GenerateDocumentsResponse | null>(null);

  // Monitor step3Valid changes
  useEffect(() => {
    console.log(`🔄 step3Valid changed to:`, step3Valid);
  }, [step3Valid]);

  // Guardar en localStorage cuando cambian los datos o el paso (excepto en paso 4)
  useEffect(() => {
    // No guardar en el paso 4 (documentos generados)
    if (currentStep === 4) return;
    
    saveStateToStorage(currentStep, formData);
  }, [formData, currentStep]);

  const handleDataChange = useCallback(
    (field: string, value: string | boolean | string[] | object | null) => {
      setFormData((prev) => ({
        ...prev,
        [field]: value,
      }));
    },
    []
  );

  const resetRenapData = useCallback(() => {
    console.log("🔄 Reseteando datos del RENAP");
    setFormData((prev) => ({
      ...prev,
      dpi: undefined,
      renapData: undefined,
      documents: undefined,
      fields: undefined,
      fieldValues: undefined,
    }));
    setStep3Valid(false);
    setShouldValidateStep3(false);
  }, []);

  const validateStep = useCallback(
    (step: number): boolean => {
      const result = (() => {
        switch (step) {
          case 1:
            return !!(
              formData.documentTypes && formData.documentTypes.length > 0
            );
          case 2:
            return !!(formData.renapData && formData.dpi);
          case 3:
            return true;
          case 4:
            return true; // El step 4 es solo visualización
          default:
            return false;
        }
      })();

      console.log(`🔍 ValidateStep ${step}:`, { result, step3Valid });
      return result;
    },
    [formData.documentTypes, formData.renapData, formData.dpi, step3Valid]
  );

  const generateDocuments = useCallback(async () => {
    setIsLoading(true);
    console.log(
      "Generando documentos con los siguientes datos:",
      formData.fieldValues
    );

    try {
      // Obtener el email del campo "correo"
      const email =
        formData.fieldValues?.correo || formData.fieldValues?.email || "";

      if (!email) {
        // si no aparece el campo que contacte a soporte
        alert(
          "⚠️ Correo electrónico requerido\n\n" +
            "Si no encuentras el campo para ingresar el correo, por favor contacta a soporte."
        );
        return;
      }

      // Construir el payload para cada documento seleccionado
      const payload: Contracts[] =
        formData.documents?.map((document) => {
          // Obtener los campos que pertenecen a este documento
          const documentFields =
            formData.fields?.filter((field) =>
              field.iddocuments.map(Number).includes(document.id)
            ) || [];

          // Construir los campos con sus valores
          const fields = documentFields.map((field) => {
            const value = formData.fieldValues?.[field.key] || "";

            return { [field.key]: value };
          });

          // Determinar el género: para "declaracion_vendedor" usar genderVendedor, sino usar el del cliente
          const isVendedorDoc = document.nombre_documento === "declaracion_vendedor";
          const vendedorGender = formData.fieldValues?.genderVendedor;
          const genderSource = isVendedorDoc && vendedorGender ? vendedorGender : formData.renapData?.gender;
          const gender = genderSource === "M" ? "male" : "female";

          return {
            options: {
              generatePdf: true,
              gender,
              filenamePrefix: document.nombre_documento + "_" + Date.now(),
            },
            // convertir el array de fields a un objeto key-value, incluyendo el DPI
            data: Object.assign({}, ...fields, { dpi: formData.dpi }),
            contractType: document.nombre_documento,
            // Agregar email del cliente (por ahora solo 1, se puede expandir para múltiples firmantes)
            emails: email ? [email] : undefined,
          };
        }) || [];

      const contracts: DocumentSubmission = {
        contracts: payload,
      };

      console.log("Payload a enviar:", JSON.stringify(contracts, null, 2));

      // Usar el servicio para generar documentos
      const result = await documentsService.generateDocuments(contracts);
      console.log("Respuesta del servidor:", result);

      // Guardar la respuesta y avanzar al Step 4
      setDocumentsResponse(result);
      setCurrentStep(4);
      
      // Limpiar localStorage después de generar exitosamente
      clearStorage();
      console.log("✅ Documentos generados exitosamente - localStorage limpiado");
    } catch (error) {
      console.error("Error generando documentos:", error);

      // Manejar diferentes tipos de errores con mensajes específicos
      if (error instanceof NetworkError) {
        alert(
          "❌ Error de conexión\n\n" +
            "No se pudo conectar con el servidor. Por favor:\n" +
            "• Verifica tu conexión a internet\n" +
            "• Intenta nuevamente en unos momentos\n\n" +
            "Si el problema persiste, contacta a soporte."
        );
      } else if (error instanceof TimeoutError) {
        alert(
          "⏱️ La solicitud tardó demasiado\n\n" +
            "El servidor está tardando más de lo esperado.\n" +
            "Por favor intenta nuevamente."
        );
      } else if (error instanceof ValidationError) {
        const errorList = error.errors
          .map((e) => `• ${e.field}: ${e.error}`)
          .join("\n");

        alert(
          "⚠️ Errores de validación\n\n" +
            "Por favor corrige los siguientes errores:\n\n" +
            errorList
        );
      } else if (error instanceof ServerError) {
        const statusMessages: Record<number, string> = {
          500: "Error interno del servidor",
          502: "El servidor no está disponible",
          503: "El servicio está temporalmente fuera de línea",
          504: "El servidor no respondió a tiempo",
        };

        const message = statusMessages[error.statusCode] || error.message;

        alert(
          `❌ Error del servidor (${error.statusCode})\n\n` +
            message +
            "\n\n" +
            "Por favor intenta nuevamente en unos momentos.\n" +
            "Si el problema persiste, contacta a soporte."
        );
      } else {
        // Error desconocido
        alert(
          "❌ Error inesperado\n\n" +
            "Ocurrió un error inesperado al generar los documentos.\n" +
            "Por favor intenta nuevamente.\n\n" +
            "Si el problema persiste, contacta a soporte."
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [formData.fieldValues, formData.documents, formData.fields]);

  const handleNext = useCallback(async () => {
    if (currentStep === 3) {
      // Activar validación antes de generar documento
      setShouldValidateStep3(true);
      // Dar tiempo para que la validación se procese
      await new Promise((resolve) => setTimeout(resolve, 100));

      if (!step3Valid) {
        return; // No continuar si la validación falla
      }

      // Generar documentos
      await generateDocuments();
    } else if (currentStep < 4) {
      // Máximo 4 pasos
      setCurrentStep((prev) => prev + 1);
    }

    // Scroll hasta arriba al cambiar de paso
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentStep, step3Valid, generateDocuments]);

  const handlePrevious = useCallback(() => {
    const newStep = Math.max(1, currentStep - 1);

    // Si regresa del paso 2 al 1, resetear datos del RENAP
    if (currentStep === 2 && newStep === 1) {
      resetRenapData();
    }

    setCurrentStep(newStep);
    // Scroll hasta arriba al retroceder
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentStep, resetRenapData]);

  const handleStepClick = useCallback(
    (stepId: number) => {
      // Solo permitir navegar a pasos anteriores o al actual
      if (stepId <= currentStep) {
        // Si hace clic en el paso 1 desde el paso 2 o superior, resetear datos del RENAP
        if (stepId === 1 && currentStep >= 2) {
          resetRenapData();
        }

        setCurrentStep(stepId);
        // Scroll hasta arriba al hacer clic en un paso
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [currentStep, resetRenapData]
  );

  const setStep3ValidWrapper = useCallback((valid: boolean) => {
    console.log(`📤 Step3 setting validation to:`, valid);
    setStep3Valid(valid);
  }, []);

  const resetWizard = useCallback(() => {
    console.log("🔄 Reiniciando wizard completo");
    setCurrentStep(1);
    setFormData({});
    setStep3Valid(false);
    setShouldValidateStep3(false);
    setDocumentsResponse(null);
    clearStorage();
    // Scroll hasta arriba
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return {
    // Estados
    currentStep,
    formData,
    isLoading,
    step3Valid,
    shouldValidateStep3,
    documentsResponse,

    // Funciones
    handleDataChange,
    validateStep,
    handleNext,
    handlePrevious,
    handleStepClick,
    setStep3ValidWrapper,
    resetRenapData,
    resetWizard,
  };
}
