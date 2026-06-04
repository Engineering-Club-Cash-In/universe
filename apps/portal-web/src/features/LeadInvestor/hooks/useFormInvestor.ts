import { useFormik } from "formik";
import * as Yup from "yup";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { sendLeadInvestor } from "../service/serviceLeadInvestor";

export type ProfileType = "individual" | "juridica";

export interface FormInvestorValues {
  profileType: ProfileType | "";
  nombreCompleto: string;
  nombreSociedad: string;
  representanteLegal: string;
  dpi: string;
  correo: string;
  telefono: string;
  experiencia: string;
  proposedAmount: string;
  mensaje: string;
}

const validationSchema = Yup.object({
  profileType: Yup.string()
    .oneOf(["individual", "juridica"], "Selecciona un tipo de perfil")
    .required("El tipo de perfil es requerido"),
  nombreCompleto: Yup.string().when("profileType", {
    is: "individual",
    then: (schema) =>
      schema
        .required("El nombre completo es requerido")
        .test("dos-palabras", "Debes ingresar al menos nombre y apellido", (value) => {
          if (!value) return false;
          const palabras = value.trim().split(/\s+/);
          return palabras.length >= 2 && palabras.every((p) => p.length > 0);
        }),
    otherwise: (schema) => schema.notRequired(),
  }),
  nombreSociedad: Yup.string().when("profileType", {
    is: "juridica",
    then: (schema) => schema.required("El nombre de sociedad es requerido"),
    otherwise: (schema) => schema.notRequired(),
  }),
  representanteLegal: Yup.string().when("profileType", {
    is: "juridica",
    then: (schema) => schema.required("El nombre del representante legal es requerido"),
    otherwise: (schema) => schema.notRequired(),
  }),
  dpi: Yup.string().when("profileType", {
    is: "individual",
    then: (schema) =>
      schema
        .matches(/^\d{13}$/, "El DPI debe tener 13 dígitos sin espacios")
        .test("solo-numeros", "Solo se permiten números", (value) => {
          if (!value) return true;
          return /^\d+$/.test(value);
        })
        .required("El DPI es requerido"),
    otherwise: (schema) => schema.notRequired(),
  }),
  correo: Yup.string()
    .email("Correo electrónico inválido")
    .required("El correo es requerido"),
  telefono: Yup.string()
    .matches(/^\d{8}$/, "El número telefónico debe tener 8 dígitos sin espacios")
    .test("solo-numeros", "Solo se permiten números", (value) => {
      if (!value) return true;
      return /^\d+$/.test(value);
    })
    .required("El número telefónico es requerido"),
  experiencia: Yup.string().required("Selecciona tu experiencia en inversión"),
  proposedAmount: Yup.string().required("Selecciona un monto a invertir"),
  mensaje: Yup.string(),
});

const VALID_AMOUNTS = ["25000", "50000", "100000", "250000", "500000", "1000000"];

const buildInitialValues = (amount?: string, defaultMessage?: string): FormInvestorValues => ({
  profileType: "individual",
  nombreCompleto: "",
  nombreSociedad: "",
  representanteLegal: "",
  dpi: "",
  correo: "",
  telefono: "",
  experiencia: "",
  proposedAmount: amount && VALID_AMOUNTS.includes(amount) ? amount : "",
  mensaje: defaultMessage || "",
});

export const useFormInvestor = (
  initialAmount?: string,
  defaultMessage?: string,
  source?: string,
  campaign?: string
) => {
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string>("");

  const mutation = useMutation({
    mutationFn: (values: FormInvestorValues) =>
      sendLeadInvestor(values, source, campaign),
    onSuccess: (data) => {
      console.log("Lead investor enviado exitosamente:", data);
      setServerError("");
      navigate({ to: "/thanks", search: { type: "investor" } });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (error: any) => {
      console.error("Error al enviar lead investor:", error);
      const errorMessage = error?.response?.data?.error || "Error al enviar el formulario";
      setServerError(errorMessage);
    },
  });

  const formik = useFormik<FormInvestorValues>({
    initialValues: buildInitialValues(initialAmount, defaultMessage),
    validationSchema,
    onSubmit: async (values) => {
      mutation.mutate(values);
    },
  });

  return {
    values: formik.values,
    errors: formik.errors,
    touched: formik.touched,
    handleChange: (field: keyof FormInvestorValues) => (value: string) => {
      formik.setFieldValue(field, value);
      if (serverError) setServerError("");
    },
    setFieldValue: formik.setFieldValue,
    setFieldTouched: formik.setFieldTouched,
    handleBlur: formik.handleBlur,
    handleSubmit: formik.handleSubmit,
    isValid: formik.isValid,
    isSubmitting: mutation.isPending,
    serverError,
  };
};
