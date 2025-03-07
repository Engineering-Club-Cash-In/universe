import BellIcon from "/assets/dashboard/bell.svg";
import CCILogo from "/assets/dashboard/cci-logo-white.svg";
import UserIcon from "/assets/dashboard/user.svg";
import { useState } from "react";
import DashboardIcon from "/assets/dashboard/dashboard.svg";
import { useDropzone } from "react-dropzone";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import {
  submitLead,
  getRenapData,
  checkCreditRecord,
  predictMissingPayments,
  createCreditScore,
} from "@/services/eden";
import { useQuery } from "@tanstack/react-query";
import { getCreditScoreAndRecordByLeadEmail } from "@/services/eden";
import {
  CircleDollarSign,
  CreditCard,
  TrendingUp,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ArrowUpRight,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Link } from "@tanstack/react-router";

export default function Dashboard() {
  const [activeSection, setActiveSection] = useState("gestiones");

  return (
    <div className="min-h-screen flex flex-col items-center bg-white text-black text-[calc(10px+2vmin)]">
      <header className="w-full p-4 px-6 max-w-screen-2xl bg-black text-white">
        <div className="flex flex-row w-full items-center justify-between relative">
          <img src={CCILogo} alt="CCI Logo" width={200} height={100} />
          <span className="text-3xl font-bold absolute left-1/2 -translate-x-1/2">
            Vive tu vida Tranki
          </span>
          <img src={BellIcon} alt="Bell Icon" className="w-6 h-6" />
        </div>
      </header>
      <main className="w-full flex flex-row max-w-screen-2xl flex-grow border-l border-r border-b">
        <aside className="flex flex-col w-1/4 bg-white p-4 border-r gap-4">
          <div
            className={`flex flex-col items-center justify-center p-4 border cursor-pointer ${
              activeSection === "gestiones"
                ? "bg-purple-500"
                : "hover:bg-purple-200"
            }`}
            onClick={() => setActiveSection("gestiones")}
          >
            <img src={UserIcon} alt="User Icon" className="w-6 h-6" />
            <span className="text-lg font-bold">Gestiones</span>
          </div>
          <div
            className={`flex flex-col items-center justify-center p-4 border cursor-pointer ${
              activeSection === "dashboard"
                ? "bg-purple-500"
                : "hover:bg-purple-200"
            }`}
            onClick={() => setActiveSection("dashboard")}
          >
            <img src={DashboardIcon} alt="Dashboard Icon" className="w-6 h-6" />
            <span className="text-lg font-bold">Dashboard</span>
          </div>
        </aside>
        <div className="w-full p-8">
          {activeSection === "gestiones" ? (
            <GestionesSection />
          ) : (
            <DashboardSection />
          )}
        </div>
      </main>
    </div>
  );
}

const GestionesSection = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState("");

  const onDrop = (acceptedFiles: File[]) => {
    const pdfFiles = acceptedFiles.filter(
      (file) => file.type === "application/pdf"
    );
    if (pdfFiles.length > 0) {
      setFiles((currentFiles) => {
        const newFiles = [...currentFiles, ...pdfFiles];
        return newFiles.slice(0, 3);
      });
    }
  };

  const handleRemoveFile = (index: number) => {
    setFiles((currentFiles) => currentFiles.filter((_, i) => i !== index));
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
    },
    maxFiles: 3,
    disabled: files.length >= 3,
  });

  // Create form with TanStack Form
  const form = useForm({
    defaultValues: {
      amount: "",
      income: "",
      age: "",
      dependents: "",
      occupation: "",
      seniority: "",
      civilStatus: "",
      moneyUsage: "",
      isOwner: false,
      isVehicle: false,
      isCreditCard: false,
      purchaseType: "",
    },
    validators: {
      onSubmit: z.object({
        amount: z.string().min(1, "El monto es requerido"),
        income: z.string().min(1, "El sueldo es requerido"),
        age: z
          .string()
          .min(1, "La edad es requerida")
          .refine((val) => {
            const num = Number(val);
            return num >= 18 && num <= 99;
          }, "La edad debe estar entre 18 y 99 años"),
        dependents: z.string().min(1, "El número de dependientes es requerido"),
        occupation: z.string().min(1, "La ocupación es requerida"),
        seniority: z.string().min(1, "La antigüedad es requerida"),
        civilStatus: z.string().min(1, "El estado civil es requerido"),
        moneyUsage: z.string().min(1, "La utilización del dinero es requerida"),
        isOwner: z.boolean(),
        isVehicle: z.boolean(),
        isCreditCard: z.boolean(),
        purchaseType: z.string().min(1, "El tipo de compras es requerido"),
      }),
    },
    onSubmit: async ({ value }) => {
      try {
        setIsLoading(true);
        setServerError("");

        // First check renap data
        const renapData = await getRenapData("3004735750101");
        // First create a lead
        const lead = {
          id: -1,
          name: `${renapData?.data.firstName} ${renapData?.data.firstLastName}`,
          desiredAmount: Number(value.amount),
          email: "bachejin@gmail.com",
          phone: "502 5555 5555",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const leadResponse = await submitLead(lead);

        // Now create the credit record
        if (leadResponse && leadResponse.data.id) {
          if (files.length > 0) {
            await checkCreditRecord(files, leadResponse.data.id);
          }
        } else {
          setServerError("Error al crear el lead");
        }

        // Now we can predict the missing payments
        const missingPayments = await predictMissingPayments({
          PRECIO_PRODUCTO: parseInt(value.amount),
          SUELDO: parseInt(value.income),
          EDAD: parseInt(value.age),
          DEPENDIENTES_ECONOMICOS: parseInt(value.dependents),
          OCUPACION: parseInt(value.occupation),
          ANTIGUEDAD: parseInt(value.seniority),
          ESTADO_CIVIL: parseInt(value.civilStatus),
          UTILIZACION_DINERO: parseInt(value.moneyUsage),
          VIVIENDA_PROPIA: value.isOwner ? 1 : 0,
          VEHICULO_PROPIO: value.isVehicle ? 1 : 0,
          TARJETA_DE_CREDITO: value.isCreditCard ? 1 : 0,
          TIPO_DE_COMPRAS: parseInt(value.purchaseType),
        });
        console.log("Missing payments:", missingPayments);
        if (leadResponse && leadResponse.data.id && missingPayments) {
          await createCreditScore(
            leadResponse.data.id,
            missingPayments.data.fit,
            missingPayments.data.probability
          );
        }
        alert("Precalificación enviada correctamente");
      } catch (error) {
        console.error("Submission error:", error);
        setServerError("Error al procesar la solicitud");
      } finally {
        setIsLoading(false);
      }
    },
  });

  return (
    <div className="flex flex-col w-full max-w-4xl mx-auto">
      <h2 className="text-3xl font-bold text-center mb-8">
        Realiza una precalificación
      </h2>

      {serverError && (
        <div className="w-full p-3 mb-4 bg-red-100 border border-red-400 text-red-700 rounded">
          {serverError}
        </div>
      )}

      <form
        className="space-y-6 mb-5"
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        {/* First row - Financial Information */}
        <div className="grid grid-cols-2 gap-6">
          <form.Field
            name="amount"
            children={(field) => (
              <div className="flex flex-col">
                <Label
                  htmlFor={field.name}
                  className="text-lg mb-2 font-medium"
                >
                  Monto que desea solicitar
                </Label>
                <div className="relative">
                  <span className="text-lg absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">
                    Q
                  </span>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="number"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="pl-10 rounded w-full"
                  />
                </div>
                {field.state.meta.errors ? (
                  <span className="text-red-500 text-sm mt-1">
                    {field.state.meta.errors[0]
                      ? String(field.state.meta.errors[0].message)
                      : ""}
                  </span>
                ) : null}
              </div>
            )}
          />

          <form.Field
            name="income"
            children={(field) => (
              <div className="flex flex-col">
                <Label
                  htmlFor={field.name}
                  className="text-lg mb-2 font-medium"
                >
                  Sueldo
                </Label>
                <div className="relative">
                  <span className="text-lg absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">
                    Q
                  </span>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="number"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="pl-10 rounded w-full"
                  />
                </div>
                {field.state.meta.errors ? (
                  <span className="text-red-500 text-sm mt-1">
                    {field.state.meta.errors[0]
                      ? String(field.state.meta.errors[0].message)
                      : ""}
                  </span>
                ) : null}
              </div>
            )}
          />
        </div>

        {/* Second row - Personal Information */}
        <div className="grid grid-cols-2 gap-6">
          <form.Field
            name="age"
            children={(field) => (
              <div className="flex flex-col">
                <Label
                  htmlFor={field.name}
                  className="text-lg mb-2 font-medium"
                >
                  Edad
                </Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type="number"
                  placeholder="Años"
                  min="18"
                  max="99"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  className="rounded w-full"
                />
                {field.state.meta.errors ? (
                  <span className="text-red-500 text-sm mt-1">
                    {field.state.meta.errors[0]
                      ? String(field.state.meta.errors[0].message)
                      : ""}
                  </span>
                ) : null}
              </div>
            )}
          />

          <form.Field
            name="dependents"
            children={(field) => (
              <div className="flex flex-col">
                <Label
                  htmlFor={field.name}
                  className="text-lg mb-2 font-medium"
                >
                  Dependientes Económicos
                </Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type="number"
                  min="0"
                  placeholder="Cantidad de personas"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  className="rounded w-full"
                />
                {field.state.meta.errors ? (
                  <span className="text-red-500 text-sm mt-1">
                    {field.state.meta.errors[0]
                      ? String(field.state.meta.errors[0].message)
                      : ""}
                  </span>
                ) : null}
              </div>
            )}
          />
        </div>

        {/* Third row - Employment Information */}
        <div className="grid grid-cols-2 gap-6">
          <form.Field
            name="occupation"
            children={(field) => (
              <div className="flex flex-col">
                <Label
                  htmlFor={field.name}
                  className="text-lg mb-2 font-medium"
                >
                  Ocupación
                </Label>
                <Select
                  value={field.state.value}
                  onValueChange={(value) => field.handleChange(value)}
                  onOpenChange={() => field.handleBlur()}
                >
                  <SelectTrigger id={field.name} className="w-full">
                    <SelectValue placeholder="Seleccione una opción" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Empleado</SelectItem>
                    <SelectItem value="1">Dueño</SelectItem>
                  </SelectContent>
                </Select>
                {field.state.meta.errors ? (
                  <span className="text-red-500 text-sm mt-1">
                    {field.state.meta.errors[0]
                      ? String(field.state.meta.errors[0].message)
                      : ""}
                  </span>
                ) : null}
              </div>
            )}
          />

          <form.Field
            name="seniority"
            children={(field) => (
              <div className="flex flex-col">
                <Label
                  htmlFor={field.name}
                  className="text-lg mb-2 font-medium"
                >
                  Antigüedad
                </Label>
                <Select
                  value={field.state.value}
                  onValueChange={(value) => field.handleChange(value)}
                  onOpenChange={() => field.handleBlur()}
                >
                  <SelectTrigger id={field.name} className="w-full">
                    <SelectValue placeholder="Seleccione una opción" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">0-1 año</SelectItem>
                    <SelectItem value="1">1-5 años</SelectItem>
                    <SelectItem value="2">5-10 años</SelectItem>
                    <SelectItem value="3">10+ años</SelectItem>
                  </SelectContent>
                </Select>
                {field.state.meta.errors ? (
                  <span className="text-red-500 text-sm mt-1">
                    {field.state.meta.errors[0]
                      ? String(field.state.meta.errors[0].message)
                      : ""}
                  </span>
                ) : null}
              </div>
            )}
          />
        </div>

        {/* Fourth row - Additional Information */}
        <div className="grid grid-cols-2 gap-6">
          <form.Field
            name="civilStatus"
            children={(field) => (
              <div className="flex flex-col">
                <Label
                  htmlFor={field.name}
                  className="text-lg mb-2 font-medium"
                >
                  Estado Civil
                </Label>
                <Select
                  value={field.state.value}
                  onValueChange={(value) => field.handleChange(value)}
                  onOpenChange={() => field.handleBlur()}
                >
                  <SelectTrigger id={field.name} className="w-full">
                    <SelectValue placeholder="Seleccione una opción" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Soltero</SelectItem>
                    <SelectItem value="1">Casado</SelectItem>
                  </SelectContent>
                </Select>
                {field.state.meta.errors ? (
                  <span className="text-red-500 text-sm mt-1">
                    {field.state.meta.errors[0]
                      ? String(field.state.meta.errors[0].message)
                      : ""}
                  </span>
                ) : null}
              </div>
            )}
          />

          <form.Field
            name="moneyUsage"
            children={(field) => (
              <div className="flex flex-col">
                <Label
                  htmlFor={field.name}
                  className="text-lg mb-2 font-medium"
                >
                  Utilización Dinero
                </Label>
                <Select
                  value={field.state.value}
                  onValueChange={(value) => field.handleChange(value)}
                  onOpenChange={() => field.handleBlur()}
                >
                  <SelectTrigger id={field.name} className="w-full">
                    <SelectValue placeholder="Seleccione una opción" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Personal</SelectItem>
                    <SelectItem value="1">Negocio</SelectItem>
                  </SelectContent>
                </Select>
                {field.state.meta.errors ? (
                  <span className="text-red-500 text-sm mt-1">
                    {field.state.meta.errors[0]
                      ? String(field.state.meta.errors[0].message)
                      : ""}
                  </span>
                ) : null}
              </div>
            )}
          />
        </div>

        {/* Fifth row - Checkboxes */}
        <div className="grid grid-cols-3 gap-6">
          <form.Field
            name="isOwner"
            children={(field) => (
              <div className="flex items-center gap-3">
                <Checkbox
                  id={field.name}
                  checked={field.state.value}
                  onCheckedChange={(checked) =>
                    field.handleChange(checked === true)
                  }
                />
                <Label htmlFor={field.name} className="text-lg">
                  Vivienda Propia
                </Label>
              </div>
            )}
          />

          <form.Field
            name="isVehicle"
            children={(field) => (
              <div className="flex items-center gap-3">
                <Checkbox
                  id={field.name}
                  checked={field.state.value}
                  onCheckedChange={(checked) =>
                    field.handleChange(checked === true)
                  }
                />
                <Label htmlFor={field.name} className="text-lg">
                  Vehículo Propio
                </Label>
              </div>
            )}
          />

          <form.Field
            name="isCreditCard"
            children={(field) => (
              <div className="flex items-center gap-3">
                <Checkbox
                  id={field.name}
                  checked={field.state.value}
                  onCheckedChange={(checked) =>
                    field.handleChange(checked === true)
                  }
                />
                <Label htmlFor={field.name} className="text-lg">
                  Tarjeta de Crédito
                </Label>
              </div>
            )}
          />
        </div>

        {/* Sixth row - Purchase Type */}
        <form.Field
          name="purchaseType"
          children={(field) => (
            <div className="flex flex-col">
              <Label htmlFor={field.name} className="text-lg mb-2 font-medium">
                Tipo de Compras
              </Label>
              <Select
                value={field.state.value}
                onValueChange={(value) => field.handleChange(value)}
                onOpenChange={() => field.handleBlur()}
              >
                <SelectTrigger id={field.name} className="w-full">
                  <SelectValue placeholder="Seleccione una opción" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Autocompras</SelectItem>
                  <SelectItem value="1">Sobre vehículo</SelectItem>
                </SelectContent>
              </Select>
              {field.state.meta.errors ? (
                <span className="text-red-500 text-sm mt-1">
                  {field.state.meta.errors[0]
                    ? String(field.state.meta.errors[0].message)
                    : ""}
                </span>
              ) : null}
            </div>
          )}
        />

        {/* Seventh row - Estados de cuenta */}
        <div className="flex flex-col gap-4">
          <Label className="text-lg mb-2 font-medium">
            Estados de Cuenta (Máximo 3 archivos PDF)
          </Label>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer
              ${
                files.length >= 3
                  ? "opacity-50 cursor-not-allowed"
                  : "hover:border-purple-500"
              }
              ${isDragActive ? "border-purple-500 bg-purple-50" : ""}`}
          >
            <input {...getInputProps()} />
            <p className="text-gray-600">
              {files.length >= 3
                ? "Límite máximo de archivos alcanzado"
                : isDragActive
                ? "Suelte los archivos aquí"
                : "Arrastre los archivos aquí o haga clic para seleccionar"}
            </p>
          </div>

          {/* File list */}
          <div className="space-y-2">
            {files.map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 bg-gray-50 rounded"
              >
                <span className="truncate">{file.name}</span>
                <Button
                  variant="ghost"
                  onClick={() => handleRemoveFile(index)}
                  className="text-red-500 hover:text-red-700"
                >
                  Eliminar
                </Button>
              </div>
            ))}
          </div>
        </div>

        <Button
          type="submit"
          disabled={isLoading || !form.state.canSubmit}
          className={`w-full h-12 bg-purple-500 text-white py-3 px-4 rounded-lg text-lg font-medium cursor-pointer hover:bg-purple-600 transition-colors focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
            isLoading || !form.state.canSubmit
              ? "opacity-70 cursor-not-allowed"
              : ""
          }`}
        >
          {isLoading ? "Procesando..." : "Enviar Precalificación"}
        </Button>
      </form>
    </div>
  );
};

const DashboardSection = () => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["credit-score-and-record-by-lead-email", "bachejin@gmail.com"],
    queryFn: () => getCreditScoreAndRecordByLeadEmail("bachejin@gmail.com"),
  });

  if (isLoading)
    return <div className="text-center text-gray-500">Cargando...</div>;
  if (error)
    return (
      <div className="text-center text-red-500">Error al cargar los datos</div>
    );
  if (!data)
    return (
      <div className="text-center text-gray-500">No hay datos disponibles</div>
    );

  const { creditScore, creditRecordResult } = data?.data;

  // You would typically use a library like 'js-cookie' or 'universal-cookie'
  // to handle cookies in a React environment.  Since I cannot install
  // packages, I will just show the general idea.  Also, storing sensitive
  // information like credit scores in cookies is generally not recommended
  // for security reasons.  This is just for demonstration.

  // Example using localStorage (similar concept, but stored in the browser)
  localStorage.setItem("creditScore", JSON.stringify(creditScore));
  localStorage.setItem(
    "creditRecordResult",
    JSON.stringify(creditRecordResult)
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <main className="container mx-auto p-4 md:p-6 space-y-6">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-8">
          Perfil Crediticio
        </h2>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <Card className="md:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Puntuación de Crédito
              </CardTitle>
              <CardDescription>
                Resumen de su calificación crediticia actual
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center py-6">
                <div className="relative w-40 h-40 mb-4">
                  <div className="w-full h-full rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                    <div className="w-32 h-32 rounded-full bg-gradient-to-br from-primary/90 to-primary flex items-center justify-center">
                      <div className="w-28 h-28 rounded-full bg-background flex items-center justify-center flex-col">
                        <span className="text-3xl font-bold">
                          {creditScore.probability
                            ? creditScore.probability * 100
                            : 0}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          de 100
                        </span>
                      </div>
                    </div>
                  </div>
                  <Badge
                    className={`absolute top-0 right-0 ${
                      creditScore.probability
                        ? creditScore.probability * 100 > 70
                          ? "bg-green-500 hover:bg-green-600"
                          : "bg-yellow-500 hover:bg-yellow-600"
                        : "bg-gray-500 hover:bg-gray-600"
                    }`}
                  >
                    {creditScore.probability
                      ? creditScore.probability * 100 > 70
                        ? "Bueno"
                        : "Regular"
                      : "Regular"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-4 w-full mt-4">
                  <div className="flex flex-col items-center p-3 bg-slate-100 dark:bg-slate-800 rounded-lg">
                    <span className="text-sm text-muted-foreground">
                      Preaplica
                    </span>
                    <span className="text-lg font-semibold text-green-500">
                      {creditScore.fit ? "Sí" : "No"}
                    </span>
                  </div>
                  <div className="flex flex-col items-center p-3 bg-slate-100 dark:bg-slate-800 rounded-lg">
                    <span className="text-sm text-muted-foreground">
                      Probabilidad
                    </span>
                    <span className="text-lg font-semibold">
                      {creditScore.probability}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
            <CardFooter className="pt-0">
              <Button variant="outline" size="sm" className="w-full">
                Ver Detalles Completos
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-primary" />
                Crédito Máximo
              </CardTitle>
              <CardDescription>Límite de crédito disponible</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center py-6">
                <div className="text-3xl font-bold mb-2">
                  Q{creditRecordResult.maximumCredit}
                </div>
                <div className="text-sm text-muted-foreground mb-4">
                  Límite Total
                </div>
                <div className="w-full">
                  <div className="flex justify-between text-sm mb-1">
                    <span>Utilizado</span>
                    <span>42%</span>
                  </div>
                  <Progress value={42} className="h-2" />
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-4 h-18  bg-purple-500 text-white font-bold hover:bg-purple-600 
                    hover:text-white cursor-pointer whitespace-normal overflow-wrap break-word text-center"
                  >
                    <Link to="/marketplace">
                      Busca tu carro soñado en nuestro Marketplace
                    </Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <CircleDollarSign className="h-5 w-5 text-primary" />
                Resumen de Cuotas
              </CardTitle>
              <CardDescription>Cuotas posibles para su crédito</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 py-2">
                <div className="flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-sm text-muted-foreground">
                      Pago Mínimo
                    </span>
                    <span className="text-lg font-semibold">
                      Q{creditRecordResult.minPayment}
                    </span>
                  </div>
                  <AlertCircle className="h-5 w-5 text-amber-500" />
                </div>

                <div className="flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-sm text-muted-foreground">
                      Pago Máximo
                    </span>
                    <span className="text-lg font-semibold">
                      Q{creditRecordResult.maxPayment}
                    </span>
                  </div>
                </div>

                <div className="flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-sm text-muted-foreground">
                      Pago Ajustado
                    </span>
                    <span className="text-lg font-semibold">
                      Q{creditRecordResult.maxAdjustedPayment}
                    </span>
                  </div>
                  <Badge
                    variant="outline"
                    className="bg-primary/10 hover:bg-primary/20 text-primary border-primary/20"
                  >
                    Recomendado
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8">
          <Tabs defaultValue="summary" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="summary">Resumen</TabsTrigger>
              <TabsTrigger value="history">Historial</TabsTrigger>
              <TabsTrigger value="recommendations">Recomendaciones</TabsTrigger>
            </TabsList>
            <TabsContent value="summary" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Análisis Detallado</CardTitle>
                  <CardDescription>
                    Desglose de su perfil crediticio actual
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg">
                        <h3 className="font-medium mb-2">Factores Positivos</h3>
                        <ul className="space-y-2">
                          <li className="flex items-center gap-2 text-sm">
                            <ArrowUpRight className="h-4 w-4 text-green-500" />
                            Pagos puntuales en los últimos 12 meses
                          </li>
                          <li className="flex items-center gap-2 text-sm">
                            <ArrowUpRight className="h-4 w-4 text-green-500" />
                            Baja utilización de crédito disponible
                          </li>
                          <li className="flex items-center gap-2 text-sm">
                            <ArrowUpRight className="h-4 w-4 text-green-500" />
                            Historial crediticio estable
                          </li>
                        </ul>
                      </div>

                      <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-lg">
                        <h3 className="font-medium mb-2">Áreas de Mejora</h3>
                        <ul className="space-y-2">
                          <li className="flex items-center gap-2 text-sm">
                            <AlertCircle className="h-4 w-4 text-amber-500" />
                            Diversificar tipos de crédito
                          </li>
                          <li className="flex items-center gap-2 text-sm">
                            <AlertCircle className="h-4 w-4 text-amber-500" />
                            Reducir consultas recientes
                          </li>
                        </ul>
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      className="w-full mt-2 flex items-center justify-center"
                      onClick={() => setIsExpanded(!isExpanded)}
                    >
                      {isExpanded ? (
                        <>
                          Mostrar menos <ChevronUp className="ml-2 h-4 w-4" />
                        </>
                      ) : (
                        <>
                          Mostrar más <ChevronDown className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>

                    {isExpanded && (
                      <div className="pt-4 border-t">
                        <h3 className="font-medium mb-3">
                          Desglose de Puntuación
                        </h3>
                        <div className="space-y-3">
                          <div>
                            <div className="flex justify-between text-sm mb-1">
                              <span>Historial de Pagos</span>
                              <span>35% - Excelente</span>
                            </div>
                            <Progress value={90} className="h-2" />
                          </div>
                          <div>
                            <div className="flex justify-between text-sm mb-1">
                              <span>Utilización de Crédito</span>
                              <span>30% - Bueno</span>
                            </div>
                            <Progress value={75} className="h-2" />
                          </div>
                          <div>
                            <div className="flex justify-between text-sm mb-1">
                              <span>Antigüedad de Cuentas</span>
                              <span>15% - Regular</span>
                            </div>
                            <Progress value={60} className="h-2" />
                          </div>
                          <div>
                            <div className="flex justify-between text-sm mb-1">
                              <span>Tipos de Crédito</span>
                              <span>10% - Regular</span>
                            </div>
                            <Progress value={50} className="h-2" />
                          </div>
                          <div>
                            <div className="flex justify-between text-sm mb-1">
                              <span>Consultas Recientes</span>
                              <span>10% - Bueno</span>
                            </div>
                            <Progress value={70} className="h-2" />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="history" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Historial Crediticio</CardTitle>
                  <CardDescription>
                    Registro de actividad crediticia
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground text-center py-8">
                    El historial detallado estará disponible próximamente.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="recommendations" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Recomendaciones Personalizadas</CardTitle>
                  <CardDescription>
                    Sugerencias para mejorar su perfil crediticio
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground text-center py-8">
                    Las recomendaciones personalizadas estarán disponibles
                    próximamente.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
};
