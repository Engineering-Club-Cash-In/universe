/* eslint-disable @typescript-eslint/no-explicit-any */
// src/hooks/useCreditForm.ts
import { useFormik } from "formik";

import { z } from "zod";
import { createCredit } from "../services/services";
export const creditSchema = z.object({
  usuario: z.string().max(1000),
  numero_credito_sifco: z.string().max(1000),
  capital: z.number().nonnegative(),
  porcentaje_interes: z.number().min(0).max(100),
  porcentaje_cash_in: z.number().min(0).max(100),
  seguro_10_cuotas: z.number().min(0),
  gps: z.number().min(0),
  inversionista_id: z.preprocess((v) => {
    // Si el valor es string vacío, deja undefined para que lance error de requerido
    if (v === "") return undefined;
    // Si el valor es string (como viene de un select), pásalo a number
    if (typeof v === "string") return Number(v);
    // Si ya es number, no cambies nada
    return v;
  }, z.number({ required_error: "Selecciona un inversionista" }).min(1, "Selecciona un inversionista válido")),
  observaciones: z.string().max(1000),
  no_poliza: z.string().max(1000),
  como_se_entero: z.string().max(100),
  asesor: z.string().max(1000),
  plazo: z.number().int().min(1).max(360),
  porcentaje_participacion_inversionista: z.number().min(0).max(100),
  cuota: z.number().min(0),
  membresias_pago: z.number().min(0),
  formato_credito: z.string().max(1000),
  categoria: z.string().max(1000),
  nit: z.string().max(1000),
  otros: z.number().max(100000),
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function zodToFormikValidate(schema: z.ZodSchema<any>) {
  return (values: any) => {
    const result = schema.safeParse(values);
    if (result.success) return {};
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      errors[issue.path[0]] = issue.message;
    }
    return errors;
  };
}
export type CreditFormValues = z.infer<typeof creditSchema>;

export function useCreditForm(initialValues?: Partial<CreditFormValues>) {
  const formik = useFormik<CreditFormValues>({
    initialValues: {
      usuario: "",
      numero_credito_sifco: "",
      capital: 0,
      porcentaje_interes: 0,
      porcentaje_cash_in: 0,
      seguro_10_cuotas: 0,
      gps: 0,
      inversionista_id: 0,
      observaciones: "",
      no_poliza: "",
      como_se_entero: "",
      asesor: "",
      plazo: 1,
      porcentaje_participacion_inversionista: 0,
      cuota: 0,
      membresias_pago: 0,
      formato_credito: "",
      categoria: "",
      nit: "",
      otros: 0,
      ...initialValues,
    },
    validate: zodToFormikValidate(creditSchema),
   onSubmit: async (values, { setSubmitting, setStatus }) => {
  try {
    console.log("Enviando datos del crédito:", values);
     await createCredit(values);
    alert("¡Crédito creado correctamente!");
    setStatus({ success: true });
//    resetForm(); // <-- Aquí resetea el formulario a los valores iniciales
  } catch (error: any) {
    const backendMessage =
      error?.response?.data?.message || "Error desconocido";
    alert(`No se pudo crear el crédito:\n${backendMessage}`);
    setStatus({ success: false, error: backendMessage });
  } finally {
    setSubmitting(false);
  }
},
  });
  return formik;
}
