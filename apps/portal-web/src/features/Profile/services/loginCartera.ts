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
    setCookie(ACCESS_TOKEN_COOKIE, data.data.accessToken, 1);
    setCookie(REFRESH_TOKEN_COOKIE, data.data.refreshToken, 1);

    return data.data.accessToken;
  } catch (error) {
    console.error("Error en loginCartera:", error);
    throw error;
  }
};

/**
 * Obtener el access token actual (de cookie o hacer login)
 */
export const getCarteraAccessToken = async (): Promise<string> => {
  // Intentar obtener token de cookie
  const token = getCookie(ACCESS_TOKEN_COOKIE);

  if (token) {
    return token;
  }

  // Si no hay token, hacer login
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
