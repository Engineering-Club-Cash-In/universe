import { useFormik } from "formik";
import * as Yup from "yup";
import { useState } from "react";
import type { RegisterCredentials } from "@/lib/auth";
import { authClient } from "@/lib/auth";

// Esquema de validación con Yup
const validationSchema = Yup.object({
  fullName: Yup.string()
    .min(3, "El nombre debe tener al menos 3 caracteres")
    .required("El nombre completo es requerido"),
  phone: Yup.string().optional(),
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
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

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
    onSubmit: async (values) => {
      try {
        setIsLoading(true);
        await authClient.signUp.email({
          email: values.email,
          password: values.password,
          name: values.fullName,
          callbackURL: `${import.meta.env.VITE_FRONTEND_URL}/profile`,
          // Better-auth no tiene campo phone por defecto, se puede agregar como dato adicional si es necesario
        });
      } catch (error) {
        console.error("Error during registration:", error);
      } finally {
        setIsLoading(false);
      }
    },
  });

  const handleGoogleRegister = async () => {
    try {
      setIsGoogleLoading(true);

      // Iniciar el flujo de OAuth con Google
      await authClient.signIn.social(
        {
          provider: "google",
          callbackURL: `${import.meta.env.VITE_FRONTEND_URL}/profile`,
        },
        {
          onError: (error) => {
            console.error("Error during Google register:", error);
            setIsGoogleLoading(false);
          },
        }
      );
    } catch (error) {
      console.error("Error during Google register:", error);
      setIsGoogleLoading(false);
    }
  };

  return {
    formik,
    handleGoogleRegister,
    isLoading,
    isGoogleLoading,
  };
};
