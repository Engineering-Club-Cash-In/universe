import { useState, useEffect } from "react";
import { Wizard, type WizardStep } from "@/components/wizard/Wizard";
import { Step1 } from "./components/Step1";
import { Step2 } from "./components/Step2";
import { Step3 } from "./components/Step3";
import { Step4 } from "./components/Step4";
import { type Document, type Field, type RenapData } from "./hooks/useStep2";
import {
  documentsService,
  type DocumentSubmission,
  type GenerateDocumentsResponse,
} from "@/services/documents";
import { NetworkError, ValidationError, ServerError, TimeoutError } from '@/services/errors';

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

export function GenerateComponent() {
  const [currentStep, setCurrentStep] = useState(1)
  const [formData, setFormData] = useState<DocumentData>({})
  const [isLoading, setIsLoading] = useState(false)
  const [step3Valid, setStep3Valid] = useState(false)
  const [shouldValidateStep3, setShouldValidateStep3] = useState(false)
  const [documentsResponse, setDocumentsResponse] = useState<GenerateDocumentsResponse | null>(null)

  // Monitor step3Valid changes
  useEffect(() => {
    console.log(`🔄 step3Valid changed to:`, step3Valid);
  }, [step3Valid]);

  const handleDataChange = (
    field: string,
    value: string | boolean | string[] | object | null
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const validateStep = (step: number): boolean => {
    const result = (() => {
      switch (step) {
        case 1:
          return !!(formData.documentTypes && formData.documentTypes.length > 0);
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
  };

  const handleNext = async () => {
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
    } else if (currentStep < steps.length) {
      setCurrentStep((prev) => prev + 1);
    }
    
    // Scroll hasta arriba al cambiar de paso
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const generateDocuments = async () => {
    setIsLoading(true);
    console.log("Generando documentos con los siguientes datos:", formData.fieldValues);
    try {
      // Obtener el email del campo "correo"
      const email =
        formData.fieldValues?.correo || formData.fieldValues?.email || "";

      if (!email) {
        alert(
          "El campo correo/email es requerido para generar los documentos."
        );
        return;
      }

      // Construir el payload para cada documento seleccionado
      const payload: DocumentSubmission[] =
        formData.documents?.map((document) => {
          // Obtener los campos que pertenecen a este documento
          const documentFields =
            formData.fields?.filter((field) =>
              field.iddocuments.includes(document.id.toString())
            ) || [];

          // Construir los campos con sus valores
          const fields = documentFields
            .map((field) => ({
              key: field.name, // Usar el nombre del campo como key
              value: formData.fieldValues?.[field.key] || "",
            }))

          return {
            id: document.id,
            email: email,
            fields: fields,
          };
        }) || [];

      console.log("Payload a enviar:", JSON.stringify(payload, null, 2));

      // Usar el servicio para generar documentos
      const result = await documentsService.generateDocuments(payload);
      console.log("Respuesta del servidor:", result);

      // Guardar la respuesta y avanzar al Step 4
      setDocumentsResponse(result)
      setCurrentStep(4)
    } catch (error) {
      console.error("Error generando documentos:", error);

      // Manejar diferentes tipos de errores con mensajes específicos
      if (error instanceof NetworkError) {
        alert(
          '❌ Error de conexión\n\n' +
          'No se pudo conectar con el servidor. Por favor:\n' +
          '• Verifica tu conexión a internet\n' +
          '• Intenta nuevamente en unos momentos\n\n' +
          'Si el problema persiste, contacta a soporte.'
        );
      } else if (error instanceof TimeoutError) {
        alert(
          '⏱️ La solicitud tardó demasiado\n\n' +
          'El servidor está tardando más de lo esperado.\n' +
          'Por favor intenta nuevamente.'
        );
      } else if (error instanceof ValidationError) {
        const errorList = error.errors
          .map(e => `• ${e.field}: ${e.error}`)
          .join('\n');

        alert(
          '⚠️ Errores de validación\n\n' +
          'Por favor corrige los siguientes errores:\n\n' +
          errorList
        );
      } else if (error instanceof ServerError) {
        const statusMessages: Record<number, string> = {
          500: 'Error interno del servidor',
          502: 'El servidor no está disponible',
          503: 'El servicio está temporalmente fuera de línea',
          504: 'El servidor no respondió a tiempo',
        };

        const message = statusMessages[error.statusCode] || error.message;

        alert(
          `❌ Error del servidor (${error.statusCode})\n\n` +
          message + '\n\n' +
          'Por favor intenta nuevamente en unos momentos.\n' +
          'Si el problema persiste, contacta a soporte.'
        );
      } else {
        // Error desconocido
        alert(
          '❌ Error inesperado\n\n' +
          'Ocurrió un error inesperado al generar los documentos.\n' +
          'Por favor intenta nuevamente.\n\n' +
          'Si el problema persiste, contacta a soporte.'
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handlePrevious = () => {
    setCurrentStep((prev) => Math.max(1, prev - 1));
    // Scroll hasta arriba al retroceder
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleStepClick = (stepId: number) => {
    // Solo permitir navegar a pasos anteriores o al actual
    if (stepId <= currentStep) {
      setCurrentStep(stepId);
      // Scroll hasta arriba al hacer clic en un paso
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const steps: WizardStep[] = [
    {
      id: 1,
      title: "Seleccionar Documentos",
      description: "Elige los tipos de documentos legales que necesitas",
      component: <Step1 data={formData} onChange={handleDataChange} />,
    },
    {
      id: 2,
      title: "Información del Firmante",
      description: "Consulta los datos del DPI de quien firmará los documentos",
      component: <Step2 data={formData} onChange={handleDataChange} />,
    },
    {
      id: 3,
      title: "Configuración de Documentos",
      description: "Completa la información requerida para generar los documentos",
      component: (
        <Step3
          data={formData}
          onChange={handleDataChange}
          onValidationChange={(valid) => {
            console.log(`📤 Step3 setting validation to:`, valid);
            setStep3Valid(valid);
          }}
          shouldValidate={shouldValidateStep3}
        />
      ),
    },
    {
      id: 4,
      title: "Documentos Generados",
      description: "Vista previa de los documentos creados",
      component: (
        <Step4
          documentsResponse={documentsResponse}
          isLoading={isLoading}
        />
      ),
    },
  ];

  return (
    <div className="py-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">
            Generador de Documentos Legales
          </h1>
          <p className="text-muted-foreground">
            Crea documentos legales personalizados en minutos
          </p>
        </div>

        <Wizard
          steps={steps}
          currentStep={currentStep}
          onNext={handleNext}
          onPrevious={handlePrevious}
          onStepClick={handleStepClick}
          canGoNext={validateStep(currentStep)}
          isLoading={isLoading}
          finishLabel={currentStep === 3 ? "Generar Documentos" : "Finalizar"}
          nextLabel="Continuar"
          previousLabel="Volver"
        />

        {isLoading && (
          <div className="mt-6 text-center">
            <p className="text-muted-foreground animate-pulse">
              Generando tu documento legal personalizado...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
