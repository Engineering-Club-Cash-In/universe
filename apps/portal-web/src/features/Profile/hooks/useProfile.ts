import { useEffect, useState } from "react";
import { registerExternalUserAuth } from "../services/unifiedService";
import { useAuth } from "@/lib";
import { mensajeDeRegistroFallido } from "@/features/Login/hook/registroPendiente";
import { mensajeDeDpiPendiente } from "../services/registroSinDpi";
import {
  avisoDpiPendienteVigente,
  recordarSiQuedoSinDpi,
} from "../services/avisoDpiPendiente";

interface UserData {
  id: string;
  email: string;
  name?: string;
  phone?: string;
  dpi?: string;
  role: "CLIENT" | "INVESTOR";
  image?: string;
  cachedImage?: string;
}

/**
 * Registro por Google que llegó al perfil sin terminar.
 *
 * `register-external-auth` es la única llamada que escribe el rol y el DPI. Si
 * muere —el caso normal es un DPI ya tomado por otra cuenta— la persona se
 * queda con una cuenta a medias, y lo que sabemos del intento (qué pidió ser y
 * por qué falló) solo existe aquí. Antes esto era un `console.error`: el
 * formulario de recuperación aparecía mudo y puesto en CLIENT, así que quien
 * pidió invertir se reinscribía como cliente sin enterarse.
 */
export type RegistroPendiente = {
  tipoSolicitado: "CLIENT" | "INVESTOR";
  mensaje: string;
  /**
   * El registro NO falló: salió 200 pero el servidor se negó a escribir el DPI
   * porque la ficha la abrió un asesor. No es un error de la persona y no hay
   * nada que corregir, así que el formulario lo muestra en su bloque de espera
   * y no en el de error. Ver `registroQuedoSinDpi`.
   */
  dpiPendiente?: boolean;
};

export const useProfile = () => {
  const { user } = useAuth();

  const [isLoading, setIsLoading] = useState(true);
  const [registroPendiente, setRegistroPendiente] =
    useState<RegistroPendiente | null>(null);

  // Crear lead o investor según parámetros de URL (para registro con Google)
  useEffect(() => {
    const createUserFromURLParams = async () => {
      if (!user) return;

      if (user) await cacheProfileImage(user);

      // Leer parámetros de la URL
      const urlParams = new URLSearchParams(window.location.search);
      const userType = urlParams.get("userType") as
        | "CLIENT"
        | "INVESTOR"
        | null;
      const dpi = urlParams.get("dpi");
      const phone = urlParams.get("phone") || "";

      // Si hay parámetros de registro, crear el usuario correspondiente
      // PERO solo si el usuario NO tiene DPI todavía (es decir, es un registro nuevo)
      if (userType && dpi && !user.dpi) {
        console.log(`Creando usuario tipo ${userType} desde OAuth`);
        // Mantener isLoading en true mientras se procesa y recarga
        try {
          // Servicio unificado (variante autenticada): registra en CRM o
          // Cartera y, ya del lado del servidor, deja el DPI y el rol en la
          // cuenta de la sesión. El cliente ya no los escribe.
          const resultado = await registerExternalUserAuth({
            userType: userType,
            fullName: user.name || user.email.split("@")[0],
            email: user.email,
            dpi: dpi,
            phone: phone,
          });

          // Limpiar parámetros de la URL: ya se consumieron y no deben volver a
          // dispararse en la recarga.
          const newUrl = window.location.pathname;
          window.history.replaceState({}, "", newUrl);

          // Un 200 no siempre deja DPI en la cuenta. Recargar aquí aterrizaba
          // en el formulario de completar perfil sin decir nada —el mismo punto
          // ciego que tenía el formulario— y la persona daba una vuelta muda
          // antes de entrar al bucle. Se corta la recarga y el motivo viaja con
          // ella hasta el formulario.
          // El aviso se DEJA GUARDADO antes de pintarlo. Solo en el estado de
          // React moría con la primera recarga, y como la cuenta sigue siendo
          // CLIENT y sin DPI, `Profile.tsx` volvía a sacar el formulario en
          // blanco, sin explicación y dejando reenviar el mismo DPI para nada.
          // El ciclo de vida (cuándo se apaga) vive en `avisoDpiPendiente`.
          if (
            recordarSiQuedoSinDpi({
              respuesta: resultado,
              correo: user.email,
              tipoSolicitado: userType,
            })
          ) {
            setRegistroPendiente({
              tipoSolicitado: userType,
              mensaje: mensajeDeDpiPendiente(user.email),
              dpiPendiente: true,
            });
            setIsLoading(false);
            return;
          }

          console.log(`${userType} creado exitosamente`);

          // NO quitar isLoading aquí porque vamos a recargar
          window.location.reload();
          return; // Salir antes de setIsLoading(false)
        } catch (error) {
          console.error(`Error al crear ${userType}:`, error);

          // El fallo se le muestra a la persona y su elección sobrevive hasta
          // el formulario de recuperación, igual que en el registro por correo.
          // Los parámetros de la URL se dejan como están a propósito: son lo
          // único que conserva la intención si recarga la página.
          setRegistroPendiente({
            tipoSolicitado: userType,
            mensaje: mensajeDeRegistroFallido(error),
          });
          setIsLoading(false);
        }
      } else {
        // Solo limpiar URL si no hay parámetros de registro
        const newUrl = window.location.pathname;
        window.history.replaceState({}, "", newUrl);

        // Sin parámetros en la URL se llega aquí por una recarga, por volver al
        // perfil o por el registro con correo, que ya navegó. Si un intento
        // anterior quedó sin DPI, el aviso se recupera y la persona ve por qué
        // le siguen pidiendo el dato, en vez del formulario mudo.
        // `avisoDpiPendienteVigente` es el que decide si sigue vigente: en
        // cuanto el asesor pone el DPI, deja de devolverlo y se borra solo.
        const aviso = avisoDpiPendienteVigente({ usuario: user });

        setRegistroPendiente(
          aviso
            ? {
                tipoSolicitado: aviso.tipoSolicitado,
                mensaje: mensajeDeDpiPendiente(aviso.correo),
                dpiPendiente: true,
              }
            : null,
        );
        setIsLoading(false);
      }
    };

    createUserFromURLParams();
  }, [user]);

  // Función para cachear imagen de perfil
  const cacheProfileImage = async (userData: UserData) => {
    if (!userData.image) return;

    const cachedImageKey = `user_image_${userData.id}`;
    const cachedImage = localStorage.getItem(cachedImageKey);

    if (cachedImage) return;

    try {
      const response = await fetch(userData.image);
      const blob = await response.blob();

      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result as string;
        localStorage.setItem(cachedImageKey, base64data);
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error("Error caching image:", error);
    }
  };

  return {
    user,
    isLoading,
    registroPendiente,
  };
};
