/**
 * Servicio para operaciones de inversionistas en Cartera
 */

import { env } from "../../config/env";
import { ensureCarteraAuth } from "./carteraAuth.service";

// ============================================
// INTERFACES
// ============================================

export interface CreateInvestorPayload {
  /**
   * Destino explícito de la escritura. Cuando viene, cartera edita esa fila y
   * no intenta resolverla por DPI/correo/nombre.
   */
  inversionista_id?: number;
  /**
   * `"CREATE"` pone a cartera en modo estricto: si el DPI, el correo o el
   * nombre ya existen responde 409 en vez de actualizar la fila existente.
   */
  operation?: "CREATE";
  /**
   * Id de la cuenta de auth-google que da de alta la fila desde el registro
   * del portal. Cartera solo lo escribe al CREAR (migración 0034), nunca al
   * actualizar, así que es prueba de creación y no de mera edición.
   */
  creado_por_usuario_portal?: string;
  nombre?: string;
  dpi?: number;
  email?: string;
  emite_factura?: boolean;
  tipo_reinversion?: string;
  banco?: string | null;
  banco_id?: number;
  tipo_cuenta?: string | null;
  numero_cuenta?: string | null;
}

export interface CreateInvestorResponse {
  success: boolean;
  message: string;
  data?: any;
}

export interface InvestorProfile {
  inversionista_id: number;
  nombre: string;
  /**
   * OJO: en la búsqueda por correo cartera devuelve aquí `dpi_rep_legal`
   * cuando la fila tiene representante legal, no el `dpi` de la fila (que en
   * esas filas de sociedad es NULL). No sirve para decidir de quién es la
   * fila; para eso está `creado_por_usuario_portal`.
   */
  dpi: number;
  email: string;
  /** Marca de procedencia del registro del portal. NULL en todo lo demás. */
  creado_por_usuario_portal?: string | null;
  emite_factura: boolean;
  tipo_reinversion: string;
  banco: string | null;
  tipo_cuenta: string | null;
  numero_cuenta: string | null;
}

export interface Banco {
  banco_id: number;
  nombre: string;
  codigo: string;
}

/**
 * Una de las entidades que la persona logueada puede operar: su propio
 * inversionista y el de cada sociedad que representa.
 */
export interface EntidadPortal {
  inversionista_id: number;
  nombre: string;
  tipo: "persona" | "empresa";
  es_ancla: boolean;
  dpi: string | null;
  dpi_rep_legal: string | null;
  email: string | null;
  moneda: string;
  status: string;
}

export interface InvestorDocument {
  documento_id: number;
  inversionista_id: number;
  key: string;
  nombre: string;
  descripcion: string | null;
  visible: boolean;
  created_at: string;
  created_by: string | null;
  url: string;
}

// ============================================
// ERRORES
// ============================================

/**
 * Rechazo de cartera al escribir un inversionista, con el motivo que dio.
 *
 * Se conserva el status y el mensaje para que un rechazo legítimo (un banco
 * inexistente, un campo mal formado) le llegue a quien lo provocó en vez de
 * convertirse en un 500 mudo. Quien lo propague hacia un cliente NO autenticado
 * debe generalizarlo antes: los mensajes de duplicado de cartera dicen si un
 * DPI o un correo ya existen.
 */
export class CarteraInvestorError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CarteraInvestorError";
  }
}

// ============================================
// FUNCIONES DE INVERSIONISTAS
// ============================================

/**
 * Saca de la respuesta de cartera el motivo del rechazo.
 *
 * Cartera contesta `{ message, errores?: string[] }`. Si el cuerpo no trae nada
 * aprovechable se cae a un mensaje genérico, y en todo caso se acota el largo:
 * lo que salga de aquí puede terminar en la pantalla de un usuario.
 */
const motivoDeCartera = (cuerpo: string): string => {
  const generico = "Cartera rechazó la operación";

  try {
    const json = JSON.parse(cuerpo) as {
      message?: unknown;
      errores?: unknown;
    };

    const detalle = Array.isArray(json.errores)
      ? json.errores.filter((e) => typeof e === "string").join("; ")
      : "";

    const mensaje =
      typeof json.message === "string" && json.message.trim()
        ? json.message.trim()
        : generico;

    return (detalle ? `${mensaje}: ${detalle}` : mensaje).slice(0, 300);
  } catch {
    return generico;
  }
};

/**
 * Crear o actualizar un inversionista
 */
export const createInvestor = async (
  payload: CreateInvestorPayload,
): Promise<CreateInvestorResponse> => {
  try {
    // Asegurar autenticación
    const token = await ensureCarteraAuth();

    console.log("Creating investor with payload:", payload);

    const response = await fetch(`${env.CARTERA_API_URL}/investor`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const cuerpo = await response.text();
      console.error("Error response from Cartera API:", cuerpo);
      throw new CarteraInvestorError(response.status, motivoDeCartera(cuerpo));
    }

    const data = (await response.json()) as CreateInvestorResponse;
    return data;
  } catch (error) {
    console.error("Error al crear inversionista:", error);
    throw error;
  }
};

/**
 * Resolver las entidades que puede operar la persona dueña de ese correo.
 * El correo lo pone SIEMPRE la sesión, nunca el cliente.
 */
export const getEntidades = async (
  email: string,
): Promise<EntidadPortal[]> => {
  const token = await ensureCarteraAuth();

  const response = await fetch(
    `${env.CARTERA_API_URL}/investor/entidades?email=${encodeURIComponent(email)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error("Error al resolver las entidades del inversionista");
  }

  const json = (await response.json()) as {
    success: boolean;
    data: EntidadPortal[];
  };
  return json.data ?? [];
};

/**
 * Obtener perfil de inversionista por su id
 */
export const getInvestorProfileById = async (
  inversionistaId: number,
): Promise<InvestorProfile> => {
  const token = await ensureCarteraAuth();

  const response = await fetch(
    `${env.CARTERA_API_URL}/investor?id=${inversionistaId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error("Error al obtener perfil del inversionista");
  }

  const perfil = (await response.json()) as Record<string, unknown>;

  // `/investor` adjunta TODOS los documentos del inversionista —el left join de
  // getInvestors no filtra `visible`— y cada uno ya viene con su URL firmada.
  // El portal pide los suyos por `client-by-id`, que sí respeta la visibilidad,
  // así que acá se descartan: aunque la UI ignore la propiedad, los documentos
  // internos viajarían igual hasta el navegador.
  delete perfil.documentos;

  return perfil as unknown as InvestorProfile;
};

/**
 * Obtener documentos visibles de un inversionista por su id
 */
export const getInvestorDocumentsById = async (
  inversionistaId: number,
): Promise<InvestorDocument[]> => {
  const token = await ensureCarteraAuth();

  const response = await fetch(
    `${env.CARTERA_API_URL}/investor-documents/client-by-id/${inversionistaId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error("Error al obtener documentos del inversionista");
  }

  const json = (await response.json()) as {
    success: boolean;
    data: InvestorDocument[];
  };
  return json.data;
};

/**
 * Obtener perfil de inversionista por DPI
 */
export const getInvestorProfile = async (
  dpi: string,
  email: string,
): Promise<InvestorProfile> => {
  try {
    // Asegurar autenticación
    const token = await ensureCarteraAuth();

    const response = await fetch(
      `${env.CARTERA_API_URL}/investor?dpi=${dpi}&email=${email}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error("Error al obtener perfil del inversionista");
    }

    const data = (await response.json()) as InvestorProfile;
    return data;
  } catch (error) {
    console.error("Error al obtener perfil del inversionista:", error);
    throw error;
  }
};

/**
 * Obtener documentos de un inversionista por email
 */
export const getInvestorDocuments = async (
  email: string,
): Promise<InvestorDocument[]> => {
  try {
    const token = await ensureCarteraAuth();

    const response = await fetch(
      `${env.CARTERA_API_URL}/investor-documents/client/${encodeURIComponent(email)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    console.log("Response status for getInvestorDocuments:", response);

    if (!response.ok) {
      throw new Error("Error al obtener documentos del inversionista");
    }

    const json = (await response.json()) as {
      success: boolean;
      data: InvestorDocument[];
    };
    return json.data;
  } catch (error) {
    console.error("Error al obtener documentos del inversionista:", error);
    throw error;
  }
};

/**
 * Obtener catálogo de bancos
 * @param soloConTransferencia Si es true, sólo devuelve bancos con id_banco_transferencia asignado
 */
export const getBancos = async (
  soloConTransferencia = false
): Promise<Banco[]> => {
  try {
    // Asegurar autenticación
    const token = await ensureCarteraAuth();

    const url = new URL(`${env.CARTERA_API_URL}/bancos`);
    
    url.searchParams.set("con_transferencia", "true");
    

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error("Error al obtener catálogo de bancos");
    }

    const data = (await response.json()) as { data: Banco[] };
    return data.data;
  } catch (error) {
    console.error("Error al obtener bancos:", error);
    throw error;
  }
};
