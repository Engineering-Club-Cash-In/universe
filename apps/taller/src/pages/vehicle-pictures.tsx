"use client";

import type React from "react";

import { useState, useRef } from "react";
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Upload,
  X,
  Car,
  Gauge,
  Armchair,
  Wrench,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

// Define the inspection steps and their photos
const inspectionSteps = [
  {
    id: "exterior",
    title: "Exterior",
    icon: Car,
    photos: [
      {
        id: "front-view",
        title: "Vista Frontal",
        description:
          "Toma frontal capturando faros, parrilla, parachoques y capó.",
      },
      {
        id: "rear-view",
        title: "Vista Trasera",
        description:
          "Toma directa mostrando luces traseras, maletero y parachoques trasero.",
      },
      {
        id: "left-side",
        title: "Vista Lateral Izquierda",
        description: "Perfil completo del lado izquierdo del vehículo.",
      },
      {
        id: "right-side",
        title: "Vista Lateral Derecha",
        description: "Perfil completo del lado derecho del vehículo.",
      },
      {
        id: "front-left",
        title: "Vista Frontal Izquierda ¾",
        description: "Captura de la esquina frontal izquierda en ángulo.",
      },
      {
        id: "front-right",
        title: "Vista Frontal Derecha ¾",
        description: "Captura de la esquina frontal derecha en ángulo.",
      },
      {
        id: "rear-left",
        title: "Vista Trasera Izquierda ¾",
        description: "Captura de la esquina trasera izquierda en ángulo.",
      },
      {
        id: "rear-right",
        title: "Vista Trasera Derecha ¾",
        description: "Captura de la esquina trasera derecha en ángulo.",
      },
      {
        id: "roof",
        title: "Techo",
        description:
          "Tomada desde arriba para verificar techo solar, abolladuras o problemas de pintura.",
      },
      {
        id: "undercarriage",
        title: "Parte Inferior",
        description: "Toma de ángulo inferior mostrando la parte inferior del vehículo.",
      },
    ],
  },
  {
    id: "wheels",
    title: "Ruedas y Neumáticos",
    icon: Gauge,
    photos: [
      {
        id: "front-left-wheel",
        title: "Rueda Delantera Izquierda",
        description: "Acercamiento del rin y condición del neumático.",
      },
      {
        id: "front-right-wheel",
        title: "Rueda Delantera Derecha",
        description: "Acercamiento del rin y condición del neumático.",
      },
      {
        id: "rear-left-wheel",
        title: "Rueda Trasera Izquierda",
        description: "Acercamiento del rin y condición del neumático.",
      },
      {
        id: "rear-right-wheel",
        title: "Rueda Trasera Derecha",
        description: "Acercamiento del rin y condición del neumático.",
      },
      {
        id: "spare-tire",
        title: "Neumático de Repuesto",
        description: "Si es accesible, foto del repuesto y herramientas.",
      },
    ],
  },
  {
    id: "interior",
    title: "Interior",
    icon: Armchair,
    photos: [
      {
        id: "dashboard",
        title: "Tablero y Volante",
        description: "Desde la perspectiva del conductor.",
      },
      {
        id: "odometer",
        title: "Odómetro y Panel de Instrumentos",
        description: "Mostrando kilometraje y luces de advertencia.",
      },
      {
        id: "center-console",
        title: "Consola Central e Infoentretenimiento",
        description: "Mostrando controles, palanca de cambios y pantalla.",
      },
      {
        id: "front-seats",
        title: "Asientos Delanteros",
        description: "Toma amplia capturando la condición de la tapicería.",
      },
      {
        id: "rear-seats",
        title: "Asientos Traseros",
        description: "Toma amplia capturando tapicería y espacio para piernas.",
      },
      {
        id: "driver-door",
        title: "Panel de Puerta del Conductor",
        description: "Mostrando controles de ventanas, seguros y espejos.",
      },
      {
        id: "passenger-door",
        title: "Panel de Puerta del Pasajero",
        description: "Similar al lado del conductor.",
      },
      {
        id: "trunk",
        title: "Maletero / Área de Carga",
        description: "Vista abierta mostrando espacio de almacenamiento y condición.",
      },
    ],
  },
  {
    id: "engine",
    title: "Compartimiento del Motor",
    icon: Wrench,
    photos: [
      {
        id: "engine-bay",
        title: "Compartimiento del Motor General",
        description: "Desde arriba con el capó abierto.",
      },
      {
        id: "battery",
        title: "Batería y Componentes Eléctricos",
        description: "Acercamiento del área de la batería.",
      },
      {
        id: "oil-cap",
        title: "Área de Tapón de Aceite / Varilla",
        description: "Acercamiento para verificar fugas o lodo.",
      },
    ],
  },
  {
    id: "damage",
    title: "Daños y Áreas Específicas",
    icon: AlertTriangle,
    photos: [
      {
        id: "scratches",
        title: "Rayones, Abolladuras o Puntos de Óxido",
        description: "Acercamientos de cualquier defecto.",
      },
      {
        id: "windshield",
        title: "Parabrisas y Ventanas",
        description: "Si hay grietas o despostillados.",
      },
      {
        id: "undercarriage-damage",
        title: "Óxido/Daño en Parte Inferior",
        description: "Si es visible.",
      },
    ],
  },
];

type PhotoData = {
  file: File;
  preview: string;
};

type PhotosState = {
  [key: string]: {
    [key: string]: PhotoData | null;
  };
};

interface VehiclePicturesProps {
  onComplete?: () => void;
  isWizardMode?: boolean;
}

export default function VehiclePictures({ 
  onComplete, 
  isWizardMode = false 
}: VehiclePicturesProps) {
  const [activeStep, setActiveStep] = useState(inspectionSteps[0].id);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [photos, setPhotos] = useState<PhotosState>(() => {
    // Initialize the photos state with null values for all photos
    const initialState: PhotosState = {};
    inspectionSteps.forEach((step) => {
      initialState[step.id] = {};
      step.photos.forEach((photo) => {
        initialState[step.id][photo.id] = null;
      });
    });
    return initialState;
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get the current step and photo
  const currentStepIndex = inspectionSteps.findIndex(
    (step) => step.id === activeStep
  );
  const currentStep = inspectionSteps[currentStepIndex];
  const currentPhoto = currentStep.photos[photoIndex];

  // Calculate progress
  const totalPhotos = inspectionSteps.reduce(
    (acc, step) => acc + step.photos.length,
    0
  );
  const completedPhotos = Object.values(photos).reduce((acc, stepPhotos) => {
    return (
      acc + Object.values(stepPhotos).filter((photo) => photo !== null).length
    );
  }, 0);
  const progress = Math.round((completedPhotos / totalPhotos) * 100);
  const isComplete = completedPhotos === totalPhotos;

  // Calculate completion for each step
  const stepCompletionStatus = inspectionSteps.map((step) => {
    const totalStepPhotos = step.photos.length;
    const completedStepPhotos = Object.values(photos[step.id]).filter(
      (photo) => photo !== null
    ).length;
    const percentage = Math.round(
      (completedStepPhotos / totalStepPhotos) * 100
    );
    return {
      id: step.id,
      completed: completedStepPhotos,
      total: totalStepPhotos,
      percentage,
    };
  });

  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setPhotos((prev) => ({
        ...prev,
        [activeStep]: {
          ...prev[activeStep],
          [currentPhoto.id]: {
            file,
            preview: reader.result as string,
          },
        },
      }));
    };
    reader.readAsDataURL(file);
  };

  // Navigation functions
  const goToNextPhoto = () => {
    if (photoIndex < currentStep.photos.length - 1) {
      setPhotoIndex(photoIndex + 1);
    } else {
      const nextStepIndex = currentStepIndex + 1;
      if (nextStepIndex < inspectionSteps.length) {
        setActiveStep(inspectionSteps[nextStepIndex].id);
        setPhotoIndex(0);
      }
    }
  };

  const goToPrevPhoto = () => {
    if (photoIndex > 0) {
      setPhotoIndex(photoIndex - 1);
    } else {
      const prevStepIndex = currentStepIndex - 1;
      if (prevStepIndex >= 0) {
        setActiveStep(inspectionSteps[prevStepIndex].id);
        setPhotoIndex(inspectionSteps[prevStepIndex].photos.length - 1);
      }
    }
  };

  const handleStepChange = (value: string) => {
    setActiveStep(value);
    setPhotoIndex(0);
  };

  const removePhoto = () => {
    setPhotos((prev) => ({
      ...prev,
      [activeStep]: {
        ...prev[activeStep],
        [currentPhoto.id]: null,
      },
    }));
  };

  const handleFinish = () => {
    // Here you would typically submit the photos to your backend
    console.log("Submitting all photos:", photos);

    // Show success message
    toast.success(
      `Se enviaron exitosamente ${completedPhotos} fotos de la inspección del vehículo.`
    );

    // In wizard mode, call the onComplete callback
    if (isWizardMode && onComplete) {
      onComplete();
    }
    
    // In a real application, you might redirect the user or show a success screen
  };

  // Calculate if we're at the first or last photo overall
  const isFirstPhoto = currentStepIndex === 0 && photoIndex === 0;
  const isLastPhoto =
    currentStepIndex === inspectionSteps.length - 1 &&
    photoIndex ===
      inspectionSteps[inspectionSteps.length - 1].photos.length - 1;

  const currentPhotoData = photos[activeStep][currentPhoto.id];

  // Find the current step's icon component
  const CurrentStepIcon =
    inspectionSteps.find((step) => step.id === activeStep)?.icon || Car;

  return (
    <div className="container mx-auto py-4 px-2 sm:py-8 sm:px-4">
      <div className="flex flex-col space-y-4 sm:space-y-6 max-w-4xl mx-auto">
        <div className="flex flex-col space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold">
            Fotos de Inspección del Vehículo
          </h1>
          <p className="text-muted-foreground">
            Complete la inspección fotográfica tomando fotos claras de cada
            área requerida.
          </p>

          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-2">
              <Progress value={progress} className="w-40 h-2" />
              <span className="text-sm text-muted-foreground">
                {completedPhotos}/{totalPhotos} fotos
              </span>
            </div>

            <Button
              onClick={handleFinish}
              disabled={!isComplete}
              className={cn(
                "transition-all",
                isComplete
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : "bg-muted text-muted-foreground"
              )}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Finalizar Inspección
            </Button>
          </div>
        </div>

        {/* Mobile Category Selector */}
        <div className="md:hidden">
          <Select value={activeStep} onValueChange={handleStepChange}>
            <SelectTrigger className="w-full">
              <SelectValue>
                <div className="flex items-center gap-2">
                  <CurrentStepIcon className="h-4 w-4" />
                  <span>{currentStep.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {stepCompletionStatus.find((s) => s.id === activeStep)
                      ?.completed || 0}
                    /
                    {stepCompletionStatus.find((s) => s.id === activeStep)
                      ?.total || 0}
                  </span>
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {inspectionSteps.map((step) => {
                const status = stepCompletionStatus.find(
                  (s) => s.id === step.id
                );
                const StepIcon = step.icon;
                return (
                  <SelectItem key={step.id} value={step.id}>
                    <div className="flex items-center gap-2 w-full">
                      <StepIcon className="h-4 w-4" />
                      <span>{step.title}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {status?.completed || 0}/{status?.total || 0}
                      </span>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {/* Desktop Tabs */}
        <div className="hidden md:block">
          <Tabs
            value={activeStep}
            onValueChange={handleStepChange}
            className="w-full"
          >
            <TabsList className="flex w-full">
              {inspectionSteps.map((step) => {
                const status = stepCompletionStatus.find(
                  (s) => s.id === step.id
                );
                const StepIcon = step.icon;
                return (
                  <TabsTrigger
                    key={step.id}
                    value={step.id}
                    className="flex items-center gap-2 py-2 px-3 flex-1"
                  >
                    <StepIcon className="h-4 w-4" />
                    <span className="text-xs whitespace-nowrap">
                      {step.title}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {status?.completed || 0}/{status?.total || 0}
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        </div>

        {/* Photo Content */}
        <Card>
          <CardHeader className="px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base sm:text-lg">
                  {currentPhoto.title}
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  {currentPhoto.description}
                </CardDescription>
              </div>
              <div className="text-xs sm:text-sm text-muted-foreground">
                Foto {photoIndex + 1} de {currentStep.photos.length}
              </div>
            </div>
          </CardHeader>

          <CardContent className="px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex flex-col items-center justify-center">
              {currentPhotoData ? (
                <div className="relative w-full max-w-md aspect-[4/3] bg-muted rounded-lg overflow-hidden">
                  <img
                    src={currentPhotoData.preview || "/placeholder.svg"}
                    alt={currentPhoto.title}
                    className="object-cover w-full h-full"
                  />
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2"
                    onClick={removePhoto}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div
                  className="flex flex-col items-center justify-center w-full max-w-md aspect-[4/3] bg-muted rounded-lg border-2 border-dashed border-muted-foreground/25 cursor-pointer hover:bg-muted/80 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera className="h-10 w-10 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Clic para subir o tomar una foto
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </div>
              )}
            </div>
          </CardContent>

          <CardFooter className="flex justify-between px-4 py-3 sm:px-6 sm:py-4">
            <Button
              variant="outline"
              onClick={goToPrevPhoto}
              disabled={isFirstPhoto}
              className="h-10"
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              <span className="sm:inline">Anterior</span>
            </Button>

            <Button
              onClick={() => {
                if (currentPhotoData) {
                  goToNextPhoto();
                } else {
                  fileInputRef.current?.click();
                }
              }}
              disabled={isLastPhoto && currentPhotoData === null}
              className="h-10"
            >
              {currentPhotoData ? (
                <>
                  {isLastPhoto ? (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Completar
                    </>
                  ) : (
                    <>
                      <span className="sm:inline">Siguiente</span>
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  <span className="sm:inline">Subir</span>
                </>
              )}
            </Button>
          </CardFooter>
        </Card>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-4 mt-4 sm:mt-6">
          {currentStep.photos.map((photo, idx) => {
            const photoData = photos[activeStep][photo.id];
            return (
              <div
                key={photo.id}
                className={cn(
                  "relative aspect-square rounded-lg overflow-hidden border cursor-pointer",
                  photoIndex === idx ? "ring-2 ring-primary" : "",
                  photoData ? "bg-muted" : "bg-muted/50"
                )}
                onClick={() => setPhotoIndex(idx)}
              >
                {photoData ? (
                  <>
                    <img
                      src={photoData.preview || "/placeholder.svg"}
                      alt={photo.title}
                      className="object-cover w-full h-full"
                    />
                    <div className="absolute top-1 right-1 bg-primary rounded-full p-0.5">
                      <Check className="h-3 w-3 text-primary-foreground" />
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <Camera className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-1">
                  <p className="text-xs text-white truncate text-center">
                    {photo.title}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <Toaster />
    </div>
  );
}
