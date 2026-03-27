import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { useInspection } from "../contexts/InspectionContext";
import { validateVehiclePlate } from "../services/vehicles";
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast, Toaster } from "sonner";
import { Sparkles, Search, Check, FileSearch, History, Car, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { searchVehicles } from "../services/vehicles";

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
      
      // Validación manual de seguridad para inspección nueva
      if (inspectionType === 'new' && !values.vinVerification) {
        toast.error("Debe confirmar que ha verificado el VIN con la tarjeta de circulación");
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
  }));

  const [inspectionType, setInspectionType] = useState<"new" | "existing">("new");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = async (query: string) => {
    setSearchTerm(query);
    if (query.length < 3) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const result = await searchVehicles(query);
      if (result.success) {
        setSearchResults(result.data || []);
      }
    } catch (error) {
      console.error("Error searching vehicles:", error);
    } finally {
      setIsSearching(false);
    }
  };

  const selectVehicle = (vehicle: any) => {
    form.reset({
      ...form.getValues(),
      vehicleMake: vehicle.make || "",
      vehicleModel: vehicle.model || "",
      trim: vehicle.trim || "",
      vehicleYear: vehicle.year?.toString() || "",
      licensePlate: vehicle.licensePlate || "",
      vinNumber: vehicle.vinNumber || "",
      motorNumber: vehicle.motorNumber || "",
      vehicleType: vehicle.vehicleType || "",
      color: vehicle.color || "",
      cylinders: vehicle.cylinders || "",
      engineCC: vehicle.engineCC || "",
      fuelType: vehicle.fuelType as any,
      transmission: vehicle.transmission as any,
      traction: vehicle.traction as any,
      origin: vehicle.origin as any,
      kmMileage: vehicle.kmMileage?.toString() || "",
      milesMileage: vehicle.milesMileage?.toString() || "",
      vinVerification: false, // Default to unchecked as requested
      vehicleId: vehicle.id, // Store the ID for the backend logic
    });
    
    // Clear search results
    setSearchResults([]);
    setSearchTerm("");
    toast.success("Información del vehículo cargada correctamente");
  };

  useEffect(() => {
    if (formSubmitted) {
      topRef.current?.scrollIntoView({ behavior: "smooth" });
      setFormSubmitted(false);
    }
  }, [formSubmitted]);

  async function onSubmit(values: FormValues) {
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
    // Update form with OCR data and trigger validation only for filled fields
    for (const key of Object.keys(mappedData)) {
      const value = mappedData[key as string];
      if (value != null && value !== "") {
        form.setValue(
          key as keyof FormValues,
          value as FormValues[keyof FormValues],
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
    const updatedData = { ...currentData, ...mappedData };
    setFormData(updatedData);

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

    setInspectionType("existing");

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

          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="px-3 py-3 sm:px-6">
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                ¿Qué tipo de inspección realizará?
              </CardTitle>
              <CardDescription>
                Seleccione si el vehículo es nuevo en el sistema o ya tiene inspecciones previas
              </CardDescription>
            </CardHeader>
            <CardContent className="px-3 pb-4 sm:px-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setInspectionType("new")}
                  className={cn(
                    "flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all text-left",
                    inspectionType === "new" 
                      ? "border-primary bg-white shadow-md ring-4 ring-primary/10" 
                      : "border-gray-200 bg-gray-50/50 hover:border-gray-300"
                  )}
                >
                  <div className={cn(
                    "p-2 rounded-full",
                    inspectionType === "new" ? "bg-primary text-white" : "bg-gray-200 text-gray-500"
                  )}>
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <div className="text-center">
                    <div className="font-bold">Nueva Inspección</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Vehículo no registrado previamente (Usa OCR)
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setInspectionType("existing")}
                  className={cn(
                    "flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all text-left",
                    inspectionType === "existing" 
                      ? "border-primary bg-white shadow-md ring-4 ring-primary/10" 
                      : "border-gray-200 bg-gray-50/50 hover:border-gray-300"
                  )}
                >
                  <div className={cn(
                    "p-2 rounded-full",
                    inspectionType === "existing" ? "bg-primary text-white" : "bg-gray-200 text-gray-500"
                  )}>
                    <History className="h-6 w-6" />
                  </div>
                  <div className="text-center">
                    <div className="font-bold">Vehículo Existente</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Re-inspección o seguimiento (Buscador)
                    </div>
                  </div>
                </button>
              </div>
            </CardContent>
          </Card>

          {inspectionType === "new" ? (
            <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-300">
              <VehicleRegistrationOCR
                onDataExtracted={handleOCRData}
                isProcessing={form.formState.isSubmitting}
              />
            </div>
          ) : (
            <Card className="animate-in fade-in slide-in-from-top-4 duration-300">
              <CardHeader className="px-3 py-2 sm:px-6">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Search className="h-5 w-5 text-primary" />
                  Buscar Vehículo en la Base de Datos
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-4 sm:px-6 space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Busque por placa, marca o línea..." 
                    className="pl-10 h-12 text-lg"
                    value={searchTerm}
                    onChange={(e) => handleSearch(e.target.value)}
                  />
                </div>

                {isSearching && (
                  <div className="flex items-center justify-center p-8">
                    <Loader2 className="h-8 w-8 text-primary animate-spin" />
                  </div>
                )}

                {!isSearching && searchTerm.length >= 3 && searchResults.length === 0 && (
                  <div className="text-center p-8 bg-gray-50 rounded-lg border border-dashed text-muted-foreground font-medium">
                    No se encontraron vehículos que coincidan con "{searchTerm}"
                  </div>
                )}

                {searchResults.length > 0 && (
                  <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {searchResults.map((vehicle) => (
                      <button
                        key={vehicle.id}
                        type="button"
                        onClick={() => selectVehicle(vehicle)}
                        className="flex items-center justify-between p-3 rounded-lg border hover:border-primary hover:bg-primary/5 transition-all text-left group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 bg-primary/10 rounded-full flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                            <Car className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="font-bold text-base">{vehicle.licensePlate}</div>
                            <div className="text-sm text-muted-foreground">
                              {vehicle.make} {vehicle.model} - {vehicle.year}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end">
                          <Check className="h-5 w-5 text-green-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                          <div className="text-[10px] uppercase font-bold text-primary/60 mt-1">Seleccionar</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                
                {searchTerm.length < 3 && !isSearching && (
                  <div className="flex flex-col items-center justify-center p-8 text-muted-foreground text-center">
                    <FileSearch className="h-12 w-12 opacity-20 mb-2" />
                    <p className="text-sm font-medium">Escriba al menos 3 caracteres para buscar</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="px-3 py-0.5 sm:px-6 sm:py-1">
              <CardTitle className="text-xl sm:text-2xl">Información del Vehículo</CardTitle>
              <CardDescription className="text-sm sm:text-base">Datos técnicos del vehículo</CardDescription>
            </CardHeader>
            <CardContent className="px-3 py-2 sm:px-6 sm:py-3 space-y-4 sm:space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                <FormField
                  control={form.control}
                  name="vehicleMake"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Marca del vehículo</FormLabel>
                      <FormControl>
                        <Input placeholder="Ej. Toyota" {...field} />
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
                        <Input placeholder="Ej. Corolla" {...field} />
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
                        <Input placeholder="Ej. LE, XSE, Limited" {...field} />
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
                        <Input placeholder="Ej. 2022" {...field} />
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
                        <Input placeholder="Ej. P-345JKL" {...field} />
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
                        <Input placeholder="Ej. Blanco" {...field} />
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
                        <Input placeholder="Ej. 4" {...field} />
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
                        <Input placeholder="Ej. 2000" {...field} />
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
            <Card id="vin-verification-container" className="border-amber-200 bg-amber-50 mb-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <CardContent className="p-4">
                <FormField
                  control={form.control}
                  name="vinVerification"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          className="mt-1 h-5 w-5"
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="text-base font-semibold text-amber-900 cursor-pointer">
                          He verificado que el VIN ingresado coincide con la Tarjeta de Circulación
                        </FormLabel>
                        <p className="text-sm text-amber-700">
                          Confirmación obligatoria para garantizar la integridad de los datos del vehículo nuevo.
                        </p>
                      </div>
                    </FormItem>
                  )}
                />
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
