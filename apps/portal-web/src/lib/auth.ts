import { createAuthClient } from "better-auth/client";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_BETTER_AUTH_URL,
  fetchOptions: {
    credentials: "include",
  },
});

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
