import { betterAuth } from "better-auth";

// Configuración de better-auth para el cliente
export const authClient = betterAuth({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:3000",
  // Aquí se configurará la conexión con el backend cuando esté listo
});

// Tipos para la autenticación
export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface User {
  id: string;
  email: string;
  name?: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}
