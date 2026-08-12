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
	/** Prefijo "B0".."B5" del bucket de aging; null/undefined para estados de status. */
	prefijo?: string | null;
	/** Clase Tailwind bg+text, usada cuando no hay color dinámico (hex). */
	colorClass: string;
	/** Color hex de referencia (embudo, barras) — respaldo si el catálogo no trae color. */
	colorHex: string;
	orden: number;
}

export const DEFAULT_BUCKETS: readonly BucketUI[] = [
	{
		key: "al_dia",
		prefijo: "B0",
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
		prefijo: "B1",
		label: "Alerta Temprana",
		colorClass: "bg-yellow-100 text-yellow-800",
		colorHex: "#eab308",
		orden: 1,
	},
	{
		key: "mora_60",
		prefijo: "B2",
		label: "Gestión Activa",
		colorClass: "bg-orange-100 text-orange-800",
		colorHex: "#f97316",
		orden: 2,
	},
	{
		key: "mora_90",
		prefijo: "B3",
		label: "Rescate",
		colorClass: "bg-red-100 text-red-800",
		colorHex: "#ef4444",
		orden: 3,
	},
	{
		key: "mora_120",
		prefijo: "B4",
		label: "Última Instancia / Pre Jurídico",
		colorClass: "bg-red-200 text-red-900",
		colorHex: "#b91c1c",
		orden: 4,
	},
	{
		key: "mora_120_plus",
		prefijo: "B5",
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
		key: "pendiente_cancelacion",
		label: "Pendiente Cancelación",
		colorClass: "bg-purple-100 text-purple-800",
		colorHex: "#a855f7",
		orden: 8,
	},
	{
		key: "completado",
		label: "Completado",
		colorClass: "bg-blue-100 text-blue-800",
		colorHex: "#3b82f6",
		orden: 9,
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
	/** Número real de bucket (0-5) del catálogo dinámico — identidad estable, no `orden`. */
	numero: number;
	estadoMora: string;
	label: string;
	prefijo: string | null;
	color: string | null;
	orden: number;
	diasSla?: number | null;
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

/**
 * Bucket combinado a partir del número (0-5) que devuelve getAperturaDia/getBucketsCarga.
 *
 * Resuelve la fila por `numero` directo (`catalogoDeNumero`) en vez de pasar
 * por `ESTADO_MORA_POR_NUMERO[numero]` → buscar por estado: si un admin
 * reasigna qué `estado_mora` corresponde a qué `numero` en el catálogo, esa
 * ruta seguía devolviendo la fila VIEJA que ocupaba esa posición en el array
 * hardcodeado, no la fila real del bucket pedido (Codex, PR #1205 — mismo
 * defecto que ya se corrigió en `numeroDeEstadoMora`, acá en la dirección
 * inversa número→fila). Sin catálogo (aún no cargó), cae al default vía
 * `bucketDeEstado` con el estado hardcodeado — ahí no hay catálogo real que
 * pueda haberse reasignado.
 */
export function bucketDeNumero(
	numero: number,
	catalogo: BucketsCatalogoQueryData | undefined,
): BucketUI {
	const fila = catalogoDeNumero(numero, catalogo);
	if (fila) return bucketDeEstado(fila.estadoMora, catalogo);
	return bucketDeEstado(ESTADO_MORA_POR_NUMERO[numero], catalogo);
}

/**
 * CB-027: ¿el bucket numérico dado es B2 ("Gestión Activa")? Usado para
 * decidir si mostrar la card de convenio en el detalle de un caso, cuando
 * `bucketPrevio` es el último bucket registrado en buckets_historial ANTES
 * de que el crédito entrara en convenio (ver $id.tsx).
 *
 * NO compara `numero === 2`: `cartera.buckets.numero` es config dinámica (un
 * admin puede reasignar qué número corresponde a qué etapa — mismo tipo de
 * bug que el commit 78c92c9c / PR #1205 corrigió en otro lado). Resuelve la
 * fila real vía `bucketDeNumero` (catálogo dinámico con fallback a
 * ESTADO_MORA_POR_NUMERO) y compara por `key`, que es la clave estable
 * ("mora_60" = B2 en el catálogo semilla, independiente de qué `numero` DB
 * tenga asignado hoy).
 */
export function esBucketB2(
	numero: number | null,
	catalogo: BucketsCatalogoQueryData | undefined,
): boolean {
	if (numero === null) return false;
	return bucketDeNumero(numero, catalogo).key === "mora_60";
}

/**
 * Inverso de `bucketDeNumero`: número de bucket (0-5) a partir de un
 * `estadoMora`, o null si no matchea ninguno (pseudo-buckets de status como
 * "en_convenio"/"pagado" no tienen número — no son filas de aging).
 *
 * Usa el `numero` que el catálogo dinámico ya trae por fila (fuente real,
 * `cartera.buckets.numero`) en vez de reindexar `estadoMora` contra
 * `ESTADO_MORA_POR_NUMERO`. Reindexar por string se desalinea si un admin
 * reasigna qué `estado_mora` corresponde a qué `numero` en el catálogo — el
 * string seguiría matcheando una posición vieja del array hardcodeado, no el
 * bucket real (Codex, PR #1205: hacía exactamente eso y podía marcar
 * divergencia motor/CRM aunque ambos usaran la misma fila del catálogo).
 * `ESTADO_MORA_POR_NUMERO` queda solo de fallback cuando el catálogo dinámico
 * aún no cargó.
 */
export function numeroDeEstadoMora(
	estadoMora: string | null | undefined,
	catalogo: BucketsCatalogoQueryData | undefined,
): number | null {
	if (!estadoMora) return null;
	if (catalogo) {
		const fila = catalogo.find((b) => b.estadoMora === estadoMora);
		if (fila) return fila.numero;
	}
	const numero = ESTADO_MORA_POR_NUMERO.indexOf(
		estadoMora as (typeof ESTADO_MORA_POR_NUMERO)[number],
	);
	return numero === -1 ? null : numero;
}

/**
 * Fila cruda del catálogo dinámico para el bucket numérico (0-5), o undefined
 * si no cargó / no está.
 *
 * Busca por `b.numero === numero` directo — la fila ya trae su `numero` real
 * (CB-026). Antes buscaba por `b.estadoMora === ESTADO_MORA_POR_NUMERO[numero]`,
 * que devolvía la fila equivocada si un admin reasignaba qué `estado_mora`
 * corresponde a qué `numero` en `cartera.buckets` (Codex, PR #1205).
 */
export function catalogoDeNumero(
	numero: number,
	catalogo: BucketsCatalogoQueryData | undefined,
) {
	return catalogo?.find((b) => b.numero === numero);
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
		prefijo: dinamico.prefijo ?? base.prefijo ?? null,
		label: dinamico.label || base.label,
		colorClass: base.colorClass,
		colorHex: dinamico.color || base.colorHex,
		orden: dinamico.orden,
	};
}

/**
 * Label con el código de bucket adelante: "B1 - Alerta Temprana". Los estados
 * de status (En Convenio, Incobrable, Completado…) no son buckets de aging y no
 * tienen prefijo → se muestran tal cual, sin código.
 */
export function labelBucketConCodigo(b: BucketUI): string {
	return b.prefijo ? `${b.prefijo} - ${b.label}` : b.label;
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
