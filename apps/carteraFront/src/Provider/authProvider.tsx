/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const BACK_URL = import.meta.env.VITE_BACK_URL;

interface User {
  id: number;
  email: string;
  role: "ADMIN" | "ASESOR" | "CONTA";
  asesor_id?: number;
  admin_id?: number;
}

interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoggedIn: boolean;
  loading: boolean;
  login: (user: User, accessToken: string, refreshToken: string) => void;
  logout: () => void;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 🔹 Verificar token al cargar la app
  useEffect(() => {
    const savedAccess = localStorage.getItem("accessToken");
    const savedRefresh = localStorage.getItem("refreshToken");
    const savedUser = localStorage.getItem("user");

    if (savedAccess && savedRefresh && savedUser) {
      // Primero cargamos el refresh token al estado
      setRefreshToken(savedRefresh);

      fetch(`${BACK_URL}/auth/verify?token=${savedAccess}`)
        .then((res) => {
          if (res.status === 401) throw new Error("Token expirado");
          return res.json();
        })
        .then((data) => {
          if (data.success) {
            const newToken = data.accessToken || savedAccess;
            setAccessToken(newToken);
            setUser(JSON.parse(savedUser));
            localStorage.setItem("accessToken", newToken);
          } else {
            throw new Error("Token inválido");
          }
        })
        .catch(async () => {
          // Si falla verify, intentamos refresh
          try {
            const res = await fetch(`${BACK_URL}/auth/refresh`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ refreshToken: savedRefresh }),
            });

            if (!res.ok) throw new Error("Refresh falló");

            const data = await res.json();

            if (data.success) {
              setAccessToken(data.accessToken);
              setRefreshToken(data.refreshToken);
              setUser(JSON.parse(savedUser));
              localStorage.setItem("accessToken", data.accessToken);
              localStorage.setItem("refreshToken", data.refreshToken);
            } else {
              throw new Error("Refresh inválido");
            }
          } catch {
            // Si el refresh también falla, logout
            clearSession();
          }
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  // 🔹 Función auxiliar para limpiar sesión
  const clearSession = () => {
    setUser(null);
    setAccessToken(null);
    setRefreshToken(null);
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
  };

  // 🔹 Login
  const login = (user: User, access: string, refresh: string) => {
    setUser(user);
    setAccessToken(access);
    setRefreshToken(refresh);

    localStorage.setItem("accessToken", access);
    localStorage.setItem("refreshToken", refresh);
    localStorage.setItem("user", JSON.stringify(user));
  };

  // 🔹 Logout + redirección inmediata
  const logout = () => {
    clearSession();
    navigate("/login", { replace: true });
  };

  // 🔹 Refrescar sesión
  const refreshSession = async () => {
    const currentRefreshToken = refreshToken || localStorage.getItem("refreshToken");

    if (!currentRefreshToken) {
      logout();
      return;
    }

    try {
      const res = await fetch(`${BACK_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: currentRefreshToken }),
      });

      if (!res.ok) throw new Error("No se pudo refrescar sesión");

      const data = await res.json();

      if (data.success) {
        setAccessToken(data.accessToken);
        setRefreshToken(data.refreshToken);
        localStorage.setItem("accessToken", data.accessToken);
        localStorage.setItem("refreshToken", data.refreshToken);
      } else {
        logout();
      }
    } catch (error) {
      console.error("Error al refrescar sesión:", error);
      logout();
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        refreshToken,
        isLoggedIn: !!accessToken && !!user,
        loading,
        login,
        logout,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth debe ser usado dentro de un AuthProvider");
  }
  return context;
};