import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Car,
  ClipboardCheck,
  Camera,
  CheckCircle,
} from "lucide-react";
import { useInspection } from "../contexts/InspectionContext";
import { prepareInspectionData, createFullInspection } from "../services/vehicles";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import VehicleInspectionForm from "./vehicle-inspection";
import InspectionChecklist from "../components/inspection-checklist";
import VehiclePictures from "./vehicle-pictures";
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
    id: "checklist",
    title: "Criterios Críticos",
    description: "Evaluación de puntos de rechazo",
    icon: ClipboardCheck,
  },
  {
    id: "photos",
    title: "Fotografías",
    description: "Captura de imágenes del vehículo",
    icon: Camera,
  },
];

export default function VehicleInspectionWizard() {
  const { formData, checklistItems, photos, resetInspection } = useInspection();
  const [currentStep, setCurrentStep] = useState(0);
  const [basicInfoCompleted, setBasicInfoCompleted] = useState(false);
  const [checklistCompleted, setChecklistCompleted] = useState(false);
  const [photosCompleted, setPhotosCompleted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const progress = ((currentStep + 1) / STEPS.length) * 100;

  const handleNextStep = () => {
    // Validar que el paso actual esté completo antes de avanzar
    if (currentStep === 0 && !basicInfoCompleted) {
      toast.error("Por favor complete la información básica antes de continuar");
      return;
    }
    if (currentStep === 1 && !checklistCompleted) {
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

  const handleCompleteInspection = async (photosFromPictures?: any[]) => {
    // Usar las fotos pasadas directamente o las del contexto
    const photosToUse = photosFromPictures || photos;
    
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
      const { vehicleData, inspectionData } = prepareInspectionData(formData);
      
      // Call the API to create the full inspection
      const result = await createFullInspection(
        vehicleData,
        inspectionData,
        checklistItems,
        photosToUse
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
        <div className="container mx-auto px-2 sm:px-4 py-1">
          <div className="text-center">
            <h1 className="text-2xl sm:text-3xl font-bold">Nueva Inspección de Vehículo</h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">
              Complete todos los pasos para registrar la inspección
            </p>
          </div>
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
                const isCompleted = 
                  (index === 0 && basicInfoCompleted) ||
                  (index === 1 && checklistCompleted) ||
                  (index === 2 && photosCompleted);
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

            {currentStep === 1 && (
              <div>
                <InspectionChecklist 
                  onComplete={() => {
                    setChecklistCompleted(true);
                    // Avanzar automáticamente al siguiente paso
                    if (currentStep < STEPS.length - 1) {
                      setCurrentStep(currentStep + 1);
                      // Usar setTimeout para asegurar que el DOM se actualice primero
                      setTimeout(() => {
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }, 100);
                    }
                  }}
                  isWizardMode={true}
                />
              </div>
            )}

            {currentStep === 2 && (
              <div>
                <VehiclePictures 
                  onComplete={(photosFromComponent) => {
                    setPhotosCompleted(true);
                    // Pasar las fotos directamente, sin delays
                    handleCompleteInspection(photosFromComponent);
                  }}
                  isWizardMode={true}
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
                disabled={currentStep === 0}
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

              {currentStep === STEPS.length - 1 ? (
                // No mostrar botón aquí, el botón "Finalizar" en VehiclePictures lo maneja todo
                null
              ) : (
                <Button 
                  onClick={handleNextStep}
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