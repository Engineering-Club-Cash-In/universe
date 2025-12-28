import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authClient, type User } from "@/lib/auth";
import { AuthContext } from "./useAuth";

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);

  // Query para verificar autenticación
  const { data, isLoading } = useQuery({
    queryKey: ["auth", "session"],
    queryFn: () => authClient.getSession().then((res) => res.data),
    staleTime: 1 * 60 * 1000, // 1 minuto - refetch más frecuente
    refetchOnWindowFocus: true, // Refetch cuando la ventana recupera el foco
    refetchOnMount: true, // Refetch cuando el componente se monta
  });

  useEffect(() => {
    if (data) {
      setUser(data.user);
    } else {
      setUser(null);
    }
  }, [data]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        token: data?.session.token || null,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
