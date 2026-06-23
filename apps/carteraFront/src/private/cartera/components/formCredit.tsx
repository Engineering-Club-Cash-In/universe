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
  Loader2,
} from "lucide-react";
import { useCatalogs } from "../hooks/catalogs";
import { User as UserIcon } from "lucide-react";
import { OtrosField } from "./rubros";
import { BulkInsolutoUpload } from "./BulkInsolutoUpload";
import React from "react";

/** Fecha por defecto según tipo de inversión */
function getDefaultFechaInicio(tipo: "compra_cartera" | "reinversion"): string {
  const now = new Date();
  if (tipo === "compra_cartera") {
    // Primer día del mes actual
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  }
  // Reinversión: 3 meses atrás
  const d = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Rango permitido para compra de cartera (mes actual) */
function getCurrentMonthRange(): { min: string; max: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const lastDay = new Date(y, m, 0).getDate();
  return {
    min: `${y}-${String(m).padStart(2, "0")}-01`,
    max: `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}
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
    label: "No. Crédito SIFCO",
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
    label: "Seguro",
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
    name: "asesor_id",
    label: "Asesor",
    type: "text",
    icon: <UserIcon className="text-blue-500 mr-2 w-5 h-5" />,
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
    label: "Royalty",
    type: "number",
    icon: <CreditCard className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "porcentaje_royalti",
    label: "Porcentaje Royalty",
    type: "number",
    icon: <Percent className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "reserva",
    label: "Reserva ",
    type: "number",
    icon: <Percent className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "dia_pago_mensual",
    label: "Día de Pago Mensual",
    type: "number",
    icon: <Calendar className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "direccion",
    label: "Dirección",
    type: "text",
    icon: <FileText className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "municipio",
    label: "Municipio",
    type: "text",
    icon: <FileText className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "departamento",
    label: "Departamento",
    type: "text",
    icon: <FileText className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "codigo_postal",
    label: "Código Postal",
    type: "text",
    icon: <FileText className="text-blue-500 mr-2 w-5 h-5" />,
  },
  {
    name: "pais",
    label: "País",
    type: "text",
    icon: <FileText className="text-blue-500 mr-2 w-5 h-5" />,
  },
];

type FieldDef = {
  name: string;
  label: string;
  type: string;
  icon: React.ReactNode;
};

const fieldsByName = Object.fromEntries(
  fields.map((f) => [f.name, f])
) as Record<string, FieldDef>;

// Agrupación del formulario en secciones para ordenar tantos campos.
const FORM_SECTIONS: {
  title: string;
  fields: string[];
  collapsible?: boolean;
}[] = [
  { title: "Cliente", fields: ["usuario", "nit", "categoria", "asesor_id"] },
  {
    title: "Crédito",
    fields: [
      "numero_credito_sifco",
      "capital",
      "porcentaje_interes",
      "plazo",
      "cuota",
      "dia_pago_mensual",
      "observaciones",
    ],
  },
  {
    title: "Cargos",
    fields: [
      "seguro_10_cuotas",
      "gps",
      "membresias_pago",
      "royalti",
      "porcentaje_royalti",
      "otros",
      "reserva",
    ],
  },
  {
    title: "Dirección (opcional)",
    fields: ["direccion", "municipio", "departamento", "codigo_postal", "pais"],
    collapsible: true,
  },
];

export function CreditForm() {
  const formik = useCreditForm();
  // Modo carga masiva de insolutos (reemplaza el formulario por el wizard)
  const [bulkMode, setBulkMode] = React.useState(false);
  // Define the type for an investor
  type Investor = { inversionista_id: number; nombre: string };

  const { investors, advisors } = useCatalogs() as {
    investors: Investor[];
    advisors: any[];
    loading: boolean;
  };
  const reservaEditadoPorUsuario = React.useRef(false);
  React.useEffect(() => {
    if (formik.values.esInsoluto) return; // insoluto: reserva forzada a 0 (ver efecto de abajo)
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

  // Campos que el backend fuerza cuando el crédito es insoluto. En el front los
  // mostramos pero BLOQUEADOS, para que el usuario vea qué valor van a tomar.
  const esInsoluto = formik.values.esInsoluto === true;
  const FORCED_INSOLUTO_FIELDS = React.useMemo(
    () =>
      new Set<string>([
        "numero_credito_sifco",
        "porcentaje_interes",
        "seguro_10_cuotas",
        "gps",
        "membresias_pago",
        "otros",
        "royalti",
        "porcentaje_royalti",
        "reserva",
        "cuota",
      ]),
    []
  );
  const isForced = (name: string) => esInsoluto && FORCED_INSOLUTO_FIELDS.has(name);

  // Insoluto: todos los cargos a 0 y cuota = capital / plazo (en vivo).
  React.useEffect(() => {
    if (!esInsoluto) return;
    const cap = Number(formik.values.capital) || 0;
    const plz = Number(formik.values.plazo) || 1;
    const cuota = plz > 0 ? Math.round((cap / plz) * 100) / 100 : 0;
    formik.setFieldValue("porcentaje_interes", 0);
    formik.setFieldValue("seguro_10_cuotas", 0);
    formik.setFieldValue("gps", 0);
    formik.setFieldValue("membresias_pago", 0);
    formik.setFieldValue("royalti", 0);
    formik.setFieldValue("porcentaje_royalti", 0);
    formik.setFieldValue("otros", 0);
    formik.setFieldValue("reserva", 0);
    formik.setFieldValue("cuota", cuota);
    formik.setFieldValue("numero_credito_sifco", "");
    formik.setFieldValue("inversionistas", []);
    // eslint-disable-next-line
  }, [esInsoluto, formik.values.capital, formik.values.plazo]);
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-start bg-gradient-to-br from-blue-50 to-white px-2 overflow-auto pt-8 pb-8">
      <h1 className="text-4xl font-extrabold text-blue-700 text-center mb-6 drop-shadow-md w-full">
        Registro de Crédito
      </h1>
      <Card className="w-full max-w-[1120px] mx-2 flex flex-col shadow-2xl border-2 border-blue-100 rounded-3xl bg-white/90 backdrop-blur-sm">
        <CardHeader className="pb-0 flex flex-col items-center gap-2">
          <span className="flex items-center justify-center bg-blue-100 rounded-full w-14 h-14 mb-1 shadow">
            <CreditCard className="text-blue-600 w-8 h-8" />
          </span>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col justify-center">
          {/* Barra superior: toggle insoluto + carga masiva */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {!bulkMode && (
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="esInsoluto"
                  className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5"
                >
                  <input
                    id="esInsoluto"
                    name="esInsoluto"
                    type="checkbox"
                    checked={esInsoluto}
                    onChange={(e) => formik.setFieldValue("esInsoluto", e.target.checked)}
                    className="h-4 w-4 accent-amber-600"
                  />
                  <span className="text-sm font-medium text-amber-800">
                    Crédito insoluto
                  </span>
                </label>
                {esInsoluto && (
                  <p className="text-xs text-amber-700">
                    Sin interés ni cargos · se crea INCOBRABLE · cuota = capital / plazo ·
                    se asigna a Cube Investments S.A. (100% Cash In) · No. SIFCO automático.
                  </p>
                )}
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => setBulkMode((b) => !b)}
              className="ml-auto gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
            >
              {bulkMode ? "← Volver al formulario" : "Cargar varios (insolutos)"}
            </Button>
          </div>

          {bulkMode ? (
            <BulkInsolutoUpload
              onFinish={() => {
                setBulkMode(false);
                formik.resetForm();
              }}
            />
          ) : (
          <form
            onSubmit={formik.handleSubmit}
            className="flex-1 flex flex-col gap-5"
          >
            {(() => {
              const renderField = (field: FieldDef) => {
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
                        <span className="text-red-500 text-xs">
                          {formik.errors.categoria as string}
                        </span>
                      )}
                    </div>
                  );
                }
                if (field.name === "asesor_id") {
                  return (
                    <div key={field.name} className="grid gap-1 w-full">
                      <Label className="text-gray-900 font-medium mb-1 flex items-center">
                        {field.icon}
                        Asesor
                      </Label>
                      <select
                        id="asesor_id"
                        name="asesor_id"
                        value={formik.values.asesor_id}
                        onChange={(e) => {
                          formik.setFieldValue("asesor_id", Number(e.target.value));
                        }}
                        onBlur={formik.handleBlur}
                        className={[
                          "w-full border rounded-lg px-3 py-2 bg-white text-gray-900",
                          formik.errors.asesor_id && formik.touched.asesor_id
                            ? "border-red-500 focus:ring-red-500"
                            : "border-gray-300",
                        ].join(" ")}
                      >
                        <option value="">Seleccione un asesor</option>
                        {advisors.map((adv: any) => (
                          <option key={adv.asesor_id} value={adv.asesor_id}>
                            {adv.nombre}
                          </option>
                        ))}
                      </select>
                      {formik.errors.asesor_id && formik.touched.asesor_id && (
                        <span className="text-red-500 text-xs">
                          {formik.errors.asesor_id as string}
                        </span>
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
                        disabled={esInsoluto}
                        onChange={(e) => {
                          // Marca como manualmente editado SOLO si el valor es distinto a la fórmula
                          reservaEditadoPorUsuario.current = true;
                          formik.handleChange(e);
                        }}
                        onBlur={formik.handleBlur}
                        className={[
                          "w-full border rounded-lg px-3 py-2 text-gray-900",
                          esInsoluto ? "bg-gray-100 cursor-not-allowed" : "bg-white",
                        ].join(" ")}
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
                  if (esInsoluto) {
                    return (
                      <div key={field.name} className="grid gap-1 w-full">
                        <Label className="text-gray-900 font-medium mb-1 flex items-center">
                          {field.icon}
                          {field.label}
                        </Label>
                        <Input
                          type="number"
                          value={0}
                          disabled
                          className="w-full border rounded-lg px-3 py-2 bg-gray-100 text-gray-900 cursor-not-allowed"
                        />
                      </div>
                    );
                  }
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
                      value={value as any}
                      onChange={formik.handleChange}
                      onBlur={formik.handleBlur}
                      disabled={isForced(field.name)}
                      placeholder={
                        isForced(field.name) && field.name === "numero_credito_sifco"
                          ? "Se genera automáticamente: insoluto-N"
                          : undefined
                      }
                      className={[
                        "w-full border rounded-lg px-3 py-2 text-gray-900",
                        isForced(field.name) ? "bg-gray-100 cursor-not-allowed" : "bg-white",
                      ].join(" ")}
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
              };
              return FORM_SECTIONS.map((section) => {
                const grid = (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-4">
                    {section.fields.map((name) => renderField(fieldsByName[name]))}
                  </div>
                );
                return (
                  <section key={section.title} className="flex flex-col gap-3">
                    {section.collapsible ? (
                      <details className="group rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3">
                        <summary className="flex cursor-pointer list-none items-center gap-2 text-base font-bold text-blue-700">
                          <span className="text-blue-400 transition-transform group-open:rotate-90">
                            ▶
                          </span>
                          {section.title}
                        </summary>
                        <div className="mt-4">{grid}</div>
                      </details>
                    ) : (
                      <>
                        <h2 className="border-b border-blue-100 pb-1 text-base font-bold text-blue-700">
                          {section.title}
                        </h2>
                        {grid}
                      </>
                    )}
                  </section>
                );
              });
            })()}

            {/* Sección de inversionistas */}
            <div className="flex flex-col gap-4 border-t pt-6">
              <Label className="text-xl font-bold text-blue-700">
                Inversionistas
              </Label>

              {esInsoluto && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  Crédito insoluto: se asigna automáticamente a{" "}
                  <strong>Cube Investments S.A.</strong> con 100% Cash In. No se
                  editan inversionistas.
                </div>
              )}

              {!esInsoluto &&
                formik.values.inversionistas.map((inv, index) => (
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
                      Tipo de Inversión
                    </Label>
                    <select
                      name={`inversionistas.${index}.tipo_inversion`}
                      value={inv.tipo_inversion ?? "compra_cartera"}
                      onChange={(e) => {
                        const tipo = e.target.value as "compra_cartera" | "reinversion";
                        formik.setFieldValue(`inversionistas.${index}.tipo_inversion`, tipo);
                        formik.setFieldValue(
                          `inversionistas.${index}.fecha_inicio_participacion`,
                          getDefaultFechaInicio(tipo)
                        );
                      }}
                      className="w-full border rounded px-3 py-2 bg-white text-gray-900"
                    >
                      <option value="compra_cartera">Compra de Cartera</option>
                      <option value="reinversion">Reinversión</option>
                    </select>
                  </div>

                  <div>
                    <Label className="text-gray-900 font-medium mb-2">
                      Fecha Inicio Participación
                    </Label>
                    {inv.tipo_inversion === "reinversion" ? (
                      <>
                        <Input
                          type="date"
                          value={inv.fecha_inicio_participacion ?? ""}
                          disabled
                          className="text-gray-900 bg-gray-100 cursor-not-allowed"
                        />
                        <div className="text-xs text-gray-500 mt-1">
                          * Reinversión: 3 meses antes del mes actual (no editable)
                        </div>
                      </>
                    ) : (
                      <Input
                        type="date"
                        name={`inversionistas.${index}.fecha_inicio_participacion`}
                        value={inv.fecha_inicio_participacion ?? ""}
                        min={getCurrentMonthRange().min}
                        max={getCurrentMonthRange().max}
                        onChange={formik.handleChange}
                        onBlur={formik.handleBlur}
                        className="text-gray-900"
                      />
                    )}
                  </div>

                  <div className="col-span-2 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <p className="text-xs text-yellow-700">
                      <strong>Nota:</strong> Para nuevos inversionistas, la cuenta padre e hija (espejo) se crean con los mismos datos.
                      El espejo no es editable en este formulario.
                    </p>
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

              {!esInsoluto && (
                <Button
                  type="button"
                  onClick={() => {
                      const tipoDefault = "compra_cartera" as const;
                    formik.setFieldValue("inversionistas", [
                      ...formik.values.inversionistas,
                      {
                        inversionista_id: 0,
                        monto_aportado: 0,
                        porcentaje_cash_in: 0,
                        porcentaje_inversion: 100,
                        tipo_inversion: tipoDefault,
                        fecha_inicio_participacion: getDefaultFechaInicio(tipoDefault),
                      },
                    ]);
                  }}
                  className="w-fit bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-xl shadow"
                >
                  + Agregar Inversionista
                </Button>
              )}
            </div>
            <Button
              type="submit"
              disabled={formik.isSubmitting}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-4 rounded-xl text-lg shadow transition flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={(e) => {
                // Evita doble envío (clicks repetidos) mientras se está creando
                if (formik.isSubmitting) {
                  e.preventDefault();
                  return;
                }
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
              {formik.isSubmitting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Creando…
                </>
              ) : (
                "Enviar"
              )}
            </Button>
          </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
