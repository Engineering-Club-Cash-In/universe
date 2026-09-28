/**
 * Servicio de perfil - Proxy a través de Better Auth API
 */

import apiAuth from "@/lib/api/apiAuth";
import axios from "axios";

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
  // Simulacro: el CRM corre candado, mora y duplicados y devuelve el veredicto
  // SIN escribir nada. El portal lo usa para no dejar escrito el DPI de la
  // cuenta cuando el CRM va a rechazar el cambio.
  soloValidar?: boolean;
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
    // Mismo motivo que en `updateOwnDpi`: auth-google serializa sus rechazos
    // como `{ error: { message } }`, así que leer `data.error` como TEXTO le
    // mostraba "[object Object]" en vez del motivo.
    const customError: any = new Error(
      mensajeDelServidor(error, "Error al cargar el perfil")
    );
    // `status` y `data` se conservan: hoy nadie en el portal los lee, pero son
    // parte del error que ya viajaba y quitarlos sería un cambio aparte.
    customError.status = axios.isAxiosError(error)
      ? error.response?.status
      : undefined;
    customError.data = axios.isAxiosError(error)
      ? error.response?.data
      : undefined;
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
      // El CRM puede contestar 200 con el rechazo adentro; el motivo se lee
      // igual que el de un 4xx porque viene con la misma forma anidada.
      throw new Error(
        mensajeDelServidor({ response }, "Error al actualizar la información")
      );
    }

    return response.data;
  } catch (error) {
    // Mismo motivo que en `updateOwnDpi`: auth-google serializa sus rechazos
    // como `{ error: { message } }`, así que leer `data.error` como TEXTO le
    // mostraba "[object Object]" en lugar del motivo que la persona sí puede
    // corregir sola (mora activa, DPI duplicado, candado de la solicitud).
    //
    // El `throw` de arriba cae en este mismo `catch` y su texto ya está listo
    // para el usuario, así que se relanza tal cual. Se distingue por
    // `isAxiosError` y NO por "no trae response": un fallo de red o un timeout
    // también es `instanceof Error` y también viene sin `response`, y con ese
    // guard el usuario terminaba leyendo "Network Error" o "ECONNREFUSED".
    if (!axios.isAxiosError(error)) {
      throw error;
    }

    throw new Error(
      mensajeDelServidor(error, "Error al actualizar la información")
    );
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
    // Igual que `getProfile`: el motivo de auth-google viene anidado, y leerlo
    // como texto plano le mostraba "[object Object]" al usuario.
    const customError: any = new Error(
      mensajeDelServidor(error, "Error al cargar los números Sifco")
    );
    customError.status = axios.isAxiosError(error)
      ? error.response?.status
      : undefined;
    customError.data = axios.isAxiosError(error)
      ? error.response?.data
      : undefined;
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
