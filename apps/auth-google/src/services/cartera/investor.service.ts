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
   * del portal. Cartera solo lo escribe al CREAR (migración 0033), nunca al
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

/**
 * El correo de la sesión corresponde a más de un inversionista.
 *
 * `inversionistas.email` no es único y la consulta que lo resuelve no tiene
 * desempate, así que no hay forma de saber a cuál de ellos quiso escribir el
 * titular. No se elige uno: la operación se rechaza.
 */
export class AmbiguousInvestorEmailError extends Error {
  constructor(readonly coincidencias: number) {
    super("El correo está asociado a más de un inversionista");
    this.name = "AmbiguousInvestorEmailError";
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
 * Busca el inversionista dueño de un correo.
 *
 * Es la forma en que el portal resuelve "cuál es MI inversionista": el correo
 * sale de la sesión, que es lo único que Better Auth autentica. Devuelve
 * `null` cuando no hay ninguno, en vez de tratarlo como error.
 */
export const findInvestorByEmail = async (
  email: string,
): Promise<InvestorProfile | null> => {
  const token = await ensureCarteraAuth();

  const url = new URL(`${env.CARTERA_API_URL}/investor`);
  url.searchParams.set("email", email);

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Error al obtener perfil del inversionista");
  }

  const data = (await response.json()) as
    | (InvestorProfile & { coincidencias_email?: number })
    | null;

  if (!data?.inversionista_id) {
    return null;
  }

  // Cartera informa cuántos inversionistas comparten el correo. Si son varios,
  // el que viene en `data` es el que haya salido primero del plan de ejecución,
  // no "el del titular": mejor no poder editar que editarle la cuenta bancaria
  // a la empresa equivocada.
  if ((data.coincidencias_email ?? 1) > 1) {
    throw new AmbiguousInvestorEmailError(data.coincidencias_email!);
  }

  return data;
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
