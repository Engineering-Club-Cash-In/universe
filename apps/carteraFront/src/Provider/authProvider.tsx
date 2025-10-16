import { createContext, useContext, useState, useEffect } from "react";

interface User {
  id: number;
  email: string;
  role: "ADMIN" | "ASESOR";
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
      fetch(`${import.meta.env.VITE_BACK_URL}/auth/verify?token=${savedAccess}`)
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
            refreshSession(); // 👈 intenta refrescar sesión
          }
        })
        .catch(() => refreshSession()) // 👈 si falla la verificación → refresca
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
      const res = await fetch(`${import.meta.env.VITE_BACK_URL}/auth/refresh`, {
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

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
};
