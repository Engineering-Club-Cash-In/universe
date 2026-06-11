import { useMutation } from "@tanstack/react-query";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useState } from "react";
import { authClient } from "@/lib/auth";

interface ForgotPasswordValues {
  email: string;
}

const validationSchema = Yup.object({
  email: Yup.string()
    .email("Correo electrónico inválido")
    .required("El correo electrónico es requerido"),
});

export const useForgotPassword = () => {
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [emailSent, setEmailSent] = useState(false);

  const forgotPasswordMutation = useMutation({
    mutationFn: async (email: string) => {
      const { error } = await authClient.requestPasswordReset({
        email,
        redirectTo: `${import.meta.env.VITE_FRONTEND_URL}/reset-password`,
      });

      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      setEmailSent(true);
      setErrorMessage("");
    },
    onError: (error: unknown) => {
      const err = error as { message?: string };
      setErrorMessage(
        err?.message || "Error al enviar el correo. Por favor, intenta de nuevo."
      );
    },
  });

  const formik = useFormik<ForgotPasswordValues>({
    initialValues: {
      email: "",
    },
    validationSchema,
    onSubmit: (values) => {
      setErrorMessage("");
      forgotPasswordMutation.mutate(values.email);
    },
  });

  return {
    formik,
    isLoading: forgotPasswordMutation.isPending,
    errorMessage,
    emailSent,
  };
};
