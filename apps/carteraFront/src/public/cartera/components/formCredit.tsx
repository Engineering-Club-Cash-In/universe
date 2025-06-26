import { useCreditForm } from "../hooks/registerCredit";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader,   } from "@/components/ui/card";
import {
  User,
  CreditCard,
  DollarSign,
  Percent,
  FileText,
  BadgeDollarSign,
  Users,
  Calendar,
  BookUser,
  File,
  ListChecks,
} from "lucide-react";
import { useCatalogs } from "../hooks/catalogs";
const fields = [
  {
    name: "usuario",
    label: "Usuario",
    type: "text",
    icon: <User className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "numero_credito_sifco",
    label: "Número crédito SIFCO",
    type: "text",
    icon: <CreditCard className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "capital",
    label: "Capital",
    type: "number",
    icon: <DollarSign className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "porcentaje_interes",
    label: "Porcentaje Interés",
    type: "number",
    icon: <Percent className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "porcentaje_cash_in",
    label: "Porcentaje Cash In",
    type: "number",
    icon: <Percent className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "seguro_10_cuotas",
    label: "Seguro 10 cuotas",
    type: "number",
    icon: <FileText className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "gps",
    label: "GPS",
    type: "number",
    icon: <BadgeDollarSign className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "inversionista_id",
    label: "ID Inversionista",
    type: "number",
    icon: <Users className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "observaciones",
    label: "Observaciones",
    type: "text",
    icon: <FileText className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "no_poliza",
    label: "No. Póliza",
    type: "text",
    icon: <File className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "como_se_entero",
    label: "¿Cómo se enteró?",
    type: "text",
    icon: <BookUser className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "asesor",
    label: "Asesor",
    type: "text",
    icon: <User className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "plazo",
    label: "Plazo",
    type: "number",
    icon: <Calendar className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "porcentaje_participacion_inversionista",
    label: "  Participación Inversionista",
    type: "number",
    icon: <Percent className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "cuota",
    label: "Cuota",
    type: "number",
    icon: <ListChecks className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "membresias_pago",
    label: "Membresías Pago",
    type: "number",
    icon: <BadgeDollarSign className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "formato_credito",
    label: "Formato Crédito",
    type: "text",
    icon: <FileText className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "categoria",
    label: "Categoría",
    type: "text",
    icon: <BookUser className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "nit",
    label: "NIT",
    type: "text",
    icon: <CreditCard className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "otros",
    label: "Otros",
    type: "number",
    icon: <CreditCard className="text-blue-500 mr-2 w-5 h-5" />,
  },
];
export function CreditForm() {
  const formik = useCreditForm();
  const { investors, advisors, loading } = useCatalogs();

  return (
    <div className="flex flex-col w-full h-full items-center justify-center p-4">
      {/* Título fuera de la Card */}
      <h1 className="text-4xl font-extrabold text-blue-700 text-center mb-6 drop-shadow-md">
        Registro de Crédito
      </h1>
      <Card
        className="
        w-full max-w-[900px]
        h-full flex flex-col
        shadow-2xl
        border-2 border-blue-100
        rounded-3xl
        bg-white/90
        backdrop-blur-sm
      "
      >
        <CardHeader className="pb-0 flex flex-col items-center gap-2">
          <span className="flex items-center justify-center bg-blue-100 rounded-full w-14 h-14 mb-1 shadow">
            <CreditCard className="text-blue-600 w-8 h-8" />
          </span>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col justify-center">
          <form
            onSubmit={formik.handleSubmit}
            className="flex-1 flex flex-col gap-5"
            style={{ minHeight: 0 }}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {fields.map((field) => {
                // Selector para inversionista
                if (field.name === "inversionista_id") {
                  return (
                    <div key={field.name} className="grid gap-1 w-full">
                      <Label className="text-gray-900 font-medium mb-1 flex items-center">
                        {field.icon}
                        Inversionista
                      </Label>
                      <select
                        id="inversionista_id"
                        name="inversionista_id"
                        value={formik.values.inversionista_id}
                         onChange={e => {
    const value = e.target.value;
    formik.setFieldValue("inversionista_id", value ? Number(value) : "");
  }}
                        onBlur={formik.handleBlur}
                        className={[
                          "w-full max-w-full border rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-base bg-white/70 truncate",
                          formik.errors.inversionista_id &&
                          formik.touched.inversionista_id
                            ? "border-red-500 focus:ring-red-500"
                            : "border-gray-300",
                        ].join(" ")}
                        disabled={loading}
                      >
                        <option value="">Seleccione un inversionista</option>
                        {investors.map((inv) => (
                          <option key={inv.inversionista_id} value={inv.inversionista_id}>
                            {inv.nombre}
                          </option>
                        ))}
                      </select>
                      {formik.errors.inversionista_id &&
                        formik.touched.inversionista_id && (
                          <div className="text-red-500 text-xs">
                            {formik.errors.inversionista_id}
                          </div>
                        )}
                    </div>
                  );
                }

                // Selector para asesor
                if (field.name === "asesor") {
                  return (
                    <div key={field.name} className="grid gap-1 w-full">
                      <Label className="text-gray-900 font-medium mb-1 flex items-center">
                        {field.icon}
                        Asesor
                      </Label>
                      <select
                        id="asesor"
                        name="asesor"
                        value={formik.values.asesor}
                        onChange={formik.handleChange}
                        onBlur={formik.handleBlur}
                        className={[
                          "w-full max-w-full border rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-base bg-white/70 truncate",
                          formik.errors.asesor && formik.touched.asesor
                            ? "border-red-500 focus:ring-red-500"
                            : "border-gray-300",
                        ].join(" ")}
                        disabled={loading}
                      >
                        <option value="">Seleccione un asesor</option>
                        {advisors.map((adv) => (
                          <option key={adv.id} value={adv.nombre}>
                            {adv.nombre}
                          </option>
                        ))}
                      </select>
                      {formik.errors.asesor && formik.touched.asesor && (
                        <div className="text-red-500 text-xs">
                          {formik.errors.asesor}
                        </div>
                      )}
                    </div>
                  );
                }

                // Campos normales
                return (
                  <div key={field.name} className="grid gap-1 w-full">
                    <Label className="text-gray-900 font-medium mb-1 flex items-center">
                      {field.icon}
                      {field.label}
                    </Label>
                    <Input
                      id={field.name}
                      name={field.name}
                      type={field.type}
                      value={
                        formik.values[field.name as keyof typeof formik.values]
                      }
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                      className={[
                        "w-full max-w-full border rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-base bg-white/70",
                        formik.errors[
                          field.name as keyof typeof formik.values
                        ] &&
                        formik.touched[field.name as keyof typeof formik.values]
                          ? "border-red-500 focus:ring-red-500"
                          : "border-gray-300",
                      ].join(" ")}
                    />
                    {formik.errors[field.name as keyof typeof formik.values] &&
                      formik.touched[
                        field.name as keyof typeof formik.values
                      ] && (
                        <div className="text-red-500 text-xs">
                          {
                            formik.errors[
                              field.name as keyof typeof formik.values
                            ]
                          }
                        </div>
                      )}
                  </div>
                );
              })}
            </div>
            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-4 rounded-xl text-lg shadow transition"
            >
              Enviar
            </Button>
            {/* Resumen */}
         
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
