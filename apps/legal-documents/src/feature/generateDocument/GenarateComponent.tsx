import { useState } from "react";
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
    switch (step) {
      case 1:
        return !!(formData.documentTypes && formData.documentTypes.length > 0);
      case 2:
        return !!(formData.renapData && formData.dpi);
      case 3:
        return step3Valid;
      case 4:
        return true; // El step 4 es solo visualización
      default:
        return false;
    }
  };

  const handleNext = async () => {
    if (currentStep === 3) {
      // Activar validación antes de generar documento
      setShouldValidateStep3(true);
      // Dar tiempo para que la validación se procese
      await new Promise((resolve) => setTimeout(resolve, 100));

      if (!step3Valid) {
        alert(
          "Por favor, completa todos los campos requeridos antes de generar los documentos."
        );
        return; // No continuar si la validación falla
      }

      // Generar documentos
      await generateDocuments();
    } else if (currentStep < steps.length) {
      setCurrentStep((prev) => prev + 1);
    }
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
              // eslint-disable-next-line 
              // @ts-ignore
              field.iddocuments.includes(document.id)
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
      alert("Error al generar los documentos. Por favor, intenta de nuevo.");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePrevious = () => {
    setCurrentStep((prev) => Math.max(1, prev - 1));
  };

  const handleStepClick = (stepId: number) => {
    // Solo permitir navegar a pasos anteriores o al actual
    if (stepId <= currentStep) {
      setCurrentStep(stepId);
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
      title: "Revisión y Generación",
      description: "Revisa la información y genera los documentos",
      component: (
        <Step3
          data={formData}
          onChange={handleDataChange}
          onValidationChange={setStep3Valid}
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
    <div className=" p-6">
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
