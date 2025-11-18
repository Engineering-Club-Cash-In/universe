import { Wizard, type WizardStep } from "@/components/wizard/Wizard";
import { Step1 } from "./components/Step1";
import { Step2 } from "./components/Step2";
import { Step3 } from "./components/Step3";
import { Step4 } from "./components/Step4";
import { useGenerateComponent } from "./hooks/useGenerateComponent";

export function GenerateComponent() {
  const {
    currentStep,
    formData,
    isLoading,
    shouldValidateStep3,
    documentsResponse,
    handleDataChange,
    validateStep,
    handleNext,
    handlePrevious,
    handleStepClick,
    setStep3ValidWrapper,
  } = useGenerateComponent();

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
          onValidationChange={setStep3ValidWrapper}
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
