/**
 * Colores de las etiquetas de `creditos."statusCredit"`.
 *
 * Definición única: el mismo estado se veía de dos colores distintos según la
 * pantalla (Cierre de Cartera vs. Gestión de Moras). Incluye el color de borde
 * para las pantallas que dibujan la etiqueta con `border`; donde no se usa
 * `border`, la clase de color de borde es inerte.
 */
export const ESTADO_CREDITO_STYLE: Record<string, string> = {
  ACTIVO: "bg-green-100 text-green-700 border-green-200",
  MOROSO: "bg-red-100 text-red-700 border-red-200",
  EN_CONVENIO: "bg-amber-100 text-amber-700 border-amber-200",
  CAIDO: "bg-orange-100 text-orange-700 border-orange-200",
  INCOBRABLE: "bg-rose-100 text-rose-700 border-rose-200",
  PENDIENTE_CANCELACION: "bg-blue-100 text-blue-700 border-blue-200",
  CANCELADO: "bg-gray-100 text-gray-600 border-gray-200",
};

const ESTADO_CREDITO_STYLE_DEFECTO = "bg-gray-100 text-gray-600 border-gray-200";

export const estadoCreditoStyle = (estado?: string | null): string =>
  ESTADO_CREDITO_STYLE[estado ?? ""] ?? ESTADO_CREDITO_STYLE_DEFECTO;
