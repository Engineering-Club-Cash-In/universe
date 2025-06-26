/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { useFormik } from "formik";
import { createPago, getCreditoByNumero } from "../services/services";
import { useState } from "react";
export const pagoSchema = z.object({
  credito_id: z.number().int().positive(),
  usuario_id: z.number().int().positive(),
  monto_boleta: z.number().min(0.01),
  fecha_pago: z.string(), // "YYYY-MM-DD"
  llamada: z.string().max(100).optional(),
  renuevo_o_nuevo: z.string().max(50).optional(),
  otros: z.string().optional(),
  mora: z.number().optional(),
  monto_boleta_cuota: z.number().optional(),
  credito_sifco: z.string().max(50).optional(),
  observaciones: z.string().max(500).optional(),
numero_cuota: z.number().int().positive() ,
});

export type PagoFormValues = z.infer<typeof pagoSchema>;


// Helper para usar Zod con Formik
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function zodToFormikValidate(schema: z.ZodSchema<any>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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


export function usePagoForm() {
  const [loadingCredito, setLoadingCredito] = useState(false);
  const [dataCredito, setDataCredito] = useState<any>(null);
  const [errorCredito, setErrorCredito] = useState<string | null>(null);

  // Formik
  const formik = useFormik<PagoFormValues>({
    initialValues: {
      credito_id: 0,
      usuario_id: 0,
      monto_boleta: 0,
      fecha_pago: "",
      llamada: "",
      renuevo_o_nuevo: "",
      otros: "",
      mora: undefined,
      monto_boleta_cuota: undefined,
      credito_sifco: "",
      numero_cuota: 0,
      observaciones: "",
    },
    validate: zodToFormikValidate(pagoSchema),
    onSubmit: async (values, { setSubmitting, setStatus, resetForm }) => {
      try {
        await createPago(values);
        alert("¡Pago registrado correctamente!");
        setStatus({ success: true });
        resetForm();
      } catch (error: any) {
        const backendMessage =
          error?.response?.data?.message || "Error desconocido";
        alert(`No se pudo registrar el pago:\n${backendMessage}`);
        setStatus({ success: false, error: backendMessage });
      } finally {
        setSubmitting(false);
      }
    },
  });

  // Función para buscar crédito y setear los campos
  const fetchCredito = async (numero_credito_sifco: string) => {
    setLoadingCredito(true);
    setErrorCredito(null);
    try {
      const result = await getCreditoByNumero(numero_credito_sifco);
      setDataCredito(result);

      if (result?.creditos && result?.usuarios) {
        // Formatea la fecha de hoy en YYYY-MM-DD
        const today = new Date();
        const fechaHoy = today.toISOString().split("T")[0];

        formik.setValues((prev) => ({
          ...prev,
          credito_id: result.creditos.credito_id,
          usuario_id: result.usuarios.usuario_id,
          credito_sifco: result.creditos.numero_credito_sifco,
          fecha_pago: fechaHoy,
          llamada: "",
        }));
      }
    } catch (err: any) {
      setErrorCredito(err?.response?.data?.message || "Error consultando crédito");
      setDataCredito(null);
    } finally {
      setLoadingCredito(false);
    }
  };

  // El hook retorna formik y el buscador del crédito
  return {
    formik,
    fetchCredito,
    dataCredito,
    loadingCredito,
    errorCredito,
  };
}


 