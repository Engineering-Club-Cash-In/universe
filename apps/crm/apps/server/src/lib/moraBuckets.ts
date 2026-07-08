import { carteraBackClient } from "../services/cartera-back-client";

/**
 * Fuente única de verdad (lado CRM) de los buckets de aging de mora por cuotas
 * atrasadas. Espejo de `apps/cartera-back/src/config/moraBuckets.ts`: mantener
 * ambos alineados. Todo lo que mapea una etapa (estadoMora) a un rango de cuotas
 * deriva de aquí — agregar/mover una etapa se hace solo en esta lista.
 *
 * Semántica del rango:
 *   - `min` inclusivo.
 *   - `max = null`  → sin tope: cuenta `>= min` (el bucket "+", el último).
 *   - `min === max` → exacto: cuenta `= min`.
 *   - `min < max`   → rango cerrado: `BETWEEN min AND max`.
 */
export interface MoraBucket {
	/** Clave numérica que devuelve cartera-back en `porCuotasAtrasadas`. */
	key: string;
	/** Etapa de mora que consume el frontend / casos_cobros. */
	estadoMora: string;
	/** Mínimo de cuotas atrasadas (inclusivo). */
	min: number;
	/** Máximo de cuotas atrasadas (inclusivo). `null` = sin tope (>= min). */
	max: number | null;
	/** Nombre de negocio mostrado en el frontend (embudo + filtros). */
	label: string;
}

export const MORA_BUCKETS: readonly MoraBucket[] = [
	{ key: "0", estadoMora: "al_dia", min: 0, max: 0, label: "Cartera Sana" },
	{ key: "1", estadoMora: "mora_30", min: 1, max: 1, label: "Alerta Temprana" },
	{ key: "2", estadoMora: "mora_60", min: 2, max: 2, label: "Gestión Activa" },
	{ key: "3", estadoMora: "mora_90", min: 3, max: 3, label: "Rescate" },
	{ key: "4", estadoMora: "mora_120", min: 4, max: 4, label: "Última Instancia / Pre Jurídico" },
	{ key: "5", estadoMora: "mora_120_plus", min: 5, max: null, label: "Jurídico" },
] as const;

// `casos_cobros.estado_mora` es un pgEnum de 9 valores fijos en el CRM (ver
// db/schema/cobros.ts). El catálogo de cartera-back (`buckets.estado_mora`) es
// varchar(24) editable a mano — un admin puede escribir cualquier texto ahí.
// Sin esta whitelist, ese texto libre se castea `as EstadoMoraEnum` en
// sync-casos-cobros.ts y el INSERT/UPDATE revienta en Postgres con "invalid
// input value for enum" (silencioso: cae al catch por-crédito, el caso
// simplemente no se sincroniza). Solo se acepta un estado_mora del catálogo si
// es uno de estos 9; si no, se usa el fallback homólogo por número de bucket.
export const ESTADOS_MORA_VALIDOS = new Set([
	"al_dia",
	"en_convenio",
	"mora_30",
	"mora_60",
	"mora_90",
	"mora_120",
	"mora_120_plus",
	"pagado",
	"incobrable",
]);

/**
 * Cache en memoria de MORA_BUCKETS poblada desde el catálogo dinámico de
 * cartera-back (tabla `cartera.buckets`). Arranca en `null` (usa el estático
 * MORA_BUCKETS de arriba) hasta que `refreshMoraBucketsCache()` la puebla;
 * si el fetch falla se mantiene el fallback estático, nunca lanza.
 */
let dynamicBucketsCache: readonly MoraBucket[] | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — el catálogo cambia poco (admin lo edita a mano)

function activeBuckets(): readonly MoraBucket[] {
	return dynamicBucketsCache ?? MORA_BUCKETS;
}

/**
 * Resetea el cache en memoria a su estado inicial (sin poblar). Test-only:
 * el módulo es un singleton con estado global (`dynamicBucketsCache`,
 * `cachedAt`) que persiste entre tests si no se limpia explícitamente.
 */
export function __resetMoraBucketsCacheForTests(): void {
	dynamicBucketsCache = null;
	cachedAt = 0;
	refreshInFlight = null;
}

/**
 * Refresca la cache de buckets desde cartera-back. No lanza: si falla, conserva
 * el cache/fallback previos. Uso normal es interno, vía `maybeRefreshInBackground`
 * (lazy, disparado por las funciones exportadas de abajo) — se exporta para que
 * los tests puedan poblar el cache de forma determinística sin esperar al TTL,
 * y como warm-up manual opcional si algún caller quisiera precalentar el cache.
 */
export async function refreshMoraBucketsCache(): Promise<void> {
	try {
		const catalogo = await carteraBackClient.getBucketsCatalogo();
		// No se descartan filas con `estado_mora` null/inválido: eso dejaría su
		// rango de cuotas sin cobertura y `estadoMoraPorCuotas` caería al "al_dia"
		// final del loop para créditos realmente atrasados (persistido como etapa
		// del caso). En vez de eso, cada fila usa su propio `estado_mora` si es
		// uno de los 9 valores del enum del CRM, o el del bucket homólogo de
		// MORA_BUCKETS (mismo `numero`/`key`) si no — nunca se propaga un valor
		// fuera del enum (revienta el INSERT/UPDATE en sync-casos-cobros.ts).
		const mapped = catalogo
			.sort((a, b) => a.orden - b.orden)
			.map((b) => {
				const fallbackEstado =
					MORA_BUCKETS.find((f) => f.key === String(b.numero))?.estadoMora ??
					"al_dia";
				const estadoMora =
					b.estado_mora && ESTADOS_MORA_VALIDOS.has(b.estado_mora)
						? b.estado_mora
						: fallbackEstado;
				return {
					key: String(b.numero),
					estadoMora,
					min: b.cuotas_min,
					max: b.cuotas_max,
					label: b.nombre,
				};
			});
		// Guard: catálogo vacío, o sin cubrir cada bucket del fallback conocido
		// (siembra parcial, fila desactivada/borrada por error) — un catálogo
		// incompleto reemplazando el cache dejaría rangos de cuotas sin cobertura
		// (mismo síntoma que el guard de arriba, por otra puerta). Se cuentan
		// `numero`/`key` DISTINTOS, no filas: un catálogo con una fila duplicada
		// (mismo numero dos veces, otro numero ausente) tendría el mismo
		// `mapped.length` que uno completo y colaría por un `length < length`
		// simple. Todo-o-nada: o el catálogo cubre cada key del fallback, o no
		// se usa y se conserva el cache/fallback previo.
		const keysCubiertas = new Set(mapped.map((b) => b.key));
		const faltantes = MORA_BUCKETS.filter((f) => !keysCubiertas.has(f.key));
		if (faltantes.length > 0) {
			console.error(
				`[moraBuckets] Catálogo incompleto (faltan buckets: ${faltantes.map((f) => f.key).join(", ")}) — se mantiene fallback previo`,
			);
			return;
		}
		dynamicBucketsCache = mapped;
		cachedAt = Date.now();
	} catch (err) {
		// Aunque falle, se respeta el TTL antes de reintentar — sin esto, con
		// cachedAt sin tocar (0 al arranque), cada llamada síncrona siguiente
		// (una por fila en tablas de cobros) dispararía un fetch nuevo mientras
		// cartera-back esté caído, sin backoff.
		cachedAt = Date.now();
		console.error(
			"[moraBuckets] Error refrescando catálogo de buckets, se mantiene fallback:",
			err,
		);
	}
}

let refreshInFlight: Promise<void> | null = null;

/**
 * Dispara un refresh en background si el cache expiró, sin bloquear la
 * llamada actual. Deduplica: si ya hay un refresh en vuelo, no dispara otro
 * (evita N fetches concurrentes cuando N filas de una tabla llaman a este
 * módulo en el mismo tick con el cache recién expirado).
 */
function maybeRefreshInBackground(): void {
	if (Date.now() - cachedAt > CACHE_TTL_MS && !refreshInFlight) {
		refreshInFlight = refreshMoraBucketsCache().finally(() => {
			refreshInFlight = null;
		});
	}
}

/** Rango { min, max } de cuotas atrasadas para una etapa. `undefined` si no aplica filtro por cuotas. */
export function rangoCuotasPorEstadoMora(
	estadoMora: string,
): { min: number; max: number | undefined } | undefined {
	maybeRefreshInBackground();
	const b = activeBuckets().find((x) => x.estadoMora === estadoMora);
	if (!b) return undefined;
	return { min: b.min, max: b.max ?? undefined };
}

/** Nombre de negocio (label) de una etapa. `undefined` si no es bucket de aging. */
export function labelPorEstadoMora(estadoMora: string): string | undefined {
	maybeRefreshInBackground();
	return activeBuckets().find((b) => b.estadoMora === estadoMora)?.label;
}

/** Etapa de mora correspondiente a un número de cuotas atrasadas. */
export function estadoMoraPorCuotas(cuotas: number): string {
	maybeRefreshInBackground();
	for (const b of activeBuckets()) {
		const dentro = b.max === null ? cuotas >= b.min : cuotas >= b.min && cuotas <= b.max;
		if (dentro) return b.estadoMora;
	}
	return "al_dia";
}
