import { useMutation } from "@tanstack/react-query";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useEffect, useState } from "react";
import type { LoginCredentials } from "@/lib/auth";
import { authClient } from "@/lib/auth";

const REMEMBERED_EMAIL_KEY = "remembered-email";

// Esquema de validación con Yup
const validationSchema = Yup.object({
  email: Yup.string()
    .email("Correo electrónico inválido")
    .required("El correo electrónico es requerido"),
  password: Yup.string()
    .min(6, "La contraseña debe tener al menos 6 caracteres")
    .required("La contraseña es requerida"),
  rememberMe: Yup.boolean(),
});

export const useLogin = () => {
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  // Mutation para el login con better-auth
  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginCredentials) => {
      const result = await authClient.signIn.email({
        email: credentials.email,
        password: credentials.password,
        rememberMe: credentials.rememberMe,
        callbackURL: `${import.meta.env.VITE_FRONTEND_URL}/profile`,
      });
      return result;
    },
  });

  // Formik
  const formik = useFormik<LoginCredentials>({
    initialValues: {
      email: "",
      password: "",
      rememberMe: false,
    },
    validationSchema,
    onSubmit: (values) => {
      loginMutation.mutate(values);
    },
  });

  // Cargar email recordado al montar
  useEffect(() => {
    const rememberedEmail = localStorage.getItem(REMEMBERED_EMAIL_KEY);
    if (rememberedEmail) {
      formik.setFieldValue("email", rememberedEmail);
      formik.setFieldValue("rememberMe", true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGoogleLogin = async () => {
    // Iniciar el flujo de OAuth con better-auth
    try {
      setIsGoogleLoading(true);
      
      // Iniciar el flujo de OAuth con Google
      await authClient.signIn.social({
        provider: "google",
        callbackURL: `${import.meta.env.VITE_FRONTEND_URL}/profile`,
      }, {
        onError: (error) => {
          console.error("Error during Google login:", error);
          setIsGoogleLoading(false);
        }
      });
    } catch (error) {
      console.error("Error during Google login:", error);
      setIsGoogleLoading(false);
    }
  };

  return {
    formik,
    handleGoogleLogin,
    isLoading: loginMutation.isPending,
    isGoogleLoading,
  };
};
