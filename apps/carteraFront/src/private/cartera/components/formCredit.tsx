/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCreditForm } from "../hooks/registerCredit";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  User,
  CreditCard,
  DollarSign,
  Percent,
  FileText,
  BadgeDollarSign,
  Calendar,
  BookUser,
  ListChecks,
} from "lucide-react";
import { useCatalogs } from "../hooks/catalogs";
import { OtrosField } from "./rubros";
import React from "react";
const categorias = [
  "Contraseña",
  "CV Vehículo",
  "CV Vehículo nuevo",
  "Fiduciario",
  "Hipotecario",
  "Vehículo",
];
const fields = [
  {
    name: "usuario",
    label: "Cliente",
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
    name: "seguro_10_cuotas",
    label: "Seguro ",
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
    name: "observaciones",
    label: "Observaciones",
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
  {
    name: "royalti",
    label: "Royalti",
    type: "number",
    icon: <CreditCard className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "porcentaje_royalti",
    label: "Porcentaje Royalti",
    type: "number",
    icon: <Percent className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "reserva",
    label: "Reserva ",
    type: "number",
    icon: <Percent className="text-blue-500 mr-2 w-5 h-5" />,
  },
];

export function CreditForm() {
  const formik = useCreditForm();
  // Define the type for an investor
  type Investor = { inversionista_id: number; nombre: string };

  const { investors, advisors } = useCatalogs() as {
    investors: Investor[];
    advisors: any[];
    loading: boolean;
  };
  const reservaEditadoPorUsuario = React.useRef(false);
  React.useEffect(() => {
    // Solo actualiza reserva si el usuario NO la editó manualmente o la dejó vacía
    if (
      !reservaEditadoPorUsuario.current ||
      formik.values.reserva === 0 ||
      formik.values.reserva === 600 + Number(formik.values.seguro_10_cuotas)
    ) {
      formik.setFieldValue(
        "reserva",
        600 + Number(formik.values.seguro_10_cuotas)
      );
      reservaEditadoPorUsuario.current = false; // vuelve al modo auto si estaba vacío
    }
    // eslint-disable-next-line
  }, [formik.values.seguro_10_cuotas]);
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-2 overflow-auto pt-8 pb-8">
      <h1 className="text-4xl font-extrabold text-blue-700 text-center mb-6 drop-shadow-md w-full">
        Registro de Crédito
      </h1>
      <Card className="w-full max-w-[900px] mx-2 flex flex-col shadow-2xl border-2 border-blue-100 rounded-3xl bg-white/90 backdrop-blur-sm">
        <CardHeader className="pb-0 flex flex-col items-center gap-2">
          <span className="flex items-center justify-center bg-blue-100 rounded-full w-14 h-14 mb-1 shadow">
            <CreditCard className="text-blue-600 w-8 h-8" />
          </span>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col justify-center">
          <form
            onSubmit={formik.handleSubmit}
            className="flex-1 flex flex-col gap-5"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {fields.map((field) => {
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
                          "w-full border rounded-lg px-3 py-2 bg-white text-gray-900",
                          formik.errors.asesor && formik.touched.asesor
                            ? "border-red-500 focus:ring-red-500"
                            : "border-gray-300",
                        ].join(" ")}
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
                if (field.name === "categoria") {
                  return (
                    <div key={field.name} className="grid gap-1 w-full">
                      <Label className="text-gray-900 font-medium mb-1 flex items-center">
                        {field.icon}
                        Categoría
                      </Label>
                      <select
                        id="categoria"
                        name="categoria"
                        value={formik.values.categoria}
                        onChange={formik.handleChange}
                        onBlur={formik.handleBlur}
                        className={[
                          "w-full border rounded-lg px-3 py-2 bg-white text-gray-900",
                          formik.errors.categoria && formik.touched.categoria
                            ? "border-red-500 focus:ring-red-500"
                            : "border-gray-300",
                        ].join(" ")}
                      >
                        <option value="">Seleccione una categoría</option>
                        {categorias.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                      {formik.errors.categoria && formik.touched.categoria && (
                        <div className="text-red-500 text-xs">
                          {formik.errors.categoria}
                        </div>
                      )}
                    </div>
                  );
                }
                if (field.name === "reserva") {
                  return (
                    <div key={field.name} className="grid gap-1 w-full">
                      <Label className="text-gray-900 font-medium mb-1 flex items-center">
                        {field.icon}
                        {field.label}
                      </Label>
                      <Input
                        id="reserva"
                        name="reserva"
                        type="number"
                        value={formik.values.reserva}
                        onChange={(e) => {
                          // Marca como manualmente editado SOLO si el valor es distinto a la fórmula
                          reservaEditadoPorUsuario.current = true;
                          formik.handleChange(e);
                        }}
                        onBlur={formik.handleBlur}
                        className="w-full border rounded-lg px-3 py-2 bg-white text-gray-900"
                      />
                      {formik.errors.reserva && formik.touched.reserva && (
                        <div className="text-red-500 text-xs">
                          {formik.errors.reserva}
                        </div>
                      )}
                      <div className="text-xs text-gray-500 mt-1">
                        * Por defecto es 600 + Seguro 10 cuotas
                      </div>
                    </div>
                  );
                }
                if (field.name === "otros") {
                  return <OtrosField key={field.name} formik={formik} />;
                }
                // Prevent rendering Input for fields whose value is an array (like inversionistas)
                const value =
                  formik.values[field.name as keyof typeof formik.values];
                if (Array.isArray(value)) {
                  return null;
                }
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
                      value={value}
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                      className="w-full border rounded-lg px-3 py-2 bg-white text-gray-900"
                    />
                    {formik.errors[field.name as keyof typeof formik.values] &&
                      formik.touched[
                        field.name as keyof typeof formik.values
                      ] &&
                      typeof formik.errors[
                        field.name as keyof typeof formik.values
                      ] === "string" && (
                        <div className="text-red-500 text-xs">
                          {
                            formik.errors[
                              field.name as keyof typeof formik.values
                            ] as string
                          }
                        </div>
                      )}
                  </div>
                );
              })}
            </div>

            {/* Sección de inversionistas */}
            <div className="flex flex-col gap-4 border-t pt-6">
              <Label className="text-xl font-bold text-blue-700">
                Inversionistas
              </Label>

              {formik.values.inversionistas.map((inv, index) => (
                <div
                  key={index}
                  className="grid grid-cols-1 md:grid-cols-2 gap-4 border rounded-xl p-4 bg-blue-50"
                >
                  <div>
                    <Label className="text-gray-900 font-medium mb-2">
                      Inversionista
                    </Label>
                    <select
                      name={`inversionistas.${index}.inversionista_id`}
                      value={inv.inversionista_id}
                      onChange={(e) =>
                        formik.setFieldValue(
                          `inversionistas.${index}.inversionista_id`,
                          Number(e.target.value)
                        )
                      }
                      onBlur={formik.handleBlur}
                      className="w-full border rounded px-3 py-2 bg-white text-gray-900"
                    >
                      <option value="">Seleccione un inversionista</option>
                      {investors.map((invOpt) => (
                        <option
                          key={invOpt.inversionista_id}
                          value={invOpt.inversionista_id}
                        >
                          {invOpt.nombre}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <Label className="text-gray-900 font-medium mb-2">
                      Monto Aportado
                    </Label>
                    <Input
                      type="number"
                      name={`inversionistas.${index}.monto_aportado`}
                      value={inv.monto_aportado}
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                      className="text-gray-900"
                    />
                  </div>

                  <div>
                    <Label className="text-gray-900 font-medium mb-2">
                      % Cash In
                    </Label>
                    <Input
                      type="number"
                      name={`inversionistas.${index}.porcentaje_cash_in`}
                      value={inv.porcentaje_cash_in}
                      min={0}
                      max={100}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        formik.setFieldValue(
                          `inversionistas.${index}.porcentaje_cash_in`,
                          value
                        );
                        // Autocompleta el otro campo
                        formik.setFieldValue(
                          `inversionistas.${index}.porcentaje_inversion`,
                          100 - value
                        );
                      }}
                      onBlur={formik.handleBlur}
                      className="text-gray-900"
                    />
                  </div>

                  <div>
                    <Label className="text-gray-900 font-medium mb-2">
                      % Inversión
                    </Label>
                    <Input
                      type="number"
                      name={`inversionistas.${index}.porcentaje_inversion`}
                      value={inv.porcentaje_inversion}
                      min={0}
                      max={100}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        formik.setFieldValue(
                          `inversionistas.${index}.porcentaje_inversion`,
                          value
                        );
                        // Autocompleta el otro campo
                        formik.setFieldValue(
                          `inversionistas.${index}.porcentaje_cash_in`,
                          100 - value
                        );
                      }}
                      onBlur={formik.handleBlur}
                      className="text-gray-900"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-900 font-medium mb-2">
                      Cuota
                    </Label>
                    <Input
                      type="number"
                      name={`inversionistas.${index}.cuota_inversionista`}
                      value={inv.cuota_inversionista ?? ""}
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                      className="text-gray-900"
                    />
                  </div>

                  <div className="col-span-2 flex justify-end">
                    <Button
                      variant="outline"
                      color="danger"
                      type="button"
                      className="w-fit bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-xl shadow"
                      onClick={() => {
                        const newInvestors = [...formik.values.inversionistas];
                        newInvestors.splice(index, 1);
                        formik.setFieldValue("inversionistas", newInvestors);
                      }}
                    >
                      Eliminar
                    </Button>
                  </div>
                </div>
              ))}

              <Button
                type="button"
                onClick={() => {
                  formik.setFieldValue("inversionistas", [
                    ...formik.values.inversionistas,
                    {
                      inversionista_id: 0,
                      porcentaje_participacion: 0,
                      cuota_inversionista: 0,
                    },
                  ]);
                }}
                className="w-fit bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-xl shadow"
              >
                + Agregar Inversionista
              </Button>
            </div>
            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-4 rounded-xl text-lg shadow transition"
              onClick={(e) => {
                // Detener el submit si hay errores
                if (!formik.isValid && Object.keys(formik.errors).length > 0) {
                  e.preventDefault();
                  // Crea un mensaje bonito con todos los errores
                  const errores = Object.entries(formik.errors)
                    .map(([campo, mensaje]) => `• ${campo}: ${mensaje}`)
                    .join("\n");
                  alert(
                    `Por favor revisa los siguientes errores antes de continuar:\n\n${errores}`
                  );
                }
                // Si querés mostrar igual los logs
                console.log("Errores:", formik.errors);
                console.log("Touched:", formik.touched);
                console.log("Es válido:", formik.isValid);
              }}
            >
              Enviar
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
