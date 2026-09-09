/**
 * Servicio de perfil - Proxy a través de Better Auth API
 */

import apiAuth from "@/lib/api/apiAuth";
import type { AxiosError } from "axios";

import { mensajeDelServidor } from "./mensajeDelServidor";

export interface ProfileData {
  name: string;
  lastName: string;
  email: string;
  idLead: string;
  dpi?: string;
  phone?: string;
  direccion?: string;
}

export interface VehiclePhoto {
  id: string;
  vehicleId: string;
  inspectionId: string | null;
  category: string;
  photoType: string;
  title: string;
  description: string;
  url: string;
  valuatorComment: string | null;
  noCommentsChecked: boolean;
  createdAt: string;
}

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  licensePlate: string;
  color: string;
  status: string;
  vin: string;
  type: string;
  origin: string;
  engine: string;
  photos: VehiclePhoto[];
}

export interface Opportunity {
  opportunityId: string;
  opportunityTitle: string;
  numeroSifco: string;
  vehicle: Vehicle;
}

export interface UpdateFieldResponse {
  success: boolean;
  message: string;
  data?: ProfileData;
  error?: string;
}

export interface UpdateLeadPayload {
  email: string;
  dpi?: string;
  phone?: string;
  address?: string;
}

/**
 * Obtener perfil del usuario
 */
export const getProfile = async (
  email: string,
  dpi: string = ""
): Promise<ProfileData> => {
  try {
    const response = await apiAuth.get<{ data: ProfileData }>(
      `/api/crm/profile?email=${encodeURIComponent(email)}&dpi=${encodeURIComponent(dpi)}`
    );
    return response.data.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ error?: string; success?: boolean }>;
    const errorMessage = axiosError.response?.data?.error || "Error al cargar el perfil";
    const customError: any = new Error(errorMessage);
    customError.status = axiosError.response?.status;
    customError.data = axiosError.response?.data;
    throw customError;
  }
};

/**
 * Actualizar información del lead (DPI, teléfono o dirección)
 */
export const updateLead = async (
  payload: UpdateLeadPayload
): Promise<UpdateFieldResponse> => {
  try {
    const response = await apiAuth.post<UpdateFieldResponse>(
      "/api/crm/profile/update",
      payload
    );

    if (!response.data.success) {
      throw new Error(response.data.error || "Error al actualizar la información");
    }

    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ error?: string }>;
    throw new Error(axiosError.response?.data?.error || "Error al actualizar la información");
  }
};

export const getNumbersSifco = async (
  email: string,
  dpi: string = ""
): Promise<Opportunity[]> => {
  try {
    const response = await apiAuth.get<{ data: Opportunity[] }>(
      `/api/crm/sifco?email=${encodeURIComponent(email)}&dpi=${encodeURIComponent(dpi)}`
    );
    return response.data.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ error?: string; success?: boolean }>;
    const errorMessage = axiosError.response?.data?.error || "Error al cargar los números Sifco";
    const customError: any = new Error(errorMessage);
    customError.status = axiosError.response?.status;
    customError.data = axiosError.response?.data;
    throw customError;
  }
};

/**
 * Fija el DPI de la cuenta autenticada.
 *
 * El DPI dejó de aceptarse como campo del cliente en Better Auth; el servidor
 * lo escribe sobre la cuenta de la sesión.
 */
export const updateOwnDpi = async (dpi: string): Promise<string> => {
  try {
    const response = await apiAuth.post<{
      success: boolean;
      data: { dpi: string };
    }>("/api/profile/me/dpi", { dpi });

    return response.data.data.dpi;
  } catch (error) {
    // El motivo se lee con `mensajeDelServidor`: los errores de esta ruta son
    // `HTTPException`, y el manejador global de auth-google los serializa como
    // `{ error: { message } }`. Leer `data.error` como texto le mostraba al
    // usuario "[object Object]" en lugar del 409 que sí puede corregir.
    throw new Error(mensajeDelServidor(error, "Error al actualizar el DPI"));
  }
};
