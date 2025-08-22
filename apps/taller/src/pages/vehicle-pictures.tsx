"use client";

import type React from "react";

import { useState, useRef } from "react";
import { useInspection } from "../contexts/InspectionContext";
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
  Sparkles,
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
  uploadStatus: 'pending' | 'uploading' | 'uploaded' | 'failed';
  serverUrl?: string;
  uploadError?: string;
};

type PhotosState = {
  [key: string]: {
    [key: string]: PhotoData | null;
  };
};

interface VehiclePicturesProps {
  onComplete?: (photos: any[]) => void;
  isWizardMode?: boolean;
}

export default function VehiclePictures({ 
  onComplete, 
  isWizardMode = false 
}: VehiclePicturesProps) {
  const { setPhotos: setContextPhotos } = useInspection();
  const [activeStep, setActiveStep] = useState(inspectionSteps[0].id);
  const [photoIndex, setPhotoIndex] = useState(0);
  
  // Create a single temporary vehicle ID for this inspection session
  const [tempVehicleId] = useState(() => 'temp-' + Date.now());
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
  
  // Check if dev mode is enabled
  const isDevMode = import.meta.env.VITE_DEV_MODE === 'TRUE';

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

  // Function to upload photo to server optimistically
  const uploadPhotoToServer = async (
    file: File, 
    stepId: string, 
    photoId: string, 
    title: string, 
    description?: string
  ) => {
    try {
      // Use the session's temporary vehicleId so all photos go to the same folder
      
      const formData = new FormData();
      formData.append('file', file);
      formData.append('vehicleId', tempVehicleId);
      formData.append('category', stepId);
      formData.append('photoType', photoId);
      formData.append('title', title);
      if (description) {
        formData.append('description', description);
      }

      const response = await fetch(`${import.meta.env.VITE_SERVER_URL || 'http://localhost:3000'}/api/upload-vehicle-photo`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        // Get error details from server
        let errorMessage = `Upload failed: ${response.statusText}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
          console.error('Upload error details:', errorData);
        } catch (e) {
          console.error('Failed to parse error response');
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      return result.data.url;
    } catch (error) {
      console.error('Upload error:', error);
      throw error;
    }
  };

  // Handle file upload with optimistic upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const photoData: PhotoData = {
        file,
        preview: reader.result as string,
        uploadStatus: 'pending',
      };

      // Set photo immediately for UI responsiveness
      setPhotos((prev) => ({
        ...prev,
        [activeStep]: {
          ...prev[activeStep],
          [currentPhoto.id]: photoData,
        },
      }));

      // Start optimistic upload in background
      const photo = currentStep.photos.find(p => p.id === currentPhoto.id);
      if (photo) {
        uploadOptimistically(file, activeStep, currentPhoto.id, photo.title, photo.description);
      }
    };
    reader.readAsDataURL(file);
  };

  // Optimistic upload function that runs in background
  const uploadOptimistically = async (
    file: File,
    stepId: string,
    photoId: string,
    title: string,
    description?: string
  ) => {
    // Update status to uploading
    setPhotos((prev) => ({
      ...prev,
      [stepId]: {
        ...prev[stepId],
        [photoId]: {
          ...prev[stepId][photoId]!,
          uploadStatus: 'uploading',
        },
      },
    }));

    try {
      const serverUrl = await uploadPhotoToServer(file, stepId, photoId, title, description);
      
      console.log(`✅ Upload successful for ${photoId}:`, {
        stepId,
        photoId,
        serverUrl,
        title
      });
      
      // Update status to uploaded with server URL but keep blob preview for display
      setPhotos((prev) => {
        const updated = {
          ...prev,
          [stepId]: {
            ...prev[stepId],
            [photoId]: {
              ...prev[stepId][photoId]!,
              uploadStatus: 'uploaded' as const,
              serverUrl,
              // Keep the blob URL for preview, serverUrl is for database
            },
          },
        };
        
        console.log(`State updated for ${photoId}:`, updated[stepId][photoId]);
        return updated;
      });
    } catch (error) {
      // Update status to failed with error
      setPhotos((prev) => ({
        ...prev,
        [stepId]: {
          ...prev[stepId],
          [photoId]: {
            ...prev[stepId][photoId]!,
            uploadStatus: 'failed',
            uploadError: error instanceof Error ? error.message : 'Upload failed',
          },
        },
      }));
      
      // Show error toast but don't block UI
      toast.error(`Error subiendo ${title}. Reintentará al finalizar.`);
    }
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
  
  // Function to fill all photos with dummy data
  const fillWithDummyPhotos = async () => {
    const newPhotos: PhotosState = {};
    
    // Sample images to cycle through
    const sampleImages = ['/sample_1.avif', '/sample_2.jpg', '/sample_3.jpg'];
    let imageIndex = 0;
    
    for (const step of inspectionSteps) {
      newPhotos[step.id] = {};
      
      for (const photo of step.photos) {
        try {
          // Get the current sample image (cycle through the 3 images)
          const currentImageUrl = sampleImages[imageIndex % sampleImages.length];
          imageIndex++;
          
          // Fetch the sample image
          const response = await fetch(currentImageUrl);
          const blob = await response.blob();
          
          // Get file extension from the URL
          const extension = currentImageUrl.split('.').pop();
          const mimeType = extension === 'avif' ? 'image/avif' : 'image/jpeg';
          
          // Create File object
          const file = new File([blob], `${photo.id}.${extension}`, { type: mimeType });
          
          // Create preview URL
          const preview = URL.createObjectURL(blob);
          
          newPhotos[step.id][photo.id] = {
            file,
            preview,
            uploadStatus: 'pending',
          };
        } catch (error) {
          console.error(`Error loading sample image for ${photo.id}:`, error);
          
          // Fallback to canvas if image loading fails
          const canvas = document.createElement('canvas');
          canvas.width = 800;
          canvas.height = 600;
          const ctx = canvas.getContext('2d');
          
          if (ctx) {
            ctx.fillStyle = '#f0f0f0';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#333';
            ctx.font = 'bold 24px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('Imagen de prueba', canvas.width / 2, canvas.height / 2);
          }
          
          canvas.toBlob((blob) => {
            if (blob) {
              const file = new File([blob], `${photo.id}.jpg`, { type: 'image/jpeg' });
              const preview = canvas.toDataURL('image/jpeg');
              
              newPhotos[step.id][photo.id] = {
                file,
                preview,
                uploadStatus: 'pending',
              };
            }
          }, 'image/jpeg', 0.9);
        }
      }
    }
    
    setPhotos(newPhotos);
    
    // Show success message
    toast.success('Se llenaron todas las fotos con datos de prueba');
    
    // Start uploading all photos in background with small delays to avoid overwhelming server
    let delay = 0;
    for (const step of inspectionSteps) {
      for (const photo of step.photos) {
        const photoData = newPhotos[step.id][photo.id];
        if (photoData) {
          // Start upload in background with staggered timing
          setTimeout(() => {
            uploadOptimistically(photoData.file, step.id, photo.id, photo.title, photo.description);
          }, delay);
          delay += 100; // 100ms delay between uploads
        }
      }
    }
    
    // Don't auto-complete here, wait for uploads to finish
  };

  // Function to retry failed uploads
  const retryFailedUploads = async (): Promise<boolean> => {
    const failedPhotos = [];
    
    // Collect all failed photos
    for (const [stepId, stepPhotos] of Object.entries(photos)) {
      for (const [photoId, photoData] of Object.entries(stepPhotos)) {
        if (photoData && photoData.uploadStatus === 'failed') {
          const step = inspectionSteps.find(s => s.id === stepId);
          const photo = step?.photos.find(p => p.id === photoId);
          if (photo) {
            failedPhotos.push({
              file: photoData.file,
              stepId,
              photoId,
              title: photo.title,
              description: photo.description,
            });
          }
        }
      }
    }

    if (failedPhotos.length === 0) return true;

    // Retry failed uploads
    try {
      await Promise.all(
        failedPhotos.map(({ file, stepId, photoId, title, description }) =>
          uploadOptimistically(file, stepId, photoId, title, description)
        )
      );
      
      // Wait a bit for uploads to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check if any still failed
      const stillFailed = Object.values(photos).some(stepPhotos =>
        Object.values(stepPhotos).some(photo => photo?.uploadStatus === 'failed')
      );
      
      return !stillFailed;
    } catch (error) {
      return false;
    }
  };

  const handleFinish = async () => {
    if (!isWizardMode) {
      // When not in wizard mode, just show photos submitted message
      console.log("Submitting all photos:", photos);
      toast.success(
        `Se enviaron exitosamente ${completedPhotos} fotos de la inspección del vehículo.`
      );
      return;
    }

    // In wizard mode, verify all uploads are complete
    try {
      // Check for failed uploads and retry
      const allUploaded = await retryFailedUploads();
      
      if (!allUploaded) {
        toast.error("Algunas fotos no se pudieron subir. Por favor, inténtelo de nuevo.");
        return;
      }

      // Prepare photo data with server URLs for context
      const photoDataForContext = [];
      for (const [stepId, stepPhotos] of Object.entries(photos)) {
        const step = inspectionSteps.find(s => s.id === stepId);
        for (const [photoId, photoData] of Object.entries(stepPhotos)) {
          if (photoData) {
            const photo = step?.photos.find(p => p.id === photoId);
            
            // Debug: log what we're sending
            console.log(`Photo ${photoId}:`, {
              uploadStatus: photoData.uploadStatus,
              hasServerUrl: !!photoData.serverUrl,
              serverUrl: photoData.serverUrl,
              preview: photoData.preview
            });
            
            // Use serverUrl if available, otherwise skip this photo
            if (photoData.uploadStatus === 'uploaded' && photoData.serverUrl) {
              photoDataForContext.push({
                category: stepId,
                photoType: photoId,
                title: photo?.title || '',
                description: photo?.description,
                url: photoData.serverUrl, // Use server URL from R2
              });
            } else if (photoData.uploadStatus === 'uploaded' && !photoData.serverUrl) {
              console.error(`ERROR: Photo ${photoId} marked as uploaded but has no serverUrl!`);
              console.error('This photo will use blob URL:', photoData.preview);
              // This is the problem - photo is "uploaded" but no serverUrl
              // DO NOT add this photo with blob URL
            }
          }
        }
      }
      console.log('Final photos being sent to context:', photoDataForContext);
      setContextPhotos(photoDataForContext);

      // Automatically trigger completion when in wizard mode
      if (onComplete) {
        toast.success(`¡Fotos subidas exitosamente! Enviando inspección...`);
        // Pasar las fotos directamente sin delay
        onComplete(photoDataForContext);
      } else {
        toast.success(`Fotos subidas exitosamente (${completedPhotos}).`);
      }
    } catch (error) {
      console.error("Error preparing photos:", error);
      toast.error("Error al procesar las fotos");
    }
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

          {isDevMode && (
            <Button
              onClick={fillWithDummyPhotos}
              variant="outline"
              className="gap-2 w-fit"
            >
              <Sparkles className="h-4 w-4" />
              Llenar con fotos de prueba
            </Button>
          )}

          <div className="flex flex-col gap-4 mt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Progress value={progress} className="w-40 h-2" />
                <span className="text-sm text-muted-foreground">
                  {completedPhotos}/{totalPhotos} fotos
                </span>
              </div>

              <Button
                onClick={handleFinish}
                disabled={!isComplete}
                size="sm"
                className={cn(
                  "transition-all",
                  isComplete
                    ? "bg-green-600 hover:bg-green-700 text-white"
                    : "bg-muted text-muted-foreground"
                )}
              >
                <CheckCircle2 className="mr-1 h-3 w-3" />
                <span className="hidden sm:inline">Completar y Enviar Inspección</span>
                <span className="sm:hidden">Completar</span>
              </Button>
            </div>
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
                  <div className="absolute top-2 right-2 flex gap-1">
                    {/* Upload status indicator */}
                    <div className={cn(
                      "rounded-full p-1",
                      currentPhotoData.uploadStatus === 'uploaded' ? "bg-green-500" :
                      currentPhotoData.uploadStatus === 'failed' ? "bg-red-500" :
                      currentPhotoData.uploadStatus === 'uploading' ? "bg-yellow-500" :
                      "bg-blue-500"
                    )}>
                      {currentPhotoData.uploadStatus === 'uploaded' ? (
                        <Check className="h-3 w-3 text-white" />
                      ) : currentPhotoData.uploadStatus === 'failed' ? (
                        <X className="h-3 w-3 text-white" />
                      ) : currentPhotoData.uploadStatus === 'uploading' ? (
                        <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Check className="h-3 w-3 text-white" />
                      )}
                    </div>
                    
                    {/* Remove button */}
                    <Button
                      variant="destructive"
                      size="icon"
                      className="h-8 w-8"
                      onClick={removePhoto}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
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
                  <span className="sm:inline">Siguiente</span>
                  <ChevronRight className="ml-2 h-4 w-4" />
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
                    <div className={cn(
                      "absolute top-1 right-1 rounded-full p-0.5",
                      photoData.uploadStatus === 'uploaded' ? "bg-green-500" :
                      photoData.uploadStatus === 'failed' ? "bg-red-500" :
                      photoData.uploadStatus === 'uploading' ? "bg-yellow-500" :
                      "bg-blue-500"
                    )}>
                      {photoData.uploadStatus === 'uploaded' ? (
                        <Check className="h-3 w-3 text-white" />
                      ) : photoData.uploadStatus === 'failed' ? (
                        <X className="h-3 w-3 text-white" />
                      ) : photoData.uploadStatus === 'uploading' ? (
                        <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Check className="h-3 w-3 text-white" />
                      )}
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
