import { useState, useRef } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Car,
  ClipboardCheck,
  Camera,
  CheckCircle,
  DollarSign,
  Activity,
  Trash2
} from "lucide-react";
import { useInspection } from "../contexts/InspectionContext";
import { prepareInspectionData, createFullInspection } from "../services/vehicles";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import VehicleInspectionForm, { type VehicleInspectionFormRef } from "./vehicle-inspection";
import InspectionChecklist from "../components/inspection-checklist";
import VehiclePictures from "./vehicle-pictures";
import VehicleValuation from "../components/vehicle-valuation";
import Inspection360Step from "../components/inspection-360-step";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

const STEPS = [
  {
    id: "basic-info",
    title: "Información Básica",
    description: "Datos del vehículo y técnico",
    icon: Car,
  },
  {
    id: "inspection-360",
    title: "Inspección 360°",
    description: "Revisión técnica detallada",
    icon: Activity,
  },
  {
    id: "checklist",
    title: "Checklist",
    description: "Evaluación del vehículo",
    icon: ClipboardCheck,
  },
  {
    id: "photos",
    title: "Fotografías",
    description: "Captura de imágenes del vehículo",
    icon: Camera,
  },
  {
    id: "valuation",
    title: "Valoración",
    description: "Valoración del vehículo con IA",
    icon: DollarSign,
  },
];

export default function VehicleInspectionWizard() {
  const { formData, checklistItems, photos, sectionTimes, resetInspection, currentStep, setCurrentStep, items360, rejectionEvidenceUrl } = useInspection();
  const isDevMode = import.meta.env.VITE_DEV_MODE === 'TRUE';
  const [basicInfoCompleted, setBasicInfoCompleted] = useState(false);
  const [inspection360Completed, setInspection360Completed] = useState(false);
  const vehicleFormRef = useRef<VehicleInspectionFormRef>(null);
  const [checklistCompleted, setChecklistCompleted] = useState(false);
  const [photosCompleted, setPhotosCompleted] = useState(false);
  const [valuationCompleted, setValuationCompleted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const progress = ((currentStep + 1) / STEPS.length) * 100;

  const handleNextStep = async () => {
    // Validar que el paso actual esté completo antes de avanzar
    if (currentStep === 0 && !basicInfoCompleted) {
      // Triggear validación del formulario para mostrar errores en campos
      if (vehicleFormRef.current) {
        const isValid = await vehicleFormRef.current.triggerValidation();
        if (!isValid) {
          toast.error("Por favor complete los campos marcados en rojo");
          return;
        }
      } else {
        toast.error("Por favor complete la información básica antes de continuar");
        return;
      }
    }

    // Paso 1: 360 (Validación explícita)
    if (currentStep === 1 && !inspection360Completed) {
      toast.error("Por favor confirme la inspección 360 antes de continuar");
      return;
    }

    if (currentStep === 2 && !checklistCompleted) {
      toast.error("Por favor complete la evaluación de criterios antes de continuar");
      return;
    }

    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handlePreviousStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleCompleteInspection = async (photosFromPictures?: any[], dataOverride?: any) => {
    // Usar las fotos pasadas directamente o las del contexto
    const photosToUse = photosFromPictures || photos;
    // Use dataOverride if provided (from valuation step), otherwise use formData from context
    const dataToUse = dataOverride || formData;

    // Verificar que las fotos estén disponibles
    if (!photosToUse || photosToUse.length === 0) {
      console.error("No hay fotos disponibles");
      toast.error("Error: Las fotos no se cargaron correctamente. Intente nuevamente.");
      return;
    }

    console.log("Enviando inspección con", photosToUse.length, "fotos");
    setIsSubmitting(true);

    try {
      // Prepare data for submission
      const { vehicleData, inspectionData } = prepareInspectionData(dataToUse, sectionTimes, rejectionEvidenceUrl);

      // Map items360 to match API service interface (the backend expects uppercase enums: 'GOOD', 'BAD', etc)
      const apiItems360 = items360.map(item => ({
        ...item,
        status: item.status as 'GOOD' | 'REGULAR' | 'BAD' | 'NA' | 'OK' | 'LEGACY_BAD'
      }));

      // Call the API to create the full inspection
      const result = await createFullInspection(
        vehicleData,
        inspectionData,
        checklistItems,
        photosToUse,
        apiItems360
      );

      if (result.success) {
        toast.success("¡Inspección completada exitosamente!");

        // Reset the inspection context
        resetInspection();

        // Redirect to dashboard after a brief delay
        setTimeout(() => {
          window.location.href = "/vehicles";
        }, 2000);
      } else {
        toast.error(`Error al guardar la inspección: ${result.error}`);
      }
    } catch (error) {
      console.error('Error submitting inspection:', error);
      toast.error("Error al procesar la inspección");
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentStepData = STEPS[currentStep];
  const StepIcon = currentStepData.icon;

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster />

      {/* Header */}
      <div className="bg-white border-b">
        <div className="container mx-auto px-2 sm:px-4 py-1 flex items-center justify-between">
          <div className="text-left">
            <h1 className="text-2xl sm:text-3xl font-bold">Nueva Inspección de Vehículo</h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">
              Complete todos los pasos para registrar la inspección
            </p>
          </div>
          {isDevMode && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (window.confirm('¿Está seguro de querer limpiar toda la inspección y empezar de 0?')) {
                  resetInspection();
                  window.location.reload();
                }
              }}
              className="hidden sm:flex"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Reset (Dev)
            </Button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-white border-b">
        <div className="container mx-auto px-2 sm:px-4 py-1 sm:py-2">
          <div className="space-y-4">
            <Progress value={progress} className="h-2" />

            {/* Steps Indicator */}
            <div className="flex justify-between">
              {STEPS.map((step, index) => {
                const StepIconComponent = step.icon;
                const isActive = index === currentStep;

                // Lógica de completado actualizada para 5 pasos
                const isCompleted =
                  (index === 0 && basicInfoCompleted) ||
                  (index === 1 && inspection360Completed) ||
                  (index === 2 && checklistCompleted) ||
                  (index === 3 && photosCompleted) ||
                  (index === 4 && valuationCompleted);

                const isPast = index < currentStep;

                return (
                  <div
                    key={step.id}
                    className={cn(
                      "flex flex-col items-center gap-2 flex-1",
                      isActive && "text-primary",
                      !isActive && !isPast && "text-muted-foreground"
                    )}
                  >
                    <div
                      className={cn(
                        "relative flex items-center justify-center w-10 h-10 rounded-full border-2",
                        isActive && "border-primary bg-primary/10",
                        isCompleted && "border-green-500 bg-green-50",
                        !isActive && !isCompleted && "border-gray-300 bg-white"
                      )}
                    >
                      {isCompleted ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : (
                        <StepIconComponent
                          className={cn(
                            "h-5 w-5",
                            isActive && "text-primary",
                            !isActive && "text-gray-400"
                          )}
                        />
                      )}
                    </div>
                    <div className="text-center">
                      <div className={cn(
                        "text-sm font-medium",
                        !isActive && !isPast && "text-gray-400"
                      )}>
                        {step.title}
                      </div>
                      <div className="text-xs text-muted-foreground hidden sm:block">
                        {step.description}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Step Content */}
      <div className="container mx-auto px-2 sm:px-4 py-3 sm:py-6">
        <div className="bg-white rounded-lg shadow-sm">
          {/* Step Header */}
          <div className="border-b px-3 sm:px-6 py-1 sm:py-2">
            <div className="flex items-center gap-2 sm:gap-3">
              <StepIcon className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
              <div>
                <h2 className="text-xl sm:text-2xl font-semibold">{currentStepData.title}</h2>
                <p className="text-sm sm:text-base text-muted-foreground">
                  {currentStepData.description}
                </p>
              </div>
            </div>
          </div>

          {/* Step Body */}
          <div className="p-3 sm:p-5">
            {currentStep === 0 && (
              <div>
                <VehicleInspectionForm
                  ref={vehicleFormRef}
                  onComplete={() => {
                    setBasicInfoCompleted(true);
                    // Avanzar automáticamente al siguiente paso
                    if (currentStep < STEPS.length - 1) {
                      setCurrentStep(currentStep + 1);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }
                  }}
                  isWizardMode={true}
                />
              </div>
            )}

            {/* Step 1: Inspección 360 (NUEVO) */}
            {currentStep === 1 && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                <Inspection360Step
                  onComplete={() => {
                    setInspection360Completed(true);
                    setCurrentStep(2);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                />
              </div>
            )}

            {currentStep === 2 && (
              <div>
                <InspectionChecklist
                  onComplete={() => {
                    setChecklistCompleted(true);
                    // Avanzar automáticamente
                    if (currentStep < STEPS.length - 1) {
                      setCurrentStep(currentStep + 1);
                      setTimeout(() => {
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }, 100);
                    }
                  }}
                  isWizardMode={true}
                />
              </div>
            )}

            {currentStep === 3 && (
              <div>
                <VehiclePictures
                  onComplete={() => {
                    setPhotosCompleted(true);
                    // Avanzar al paso de valuación
                    setCurrentStep(4);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  isWizardMode={true}
                />
              </div>
            )}

            {currentStep === 4 && (
              <div>
                <VehicleValuation
                  vehicleData={formData}
                  onComplete={(valuationData) => {
                    setValuationCompleted(true);
                    // Merge valuation data with existing form data
                    const completeData = { ...formData, ...valuationData };
                    console.log("Fotos guardadas del paso 2:", photos);
                    console.log("Cantidad de fotos:", photos?.length || 0);
                    handleCompleteInspection(photos, completeData);
                  }}
                  isWizardMode={true}
                  isSubmitting={isSubmitting}
                />
              </div>
            )}
          </div>

          {/* Navigation Footer */}
          <div className="border-t px-3 sm:px-6 py-1.5 sm:py-2">
            <div className="flex justify-between items-center">
              <Button
                variant="outline"
                onClick={handlePreviousStep}
                disabled={currentStep === 0 || isSubmitting}
                size="sm"
                className="text-xs sm:text-sm"
              >
                <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                <span className="hidden sm:inline">Anterior</span>
                <span className="sm:hidden">Atrás</span>
              </Button>

              <div className="text-xs sm:text-sm text-muted-foreground">
                Paso {currentStep + 1} de {STEPS.length}
              </div>

              {(currentStep === 3 || currentStep === 4) ? (
                // No mostrar botón "Siguiente" en fotos (3) ni valuación (4)
                null
              ) : (
                <Button
                  onClick={handleNextStep}
                  disabled={isSubmitting}
                  size="sm"
                  className="text-xs sm:text-sm"
                >
                  <span className="hidden sm:inline">Siguiente</span>
                  <span className="sm:hidden">Sig.</span>
                  <ArrowRight className="h-3 w-3 sm:h-4 sm:w-4 ml-1 sm:ml-2" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}