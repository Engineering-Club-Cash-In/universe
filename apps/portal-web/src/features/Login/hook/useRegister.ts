import { useFormik } from "formik";
import * as Yup from "yup";
import { useState } from "react";
import type { RegisterCredentials } from "@/lib/auth";
import { authClient } from "@/lib/auth";
import { useNavigate } from "@tanstack/react-router";
import { registerExternalUser } from "@/features/Profile/services/unifiedService";
import { apiAuth } from "@/lib/api/apiAuth";

// Esquema de validación con Yup
const validationSchema = Yup.object({
  fullName: Yup.string()
    .min(3, "El nombre debe tener al menos 3 caracteres")
    .required("El nombre completo es requerido"),
  dpi: Yup.string()
    .matches(/^[0-9]{13}$/, "El DPI debe tener 13 dígitos")
    .required("El DPI es requerido"),
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
  userType: Yup.string()
    .oneOf(["CLIENT", "INVESTOR"], "Debes seleccionar un tipo de usuario")
    .required("Debes seleccionar qué deseas hacer"),
});

const checkDpiExists = async (dpi: string): Promise<boolean> => {
  try {
    const response = await apiAuth.get(`/api/profile/check-dpi/${dpi}`);
    return response.data?.data?.exists ?? false;
  } catch {
    return false;
  }
};

export const useRegister = () => {
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingDpi, setIsCheckingDpi] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const navigate = useNavigate();

  // Formik
  const formik = useFormik<RegisterCredentials>({
    initialValues: {
      fullName: "",
      dpi: "",
      phone: "",
      email: "",
      password: "",
      confirmPassword: "",
      acceptTerms: false,
      userType: "CLIENT" as "CLIENT" | "INVESTOR",
    },
    validationSchema,
    onSubmit: async (values) => {
      try {
        setIsLoading(true);
        const response = await authClient.signUp.email({
          email: values.email,
          password: values.password,
          name: values.fullName,
          callbackURL: `${import.meta.env.VITE_FRONTEND_URL}/profile`,
          dpi: values.dpi,
          role: values.userType, // Enviar el role al backend
        } as any);

        // Si el registro fue exitoso, registrar en CRM o Cartera según tipo
        if (response?.data?.user?.id) {
          try {
            await registerExternalUser({
              userType: values.userType,
              fullName: values.fullName,
              email: values.email,
              dpi: values.dpi,
              phone: values.phone,
            });
          } catch (error) {
            console.error("Error al registrar usuario adicional:", error);
            // No detener el flujo si falla, el usuario ya fue registrado en better-auth
          }
        }

        // enviar al profile
        navigate({ to: "/profile" });
      } catch (error) {
        console.error("Error during registration:", error);
      } finally {
        setIsLoading(false);
      }
    },
  });

  const validateDpi = async (): Promise<boolean> => {
    formik.setFieldTouched("userType", true);
    formik.setFieldTouched("dpi", true);

    if (!formik.values.userType) {
      return false;
    }

    if (!formik.values.dpi || !/^[0-9]{13}$/.test(formik.values.dpi)) {
      return false;
    }

    setIsCheckingDpi(true);
    try {
      const exists = await checkDpiExists(formik.values.dpi);
      if (exists) {
        formik.setFieldError("dpi", "Este DPI ya está registrado");
        return false;
      }
      return true;
    } finally {
      setIsCheckingDpi(false);
    }
  };

  const handleGoogleRegister = async () => {
    const isValid = await validateDpi();
    if (!isValid) return;

    try {
      setIsGoogleLoading(true);

      await authClient.signIn.social({
        provider: "google",
        callbackURL: `${import.meta.env.VITE_FRONTEND_URL}/profile?userType=${formik.values.userType}&dpi=${formik.values.dpi}`,
      });
    } catch (error) {
      console.error("Error during Google register:", error);
      setIsGoogleLoading(false);
    }
  };

  const handleNextStep = async () => {
    const isValid = await validateDpi();
    if (isValid) {
      setCurrentStep((prev) => Math.min(prev + 1, 2));
    }
  };

  const nextStep = () => {
    setCurrentStep((prev) => Math.min(prev + 1, 2));
  };

  const prevStep = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const goToStep = (step: number) => {
    setCurrentStep(step);
  };

  return {
    formik,
    handleGoogleRegister,
    handleNextStep,
    isLoading,
    isGoogleLoading,
    isCheckingDpi,
    currentStep,
    nextStep,
    prevStep,
    goToStep,
  };
};
