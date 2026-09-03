import { useFormik } from "formik";
import * as Yup from "yup";
import { useRef, useState } from "react";
import type { RegisterCredentials } from "@/lib/auth";
import { authClient } from "@/lib/auth";
import { useNavigate } from "@tanstack/react-router";
import { registerExternalUserAuth } from "@/features/Profile/services/unifiedService";
import { conflictoDeRegistro } from "@/features/Profile/services/registroExterno.errors";

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
  // La cuenta de Better Auth ya se creó en un envío anterior de este mismo
  // formulario.
  const cuentaCreada = useRef(false);
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
    onSubmit: async (values, helpers) => {
      try {
        setIsLoading(true);

        // La cuenta de Better Auth solo se crea una vez. Si el registro externo
        // falló por algo corregible (un DPI ya tomado), el segundo envío tiene
        // que reintentar SOLO esa parte: repetir el alta fallaría con "el
        // correo ya existe" y el usuario quedaría atrapado en el formulario.
        if (!cuentaCreada.current) {
          // El rol y el DPI ya no viajan en el alta: el servidor los escribe
          // después, al validar el registro (registerExternalUserAuth).
          const response = await authClient.signUp.email({
            email: values.email,
            password: values.password,
            name: values.fullName,
            callbackURL: `${import.meta.env.VITE_FRONTEND_URL}/profile`,
          });

          if (!response?.data?.user?.id) {
            return;
          }

          cuentaCreada.current = true;
        }

        // Registrar en CRM o Cartera según tipo. La variante autenticada usa la
        // sesión recién creada y es la que deja el rol y el DPI en la cuenta.
        try {
          await registerExternalUserAuth({
            userType: values.userType,
            fullName: values.fullName,
            email: values.email,
            dpi: values.dpi,
            phone: values.phone,
          });
        } catch (error) {
          console.error("Error al registrar usuario adicional:", error);

          // Un conflicto de DPI no se traga: el servidor lo detecta antes de
          // crear nada en CRM/cartera, así que el usuario puede corregirlo y
          // reintentar. Mandarlo al perfil como si nada le dejaba el correo
          // ocupado por una cuenta sin identidad y sin ninguna señal de qué
          // pasó.
          const conflicto = conflictoDeRegistro(error);

          if (conflicto) {
            helpers.setFieldTouched(conflicto.campo, true, false);
            helpers.setFieldError(conflicto.campo, conflicto.mensaje);
            // El DPI se pide en el primer paso del formulario.
            setCurrentStep(1);
            return;
          }

          // Cualquier otro fallo no detiene el flujo: la cuenta ya existe y el
          // registro externo se puede completar desde el perfil.
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

  // Solo formato. Que el DPI ya esté tomado lo decide el servidor al fijarlo
  // sobre la cuenta (409 en POST /api/profile/me/dpi): preguntarlo antes
  // obligaba a exponer una ruta pública que confirmaba, para cualquier DPI, si
  // estaba registrado.
  const validateDpi = async (): Promise<boolean> => {
    formik.setFieldTouched("userType", true);
    formik.setFieldTouched("dpi", true);

    if (!formik.values.userType) {
      return false;
    }

    if (!formik.values.dpi || !/^[0-9]{13}$/.test(formik.values.dpi)) {
      return false;
    }

    return true;
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
    currentStep,
    nextStep,
    prevStep,
    goToStep,
  };
};
