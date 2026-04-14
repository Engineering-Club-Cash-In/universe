import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { useInspection } from "../contexts/InspectionContext";
import { validateVehiclePlate } from "../services/vehicles";
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast, Toaster } from "sonner";
import { Sparkles, Search, Check, FileSearch, History, Car, Loader2, ShieldAlert, HelpCircle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { searchInspectedVehicles } from "../services/vehicles";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import VehicleRegistrationOCR from "../components/vehicle-registration-ocr";
const formSchema = z.object({
  // Section 1: Technician Info
  technicianName: z.string({ message: "El nombre es requerido" }).min(1, { message: "El nombre es requerido" }),
  inspectionDate: z.date({ message: "La fecha es requerida" }),

  // Section 2: Vehicle Info
  vehicleMake: z.string({ message: "La marca es requerida" }).min(1, { message: "La marca es requerida" }),
  vehicleModel: z.string({ message: "La línea es requerida" }).min(1, { message: "La línea es requerida" }),
  trim: z.string({ message: "La versión/equipamiento es requerida" }).min(1, { message: "La versión es requerida" }),
  vehicleYear: z.string({ message: "El año es requerido" }).min(1, { message: "El año es requerido" }),
  licensePlate: z.string({ message: "El número de placa es requerido" }).min(1, { message: "El número de placa es requerido" }),
  vinNumber: z.string({ message: "El número VIN/Chasis es requerido" }).min(1, { message: "El número VIN/Chasis es requerido" }),
  motorNumber: z.string({ message: "El número de motor es requerido" }).min(1, { message: "El número de motor es requerido" }),
  milesMileage: z.string().optional(),
  kmMileage: z.string({ message: "El kilometraje es requerido" }).min(1, { message: "El kilometraje es requerido" }),
  origin: z.enum(["Nacional", "Importado"], { message: "La procedencia es requerida" }),
  vehicleType: z.string({ message: "El tipo de vehículo es requerido" }).min(1, { message: "El tipo de vehículo es requerido" }),
  color: z.string({ message: "El color es requerido" }).min(1, { message: "El color es requerido" }),
  vehicleUse: z.string().optional(),
  seats: z.string().optional(),
  cylinders: z.string({ message: "Los cilindros son requeridos" })
    .min(1, { message: "Los cilindros son requeridos" })
    .refine((val) => {
      const num = parseInt(val, 10);
      return !isNaN(num) && num >= 1 && num <= 8;
    }, { message: "El número de cilindros debe estar entre 1 y 8" }),
  engineCC: z.string({ message: "El motor (CC) es requerido" }).min(1, { message: "El motor (CC) es requerido" }),
  fuelType: z.enum(["Gasolina", "Diesel", "Eléctrico", "Híbrido"], { message: "El tipo de combustible es requerido" }),
  transmission: z.enum(["Automático", "Manual"], { message: "La transmisión es requerida" }),
  traction: z.enum(["FWD (Delantera)", "RWD (Trasera)", "AWD (Integral)", "4x4"], { message: "La tracción es requerida" }),

  // Section 3: Test Drive
  testDrive: z.enum(["Sí", "No"], { message: "Esta información es requerida" }),
  noTestDriveReason: z.string(),

  vinVerification: z.boolean(),
  vehicleId: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface VehicleInspectionFormProps {
  onComplete?: () => void;
  isWizardMode?: boolean;
}

export interface VehicleInspectionFormRef {
  triggerValidation: () => Promise<boolean>;
}

const VehicleInspectionForm = forwardRef<VehicleInspectionFormRef, VehicleInspectionFormProps>(({
  onComplete,
  isWizardMode = false
}, ref) => {
  const { formData, setFormData } = useInspection();
  const topRef = useRef<HTMLDivElement>(null);
  const [formSubmitted, setFormSubmitted] = useState(false);

  // Check if dev mode is enabled
  const isDevMode = import.meta.env.VITE_DEV_MODE === 'TRUE';
  
  const [inspectionType, setInspectionType] = useState<"new" | "existing">("new");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [duplicateVehicle, setDuplicateVehicle] = useState<any | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<any | null>(null);
  const [mismatchedFields, setMismatchedFields] = useState<string[]>([]);
  const [comparisonMismatches, setComparisonMismatches] = useState<string[]>([]);
  const [rawOcrData, setRawOcrData] = useState<Partial<FormValues> | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      technicianName: "",
      inspectionDate: undefined,
      vehicleMake: "",
      vehicleModel: "",
      trim: "",
      vehicleYear: "",
      licensePlate: "",
      vinNumber: "",
      motorNumber: "",
      milesMileage: "",
      kmMileage: "",
      origin: undefined,
      vehicleType: "",
      color: "",
      vehicleUse: "",
      seats: "",
      cylinders: "",
      engineCC: "",
      fuelType: undefined,
      transmission: undefined,
      traction: undefined,
      testDrive: undefined,
      noTestDriveReason: "",
      vinVerification: false,
      vehicleId: "",
      ...formData,
    },
  });

  // Exponer método de validación para el wizard
  useImperativeHandle(ref, () => ({
    triggerValidation: async () => {
      const values = form.getValues();
      console.log("=== triggerValidation debug ===");
      console.log("vinVerification:", values.vinVerification);
      
      // Validación manual de seguridad
      if (!values.vinVerification) {
        form.setError("vinVerification", {
          type: "manual",
          message: "Debe confirmar la revisión de la información"
        });
        toast.error("Confirmación requerida: Marque la casilla de revisión de información");
        const element = document.getElementById("vin-verification-container");
        element?.scrollIntoView({ behavior: "smooth", block: "center" });
        return false;
      }

      const result = await form.trigger();
      if (!result) {
        toast.error("Por favor complete los campos marcados en rojo");
        // Scroll al primer campo con error
        const firstError = Object.keys(form.formState.errors)[0];
        if (firstError) {
          const element = document.querySelector(`[name="${firstError}"]`);
          element?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return false;
      }

      // Validar también la placa contra duplicados antes de avanzar
      // Pasamos el vehicleId para que el servidor ignore este mismo registro si es una actualización
      const validationResult = await validateVehiclePlate(values.licensePlate, values.vinNumber, values.vehicleId);
      if (!validationResult.success || !validationResult.data?.valid) {
        toast.error(validationResult.data?.message || "La placa ya está en uso con otro chasis.");
        return false;
      }

      // Si pasa la validación, guardamos en contexto de una vez
      setFormData(values);
      return true;
    }
  }), [form, setFormData]);

  const handleCheckDuplicate = async (overridePlate?: string, overrideVin?: string, ocrToMatch?: Partial<FormValues>) => {
    const plate = overridePlate || form.getValues("licensePlate");
    const vin = overrideVin || form.getValues("vinNumber");

    if (!plate && !vin) {
      setDuplicateVehicle(null);
      return;
    }

    const result = await validateVehiclePlate(plate, vin, form.getValues("vehicleId"));
    if (result.success && result.data?.alreadyExists) {
      const vehicle = result.data.vehicle;
      if (!vehicle) return;

      setDuplicateVehicle(vehicle);
      
      const ocrSource = ocrToMatch || rawOcrData || undefined;
      
      // Auto-cargar datos y comparar
      selectVehicle(vehicle, ocrSource);
      
      if (ocrSource) {
        recalculateMismatches(vehicle, ocrSource);
      } else {
        // Marcamos todo como editable si no hay OCR (entrada manual)
        setMismatchedFields(Object.keys(form.getValues()));
      }
      
      toast.info(`Sincronización automática: Datos cargados para ${vehicle.licensePlate}`);
    } else {
      setDuplicateVehicle(null);
      setSelectedVehicle(null);
      setMismatchedFields([]);
      setComparisonMismatches([]);
    }
  };

  const recalculateMismatches = (dbVehicle: any, ocr: Partial<FormValues>) => {
    const mismatches: string[] = [];
    const fieldsToCompare: Array<keyof FormValues> = [
      'vehicleMake', 'vehicleModel', 'vehicleYear', 'licensePlate', 
      'vinNumber', 'motorNumber', 'color', 'vehicleType', 'cylinders', 'engineCC',
      'vehicleUse', 'seats'
    ];

    // Helper to normalize values for comparison
    const normalize = (val: any) => {
      if (val === null || val === undefined) return "";
      return val.toString().trim().toUpperCase().replace(/^0+/, ''); // Remove leading zeros and normalize case
    };

    fieldsToCompare.forEach(field => {
      // Map form field names to database vehicle property names
      const dbProp = field === 'vehicleMake' ? 'make' : 
                    field === 'vehicleModel' ? 'model' : 
                    field === 'vehicleYear' ? 'year' :
                    field === 'vehicleUse' ? 'vehicleUse' : // Fix potential naming diff
                    field;
      
      const dbValue = normalize(dbVehicle[dbProp]);
      const ocrValue = normalize(ocr[field]);

      // Solo marcamos como "discrepancia" (alerta azul) si los valores normalizados son distintos
      // y si el OCR realmente pudo leer algo
      if (ocrValue && dbValue !== ocrValue) {
        mismatches.push(field);
      }
    });

    setComparisonMismatches(mismatches);

    // Campos que siempre requieren revisión fresca del técnico (SIEMPRE EDITABLES)
    const alwaysEditable: Array<keyof FormValues> = [
      'technicianName', 'inspectionDate', 'kmMileage', 'milesMileage', 
      'fuelType', 'transmission', 'traction', 'testDrive', 'noTestDriveReason',
      'vinVerification', 'trim', 'origin'
    ];
    
    // El técnico puede editar:
    // 1. Las discrepancias reales detectadas (incluyendo Uso y Asientos si son lógicamente distintos)
    // 2. Los campos que siempre deben ser editables
    setMismatchedFields([...mismatches, ...alwaysEditable]);
  };

  const handleSearch = async (query: string) => {
    setSearchTerm(query);
    if (query.length < 3) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const result = await searchInspectedVehicles(query);
      if (result.success) {
        setSearchResults(result.data || []);
      }
    } catch (error) {
      console.error("Error searching vehicles:", error);
    } finally {
      setIsSearching(false);
    }
  };

  const selectVehicle = (vehicle: any, ocrData?: Partial<FormValues>) => {
    // Current OCR data if available to fill gaps in DB
    const ocr = ocrData || rawOcrData || {};

    form.reset({
      ...form.getValues(),
      vehicleId: vehicle.id,
      vehicleMake: vehicle.make || ocr.vehicleMake || "",
      vehicleModel: vehicle.model || ocr.vehicleModel || "",
      trim: vehicle.trim || ocr.trim || "",
      vehicleYear: vehicle.year?.toString() || ocr.vehicleYear || "",
      licensePlate: vehicle.licensePlate || ocr.licensePlate || "",
      vinNumber: vehicle.vinNumber || ocr.vinNumber || "",
      motorNumber: vehicle.motorNumber || ocr.motorNumber || "",
      vehicleType: vehicle.vehicleType || ocr.vehicleType || "",
      color: vehicle.color || ocr.color || "",
      vehicleUse: vehicle.vehicleUse || ocr.vehicleUse || "",
      seats: vehicle.seats?.toString() || ocr.seats || "",
      cylinders: vehicle.cylinders || ocr.cylinders || "",
      engineCC: vehicle.engineCC || ocr.engineCC || "",
      fuelType: (vehicle.fuelType || ocr.fuelType) as any,
      transmission: (vehicle.transmission || ocr.transmission) as any,
      traction: (vehicle.traction || ocr.traction) as any,
      origin: (vehicle.origin || ocr.origin) as any,
      kmMileage: vehicle.kmMileage?.toString() || ocr.kmMileage || "",
      milesMileage: vehicle.milesMileage?.toString() || ocr.milesMileage || "",
      vinVerification: false,
    });
    
    // Clear search results
    setSearchResults([]);
    setSearchTerm("");
    setSelectedVehicle(vehicle);
    toast.success("Información del vehículo cargada (Sincronizada con escaneo)");
  };

  useEffect(() => {
    if (formSubmitted) {
      topRef.current?.scrollIntoView({ behavior: "smooth" });
      setFormSubmitted(false);
    }
  }, [formSubmitted]);

  async function onSubmit(values: FormValues) {
    // Validación manual de seguridad al hacer SUBMIT
    if (!values.vinVerification) {
      form.setError("vinVerification", {
        type: "manual",
        message: "Debe confirmar la revisión de la información"
      });
      toast.error("Confirmación requerida: Marque la casilla de revisión de información");
      const element = document.getElementById("vin-verification-container");
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    // Validate license plate
    const validationResult = await validateVehiclePlate(values.licensePlate, values.vinNumber, values.vehicleId);
    
    if (!validationResult.success || !validationResult.data?.valid) {
      toast.error(validationResult.data?.message || "La placa ya está en uso con otro chasis.");
      return;
    }

    // Save form data to context
    setFormData(values);

    // Show success toast
    toast.success("Información básica guardada!");

    // In wizard mode, just call onComplete without resetting
    if (isWizardMode && onComplete) {
      onComplete();
      return;
    }

    // Reset form and state only if not in wizard mode
    form.reset({
      technicianName: "",
      inspectionDate: undefined,
      vehicleMake: "",
      vehicleModel: "",
      trim: "",
      vehicleYear: "",
      licensePlate: "",
      vinNumber: "",
      motorNumber: "",
      milesMileage: "",
      kmMileage: "",
      origin: undefined,
      vehicleType: "",
      color: "",
      vehicleUse: "",
      seats: "",
      cylinders: "",
      engineCC: "",
      fuelType: undefined,
      transmission: undefined,
      traction: undefined,
      testDrive: undefined,
      noTestDriveReason: "",
      vinVerification: false,
      vehicleId: "",
    });

    setFormSubmitted(true);
  }

  const handleOCRData = (mappedData: Partial<Record<string, unknown>>) => {
    const ocrValues = mappedData as Partial<FormValues>;
    setRawOcrData(ocrValues);

    // Update form with OCR data and trigger validation only for filled fields
    for (const key of Object.keys(ocrValues)) {
      const value = ocrValues[key as keyof FormValues];
      if (value != null && value !== "") {
        form.setValue(
          key as keyof FormValues,
          value as any,
          {
            shouldValidate: true,
            shouldDirty: true,
            shouldTouch: true
          }
        );
      }
    }

    // Clear validation errors for fields that OCR cannot fill
    const nonOCRFields: Array<keyof FormValues> = [
      'technicianName', 'inspectionDate', 'milesMileage', 'kmMileage',
      'fuelType', 'transmission', 'traction', 'testDrive', 'noTestDriveReason'
    ];

    for (const field of nonOCRFields) {
      form.clearErrors(field);
    }

    // Save to context
    const currentData = form.getValues();
    const updatedData = { ...currentData, ...ocrValues };
    setFormData(updatedData);

    // After updating form, check for duplicates immediately
    handleCheckDuplicate(
      ocrValues.licensePlate, 
      ocrValues.vinNumber,
      ocrValues
    );

    toast.success('Información de la tarjeta aplicada al formulario');
  };

  // Function to fill form with dummy data
  const fillWithDummyData = () => {
    const dummyData: FormValues = {
      technicianName: "Juan Pérez García",
      inspectionDate: new Date(),
      vehicleMake: "Toyota",
      vehicleModel: "Corolla Cross",
      trim: "XLE Hybrid",
      vehicleYear: "2023",
      licensePlate: "P-123ABC",
      vinNumber: "JTMB34FV2ND123456",
      motorNumber: "2ZR-FE-1234567",
      milesMileage: "15000",
      kmMileage: "24140",
      origin: "Importado",
      vehicleType: "SUV",
      color: "Blanco Perlado",
      cylinders: "4",
      engineCC: "2000",
      fuelType: "Gasolina",
      transmission: "Automático",
      traction: "FWD (Delantera)",
      testDrive: "Sí",
      noTestDriveReason: "",
      vinVerification: false,
      vehicleId: isDevMode 
        ? "27484f6e-811d-467f-bdae-c2e3054769f3" 
        : "f710e3cc-deae-4320-97d4-6aaff963c410",
    };

    // Use form.reset() to properly update all fields including selects
    form.reset(dummyData);

    // Save to context
    setFormData(dummyData);

    toast.success("Formulario llenado con datos de prueba");
  };

  return (
    <div className={cn("flex flex-col gap-4", !isWizardMode && "p-4 sm:p-6")} ref={topRef}>
      <Toaster />
      {!isWizardMode && (
        <div className="flex justify-between items-center w-full">
          <h1 className="text-2xl sm:text-4xl font-bold w-full text-center">
            Inspección de vehículo
          </h1>
        </div>
      )}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3 sm:space-y-4">
          <Card>
            <CardHeader className="px-3 py-0.5 sm:px-6 sm:py-1">
              <div className="space-y-2">
                <CardTitle className="text-xl sm:text-2xl">Información del Técnico</CardTitle>
                <CardDescription className="text-sm sm:text-base">Datos del técnico valuador</CardDescription>
                {isDevMode && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={fillWithDummyData}
                    className="gap-2 w-fit"
                  >
                    <Sparkles className="h-4 w-4" />
                    Llenar con datos de prueba
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="px-3 py-2 sm:px-6 sm:py-3 space-y-4 sm:space-y-5">
              <FormField
                control={form.control}
                name="technicianName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre del técnico valuador</FormLabel>
                    <FormControl>
                      <Input placeholder="Nombre completo" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="inspectionDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Fecha de revisión</FormLabel>
                    <FormControl>
                      <DatePicker
                        date={field.value}
                        onDateChange={field.onChange}
                        placeholder="Seleccione una fecha"
                        disabled={(date) =>
                          date > new Date() || date < new Date("1900-01-01")
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card className="border-primary/20 bg-primary/5 shadow-inner">
            <CardHeader className="px-3 py-3 sm:px-6">
              <CardTitle className="text-xl font-bold flex items-center gap-2">
                <Car className="h-6 w-6 text-primary" />
                Identificación del Vehículo
              </CardTitle>
              <CardDescription>
                Escanee la tarjeta de circulación o busque en el sistema para iniciar
                Escanee la tarjeta de circulación para iniciar
              </CardDescription>
            </CardHeader>
            <CardContent className="px-3 pb-4 sm:px-6 space-y-6">
              <VehicleRegistrationOCR
                onDataExtracted={handleOCRData}
                isProcessing={form.formState.isSubmitting}
              />

              {selectedVehicle && (
                <div className="animate-in zoom-in-95 fade-in duration-300">
                  <div className="p-4 rounded-xl border-2 border-primary bg-white flex items-center justify-between shadow-md">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 bg-primary rounded-full flex items-center justify-center text-white shadow-md">
                        <Car className="h-7 w-7" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="font-black text-2xl text-primary tracking-tight">
                            {selectedVehicle.licensePlate}
                          </div>
                          <span className="bg-primary/10 text-primary text-[10px] font-bold px-2 py-0.5 rounded-full border border-primary/20 uppercase">
                            Base de Datos
                          </span>
                        </div>
                        <div className="text-base text-muted-foreground font-medium">
                          {selectedVehicle.make} {selectedVehicle.model} — {selectedVehicle.year}
                        </div>
                      </div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      type="button"
                      onClick={() => {
                        setSelectedVehicle(null);
                        setDuplicateVehicle(null);
                        setMismatchedFields([]);
                        setComparisonMismatches([]);
                        form.setValue("licensePlate", "");
                        form.setValue("vinNumber", "");
                      }}
                      className="text-red-600 hover:bg-red-50 hover:text-red-700 font-bold"
                    >
                      Remover
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-3 py-0.5 sm:px-6 sm:py-1">
              <CardTitle className="text-xl sm:text-2xl">Información del Vehículo</CardTitle>
              <CardDescription className="text-sm sm:text-base">Datos técnicos del vehículo</CardDescription>
            </CardHeader>
            <CardContent className="px-3 pb-4 sm:px-6 space-y-4 sm:space-y-6">
              {duplicateVehicle && (
                <div className="animate-in fade-in slide-in-from-top-4 duration-300">
                  <Alert className="border-amber-200 bg-amber-50 text-amber-900 shadow-sm flex flex-col sm:flex-row items-start gap-4">
                    <div className="bg-amber-100 p-2 rounded-full text-amber-600 shrink-0 hidden sm:block">
                      <ShieldAlert className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <AlertTitle className="font-bold text-amber-800 flex items-center gap-2 mb-1 text-base">
                        <ShieldAlert className="h-4 w-4 sm:hidden shrink-0" />
                        Registro Encontrado (Datos Sincronizados)
                      </AlertTitle>
                      <AlertDescription className="text-amber-700 text-sm leading-relaxed">
                        Este vehículo ya existe en nuestra base de datos ({duplicateVehicle.licensePlate}). 
                        Se han cargado automáticamente los datos técnicos almacenados para garantizar la integridad de la información.
                      </AlertDescription>
                    </div>
                  </Alert>
                </div>
              )}

              {duplicateVehicle && comparisonMismatches.length > 0 && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-400">
                  <div className="flex border-l-4 border-blue-500 bg-blue-50/50 p-3 rounded-r-lg shadow-sm">
                    <div className="flex-shrink-0">
                      <HelpCircle className="h-5 w-5 text-blue-500 mt-0.5" />
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-bold text-blue-800">
                        Atención: Discrepancias detectadas
                      </p>
                      <p className="text-sm text-blue-700 mt-1">
                        Los siguientes campos difieren del escaneo y deben revisarse manualmente:{" "}
                        <span className="font-black underline decoration-blue-300">
                          {comparisonMismatches.map(field => {
                            const labels: Record<string, string> = {
                              vehicleMake: "Marca",
                              vehicleModel: "Línea",
                              vehicleYear: "Año",
                              licensePlate: "Placa",
                              vinNumber: "VIN",
                              motorNumber: "Motor",
                              color: "Color",
                              vehicleType: "Tipo",
                              cylinders: "Cilindros",
                              engineCC: "CC",
                              vehicleUse: "Uso",
                              seats: "Asientos"
                            };
                            return labels[field] || field;
                          }).join(", ")}
                        </span>
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                <FormField
                  control={form.control}
                  name="vehicleMake"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Marca del vehículo</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Ej. Toyota" 
                          {...field} 
                          disabled={!!selectedVehicle && !mismatchedFields.includes("vehicleMake")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="vehicleModel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Línea del vehículo</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Ej. Corolla" 
                          {...field} 
                          disabled={!!selectedVehicle && !mismatchedFields.includes("vehicleModel")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                <FormField
                  control={form.control}
                  name="trim"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Versión / Equipamiento</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Ej. LE, XSE, Limited" 
                          {...field} 
                          disabled={!!selectedVehicle && !mismatchedFields.includes("trim")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="vehicleYear"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Año del vehículo</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Ej. 2022" 
                          {...field} 
                          disabled={!!selectedVehicle && !mismatchedFields.includes("vehicleYear")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                <FormField
                  control={form.control}
                  name="licensePlate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Número de placa</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Ej. P-345JKL" 
                          {...field} 
                          disabled={!!selectedVehicle && !mismatchedFields.includes("licensePlate")}
                          onBlur={() => {
                            field.onBlur();
                            if (!duplicateVehicle) {
                              handleCheckDuplicate();
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="vinNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>No. VIN/Chasis</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Número de identificación del vehículo"
                          {...field}
                          disabled={!!selectedVehicle && !mismatchedFields.includes("vinNumber")}
                          onBlur={() => {
                            field.onBlur();
                            if (!duplicateVehicle) {
                              handleCheckDuplicate();
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                <FormField
                  control={form.control}
                  name="motorNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>No. de Motor</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Número de motor del vehículo"
                          {...field}
                          disabled={!!selectedVehicle && !mismatchedFields.includes("motorNumber")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="color"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Color</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Ej. Blanco" 
                          {...field} 
                          disabled={!!selectedVehicle && !mismatchedFields.includes("color")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                <FormField
                  control={form.control}
                  name="milesMileage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cantidad de millas recorridas</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Millas"
                          type="number"
                          {...field}
                          disabled={!!selectedVehicle && !mismatchedFields.includes("milesMileage")}
                          onChange={(e) => {
                            field.onChange(e);
                            const miles = Number.parseFloat(e.target.value);
                            if (!Number.isNaN(miles)) {
                              const km = Math.round(miles * 1.60934);
                              form.setValue("kmMileage", km.toString());
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="kmMileage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cantidad de kilómetros recorridos</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Kilómetros"
                          type="number"
                          {...field}
                          disabled={!!selectedVehicle && !mismatchedFields.includes("kmMileage")}
                          onChange={(e) => {
                            field.onChange(e);
                            const km = Number.parseFloat(e.target.value);
                            if (!Number.isNaN(km)) {
                              const miles = Math.round(km * 0.621371);
                              form.setValue("milesMileage", miles.toString());
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="origin"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Procedencia del vehículo</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={!!selectedVehicle && !mismatchedFields.includes("origin")}
                    >
                      <FormControl>
                        <SelectTrigger className={cn("w-full", fieldState.error && "border-red-500")}>
                          <SelectValue placeholder="Seleccione la procedencia" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Nacional">Nacional</SelectItem>
                        <SelectItem value="Importado">Importado</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                <FormField
                  control={form.control}
                  name="vehicleType"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>Tipo de vehículo</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={!!selectedVehicle && !mismatchedFields.includes("vehicleType")}
                      >
                        <FormControl>
                          <SelectTrigger className={cn("w-full", fieldState.error && "border-red-500")}>
                            <SelectValue placeholder="Seleccione el tipo" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Sedan">Sedan</SelectItem>
                          <SelectItem value="Hatchback">Hatchback</SelectItem>
                          <SelectItem value="SUV">SUV</SelectItem>
                          <SelectItem value="Pickup">Pickup</SelectItem>
                          <SelectItem value="Minivan">Minivan</SelectItem>
                          <SelectItem value="Deportivo">Deportivo</SelectItem>
                          <SelectItem value="Otro">Otro</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="cylinders"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cilindros</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Ej. 4" 
                          {...field} 
                          disabled={!!selectedVehicle && !mismatchedFields.includes("cylinders")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                <FormField
                  control={form.control}
                  name="vehicleUse"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>Uso del vehículo</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={!!selectedVehicle && !mismatchedFields.includes("vehicleUse")}
                      >
                        <FormControl>
                          <SelectTrigger className={cn("w-full", fieldState.error && "border-red-500")}>
                            <SelectValue placeholder="Seleccione el uso" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Particular">Particular</SelectItem>
                          <SelectItem value="Comercial">Comercial</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="seats"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Asientos</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Ej. 5" 
                          type="number"
                          {...field} 
                          value={field.value || ""}
                          disabled={!!selectedVehicle && !mismatchedFields.includes("seats")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                <FormField
                  control={form.control}
                  name="engineCC"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Motor (CC)</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Ej. 2000" 
                          {...field} 
                          disabled={!!selectedVehicle && !mismatchedFields.includes("engineCC")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="fuelType"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>Combustible</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={!!selectedVehicle && !mismatchedFields.includes("fuelType")}
                      >
                        <FormControl>
                          <SelectTrigger className={cn("w-full", fieldState.error && "border-red-500")}>
                            <SelectValue placeholder="Seleccione el tipo de combustible" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Gasolina">Gasolina</SelectItem>
                          <SelectItem value="Diesel">Diesel</SelectItem>
                          <SelectItem value="Eléctrico">Eléctrico</SelectItem>
                          <SelectItem value="Híbrido">Híbrido</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                <FormField
                  control={form.control}
                  name="transmission"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>Transmisión</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={!!selectedVehicle && !mismatchedFields.includes("transmission")}
                      >
                        <FormControl>
                          <SelectTrigger className={cn("w-full", fieldState.error && "border-red-500")}>
                            <SelectValue placeholder="Seleccione el tipo de transmisión" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Automático">Automático</SelectItem>
                          <SelectItem value="Manual">Manual</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="traction"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>Tracción</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={!!selectedVehicle && !mismatchedFields.includes("traction")}
                      >
                        <FormControl>
                          <SelectTrigger className={cn("w-full", fieldState.error && "border-red-500")}>
                            <SelectValue placeholder="Seleccione la tracción" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="FWD (Delantera)">FWD (Delantera)</SelectItem>
                          <SelectItem value="RWD (Trasera)">RWD (Trasera)</SelectItem>
                          <SelectItem value="AWD (Integral)">AWD (Integral)</SelectItem>
                          <SelectItem value="4x4">4x4</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-3 py-0.5 sm:px-6 sm:py-1">
              <CardTitle className="text-xl sm:text-2xl">Prueba de Manejo</CardTitle>
              <CardDescription className="text-sm sm:text-base">
                Información sobre la prueba dinámica del vehículo
              </CardDescription>
            </CardHeader>
            <CardContent className="px-3 py-2 sm:px-6 sm:py-3 space-y-4 sm:space-y-5">
              <FormField
                control={form.control}
                name="testDrive"
                render={({ field, fieldState }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>¿Se realizó prueba de manejo?</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        value={field.value}
                        className={cn("flex flex-col space-y-1", fieldState.error && "border border-red-500 rounded-md p-2")}
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="Sí" />
                          </FormControl>
                          <FormLabel className="font-normal">Sí</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="No" />
                          </FormControl>
                          <FormLabel className="font-normal">No</FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {form.watch("testDrive") === "No" && (
                <FormField
                  control={form.control}
                  name="noTestDriveReason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Indique por qué no se realizó la prueba de manejo
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Razón por la que no se realizó la prueba"
                          className="min-h-20"
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </CardContent>
          </Card>

          {inspectionType === "new" && (
            <Card
              id="vin-verification-container"
              className={cn(
                "mb-4 animate-in fade-in slide-in-from-bottom-4 duration-300 transition-all border-2",
                form.formState.errors.vinVerification
                  ? "border-red-500 bg-red-50 ring-4 ring-red-500/10 shadow-lg"
                  : "border-gray-200 bg-gray-50/50 shadow-sm"
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-gray-600 font-bold text-sm uppercase tracking-wider">
                    <ShieldAlert className="h-4 w-4" />
                    Validación de Seguridad
                  </div>
                  <span className="bg-gray-200 text-gray-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-gray-300 uppercase">
                    Requerido
                  </span>
                </div>
                <FormField
                  control={form.control}
                  name="vinVerification"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          className="mt-1 h-5 w-5 border-gray-400"
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="text-base font-semibold text-gray-800 cursor-pointer">
                          He revisado toda la información ingresada con la Tarjeta de Circulación
                        </FormLabel>
                        <p className={cn(
                          "text-sm",
                          form.formState.errors.vinVerification ? "text-red-700 font-medium" : "text-gray-600"
                        )}>
                          Confirmación obligatoria para garantizar que los datos del vehículo son correctos.
                        </p>
                      </div>
                    </FormItem>
                  )}
                />
                <FormMessage className="mt-2 text-red-600 font-bold" />
              </CardContent>
            </Card>
          )}

          {!isWizardMode && (
            <Button type="submit" className="w-full md:w-auto">
              Enviar formulario
            </Button>
          )}
          {isWizardMode && (
            <Button type="submit" className="w-full">
              Guardar y Continuar
            </Button>
          )}
        </form>
      </Form>
    </div>
  );
});

export default VehicleInspectionForm;
