const baseURL = import.meta.env.VITE_BETTER_AUTH_URL || "http://localhost:3000";

export interface ProfileData {
  dpi?: string;
  phone?: string;
  address?: string;
  profileCompleted: boolean;
}

export interface UpdateFieldResponse {
  success: boolean;
  message: string;
  data?: ProfileData;
}

/**
 * Obtener perfil del usuario
 */
export const getProfile = async (userId: string): Promise<ProfileData> => {
  const response = await fetch(`${baseURL}/api/profile/${userId}`, {
    credentials: "include",
  });
  
  if (!response.ok) {
    throw new Error("Error al cargar el perfil");
  }
  
  const result = await response.json();
  return result.data as ProfileData;
};

/**
 * Actualizar DPI del usuario
 */
export const updateDpi = async (
  userId: string,
  dpi: string
): Promise<UpdateFieldResponse> => {
  const response = await fetch(`${baseURL}/api/profile/${userId}/dpi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ dpi }),
  });

  if (!response.ok) {
    throw new Error("Error al actualizar DPI");
  }

  return response.json();
};

/**
 * Actualizar teléfono del usuario
 */
export const updatePhone = async (
  userId: string,
  phone: string
): Promise<UpdateFieldResponse> => {
  const response = await fetch(`${baseURL}/api/profile/${userId}/phone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ phone }),
  });

  if (!response.ok) {
    throw new Error("Error al actualizar teléfono");
  }

  return response.json();
};

/**
 * Actualizar dirección del usuario
 */
export const updateAddress = async (
  userId: string,
  address: string
): Promise<UpdateFieldResponse> => {
  const response = await fetch(`${baseURL}/api/profile/${userId}/address`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ address }),
  });

  if (!response.ok) {
    throw new Error("Error al actualizar dirección");
  }

  return response.json();
};
