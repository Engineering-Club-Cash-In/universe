import { useFormik } from "formik";
import * as Yup from "yup";
import { useRef, useState } from "react";
import type { RegisterCredentials } from "@/lib/auth";
import { authClient } from "@/lib/auth";
import { useNavigate } from "@tanstack/react-router";
import { registerExternalUserAuth } from "@/features/Profile/services/unifiedService";
import { conflictoDeRegistro } from "@/features/Profile/services/registroExterno.errors";
import {
  decidirAlta,
  mensajeDeAltaFallida,
  mensajeDeCorreoCambiado,
  mensajeDeRegistroFallido,
} from "./registroPendiente";

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

/**
 * Correo de la sesión abierta, o `null`. Es la prueba, del lado del servidor,
 * de que un intento anterior ya creó la cuenta de Better Auth.
 */
const correoDeLaSesion = async (): Promise<string | null> => {
  try {
    const sesion = await authClient.getSession();
    const correo = sesion?.data?.user?.email;

    return typeof correo === "string" ? correo : null;
  } catch {
    // Sin respuesta del servidor no se puede afirmar que la cuenta exista; se
    // intenta el alta, que es lo que hacía antes.
    return null;
  }
};

export const useRegister = () => {
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  // Correo con el que ESTE formulario ya creó la cuenta, o `null`. Guarda el
  // correo y no un booleano a propósito: con un booleano el reintento se
  // saltaba el alta sin mirar si el formulario seguía llevando ese mismo
  // correo. No es la fuente de verdad —un ref se pierde al recargar, y ahí es
  // donde el registro a medias se quedaba atrapado—, por eso se contrasta
  // también con la sesión. Ver `decidirAlta`.
  const correoDelAlta = useRef<string | null>(null);
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
        // Un intento nuevo parte sin el error del anterior.
        helpers.setStatus(undefined);

        // La cuenta de Better Auth solo se crea una vez. Si el registro externo
        // falló por algo corregible (un DPI ya tomado), el segundo envío tiene
        // que reintentar SOLO esa parte: repetir el alta fallaría con "el
        // correo ya existe" y el usuario quedaría atrapado en el formulario.
        // Si el alta ya ocurrió lo dice el SERVIDOR, no la memoria del
        // componente: tras `signUp.email` la sesión queda abierta y sobrevive a
        // una recarga. Se le pregunta SIEMPRE, también cuando el ref ya sabe
        // que la cuenta existe: ahorrarse esta llamada en el reintento era lo
        // que dejaba el correo del formulario sin comparar con el de la cuenta.
        const correoDeLaCuenta = await correoDeLaSesion();
        const decision = decidirAlta({
          correoDelAlta: correoDelAlta.current,
          correoDeLaSesion: correoDeLaCuenta,
          correoDelFormulario: values.email,
        });

        // El correo del formulario ya no es el de la cuenta creada. No se puede
        // seguir por ninguno de los dos lados: continuar registraría en
        // CRM/cartera el correo viejo (el servidor toma el de la sesión, no el
        // del cuerpo), y crear la cuenta nueva dejaría huérfana la primera. Se
        // corta diciendo con qué correo quedó la cuenta y cómo empezar de
        // nuevo.
        if (decision === "correo_cambiado") {
          helpers.setStatus(
            mensajeDeCorreoCambiado(correoDeLaCuenta ?? correoDelAlta.current ?? ""),
          );
          return;
        }

        if (decision === "crear") {
          // El rol y el DPI ya no viajan en el alta: el servidor los escribe
          // después, al validar el registro (registerExternalUserAuth).
          const response = await authClient.signUp.email({
            email: values.email,
            password: values.password,
            name: values.fullName,
            callbackURL: `${import.meta.env.VITE_FRONTEND_URL}/profile`,
          });

          if (!response?.data?.user?.id) {
            // Un alta fallida ya no se traga en silencio. El caso normal aquí
            // es el correo ocupado por un registro anterior a medias, y su
            // salida es iniciar sesión: el formulario de completar perfil
            // termina la identidad (y muestra el selector de tipo, porque un
            // CLIENT sin DPI no cuenta como rol elegido).
            helpers.setStatus(mensajeDeAltaFallida(response));
            return;
          }
        }

        correoDelAlta.current = values.email;

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

          // Ningún fallo se traga. Esta llamada es la ÚNICA que escribe el rol
          // y el DPI de la cuenta, así que mandar al perfil como si nada dejaba
          // al usuario con el rol por defecto (CLIENT) y sin DPI: quien pidió
          // ser inversionista quedaba clasificado como cliente sin enterarse.
          // Se queda en el formulario, con su tipo elegido intacto, y puede
          // reintentar — el alta de Better Auth ya no se repite.
          // El motivo sale del mismo sitio que el del camino de Google: los dos
          // mueren en esta llamada y no tiene sentido que digan cosas
          // distintas.
          helpers.setStatus(mensajeDeRegistroFallido(error));
          return;
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
