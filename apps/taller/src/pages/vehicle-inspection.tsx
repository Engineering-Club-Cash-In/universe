import type React from "react";

import { useState, useRef, useEffect } from "react";
import { useInspection } from "../contexts/InspectionContext";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast, Toaster } from "sonner";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormDescription,
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
const formSchema = z.object({
  // Section 1
  technicianName: z.string().min(1, { message: "El nombre es requerido" }),
  inspectionDate: z.date({ message: "La fecha es requerida" }),

  // Section 2
  vehicleMake: z.string().min(1, { message: "La marca es requerida" }),
  vehicleModel: z.string().min(1, { message: "La línea es requerida" }),
  vehicleYear: z.string().min(1, { message: "El año es requerido" }),
  licensePlate: z
    .string()
    .min(1, { message: "El número de placa es requerido" }),
  vinNumber: z
    .string()
    .min(1, { message: "El número VIN/Chasis es requerido" }),
  milesMileage: z.string().optional(),
  kmMileage: z.string().min(1, { message: "El kilometraje es requerido" }),
  origin: z.enum(["Nacional", "Importado"], {
    message: "La procedencia es requerida",
  }),
  vehicleType: z
    .string()
    .min(1, { message: "El tipo de vehículo es requerido" }),
  color: z.string().min(1, { message: "El color es requerido" }),
  cylinders: z.string().min(1, { message: "Los cilindros son requeridos" }),
  engineCC: z.string().min(1, { message: "El motor (CC) es requerido" }),
  fuelType: z.enum(["Gasolina", "Diesel", "Eléctrico", "Híbrido"], {
    message: "El tipo de combustible es requerido",
  }),
  transmission: z.enum(["Automático", "Manual"], {
    message: "La transmisión es requerida",
  }),
  inspectionResult: z
    .string()
    .min(1, { message: "El resultado de la inspección es requerido" }),

  // Section 3
  vehicleRating: z.enum(["Comercial", "No comercial"], {
    message: "La calificación es requerida",
  }),
  marketValue: z
    .string()
    .min(1, { message: "El valor de mercado es requerido" }),
  suggestedCommercialValue: z
    .string()
    .min(1, { message: "El valor comercial sugerido es requerido" }),
  bankValue: z.string().min(1, { message: "El valor bancario es requerido" }),
  currentConditionValue: z
    .string()
    .min(1, { message: "El valor en condiciones actuales es requerido" }),
  vehicleEquipment: z
    .string()
    .min(1, { message: "El equipamiento es requerido" }),
  importantConsiderations: z.string().optional(),
  scannerUsed: z.enum(["Sí", "No"], {
    message: "Esta información es requerida",
  }),
  scannerResult: z.instanceof(File).optional(),
  airbagWarning: z.enum(["Sí", "No"], {
    message: "Esta información es requerida",
  }),
  missingAirbag: z.string().optional(),

  // Section 4
  testDrive: z.enum(["Sí", "No"], {
    message: "Esta información es requerida",
  }),
  noTestDriveReason: z.string().optional(),
});

interface VehicleInspectionFormProps {
  onComplete?: () => void;
  isWizardMode?: boolean;
}

export default function VehicleInspectionForm({ 
  onComplete, 
  isWizardMode = false 
}: VehicleInspectionFormProps) {
  const { formData, setFormData } = useInspection();
  const [scannerFile, setScannerFile] = useState<File | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const [formSubmitted, setFormSubmitted] = useState(false);
  
  // Check if dev mode is enabled
  const isDevMode = import.meta.env.VITE_DEV_MODE === 'TRUE';

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: formData || {},
  });

  useEffect(() => {
    if (formSubmitted) {
      topRef.current?.scrollIntoView({ behavior: "smooth" });
      setFormSubmitted(false);
    }
  }, [formSubmitted]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    console.log(values);
    
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
      vehicleYear: "",
      licensePlate: "",
      vinNumber: "",
      milesMileage: "",
      kmMileage: "",
      origin: undefined,
      vehicleType: "",
      color: "",
      cylinders: "",
      engineCC: "",
      fuelType: undefined,
      transmission: undefined,
      inspectionResult: "",
      vehicleRating: undefined,
      marketValue: "",
      suggestedCommercialValue: "",
      bankValue: "",
      currentConditionValue: "",
      vehicleEquipment: "",
      importantConsiderations: "",
      scannerUsed: undefined,
      scannerResult: undefined,
      airbagWarning: undefined,
      missingAirbag: "",
      testDrive: undefined,
      noTestDriveReason: "",
    });

    setScannerFile(null);
    setFormSubmitted(true);
  }

  const handleScannerUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type === "application/pdf") {
        setScannerFile(file);
        form.setValue("scannerResult", file);
      } else {
        alert("Por favor suba un archivo PDF");
      }
    }
  };
  
  // Function to fill form with dummy data
  const fillWithDummyData = async () => {
    const dummyData = {
      technicianName: "Juan Pérez García",
      inspectionDate: new Date(),
      vehicleMake: "Toyota",
      vehicleModel: "Corolla Cross",
      vehicleYear: "2023",
      licensePlate: "P-123ABC",
      vinNumber: "JTMB34FV2ND123456",
      milesMileage: "15000",
      kmMileage: "24140",
      origin: "Importado" as const,
      vehicleType: "SUV",
      color: "Blanco Perlado",
      cylinders: "4",
      engineCC: "2000",
      fuelType: "Gasolina" as const,
      transmission: "Automático" as const,
      inspectionResult: "Vehículo en excelentes condiciones generales. Motor sin ruidos anormales, transmisión automática funcionando suavemente. Carrocería sin golpes mayores, pintura en buen estado. Interior bien conservado sin desgaste excesivo.",
      vehicleRating: "Comercial" as const,
      marketValue: "185000",
      suggestedCommercialValue: "175000",
      bankValue: "165000",
      currentConditionValue: "170000",
      vehicleEquipment: "Aire acondicionado automático dual zone, Sistema de infoentretenimiento con pantalla táctil 8\", Apple CarPlay/Android Auto, Cámara de reversa, Sensores de estacionamiento delanteros y traseros, Asientos de cuero sintético, Volante multifunción con controles de audio, Control crucero adaptativo, Sistema keyless entry",
      importantConsiderations: "Mantenimientos realizados en agencia hasta la fecha. Cuenta con garantía de fábrica vigente hasta 2026. Único dueño, papelería completa y al día.",
      scannerUsed: "Sí" as const,
      airbagWarning: "No" as const,
      testDrive: "Sí" as const,
    };
    
    // Use form.reset() to properly update all fields including selects
    form.reset(dummyData);
    
    // Load and set the PDF file
    try {
      const response = await fetch('/sample.pdf');
      const blob = await response.blob();
      const file = new File([blob], 'reporte_scanner_ejemplo.pdf', { type: 'application/pdf' });
      
      setScannerFile(file);
      form.setValue("scannerResult", file);
    } catch (error) {
      console.error('Error loading sample PDF:', error);
    }
    
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
              </div>

              <FormField
                control={form.control}
                name="vinNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>No. Vin/Chasis</FormLabel>
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                <FormField
                  control={form.control}
                  name="milesMileage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cantidad de millas recorridas</FormLabel>
                      <FormControl>
                        <Input placeholder="Millas" type="number" {...field} />
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
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Procedencia del vehículo</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
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
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo de vehículo</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
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
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                <FormField
                  control={form.control}
                  name="fuelType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Combustible</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
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

                <FormField
                  control={form.control}
                  name="transmission"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Transmisión</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
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
              </div>

              <FormField
                control={form.control}
                name="inspectionResult"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Observaciones generales de la inspección</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Describa el estado general del vehículo y observaciones relevantes"
                        className="min-h-[100px]"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-3 py-0.5 sm:px-6 sm:py-1">
              <CardTitle className="text-xl sm:text-2xl">Valoración del Vehículo</CardTitle>
              <CardDescription className="text-sm sm:text-base">
                Información sobre el valor y condiciones
              </CardDescription>
            </CardHeader>
            <CardContent className="px-3 py-2 sm:px-6 sm:py-3 space-y-4 sm:space-y-5">
              <FormField
                control={form.control}
                name="vehicleRating"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>Calificación del vehículo</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        value={field.value}
                        className="flex flex-col space-y-1"
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="Comercial" />
                          </FormControl>
                          <FormLabel className="font-normal">
                            Comercial
                          </FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="No comercial" />
                          </FormControl>
                          <FormLabel className="font-normal">
                            No comercial
                          </FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                <FormField
                  control={form.control}
                  name="marketValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor de mercado</FormLabel>
                      <FormControl>
                        <Input placeholder="Valor en moneda local" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="suggestedCommercialValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor comercial sugerido</FormLabel>
                      <FormControl>
                        <Input placeholder="Valor en moneda local" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                <FormField
                  control={form.control}
                  name="bankValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor bancario</FormLabel>
                      <FormControl>
                        <Input placeholder="Valor en moneda local" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="currentConditionValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor vehículo condiciones actuales</FormLabel>
                      <FormControl>
                        <Input placeholder="Valor en moneda local" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="vehicleEquipment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Equipamiento del vehículo</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Ej: Aire AC, cámaras de reversa, tapicería de cuero, sistema de navegación, sensores de estacionamiento, techo panorámico, etc."
                        className="min-h-[100px]"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="importantConsiderations"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Aspectos importantes a considerar</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Observaciones sobre estado físico, legal o técnico del vehículo"
                        className="min-h-[100px]"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="scannerUsed"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>¿Se le pasó escáner al vehículo?</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        value={field.value}
                        className="flex flex-col space-y-1"
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

              {form.watch("scannerUsed") === "Sí" && (
                <FormField
                  control={form.control}
                  name="scannerResult"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Resultado del scanner (subir PDF)</FormLabel>
                      <FormControl>
                        <Input
                          type="file"
                          accept=".pdf"
                          onChange={(e) => {
                            handleScannerUpload(e);
                            field.onChange(e.target.files?.[0] || null);
                          }}
                          className="flex-1"
                        />
                      </FormControl>
                      {scannerFile && (
                        <FormDescription className="text-green-600">
                          Archivo cargado: {scannerFile.name}
                        </FormDescription>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="airbagWarning"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>¿Presenta testigos de airbag u otros en tablero?</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        value={field.value}
                        className="flex flex-col space-y-1"
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

              {form.watch("airbagWarning") === "Sí" && (
                <FormField
                  control={form.control}
                  name="missingAirbag"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Indique qué airbag no posee</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Ej. Airbag lateral izquierdo"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
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
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>¿Se realizó prueba de manejo?</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        value={field.value}
                        className="flex flex-col space-y-1"
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
                          className="min-h-[80px]"
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
}
