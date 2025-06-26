import {   usePagoForm } from "../hooks/registerPayment";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DollarSign, BadgeCheck, Percent, Info } from "lucide-react";
import { useState } from "react";
import { MiniCardCredito } from "./cardInfo";

const fields = [
  {
    name: "monto_boleta",
    label: "Monto Boleta",
    type: "number",
    icon: <DollarSign className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "renuevo_o_nuevo",
    label: "Tipo",
    type: "select",
    icon: <BadgeCheck className="text-blue-500 mr-2 w-5 h-5" />,
    options: [
      { value: "Renuevo", label: "Renuevo" },
      { value: "Nuevo", label: "Nuevo" },
      { value: "Otro", label: "Otro" },
    ],
  },
  {
    name: "otros",
    label: "Otros",
    type: "text",
    icon: <Info className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "mora",
    label: "Mora",
    type: "number",
    icon: <Percent className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "observaciones",
    label: "Observaciones",
    type: "text",
    icon: <Percent className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "numero_cuota",
    label: "# Cuota",
    type: "number",
    icon: <Percent className="text-blue-500 mr-2 w-5 h-5" />,
  },
];

export function PagoForm() {
const { formik, fetchCredito, dataCredito, loadingCredito, errorCredito } = usePagoForm();


  const [searchNumero, setSearchNumero] = useState("");
   

  return (
    <div className="flex flex-col items-center mt-4">
      <h1 className="text-4xl font-extrabold text-blue-700 text-center mb-6 drop-shadow-md">
        Registro de Pago
      </h1>
      <Card
        className="
          w-full max-w-[900px]
          flex flex-col
          shadow-2xl
          border-2 border-blue-100
          rounded-3xl
          bg-white/90
          backdrop-blur-sm
        "
      >
        {/* Ícono flotando centrado */}
        <CardHeader className="pb-0 flex flex-col items-center gap-2">
          <span className="flex items-center justify-center bg-blue-100 rounded-full w-14 h-14 mb-1 shadow">
            <DollarSign className="text-blue-600 w-9 h-9" />
          </span>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col items-center justify-center">
          <div className="mb-4 flex gap-2 items-center">
            <Input
              type="text"
              className="border px-4 py-2 rounded-lg text-gray-900 text-lg bg-white/90"
              placeholder="Buscar crédito SIFCO"
              value={searchNumero}
              onChange={(e) => setSearchNumero(e.target.value)}
            />
            <Button
              className="bg-gray-100 text-blue-700 border border-blue-400 hover:bg-blue-100 font-bold"
              onClick={() => fetchCredito(searchNumero)}
              disabled={loadingCredito || !searchNumero}
            >
              Buscar
            </Button>
          </div>
          {/* --- MINICARD --- */}
          {dataCredito?.creditos && dataCredito?.usuarios && (
            <MiniCardCredito
              creditos={dataCredito.creditos}
              usuarios={dataCredito.usuarios}
            />
          )}
          {errorCredito && <div className="text-red-500 mb-2">{errorCredito}</div>}
          <form
            onSubmit={formik.handleSubmit}
            className="flex-1 flex flex-col gap-5 w-full"
            style={{ minHeight: 0 }}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {fields.map((field) => (
                <div
                  key={field.name}
                  className="min-h-[92px] flex flex-col justify-end w-full"
                >
                  <Label
                    className={`text-gray-900 font-semibold mb-1 flex items-center text-lg ${
                      field.name === "observaciones"
                        ? "flex-col items-start gap-0"
                        : ""
                    }`}
                  >
                    {field.icon}
                    <span>{field.label}</span>
                  </Label>
                  {field.name === "renuevo_o_nuevo" ? (
                    <select
                      id={field.name}
                      name={field.name}
                      value={
                        formik.values[
                          field.name as keyof typeof formik.values
                        ] ?? ""
                      }
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                      className={[
                        "w-full max-w-full border rounded-lg px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg bg-white/70",
                        formik.errors[
                          field.name as keyof typeof formik.values
                        ] &&
                        formik.touched[field.name as keyof typeof formik.values]
                          ? "border-red-500 focus:ring-red-500"
                          : "border-gray-300",
                      ].join(" ")}
                    >
                      <option value="">Seleccione una opción</option>
                      <option value="Renuevo">Renuevo</option>
                      <option value="Nuevo">Nuevo</option>
                    </select>
                  ) : (
                    <Input
                      id={field.name}
                      name={field.name}
                      type={field.type}
                      value={
                        formik.values[
                          field.name as keyof typeof formik.values
                        ] ?? ""
                      }
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                      className={[
                        "w-full max-w-full border rounded-lg px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg bg-white/70",
                        formik.errors[
                          field.name as keyof typeof formik.values
                        ] &&
                        formik.touched[field.name as keyof typeof formik.values]
                          ? "border-red-500 focus:ring-red-500"
                          : "border-gray-300",
                      ].join(" ")}
                    />
                  )}
                  {formik.errors[field.name as keyof typeof formik.values] &&
                    formik.touched[
                      field.name as keyof typeof formik.values
                    ] && (
                      <div className="text-red-500 text-sm mt-1">
                        {
                          formik.errors[
                            field.name as keyof typeof formik.values
                          ]
                        }
                      </div>
                    )}
                </div>
              ))}
            </div>
            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-5 px-4 rounded-xl text-2xl shadow transition"
              disabled={formik.isSubmitting}
            >
              {formik.isSubmitting ? "Registrando..." : "Registrar Pago"}
            </Button>
            {/* Resumen */}
           
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
