import { NavBar } from "@components/ui";
import { useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { authClient } from "@/lib/auth";
import { InfoPerson } from "./InfoPerson";
import { Menu } from "../components/Menu";

interface UserData {
  id: string;
  email: string;
  name?: string;
  phone?: string;
  image?: string;
}

export const Profile = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadUserSession = async () => {
      try {
        // Obtener la sesión directamente de better-auth
        const sessionData = await authClient.getSession();

        if (sessionData?.data?.user) {
          const userData = sessionData.data.user as UserData;
          setUser({
            id: userData.id,
            email: userData.email,
            name: userData.name,
            phone: userData.phone, // Si el backend lo tiene\
            image: userData.image,
          });
        } else {
          // Si no hay sesión, redirigir al login
          navigate({ to: "/login" });
        }
      } catch (error) {
        console.error("Error loading session:", error);
        navigate({ to: "/login" });
      } finally {
        setIsLoading(false);
      }
    };

    loadUserSession();
  }, [navigate]);


  if (isLoading) {
    return (
      <div>
        <div className="w-full mt-4 p-8">
          <NavBar />
          <div className="max-w-4xl mx-auto mt-16 mb-20">
            <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8">
              <div className="flex justify-center items-center py-12">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="w-full mt-4 p-8">
        <NavBar />
        <Menu />
        <div className="max-w-7xl mx-auto mt-16 mb-20">
          {/* Header - Mi Perfil */}
          <div className="mb-12">
            <h1 className="text-header-2 mb-6">Mi Perfil</h1>

            <div className="flex items-center gap-6">
              {/* Imagen de perfil */}
              <div className="w-24 h-24 rounded-full bg-primary/20 flex items-center justify-center text-primary text-3xl font-bold">
                {user?.image ? (
                  <img
                    src={user.image}
                    alt="Imagen de perfil"
                    className="w-full h-full object-cover rounded-full"
                  />
                ) : (
                  user?.name?.charAt(0).toUpperCase() ||
                  user?.email.charAt(0).toUpperCase()
                )}
              </div>

              {/* Información básica */}
              <div>
                <p className="text-header-4 mb-2">{user?.name || "Usuario"}</p>
                <p className="text-gray text-lg">{user?.email}</p>
              </div>
            </div>
          </div>
          {user && (
            <div className="space-y-6">
              <InfoPerson
                userId={user.id}
                userName={user.name}
                userEmail={user.email}
                userImage={user.image}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
