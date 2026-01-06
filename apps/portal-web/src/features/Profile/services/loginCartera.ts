const carteraURL = import.meta.env.VITE_CARTERA_API_URL || "http://localhost:5000";
const carteraUser = import.meta.env.VITE_USER_CARTERA;
const carteraPassword = import.meta.env.VITE_PASSWORD_CARTERA;

// Interfaces
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

// Nombre de las cookies
const ACCESS_TOKEN_COOKIE = "cartera_access_token";
const REFRESH_TOKEN_COOKIE = "cartera_refresh_token";

/**
 * Guardar un valor en una cookie con expiración de 1 día
 */
const setCookie = (name: string, value: string, days: number = 1) => {
  const date = new Date();
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  const expires = `expires=${date.toUTCString()}`;
  document.cookie = `${name}=${value};${expires};path=/;SameSite=Lax`;
};

/**
 * Obtener el valor de una cookie
 */
const getCookie = (name: string): string | null => {
  const nameEQ = name + "=";
  const cookies = document.cookie.split(";");
  for (let i = 0; i < cookies.length; i++) {
    let cookie = cookies[i];
    while (cookie.charAt(0) === " ") cookie = cookie.substring(1, cookie.length);
    if (cookie.indexOf(nameEQ) === 0) return cookie.substring(nameEQ.length, cookie.length);
  }
  return null;
};

/**
 * Eliminar una cookie
 */
const deleteCookie = (name: string) => {
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
};

/**
 * Realizar login en la API de Cartera
 */
export const loginCartera = async (): Promise<string> => {
  try {
    const response = await fetch(`${carteraURL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: carteraUser,
        password: carteraPassword,
      }),
    });

    if (!response.ok) {
      throw new Error("Error al hacer login en Cartera");
    }

    const data: CarteraLoginResponse = await response.json();

    // Guardar tokens en cookies con expiración de 1 día
    setCookie(ACCESS_TOKEN_COOKIE, data.data.accessToken, 0.5);
    setCookie(REFRESH_TOKEN_COOKIE, data.data.refreshToken, 0.5);

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
    const response = await fetch(`${carteraURL}/auth/verify?token=${encodeURIComponent(token)}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    const data: CarteraVerifyResponse = await response.json();

    if (data.success && data.accessToken) {
      // Guardar el nuevo token renovado
      setCookie(ACCESS_TOKEN_COOKIE, data.accessToken, 0.5);
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
    const refreshToken = getCookie(REFRESH_TOKEN_COOKIE);

    if (!refreshToken) {
      return null;
    }

    const response = await fetch(`${carteraURL}/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refreshToken: refreshToken,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data: CarteraRefreshResponse = await response.json();

    if (data.success && data.accessToken) {
      // Guardar los nuevos tokens
      setCookie(ACCESS_TOKEN_COOKIE, data.accessToken, 0.5);
      if (data.refreshToken) {
        setCookie(REFRESH_TOKEN_COOKIE, data.refreshToken, 0.5);
      }
      return data.accessToken;
    }

    return null;
  } catch (error) {
    console.error("Error refrescando token de Cartera:", error);
    return null;
  }
};

/**
 * Obtener el access token actual (de cookie o hacer login)
 */
export const getCarteraAccessToken = async (): Promise<string> => {
  // 1. Intentar obtener token de cookie
  const token = getCookie(ACCESS_TOKEN_COOKIE);

  if (token) {
    // 2. Verificar si el token es válido y renovarlo
    const verifiedToken = await verifyCarteraToken(token);
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
 * Cerrar sesión (eliminar cookies)
 */
export const logoutCartera = () => {
  deleteCookie(ACCESS_TOKEN_COOKIE);
  deleteCookie(REFRESH_TOKEN_COOKIE);
};
