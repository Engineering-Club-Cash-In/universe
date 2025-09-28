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

  seguro_10_cuotas: z.number().min(0),
  gps: z.number().min(0),
  observaciones: z.string().max(1000),
  no_poliza: z.string().max(1000),
  como_se_entero: z.string().max(100),
  asesor: z.string().max(1000),
  plazo: z.number().int().min(1).max(360),
  cuota: z.number().min(0),
  membresias_pago: z.number().min(0),
  cuota_interes: z.number().min(0).optional(),
  categoria: z.string().max(1000),

  nit: z.string().max(1000),
  otros: z.number().max(10000),
  porcentaje_royalti: z.number().min(0),
  royalti: z.number().min(0),
  reserva: z.number().min(0), // 👈 Aquí
  inversionistas: z
    .array(
      z.object({
        inversionista_id: z.number().min(1, "Seleccione un inversionista"),
        monto_aportado: z.number().positive("Monto debe ser mayor a 0"),
        porcentaje_cash_in: z.number().min(0).max(100),
        porcentaje_inversion: z.number().min(0).max(100),
        cuota_inversionista: z.number().min(0).optional(),
      })
    )
    .min(1, "Debe agregar al menos un inversionista"),
  rubros: z
    .array(
      z.object({
        nombre_rubro: z.string().max(100),
        monto: z.number().min(0),
      })
    )
    .optional()
    .default([]),
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

      seguro_10_cuotas: 0,
      gps: 0,
      observaciones: "",
      no_poliza: "",
      como_se_entero: "",
      asesor: "",
      plazo: 1,
      cuota: 0,
      membresias_pago: 0,
      cuota_interes: 0,
      categoria: "",
      nit: "",
      royalti: 0,
      porcentaje_royalti: 0,
      otros: 0,
      reserva: 0,
      inversionistas: [],
      rubros: [],
      ...initialValues,
    },

    validate: zodToFormikValidate(creditSchema),
    onSubmit: async (values, { setSubmitting, setStatus, resetForm }) => {
      try {
        console.log("Enviando datos del crédito:", values);
        await createCredit(values);
        formik.resetForm();
        resetForm({
          values: {
            ...formik.initialValues,
            rubros: [],
            otros: 0,
          },
        });
        alert("¡Crédito creado correctamente!");
        setStatus({ success: true });
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
