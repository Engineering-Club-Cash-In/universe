import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useEffect } from "react";
import { authService } from "../services/authService";
import type { LoginCredentials } from "@/lib/auth";

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
  const navigate = useNavigate();

  // Mutation para el login
  const loginMutation = useMutation({
    mutationFn: authService.login,
    onSuccess: (data, variables) => {
      // Guardar token en localStorage
      localStorage.setItem("auth-token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));

      // Recordar usuario si está activado
      if (variables.rememberMe) {
        localStorage.setItem(REMEMBERED_EMAIL_KEY, variables.email);
      } else {
        localStorage.removeItem(REMEMBERED_EMAIL_KEY);
      }

      // Redirigir al perfil
      navigate({ to: "/profile" });
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

  const handleGoogleLogin = () => {
    // TODO: Implementar login con Google usando better-auth
    console.log("Google login - Por implementar");
  };

  return {
    formik,
    handleGoogleLogin,
    isLoading: loginMutation.isPending,
  };
};
