/**
 * Servicio para autenticación con la API de Cartera
 * Maneja login, verificación y refresh de tokens
 */

import { env } from "../../config/env";

// ============================================
// INTERFACES
// ============================================

export interface CarteraUser {
  id: number;
  email: string;
  role: "ADMIN";
  is_active: boolean;
  admin_id: number | null;
  asesor_id: number | null;
  conta_id: number | null;
  nombre: string;
  apellido: string;
}

export interface CarteraLoginResponse {
  success: boolean;
  message: string;
  data: {
    accessToken: string;
    refreshToken: string;
    user: CarteraUser;
  };
}

export interface CarteraVerifyResponse {
  success: boolean;
  message: string;
  data: CarteraUser;
  accessToken: string;
}

export interface CarteraRefreshResponse {
  success: boolean;
  message: string;
  accessToken: string;
  refreshToken: string;
}

// ============================================
// TOKEN CACHE (en memoria para el servidor)
// ============================================

interface TokenCache {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number; // timestamp
}

let tokenCache: TokenCache = {
  accessToken: null,
  refreshToken: null,
  expiresAt: 0,
};

// Token válido por 12 horas (ajustar según la API de cartera)
const TOKEN_EXPIRY_MS = 12 * 60 * 60 * 1000;

// ============================================
// FUNCIONES DE AUTENTICACIÓN
// ============================================

/**
 * Realizar login en la API de Cartera
 */
export const loginCartera = async (): Promise<string> => {
  try {
    const response = await fetch(`${env.CARTERA_API_URL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: env.CARTERA_USER,
        password: env.CARTERA_PASSWORD,
      }),
    });

    if (!response.ok) {
      throw new Error("Error al hacer login en Cartera");
    }

    const data = (await response.json()) as CarteraLoginResponse;

    // Guardar tokens en cache
    tokenCache = {
      accessToken: data.data.accessToken,
      refreshToken: data.data.refreshToken,
      expiresAt: Date.now() + TOKEN_EXPIRY_MS,
    };

    return data.data.accessToken;
  } catch (error) {
    console.error("Error en loginCartera:", error);
    throw error;
  }
};

/**
 * Verificar si el access token actual es válido
 * Si es válido, retorna un nuevo token renovado
 */
export const verifyCarteraToken = async (token: string): Promise<string | null> => {
  try {
    const response = await fetch(
      `${env.CARTERA_API_URL}/auth/verify?token=${encodeURIComponent(token)}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as CarteraVerifyResponse;

    if (data.success && data.accessToken) {
      // Actualizar cache con el nuevo token
      tokenCache.accessToken = data.accessToken;
      tokenCache.expiresAt = Date.now() + TOKEN_EXPIRY_MS;
      return data.accessToken;
    }

    return null;
  } catch (error) {
    console.error("Error verificando token de Cartera:", error);
    return null;
  }
};

/**
 * Refrescar el access token usando el refresh token
 */
export const refreshCarteraToken = async (): Promise<string | null> => {
  try {
    if (!tokenCache.refreshToken) {
      return null;
    }

    const response = await fetch(`${env.CARTERA_API_URL}/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refreshToken: tokenCache.refreshToken,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as CarteraRefreshResponse;

    if (data.success && data.accessToken) {
      // Actualizar cache con los nuevos tokens
      tokenCache.accessToken = data.accessToken;
      if (data.refreshToken) {
        tokenCache.refreshToken = data.refreshToken;
      }
      tokenCache.expiresAt = Date.now() + TOKEN_EXPIRY_MS;
      return data.accessToken;
    }

    return null;
  } catch (error) {
    console.error("Error refrescando token de Cartera:", error);
    return null;
  }
};

/**
 * Obtener el access token actual (de cache o hacer login)
 */
export const getCarteraAccessToken = async (): Promise<string> => {
  // 1. Verificar si hay token en cache y no ha expirado
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt) {
    // 2. Verificar si el token sigue siendo válido
    const verifiedToken = await verifyCarteraToken(tokenCache.accessToken);
    if (verifiedToken) {
      return verifiedToken;
    }

    // 3. Si la verificación falló, intentar refrescar con refresh token
    const refreshedToken = await refreshCarteraToken();
    if (refreshedToken) {
      return refreshedToken;
    }
  }

  // 4. Si todo falló, hacer login completo
  return await loginCartera();
};

/**
 * Asegurar que existe autenticación válida antes de hacer una petición
 * Retorna el access token listo para usar
 */
export const ensureCarteraAuth = async (): Promise<string> => {
  return await getCarteraAccessToken();
};

/**
 * Limpiar cache de tokens (logout)
 */
export const clearCarteraTokens = () => {
  tokenCache = {
    accessToken: null,
    refreshToken: null,
    expiresAt: 0,
  };
};
