// src/api/axiosInstance.ts
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";

const API_URL =
  import.meta.env.VITE_BACK_URL ||
  "https://qk4sw4kc4c088c8csos400wc.s3.devteamatcci.site";

const api = axios.create({
  baseURL: API_URL,
});

const REFRESH_MARGIN_SECONDS = 120; // refrescar si quedan ≤2 min de vida

const AUTH_REFRESH_PATH = "/auth/refresh";

// Decodifica payload de JWT sin verificar firma (la firma la valida el back).
// Devuelve null si el token es inválido o no es JWT.
function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function isTokenExpiringSoon(token: string, marginSeconds: number): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return true; // si no podemos leerlo, asumimos que conviene refrescar
  const nowSec = Math.floor(Date.now() / 1000);
  return payload.exp - nowSec <= marginSeconds;
}

function clearAuthStorage() {
  localStorage.removeItem("accessToken");
  localStorage.removeItem("refreshToken");
}

function redirectToLogin() {
  // Evitar bucle si ya estamos en /login
  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

// Lock global: si hay un refresh en vuelo, todos los callers esperan la misma Promise.
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = localStorage.getItem("refreshToken");
    if (!refreshToken) return null;

    try {
      // Usamos axios "pelado" (no `api`) para no disparar nuestros propios interceptors.
      const res = await axios.post(
        `${API_URL}${AUTH_REFRESH_PATH}`,
        { refreshToken },
      );

      if (res.data?.success && res.data.accessToken) {
        localStorage.setItem("accessToken", res.data.accessToken);
        // 🔑 Importante: el back rota el refresh token, hay que persistir el nuevo.
        if (res.data.refreshToken) {
          localStorage.setItem("refreshToken", res.data.refreshToken);
        }
        return res.data.accessToken as string;
      }

      // El back contestó 200 pero success:false → refresh inválido
      return null;
    } catch (err) {
      // Solo cerramos sesión si el back rechazó el refresh (401/403).
      // En errores de red u otros (5xx) preservamos la sesión y dejamos que el caller decida.
      const status = (err as AxiosError)?.response?.status;
      if (status === 401 || status === 403) {
        return null;
      }
      // Error transitorio: relanzar para que el caller pueda manejarlo
      throw err;
    } finally {
      // Liberar el lock al final de este tick
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();

  return refreshInFlight;
}

// ✅ Interceptor de request: refresh proactivo si el token está por vencer
api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    // No interceptar el propio /auth/refresh ni endpoints de login
    const url = config.url ?? "";
    if (url.includes(AUTH_REFRESH_PATH) || url.includes("/auth/login")) {
      return config;
    }

    let token = localStorage.getItem("accessToken");

    if (token && isTokenExpiringSoon(token, REFRESH_MARGIN_SECONDS)) {
      try {
        const newToken = await refreshAccessToken();
        if (newToken) {
          token = newToken;
        } else {
          // Refresh falló por credenciales inválidas → cerrar sesión
          clearAuthStorage();
          redirectToLogin();
          return Promise.reject(new Error("Sesión expirada"));
        }
      } catch {
        // Error transitorio (red, 5xx). Mandamos el request con el token actual;
        // si el back nos da 401, el response interceptor reintentará.
      }
    }

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ✅ Interceptor de response: red de seguridad para 401 que se nos haya colado
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as
      | (InternalAxiosRequestConfig & { _retry?: boolean })
      | undefined;

    if (!originalRequest || originalRequest._retry) {
      return Promise.reject(error);
    }

    // No reintentar si el 401 viene del propio /auth/refresh
    if ((originalRequest.url ?? "").includes(AUTH_REFRESH_PATH)) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401) {
      originalRequest._retry = true;

      try {
        const newToken = await refreshAccessToken();
        if (!newToken) {
          clearAuthStorage();
          redirectToLogin();
          return Promise.reject(error);
        }
        originalRequest.headers = originalRequest.headers ?? {};
        (originalRequest.headers as Record<string, string>).Authorization =
          `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshErr) {
        // Refresh falló por error transitorio: NO cerramos sesión
        console.error("❌ Error transitorio en refresh:", refreshErr);
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  },
);

export default api;
