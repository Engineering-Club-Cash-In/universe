import { useFormik } from "formik";
import * as Yup from "yup";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useLead } from "../store/useLead";
import { sendLead } from "../service/serviceLead";

export interface FormLeadsValues {
  nombreCompleto: string;
  correo: string;
  telefono: string;
  dpi: string;
  descripcion: string;
}

const validationSchema = Yup.object({
  nombreCompleto: Yup.string()
    .required("El nombre completo es requerido")
    .test("dos-palabras", "Debes ingresar al menos nombre y apellido", (value) => {
      if (!value) return false;
      const palabras = value.trim().split(/\s+/);
      return palabras.length >= 2 && palabras.every((p) => p.length > 0);
    }),
  correo: Yup.string()
    .email("Correo electrónico inválido")
    .required("El correo es requerido"),
  telefono: Yup.string()
    .matches(/^\d{8}$/, "El número telefónico debe tener 8 dígitos")
    .required("El número telefónico es requerido"),
  dpi: Yup.string()
    .matches(/^\d{13}$/, "El DPI debe tener 13 dígitos")
    .required("El DPI es requerido"),
  descripcion: Yup.string(),
});

const initialValues: FormLeadsValues = {
  nombreCompleto: "",
  correo: "",
  telefono: "",
  dpi: "",
  descripcion: "",
};

export const useFormLeads = () => {
  const setSubmitted = useLead((state) => state.setSubmitted);
  const [serverError, setServerError] = useState<string>("");

  const mutation = useMutation({
    mutationFn: sendLead,
    onSuccess: (data, variables) => {
      console.log("Lead enviado exitosamente:", data);
      setServerError("");
      setSubmitted(variables);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (error: any) => {
      console.error("Error al enviar lead:", error);
      const errorMessage = error?.response?.data?.error || "Error al enviar el formulario";
      setServerError(errorMessage);
    },
  });

  const formik = useFormik<FormLeadsValues>({
    initialValues,
    validationSchema,
    onSubmit: async (values) => {
      mutation.mutate(values);
    },
  });

  return {
    values: formik.values,
    errors: formik.errors,
    touched: formik.touched,
    handleChange: (field: keyof FormLeadsValues) => (value: string) => {
      formik.setFieldValue(field, value);
      if (serverError) setServerError(""); // Limpiar error del servidor al editar
    },
    handleBlur: formik.handleBlur,
    handleSubmit: formik.handleSubmit,
    isValid: formik.isValid,
    isSubmitting: mutation.isPending,
    serverError,
  };
};
