import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useFormik } from "formik";
import * as Yup from "yup";
import { authService } from "../services/authService";
import type { RegisterCredentials } from "@/lib/auth";

// Esquema de validación con Yup
const validationSchema = Yup.object({
  fullName: Yup.string()
    .min(3, "El nombre debe tener al menos 3 caracteres")
    .required("El nombre completo es requerido"),
  phone: Yup.string()
    .required("El número telefónico es requerido"),
  email: Yup.string()
    .email("Correo electrónico inválido")
    .required("El correo electrónico es requerido"),
  password: Yup.string()
    .min(8, "La contraseña debe tener al menos 8 caracteres")
    .matches(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Debe contener mayúsculas, minúsculas y números"
    )
    .required("La contraseña es requerida"),
  confirmPassword: Yup.string()
    .oneOf([Yup.ref("password")], "Las contraseñas no coinciden")
    .required("Confirmar contraseña es requerido"),
  acceptTerms: Yup.boolean()
    .oneOf([true], "Debes aceptar los términos y condiciones")
    .required("Debes aceptar los términos y condiciones"),
});

export const useRegister = () => {
  const navigate = useNavigate();

  // Mutation para el registro
  const registerMutation = useMutation({
    mutationFn: authService.register,
    onSuccess: (data) => {
      // Guardar token en localStorage
      localStorage.setItem("auth-token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));

      // Redirigir al perfil
      navigate({ to: "/profile" });
    },
  });

  // Formik
  const formik = useFormik<RegisterCredentials>({
    initialValues: {
      fullName: "",
      phone: "",
      email: "",
      password: "",
      confirmPassword: "",
      acceptTerms: false,
    },
    validationSchema,
    onSubmit: (values) => {
      registerMutation.mutate(values);
    },
  });

  const handleGoogleRegister = () => {
    // TODO: Implementar registro con Google usando better-auth
    console.log("Google register - Por implementar");
  };

  return {
    formik,
    handleGoogleRegister,
    isLoading: registerMutation.isPending,
  };
};
