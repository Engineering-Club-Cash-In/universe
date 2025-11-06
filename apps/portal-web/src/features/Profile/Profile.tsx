import { NavBar } from "@components/ui";
import { Footer } from "@features/footer";
import { useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { authClient } from "@/lib/auth";

interface UserData {
  id: string;
  email: string;
  name?: string;
  phone?: string;
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
            phone: userData.phone, // Si el backend lo tiene
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

  const handleLogout = async () => {
    try {
      // Cerrar sesión con better-auth
      await authClient.signOut();
      
      // Limpiar localStorage (solo el token de recordar email)
      localStorage.removeItem("remembered-email");
      
      // Redirigir al login
      navigate({ to: "/login" });
    } catch (error) {
      console.error("Error during logout:", error);
      navigate({ to: "/login" });
    }
  };

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
        <Footer />
      </div>
    );
  }

  return (
    <div>
      <div className="w-full mt-4 p-8">
        <NavBar />
        <div className="max-w-4xl mx-auto mt-16 mb-20">
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8">
            <h1 className="text-header-1 mb-8">Perfil de Usuario</h1>
            
            {user && (
              <div className="space-y-6">
                <div className="border-b border-white/10 pb-4">
                  <p className="text-sm text-white/65 mb-2">Nombre</p>
                  <p className="text-body">{user.name || "No disponible"}</p>
                </div>
                
                <div className="border-b border-white/10 pb-4">
                  <p className="text-sm text-white/65 mb-2">Email</p>
                  <p className="text-body">{user.email}</p>
                </div>
                
                <div className="border-b border-white/10 pb-4">
                  <p className="text-sm text-white/65 mb-2">ID de Usuario</p>
                  <p className="text-body font-mono">{user.id}</p>
                </div>
                
                <div className="pt-4">
                  <button
                    onClick={handleLogout}
                    className="px-6 py-3 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 rounded-full text-red-400 font-semibold transition-all"
                  >
                    Cerrar sesión
                  </button>
                </div>
              </div>
            )}
            
            <div className="mt-8 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <p className="text-sm text-blue-300">
                ℹ️ Esta es una página protegida. Solo los usuarios autenticados pueden acceder.
              </p>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
};
