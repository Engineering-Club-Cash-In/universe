import { useFormik } from "formik";
import * as Yup from "yup";
import { useState } from "react";
import type { RegisterCredentials } from "@/lib/auth";
import { authClient } from "@/lib/auth";
import { useNavigate } from "@tanstack/react-router";
import { sendLead } from "@/features/FormLeads/service/serviceLead";
import { createInvestor } from "@/features/Profile/services/investorService";

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

export const useRegister = () => {
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
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
          role: values.userType, // Enviar el role al backend
        } as any);

        // Si el registro fue exitoso, enviar datos según el tipo de usuario
        if (response?.data?.user?.id) {
          try {
            if (values.userType === "CLIENT") {
              // Para clientes, enviar como lead
              await sendLead({
                nombreCompleto: values.fullName,
                correo: values.email,
                telefono: values.phone,
                dpi: values.dpi,
                descripcion: `Tipo de usuario: ${values.userType}`,
              });
            } else if (values.userType === "INVESTOR") {
              // Para inversionistas, crear en cartera
              await createInvestor({
                nombre: values.fullName,
                dpi: parseInt(values.dpi),
                email: values.email,
                emite_factura: false,
                reinversion: false,
                banco: "",
                tipo_cuenta: "",
                numero_cuenta: "",
              });
            }
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

  const handleGoogleRegister = async () => {
    // Validar que se haya seleccionado el tipo de usuario
    if (!formik.values.userType) {
      formik.setFieldTouched("userType", true);
      formik.setFieldError(
        "userType",
        "Debes seleccionar qué deseas hacer antes de continuar"
      );
      return;
    }

    // Validar que se haya ingresado el DPI
    if (!formik.values.dpi || formik.values.dpi.length !== 13) {
      formik.setFieldTouched("dpi", true);
      formik.setFieldError(
        "dpi",
        "Debes ingresar tu DPI antes de continuar con Google"
      );
      return;
    }

    try {
      setIsGoogleLoading(true);

      // Iniciar el flujo de OAuth con Google
      // Pasar userType, DPI y phone en la URL para procesarlos en useProfile
      await authClient.signIn.social({
        provider: "google",
        callbackURL: `${import.meta.env.VITE_FRONTEND_URL}/profile?userType=${formik.values.userType}&dpi=${formik.values.dpi}&phone=${formik.values.phone}`,
      });
    } catch (error) {
      console.error("Error during Google register:", error);
      setIsGoogleLoading(false);
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
    isLoading,
    isGoogleLoading,
    currentStep,
    nextStep,
    prevStep,
    goToStep,
  };
};
