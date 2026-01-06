import { useEffect, useState } from "react";
import { sendLead } from "@/features/FormLeads/service/serviceLead";
import { createInvestor } from "../services/investorService";
import { useAuth } from "@/lib";

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
      if (userType && dpi) {
        console.log(`Creando usuario tipo ${userType} desde OAuth`);
        try {
          if (userType === "CLIENT") {
            // Para clientes, enviar como lead
            await sendLead({
              nombreCompleto: user.name || user.email.split("@")[0],
              correo: user.email,
              telefono: phone,
              dpi: dpi,
              descripcion: `Tipo de usuario: ${userType}`,
            });
            console.log("Lead creado exitosamente");
          } else if (userType === "INVESTOR") {
            // Para inversionistas, crear en cartera
            await createInvestor({
              nombre: user.name || user.email.split("@")[0],
              dpi: parseInt(dpi),
              email: user.email,
              emite_factura: false,
              reinversion: false,
              banco: "",
              tipo_cuenta: "",
              numero_cuenta: "",
            });
            console.log("Investor creado exitosamente");
          }

          // Limpiar parámetros de la URL
          const newUrl = window.location.pathname;
          window.history.replaceState({}, "", newUrl);
        } catch (error) {
          console.error(`Error al crear ${userType}:`, error);
        }
      }

      setIsLoading(false);
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
    isLoading
  };
};
