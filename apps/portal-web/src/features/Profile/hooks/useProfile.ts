import { useEffect, useState } from "react";
import { registerExternalUserAuth } from "../services/unifiedService";
import { useAuth } from "@/lib";
import { mensajeDeRegistroFallido } from "@/features/Login/hook/registroPendiente";

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
          await registerExternalUserAuth({
            userType: userType,
            fullName: user.name || user.email.split("@")[0],
            email: user.email,
            dpi: dpi,
            phone: phone,
          });

          console.log(`${userType} creado exitosamente`);

          // Limpiar parámetros de la URL y recargar
          const newUrl = window.location.pathname;
          window.history.replaceState({}, "", newUrl);
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
