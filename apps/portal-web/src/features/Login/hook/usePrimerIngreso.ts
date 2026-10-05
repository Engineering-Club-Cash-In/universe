import { useMutation } from "@tanstack/react-query";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { authClient } from "@/lib/auth";
import type { ValoresNuevaPassword } from "../components/FormularioNuevaPassword";

/**
 * Primer ingreso: cambiar la contraseña que le generamos por una suya.
 *
 * Usa `changePassword` y no el camino del enlace por correo, y eso es a
 * propósito: quien llega acá ya entró, así que mandarle un correo para que
 * vuelva sería un rodeo. Better Auth pide la contraseña actual, que en este
 * caso es la temporal que le mandamos, y eso es exactamente la prueba que hace
 * falta — tener la sesión abierta no debería alcanzar para cambiarle la
 * contraseña a nadie.
 *
 * Se pide escribirla de nuevo en vez de arrastrarla desde el login porque el
 * login termina en una recarga completa de la página (Better Auth redirige con
 * `callbackURL`): lo que estuviera en memoria se pierde ahí. Guardarla en
 * `localStorage` para que sobreviva sería dejar una contraseña en claro en el
 * navegador, que es justo lo que esta pantalla viene a terminar.
 *
 * `revokeOtherSessions` cierra todo lo demás: si esa contraseña temporal quedó
 * en un correo reenviado y alguien más la usó, esa sesión se cae acá.
 */

const validationSchema = Yup.object({
  passwordActual: Yup.string().required("La contraseña temporal es requerida"),
  password: Yup.string()
    .min(8, "La contraseña debe tener al menos 8 caracteres")
    .notOneOf(
      [Yup.ref("passwordActual")],
      "Elegí una contraseña distinta a la temporal",
    )
    .required("La contraseña es requerida"),
  confirmPassword: Yup.string()
    .oneOf([Yup.ref("password")], "Las contraseñas no coinciden")
    .required("Confirmar contraseña es requerido"),
});

export const usePrimerIngreso = () => {
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  const cambiarPassword = useMutation({
    mutationFn: async (valores: {
      passwordActual: string;
      password: string;
    }) => {
      const { data, error } = await authClient.changePassword({
        currentPassword: valores.passwordActual,
        newPassword: valores.password,
        revokeOtherSessions: true,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setSuccessMessage("Listo, tu contraseña quedó guardada. Un momento...");
      setErrorMessage("");
      // Recarga completa y no `navigate`: la sesión trae la marca de primer
      // ingreso y el servidor acaba de limpiarla. Sin volver a pedirla, el
      // guard leería la de antes y devolvería a esta misma pantalla.
      setTimeout(() => {
        window.location.assign("/profile");
      }, 1200);
    },
    onError: (error: unknown) => {
      const err = error as { code?: string; message?: string };

      if (err?.code === "INVALID_PASSWORD") {
        setErrorMessage(
          "La contraseña temporal no es correcta. Copiala del correo que te enviamos.",
        );
        return;
      }

      setErrorMessage(
        err?.message ||
          "No se pudo cambiar la contraseña. Por favor, intentá de nuevo.",
      );
    },
  });

  const formik = useFormik<ValoresNuevaPassword>({
    initialValues: {
      passwordActual: "",
      password: "",
      confirmPassword: "",
    },
    validationSchema,
    onSubmit: (values) => {
      setErrorMessage("");
      cambiarPassword.mutate({
        passwordActual: values.passwordActual ?? "",
        password: values.password,
      });
    },
  });

  const cerrarSesion = async () => {
    await authClient.signOut();
    navigate({ to: "/login" });
  };

  return {
    formik,
    isLoading: cambiarPassword.isPending,
    errorMessage,
    successMessage,
    cerrarSesion,
  };
};
