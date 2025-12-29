import { useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/auth";
import { sendLead } from "@/features/FormLeads/service/serviceLead";
import { getProfile, getNumbersSifco } from "../services/profileService";
import { useStoreProfile } from "../store/useStoreProfile";

interface UserData {
  id: string;
  email: string;
  name?: string;
  phone?: string;
  image?: string;
  cachedImage?: string;
}

export const useProfile = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");
  const [leadVerified, setLeadVerified] = useState(false);
  const { setOpportunities, opportunities } = useStoreProfile();

  // Query para obtener perfil (con cache automático)
  const { data: profileData, error: profileError } = useQuery({
    queryKey: ["profile", userEmail],
    queryFn: () => getProfile(userEmail, sessionToken),
    enabled: !!userEmail && !!sessionToken,
    staleTime: 5 * 60 * 1000, // Cache por 5 minutos
    retry: false,
  });

  // Crear lead si no existe (solo cuando hay error 404)
  useEffect(() => {
    const createLeadIfNeeded = async () => {
      if (!profileError || leadVerified || !user) return;

      const error = profileError as any;
      const isLeadNotFound =
        error?.status === 404 && error?.data?.error === "Lead no encontrado";

      if (isLeadNotFound) {
        console.log("Lead no encontrado, creando nuevo lead");
        try {
          await sendLead({
            nombreCompleto: user.name || user.email.split("@")[0],
            correo: user.email,
            telefono: "",
            dpi: "",
            descripcion: "Registro mediante Google OAuth",
          });
          console.log("Lead creado exitosamente");
          setLeadVerified(true);
        } catch (leadError) {
          console.error("Error al crear lead:", leadError);
        }
      }
    };

    createLeadIfNeeded();
  }, [profileError, leadVerified, user]);

  // Query para obtener números SIFCO (con cache automático)
  const { data: sifcoNumbers } = useQuery({
    queryKey: ["sifco-numbers", profileData?.dpi],
    queryFn: () => getNumbersSifco(profileData!.dpi!, sessionToken),
    enabled: !!profileData?.dpi && !!sessionToken && opportunities.length === 0,
    staleTime: 10 * 60 * 1000, // Cache por 10 minutos
    retry: false,
  });

  // Guardar números SIFCO en el store cuando se cargan
  useEffect(() => {
    if (sifcoNumbers && sifcoNumbers.length > 0 && opportunities.length === 0) {
      setOpportunities(sifcoNumbers);
      console.log("Números SIFCO cargados:", sifcoNumbers);
    }
  }, [sifcoNumbers, setOpportunities, opportunities.length]);

  // Verificar lead solo cuando profileData cambia y aún no se ha verificado
  useEffect(() => {
    if (profileData && !leadVerified && userEmail && sessionToken) {
      console.log("Lead ya existe para este usuario");
      setLeadVerified(true);
    }
  }, [profileData, leadVerified, userEmail, sessionToken]);

  useEffect(() => {
    const loadUserSession = async () => {
      try {
        const sessionData = await authClient.getSession();

        if (!sessionData?.data?.user) {
          navigate({ to: "/login" });
          return;
        }

        const userData = sessionData.data.user as UserData;
        const token = sessionData.data.session.token;

        // Establecer email y token para activar las queries
        setUserEmail(userData.email);
        setSessionToken(token);

        // Cachear imagen de perfil si existe
        await cacheProfileImage(userData);

        // Establecer datos del usuario
        setUser({
          id: userData.id,
          email: userData.email,
          name: userData.name,
          phone: userData.phone,
          image: userData.image,
          cachedImage: localStorage.getItem(`user_image_${userData.id}`) || undefined,
        });

        setIsLoading(false);
      } catch (error) {
        console.error("Error loading session:", error);
        navigate({ to: "/login" });
        setIsLoading(false);
      }
    };

    loadUserSession();
  }, [navigate]);

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
    profileData,
  };
};
