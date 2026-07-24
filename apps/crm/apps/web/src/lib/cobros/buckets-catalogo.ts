import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { orpc } from "@/utils/orpc";

/**
 * Fuente única de labels/colores/orden de buckets para la UI. Antes cada
 * ruta (embudo, filtros, tabla, detalle, reportes) mantenía su propia copia
 * hardcodeada — 4 copias divergentes, desalineadas entre sí y frente al
 * catálogo dinámico (`cartera.buckets`) que ya vive en cartera-back.
 *
 * `DEFAULT_BUCKETS` cubre TODOS los estados usados en la UI: los 6 buckets
 * de aging (B0-B5, `estadoMora` "al_dia".."mora_120_plus") que sí vienen del
 * catálogo dinámico, más los estados de STATUS del crédito (`en_convenio`,
 * `incobrable`, `completado`, `pagado`, `pre_mora`) que NUNCA son filas del
 * catálogo de buckets — esos siempre usan el default.
 *
 * `useBucketsCatalogo()` trae el catálogo dinámico vía ORPC; los helpers
 * combinan catálogo (si cargó y trae el estado) con el default (label/color
 * de respaldo, y única fuente para estados de status).
 */
export interface BucketUI {
	key: string;
	label: string;
	/** Clase Tailwind bg+text, usada cuando no hay color dinámico (hex). */
	colorClass: string;
	/** Color hex de referencia (embudo, barras) — respaldo si el catálogo no trae color. */
	colorHex: string;
	orden: number;
}

export const DEFAULT_BUCKETS: readonly BucketUI[] = [
	{
		key: "al_dia",
		label: "Cartera Sana",
		colorClass: "bg-green-100 text-green-800",
		colorHex: "#22c55e",
		orden: 0,
	},
	{
		key: "en_convenio",
		label: "En Convenio",
		colorClass: "bg-green-100 text-green-800",
		colorHex: "#22c55e",
		orden: 0.5,
	},
	{
		key: "pre_mora",
		label: "Próximo a Vencer",
		colorClass: "bg-yellow-50 text-yellow-700 border-yellow-200",
		colorHex: "#fef9c3",
		orden: 0.8,
	},
	{
		key: "mora_30",
		label: "Alerta Temprana",
		colorClass: "bg-yellow-100 text-yellow-800",
		colorHex: "#eab308",
		orden: 1,
	},
	{
		key: "mora_60",
		label: "Gestión Activa",
		colorClass: "bg-orange-100 text-orange-800",
		colorHex: "#f97316",
		orden: 2,
	},
	{
		key: "mora_90",
		label: "Rescate",
		colorClass: "bg-red-100 text-red-800",
		colorHex: "#ef4444",
		orden: 3,
	},
	{
		key: "mora_120",
		label: "Última Instancia / Pre Jurídico",
		colorClass: "bg-red-200 text-red-900",
		colorHex: "#b91c1c",
		orden: 4,
	},
	{
		key: "mora_120_plus",
		label: "Jurídico",
		colorClass: "bg-red-300 text-red-900",
		colorHex: "#991b1b",
		orden: 5,
	},
	{
		key: "pagado",
		label: "Pagado",
		colorClass: "bg-green-100 text-green-800",
		colorHex: "#22c55e",
		orden: 6,
	},
	{
		key: "incobrable",
		label: "Incobrable",
		colorClass: "bg-gray-100 text-gray-800",
		colorHex: "#6b7280",
		orden: 7,
	},
	{
		key: "completado",
		label: "Completado",
		colorClass: "bg-blue-100 text-blue-800",
		colorHex: "#3b82f6",
		orden: 8,
	},
];

/**
 * Bucket neutro para un `estadoMora` que no matchea ninguna key conocida
 * (dato faltante/corrupto, o un estado nuevo agregado en cartera-back sin
 * homólogo acá todavía). Deliberadamente NO reusa "incobrable": esa key
 * carga significado real de negocio (cartera impagable) y pintar un crédito
 * desconocido con ese label es más engañoso que útil.
 */
const BUCKET_DESCONOCIDO: BucketUI = {
	key: "desconocido",
	label: "—",
	colorClass: "bg-gray-100 text-gray-500",
	colorHex: "#9ca3af",
	orden: Number.POSITIVE_INFINITY,
};

const DEFAULT_POR_KEY = new Map(DEFAULT_BUCKETS.map((b) => [b.key, b]));

export type BucketsCatalogoQueryData = {
	estadoMora: string;
	label: string;
	prefijo: string | null;
	color: string | null;
	orden: number;
}[];

/** Catálogo dinámico de buckets de aging (B0-B5), vía ORPC. Cachea 5 min en el server. */
export function useBucketsCatalogo() {
	return useQuery(orpc.getBucketsCatalogo.queryOptions());
}

/**
 * `estadoMora` de cada bucket numérico (0-5), en el orden fijo del seed B0-B5
 * de cartera-back (espejo de `MORA_BUCKETS` en apps/server/src/lib/moraBuckets.ts).
 * El índice del array ES el número de bucket — a diferencia de `orden` del
 * catálogo dinámico (presentación, reordenable por un admin), esta lista es
 * la identidad estable del bucket y no debe usarse para ordenar UI.
 */
const ESTADO_MORA_POR_NUMERO = [
	"al_dia",
	"mora_30",
	"mora_60",
	"mora_90",
	"mora_120",
	"mora_120_plus",
] as const;

/** Bucket combinado a partir del número (0-5) que devuelve getAperturaDia/getBucketsCarga. */
export function bucketDeNumero(
	numero: number,
	catalogo: BucketsCatalogoQueryData | undefined,
): BucketUI {
	return bucketDeEstado(ESTADO_MORA_POR_NUMERO[numero], catalogo);
}

/** Fila cruda del catálogo dinámico para el bucket numérico (0-5), o undefined si no cargó / no está. */
export function catalogoDeNumero(
	numero: number,
	catalogo: BucketsCatalogoQueryData | undefined,
) {
	const estadoMora = ESTADO_MORA_POR_NUMERO[numero];
	return catalogo?.find((b) => b.estadoMora === estadoMora);
}

/**
 * Bucket combinado: catálogo dinámico (si trae el estado) sobreescribe
 * label/color; estados de status (no-aging) o catálogo aún no cargado caen
 * al default. Nunca retorna undefined — un estado sin match cae a
 * BUCKET_DESCONOCIDO (neutro), no revienta el render ni aparenta ser un
 * estado de negocio real.
 */
export function bucketDeEstado(
	estadoMora: string | null | undefined,
	catalogo: BucketsCatalogoQueryData | undefined,
): BucketUI {
	const key = estadoMora ?? "";
	const base = DEFAULT_POR_KEY.get(key) ?? BUCKET_DESCONOCIDO;
	const dinamico = catalogo?.find((b) => b.estadoMora === key);
	if (!dinamico) return base;

	return {
		key,
		label: dinamico.label || base.label,
		colorClass: base.colorClass,
		colorHex: dinamico.color || base.colorHex,
		orden: dinamico.orden,
	};
}

/** Lista de buckets para render (embudo, filtros), en el orden del catálogo dinámico si cargó, si no el default. */
export function bucketsParaRender(
	catalogo: BucketsCatalogoQueryData | undefined,
	keys: readonly string[],
): BucketUI[] {
	return keys
		.map((key) => bucketDeEstado(key, catalogo))
		.sort((a, b) => a.orden - b.orden);
}

/**
 * Estilo inline (fondo tenue + texto + borde) a partir de `colorHex` —
 * `colorClass` es una clase Tailwind estática (el default hardcoded);
 * Tailwind no puede generar clases para un hex arbitrario del catálogo
 * dinámico, así que el color REAL solo llega vía estilo inline. Mismo
 * patrón de opacidad ya usado en carteraFront/CreditsPaymentsData.tsx.
 */
export function estiloBucket(colorHex: string): CSSProperties {
	return {
		backgroundColor: `${colorHex}1A`,
		color: colorHex,
		borderColor: `${colorHex}40`,
	};
}
