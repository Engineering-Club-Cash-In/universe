import { useEffect, useState } from "react";
import { registerExternalUser } from "../services/unifiedService";
import { useAuth } from "@/lib";
import { authClient } from "@/lib/auth";

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

export const useProfile = () => {
  const { user } = useAuth();

  const [isLoading, setIsLoading] = useState(true);

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
          // Usar el servicio unificado para registrar en CRM o Cartera
          await registerExternalUser({
            userType: userType,
            fullName: user.name || user.email.split("@")[0],
            email: user.email,
            dpi: dpi,
            phone: phone,
          });

          // Actualizar DPI y role en Better Auth
          await authClient.updateUser({
            dpi: dpi,
            ...(userType === "INVESTOR" && { role: "INVESTOR" }),
          } as any);

          console.log(`${userType} creado exitosamente`);

          // Limpiar parámetros de la URL y recargar
          const newUrl = window.location.pathname;
          window.history.replaceState({}, "", newUrl);
          // NO quitar isLoading aquí porque vamos a recargar
          window.location.reload();
          return; // Salir antes de setIsLoading(false)
        } catch (error) {
          console.error(`Error al crear ${userType}:`, error);
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
  };
};
