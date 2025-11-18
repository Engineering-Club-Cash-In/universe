/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect } from "react";

// 🔥 Constante global para la URL del backend
const BACK_URL = import.meta.env.VITE_BACK_URL || "https://qk4sw4kc4c088c8csos400wc.s3.devteamatcci.site";

console.log("🔍 Backend URL configurada:", BACK_URL);

interface User {
  id: number;
  email: string;
  role: "ADMIN" | "ASESOR";
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
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 🔹 Verificar token al cargar la app
  useEffect(() => {
    
    const savedAccess = localStorage.getItem("accessToken");
    const savedRefresh = localStorage.getItem("refreshToken");
    const savedUser = localStorage.getItem("user");

    if (savedAccess && savedRefresh) {
      fetch(`${BACK_URL}/auth/verify?token=${savedAccess}`)
        .then((res) => {
          if (res.status === 401) throw new Error("Token expirado");
          return res.json();
        })
        .then((data) => {
          if (data.success) {
            setAccessToken(savedAccess);
            setRefreshToken(savedRefresh);
            if (savedUser) setUser(JSON.parse(savedUser));
            else if (data.data) setUser(data.data);
          } else {
            console.warn("Token inválido:", data.error);
            refreshSession();
          }
        })
        .catch(() => refreshSession())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  // 🔹 Login
  const login = (user: User, access: string, refresh: string) => {
    setUser(user);
    
    setAccessToken(access);
    setRefreshToken(refresh);

    localStorage.setItem("accessToken", access);
    localStorage.setItem("refreshToken", refresh);
    localStorage.setItem("user", JSON.stringify(user));
  };

  // 🔹 Logout
  const logout = () => {
    setUser(null);
    setAccessToken(null);
    setRefreshToken(null);
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
  };

  // 🔹 Refrescar sesión
  const refreshSession = async () => {
    if (!refreshToken) return logout();

    try {
      const res = await fetch(`${BACK_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) throw new Error("No se pudo refrescar sesión");
      const data = await res.json();

      if (data.success) {
        setAccessToken(data.accessToken);
        localStorage.setItem("accessToken", data.accessToken);
      } else {
        logout();
      }
    } catch (err) {
      console.error("❌ Error refrescando sesión:", err);
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

// 🎯 Custom Hook para usar el contexto
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth debe ser usado dentro de un AuthProvider");
  }
  return context;
};