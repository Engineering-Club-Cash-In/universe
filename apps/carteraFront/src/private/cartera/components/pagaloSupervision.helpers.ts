/**
 * Lógica pura y catálogos de la supervisión Págalo, separados del JSX para
 * poder testearlos. Los catálogos son un port de los del CRM: viven en su árbol
 * de componentes y no hay paquete compartido entre las dos apps.
 */

export type ColumnaOrdenable = "totalAmount" | "createdAt";

export type OrdenSupervision = {
  columna: ColumnaOrdenable;
  direccion: "asc" | "desc";
};

/** Selección multi-toggle de estados: agrega si no está, quita si ya está. */
export function alternarEstado(seleccionados: string[], estado: string): string[] {
  return seleccionados.includes(estado)
    ? seleccionados.filter((e) => e !== estado)
    : [...seleccionados, estado];
}

/**
 * Click en un header ordenable: si ya ordena por esa columna, invierte la
 * dirección; si es otra columna, la selecciona con `desc` por defecto (lo más
 * relevante primero — monto más alto, fecha más reciente).
 */
export function siguienteOrden(
  actual: OrdenSupervision,
  columnaClickeada: ColumnaOrdenable
): OrdenSupervision {
  if (actual.columna === columnaClickeada) {
    return {
      columna: columnaClickeada,
      direccion: actual.direccion === "asc" ? "desc" : "asc",
    };
  }
  return { columna: columnaClickeada, direccion: "desc" };
}

/**
 * "GERARDO FERMÍN LÓPEZ" → "Gerardo Fermín López". Solo interviene cuando el
 * nombre viene TODO en mayúsculas (dato crudo de cartera-back); si ya trae
 * mezcla de casos ("de la Cruz", "van der..."), se deja tal cual — un
 * capitalize ciego rompería esos casos.
 */
export function normalizarNombreCliente(nombre: string | null): string | null {
  if (!nombre) return nombre;
  if (nombre !== nombre.toUpperCase()) return nombre;
  return nombre
    .toLowerCase()
    .split(" ")
    .map((palabra) => (palabra ? palabra[0]?.toUpperCase() + palabra.slice(1) : palabra))
    .join(" ");
}

/**
 * Estados que se ofrecen como chip. Espejo parcial de
 * PAGALO_PAYMENT_GROUP_STATUSES en el CRM: DRAFT queda fuera a propósito — un
 * borrador no llegó a emitirse y no hay nada que supervisar en él.
 * Al agregar un estado nuevo allá, agregarlo acá y en cartera-back.
 */
export const ESTADOS_FILTRABLES = [
  "LINKS_PENDING",
  "PENDING_PAYMENT",
  "PARTIALLY_PAID",
  "READY_TO_APPLY",
  "APPLYING",
  "COMPLETED",
  "APPLICATION_FAILED",
  "REVIEW_REQUIRED",
  "CANCELLED",
] as const;

const ESTADO_GRUPO_INFO: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Borrador", className: "bg-gray-100 text-gray-700" },
  LINKS_PENDING: { label: "Creando links", className: "bg-blue-100 text-blue-700" },
  PENDING_PAYMENT: { label: "Esperando pago", className: "bg-amber-100 text-amber-800" },
  PARTIALLY_PAID: { label: "Pago parcial", className: "bg-amber-100 text-amber-800" },
  READY_TO_APPLY: { label: "Listo para aplicar", className: "bg-blue-100 text-blue-700" },
  APPLYING: { label: "Aplicando", className: "bg-blue-100 text-blue-700" },
  COMPLETED: { label: "Completado", className: "bg-green-100 text-green-700" },
  APPLICATION_FAILED: { label: "Falló al aplicar", className: "bg-red-100 text-red-700" },
  REVIEW_REQUIRED: { label: "Requiere revisión", className: "bg-red-100 text-red-700" },
  CANCELLED: { label: "Cancelado", className: "bg-gray-100 text-gray-700" },
};

export function getEstadoGrupoInfo(status: string) {
  return (
    ESTADO_GRUPO_INFO[status] ?? { label: status, className: "bg-gray-100 text-gray-700" }
  );
}

export const PROBLEMAS_LINK_FILTRABLES = [
  { valor: "EXPIRED", label: "Vencidos" },
  { valor: "CANCELLED", label: "Cancelados" },
  { valor: "ERROR", label: "Con error" },
  { valor: "REJECTED", label: "Rechazados" },
] as const;

const LINK_STATUS_LABEL: Record<string, string> = {
  CREATING: "Creando",
  ACTIVE: "Activo",
  PAID: "Pagado",
  EXPIRED: "Vencido",
  CANCELLED: "Cancelado",
  REPLACED: "Reemplazado",
  ERROR: "Error",
  REJECTED: "Rechazado",
};

export function etiquetaEstadoLink(status: string): string {
  return LINK_STATUS_LABEL[status] ?? status;
}

const FUENTE_LABEL: Record<string, string> = {
  ASESOR: "Asesor",
  BOT: "Bot WhatsApp",
};

export function etiquetaFuente(origen: string): string {
  return FUENTE_LABEL[origen] ?? origen;
}

export function etiquetaTipoLink(linkType: "CAPITAL" | "MORA_INTERES"): string {
  return linkType === "CAPITAL" ? "Capital" : "Mora/Int.";
}

/** Color del punto de estado: verde=pagado, ámbar=vivo, rojo=error, gris=cerrado sin pago. */
export function colorPuntoLink(status: string): string {
  if (status === "PAID") return "bg-green-500";
  if (status === "ERROR" || status === "REJECTED") return "bg-red-500";
  if (status === "CREATING" || status === "ACTIVE") return "bg-amber-500";
  return "bg-gray-400";
}

/** Umbral puramente visual, sin efecto de negocio. */
const DIAS_ALERTA_ANTIGUEDAD = 7;

export function antiguedad(desde: string | null): {
  dias: number | null;
  etiqueta: string;
  alerta: boolean;
} {
  if (!desde) return { dias: null, etiqueta: "—", alerta: false };
  const dias = Math.floor((Date.now() - new Date(desde).getTime()) / 86_400_000);
  if (dias <= 0) return { dias: 0, etiqueta: "hoy", alerta: false };
  return {
    dias,
    etiqueta: dias === 1 ? "1 día" : `${dias} días`,
    alerta: dias >= DIAS_ALERTA_ANTIGUEDAD,
  };
}

/**
 * Página a la que hay que moverse cuando la actual queda fuera de rango, o
 * `null` si se queda donde está.
 *
 * `cargando` es lo que evita el bug: al pasar de página, react-query deja
 * `data` en undefined por un instante y el total cae a 0. Recortar ahí devuelve
 * al usuario a la página 1 antes de que llegue la respuesta, y ninguna página
 * más allá de la primera resulta accesible. Solo se recorta con datos ya
 * cargados, que son los únicos que describen el resultado vigente.
 */
export function paginaCorregida(
  pagina: number,
  totalPaginas: number,
  { cargando, hayDatos }: { cargando: boolean; hayDatos: boolean },
): number | null {
  if (cargando || !hayDatos) return null;
  return pagina > totalPaginas ? totalPaginas : null;
}
