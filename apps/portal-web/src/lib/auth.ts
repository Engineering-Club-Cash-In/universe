import { redirect } from "@tanstack/react-router";
import { createAuthClient } from "better-auth/client";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_BETTER_AUTH_URL,
  fetchOptions: {
    credentials: "include",
  },
});

// Función para verificar autenticación con better-auth
export const checkAuth = async () => {
  try {
    const sessionData = await authClient.getSession();
    console.log("checkAuth - Respuesta de getSession:", sessionData);
    
    if (sessionData?.data?.user) {
      return; // Sesión válida
    }
    
    // Si no hay sesión, redirigir al login
    throw redirect({
      to: "/login",
    });
  } catch (error) {
    console.error("checkAuth - Error:", error);
    throw redirect({
      to: "/login",
    });
  }
};

// Tipos para la autenticación
export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface RegisterCredentials {
  fullName: string;
  phone: string;
  email: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
}

export interface User {
  id: string;
  email: string;
  name?: string;
  phone?: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}
