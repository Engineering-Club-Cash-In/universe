/* eslint-disable @typescript-eslint/no-explicit-any */
// src/hooks/useCreditForm.ts
import { useFormik } from "formik";

import { z } from "zod";
import { createCredit } from "../services/services";
import { getApiErrorMessage } from "@/lib/apiError";
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
  asesor_id: z.number().int().positive({ message: "Debe seleccionar un asesor" }),
  plazo: z.number().int().min(1).max(360),
  cuota: z.number().min(0),
  dia_pago_mensual: z.number().int().min(1).max(31),
  membresias_pago: z.number().min(0),
  porcentaje_royalti: z.number().min(0),
  royalti: z.number().min(0),
  categoria: z.string().max(1000),
  nit: z.string().max(1000),
  otros: z.number().min(0),
  reserva: z.number().min(0),

  // Campos opcionales de dirección del usuario
  direccion: z.string().max(300).optional().nullable(),
  municipio: z.string().max(100).optional().nullable(),
  departamento: z.string().max(100).optional().nullable(),
  codigo_postal: z.string().max(10).optional().nullable(),
  pais: z.string().optional().nullable(),

  // Información del vehículo, monto asegurado y opportunity_id (Opcionales para el correo)
  vehiculo_marca: z.string().optional(),
  vehiculo_linea: z.string().optional(),
  vehiculo_modelo: z.string().optional(),
  vehiculo_placa: z.string().optional(),
  monto_asegurado: z.number().min(0).optional(),
  opportunity_id: z.string().optional(),

  inversionistas: z
    .array(
      z.object({
        inversionista_id: z.number().int().positive(),
        monto_aportado: z.number().nonnegative("Monto no puede ser negativo"),
        porcentaje_cash_in: z.number().min(0).max(100),
        porcentaje_inversion: z.number().min(0).max(100),
        tipo_inversion: z.enum(["compra_cartera", "reinversion"]).optional(),
        fecha_inicio_participacion: z.string().optional(),
      })
    )
    .min(0),
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
      asesor_id: 0,
      plazo: 1,
      cuota: 0,
      dia_pago_mensual: 15,
      membresias_pago: 0,
      porcentaje_royalti: 0,
      royalti: 0,
      categoria: "",
      nit: "",
      otros: 0,
      reserva: 0,
      direccion: "",
      municipio: "",
      departamento: "",
      codigo_postal: "",
      pais: "",
      vehiculo_marca: "",
      vehiculo_linea: "",
      vehiculo_modelo: "",
      vehiculo_placa: "",
      monto_asegurado: 0,
      opportunity_id: "",
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
        const backendMessage = getApiErrorMessage(error, "No se pudo crear el crédito");
        alert(backendMessage);
        setStatus({ success: false, error: backendMessage });
      } finally {
        setSubmitting(false);
      }
    },
  });
  return formik;
}
