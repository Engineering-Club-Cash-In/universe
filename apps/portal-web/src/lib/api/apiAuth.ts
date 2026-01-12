/**
 * Cliente API centralizado para Better Auth
 * Maneja automáticamente el token de autenticación
 */

import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";

const AUTH_API_URL = import.meta.env.VITE_BETTER_AUTH_URL;

// Almacenamiento del token (se actualiza desde AuthContext)
let authToken: string | null = null;

/**
 * Establece el token de autenticación para todas las peticiones
 */
export const setAuthToken = (token: string | null) => {
  authToken = token;
};

/**
 * Obtiene el token actual
 */
export const getAuthToken = () => authToken;

/**
 * Instancia de Axios configurada para Better Auth API
 */
export const apiAuth: AxiosInstance = axios.create({
  baseURL: AUTH_API_URL,
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true, // Para enviar cookies de sesión también
});

// Interceptor para agregar el token de autenticación
apiAuth.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (authToken) {
      config.headers.Authorization = `Bearer ${authToken}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptor para manejar errores de autenticación
apiAuth.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expirado o inválido
      console.warn("Sesión expirada o token inválido");
      // Aquí se podría redirigir al login o emitir un evento
    }
    return Promise.reject(error);
  }
);

export default apiAuth;
