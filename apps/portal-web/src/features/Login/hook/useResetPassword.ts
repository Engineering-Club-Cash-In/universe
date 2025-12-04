import { useMutation } from "@tanstack/react-query";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useState } from "react";
import { authClient } from "@/lib/auth";
import { useNavigate } from "@tanstack/react-router";

interface ResetPasswordValues {
  password: string;
  confirmPassword: string;
}

// Esquema de validación con Yup
const validationSchema = Yup.object({
  password: Yup.string()
    .min(8, "La contraseña debe tener al menos 8 caracteres")
    .required("La contraseña es requerida"),
  confirmPassword: Yup.string()
    .oneOf([Yup.ref("password")], "Las contraseñas no coinciden")
    .required("Confirmar contraseña es requerido"),
});

export const useResetPassword = (token: string) => {
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  // Mutation para el reset password
  const resetPasswordMutation = useMutation({
    mutationFn: async (newPassword: string) => {
      const { data, error } = await authClient.resetPassword({
        newPassword,
        token,
      });

      if (error) {
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      setSuccessMessage(
        "Tu contraseña ha sido restablecida exitosamente. Redirigiendo al login..."
      );
      setErrorMessage("");
      // Redirigir al login después de 2 segundos
      setTimeout(() => {
        navigate({ to: "/login" });
      }, 2000);
    },
    onError: (error: unknown) => {
      const err = error as { code?: string; message?: string };
      console.error("Reset password error:", err);

      if (err?.code === "INVALID_TOKEN" || err?.code === "TOKEN_EXPIRED") {
        setErrorMessage(
          "El enlace ha expirado o es inválido. Por favor, solicita un nuevo enlace."
        );
      } else {
        setErrorMessage(
          err?.message ||
            "Error al restablecer la contraseña. Por favor, intenta de nuevo."
        );
      }
    },
  });

  // Formik
  const formik = useFormik<ResetPasswordValues>({
    initialValues: {
      password: "",
      confirmPassword: "",
    },
    validationSchema,
    onSubmit: (values) => {
      setErrorMessage("");
      resetPasswordMutation.mutate(values.password);
    },
  });

  return {
    formik,
    isLoading: resetPasswordMutation.isPending,
    errorMessage,
    successMessage,
  };
};
