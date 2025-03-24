import type React from "react";

import { useState, useRef, useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { toast, Toaster } from "sonner";

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
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createVehicle } from "../services/eden";
const formSchema = z.object({
  // Section 1
  technicianName: z.string().min(1, { message: "El nombre es requerido" }),
  inspectionDate: z.date({ required_error: "La fecha es requerida" }),

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
  origin: z.enum(["Agencia", "Rodado"], {
    required_error: "La procedencia es requerida",
  }),
  vehicleType: z
    .string()
    .min(1, { message: "El tipo de vehículo es requerido" }),
  color: z.string().min(1, { message: "El color es requerido" }),
  cylinders: z.string().min(1, { message: "Los cilindros son requeridos" }),
  engineCC: z.string().min(1, { message: "El motor (CC) es requerido" }),
  fuelType: z.enum(["Gasolina", "Diesel", "Eléctrico", "Híbrido"], {
    required_error: "El tipo de combustible es requerido",
  }),
  transmission: z.enum(["Automático", "Manual"], {
    required_error: "La transmisión es requerida",
  }),
  inspectionResult: z
    .string()
    .min(1, { message: "El resultado de la inspección es requerido" }),

  // Section 3
  vehicleRating: z.enum(["Comercial", "No comercial"], {
    required_error: "La calificación es requerida",
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
    required_error: "Esta información es requerida",
  }),
  scannerResult: z.instanceof(File).optional(),
  airbagWarning: z.enum(["Sí", "No"], {
    required_error: "Esta información es requerida",
  }),
  missingAirbag: z.string().optional(),

  // Section 4
  testDrive: z.enum(["Sí", "No"], {
    required_error: "Esta información es requerida",
  }),
  noTestDriveReason: z.string().optional(),
  vehiclePhotos: z.array(z.instanceof(File)).optional(),
});

export default function VehicleInspectionForm() {
  const [photos, setPhotos] = useState<File[]>([]);
  const [scannerFile, setScannerFile] = useState<File | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const [formSubmitted, setFormSubmitted] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      vehiclePhotos: [],
    },
  });

  useEffect(() => {
    if (formSubmitted) {
      topRef.current?.scrollIntoView({ behavior: "smooth" });
      setFormSubmitted(false);
    }
  }, [formSubmitted]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    console.log(values);
    const vehicle = {
      name:
        values.vehicleMake +
        " " +
        values.vehicleModel +
        " " +
        values.vehicleYear,
      marca: values.vehicleMake,
      modelo: parseInt(values.vehicleModel),
      ano: parseInt(values.vehicleYear),
      revisor: {
        firstName: values.technicianName,
        lastName: values.technicianName,
      },
      detalles: {
        ...values,
      },
    };
    const response = await createVehicle(vehicle);
    console.log(response);
    // Here you would typically send the data to your backend
    toast.success("Formulario enviado con éxito!");

    // Reset form and state
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
      vehiclePhotos: [],
    });

    setPhotos([]);
    setScannerFile(null);
    setFormSubmitted(true);
  }

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      if (photos.length + newFiles.length <= 10) {
        const updatedPhotos = [...photos, ...newFiles];
        setPhotos(updatedPhotos);
        form.setValue("vehiclePhotos", updatedPhotos);
      } else {
        alert("Solo se permiten hasta 10 fotos");
      }
    }
  };

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

  return (
    <div className="flex flex-col p-6 gap-4" ref={topRef}>
      <Toaster />
      <div className="flex justify-between items-center w-full">
        <h1 className="text-4xl font-bold w-full text-center">
          Inspección de vehículo
        </h1>
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Información del Técnico</CardTitle>
              <CardDescription>Datos del técnico valuador</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
                    <Popover
                      open={datePickerOpen}
                      onOpenChange={setDatePickerOpen}
                    >
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP", { locale: es })
                            ) : (
                              <span>Seleccione una fecha</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={(date) => {
                            field.onChange(date);
                            setDatePickerOpen(false);
                          }}
                          disabled={(date) =>
                            date > new Date() || date < new Date("1900-01-01")
                          }
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Información del Vehículo</CardTitle>
              <CardDescription>Datos técnicos del vehículo</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    <FormLabel>Procedencia</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Seleccione la procedencia" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Agencia">Agencia</SelectItem>
                        <SelectItem value="Rodado">Rodado</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="vehicleType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo de vehículo</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="fuelType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Combustible</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
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
                        defaultValue={field.value}
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
                    <FormLabel>Resultado de la inspección</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Describa el resultado de la inspección"
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
            <CardHeader>
              <CardTitle>Valoración del Vehículo</CardTitle>
              <CardDescription>
                Información sobre el valor y condiciones
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="vehicleRating"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>Calificación del vehículo</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                        placeholder="Describa el equipamiento del vehículo"
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
                        placeholder="Aspectos relevantes sobre el estado del vehículo"
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
                        defaultValue={field.value}
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
                    <FormLabel>¿Presenta testigo de airbag?</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
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
            <CardHeader>
              <CardTitle>Prueba de Manejo y Fotografías</CardTitle>
              <CardDescription>
                Información sobre la prueba de manejo y documentación
                fotográfica
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="testDrive"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>¿Se realizó prueba de manejo?</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
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

              <FormField
                control={form.control}
                name="vehiclePhotos"
                render={() => (
                  <FormItem>
                    <FormLabel>
                      Fotografías del vehículo (hasta 10 fotos)
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handlePhotoUpload}
                        className="flex-1"
                      />
                    </FormControl>
                    <FormDescription>{photos.length}/10 fotos</FormDescription>

                    {photos.length > 0 && (
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-4">
                        {photos.map((photo, index) => (
                          <div
                            key={index}
                            className="relative aspect-square bg-muted rounded-md overflow-hidden"
                          >
                            <img
                              src={
                                URL.createObjectURL(photo) || "/placeholder.svg"
                              }
                              alt={`Foto ${index + 1}`}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Button type="submit" className="w-full md:w-auto">
            Enviar formulario
          </Button>
        </form>
      </Form>
    </div>
  );
}
