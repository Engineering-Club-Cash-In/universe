import { createContext, useContext, useState, useEffect } from "react";

interface User {
  id: number;
  email: string;
  role: "ADMIN" | "ASESOR";
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoggedIn: boolean;
  loading: boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Cargar token de localStorage al iniciar
 useEffect(() => {
  const savedToken = localStorage.getItem("token");
  const savedUser = localStorage.getItem("user");

  if (savedToken) {
    // Llamada al backend para verificar token
    fetch(`${import.meta.env.VITE_BACK_URL}/auth/verify?token=${savedToken}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setToken(savedToken);
          // Si quieres, podés confiar en `savedUser` o en `data.data` (decoded del JWT)
          if (savedUser) {
            setUser(JSON.parse(savedUser));
          } else if (data.data) {
            setUser(data.data); // según lo que devuelva tu servicio
          }
        } else {
          console.warn("Token inválido:", data.error);
          localStorage.removeItem("token");
          localStorage.removeItem("user");
          setToken(null);
          setUser(null);
        }
      })
      .catch((err) => {
        console.error("Error verificando token:", err);
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  } else {
    setLoading(false);
  }
}, []);

 const login = (user: User, token: string) => {
  setUser(user);
  setToken(token);
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(user));
};
  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoggedIn: !!token && !!user,
        loading,
        login,
        logout,
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
