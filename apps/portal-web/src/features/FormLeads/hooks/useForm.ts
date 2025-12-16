import { useFormik } from "formik";
import * as Yup from "yup";
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
  nombreCompleto: Yup.string().required("El nombre completo es requerido"),
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

  const formik = useFormik<FormLeadsValues>({
    initialValues,
    validationSchema,
    onSubmit: async (values) => {
      try {
        await sendLead(values);
        setSubmitted(values);
      } catch (error) {
        console.error("Error al enviar:", error);
        // Aunque falle, marcamos como enviado para demo
        setSubmitted(values);
      }
    },
  });

  return {
    values: formik.values,
    errors: formik.errors,
    touched: formik.touched,
    handleChange: (field: keyof FormLeadsValues) => (value: string) => {
      formik.setFieldValue(field, value);
    },
    handleBlur: formik.handleBlur,
    handleSubmit: formik.handleSubmit,
    isValid: formik.isValid,
    isSubmitting: formik.isSubmitting,
  };
};
