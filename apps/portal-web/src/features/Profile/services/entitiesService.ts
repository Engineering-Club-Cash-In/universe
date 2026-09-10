/**
 * Entidades del inversionista - Proxy a través de Better Auth API
 *
 * Una persona puede operar varios inversionistas: el suyo y el de cada sociedad
 * que representa. El servidor resuelve el conjunto desde el correo de la sesión,
 * así que acá no se manda ningún identificador.
 */

import apiAuth from "@/lib/api/apiAuth";

export interface Entidad {
  inversionista_id: number;
  nombre: string;
  tipo: "persona" | "empresa";
  /** true si es la fila que matcheó por correo (la puerta de entrada). */
  es_ancla: boolean;
  dpi: string | null;
  dpi_rep_legal: string | null;
  email: string | null;
  moneda: string;
  status: string;
}

/**
 * Entidades que el usuario logueado puede consultar.
 * Devuelve [] cuando su usuario todavía no está vinculado a ningún inversionista.
 */
export const getEntidades = async (): Promise<Entidad[]> => {
  const response = await apiAuth.get<{ data: Entidad[] }>(
    "/api/cartera/entidades"
  );
  return response.data.data ?? [];
};
