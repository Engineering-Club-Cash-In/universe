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
	/** Prefijo corto del catálogo ("B0".."B5"). `null` si viene del fallback estático. */
	prefijo: string | null;
	/** Color del catálogo dinámico (hex/tailwind, según lo edite cartera-back). `null` = la UI usa su default. */
	color: string | null;
	/** Orden de presentación (embudo, filtros). */
	orden: number;
	/** Días de SLA para contactar al cliente desde que entra al bucket. */
	diasSla: number | null;
	/**
	 * `statusCredit` que FUERZAN este bucket sin importar cuotas atrasadas
	 * (p.ej. INCOBRABLE → B5). Espejo de `estados_incluidos` en `cartera.buckets`
	 * — CB-128: se preserva del catálogo dinámico en vez de hardcodear qué
	 * status fuerza qué bucket, para que un admin reconfigurando esto en
	 * cartera-back no desalinee al CRM. `[]` = ningún status fuerza este bucket.
	 */
	estadosIncluidos: readonly string[];
}

export const MORA_BUCKETS: readonly MoraBucket[] = [
	{
		key: "0",
		estadoMora: "al_dia",
		min: 0,
		max: 0,
		label: "Cartera Sana",
		prefijo: "B0",
		color: null,
		orden: 0,
		diasSla: null,
		estadosIncluidos: [],
	},
	{
		key: "1",
		estadoMora: "mora_30",
		min: 1,
		max: 1,
		label: "Alerta Temprana",
		prefijo: "B1",
		color: null,
		orden: 1,
		diasSla: 3,
		estadosIncluidos: [],
	},
	{
		key: "2",
		estadoMora: "mora_60",
		min: 2,
		max: 2,
		label: "Gestión Activa",
		prefijo: "B2",
		color: null,
		orden: 2,
		diasSla: 3,
		estadosIncluidos: [],
	},
	{
		key: "3",
		estadoMora: "mora_90",
		min: 3,
		max: 3,
		label: "Rescate",
		prefijo: "B3",
		color: null,
		orden: 3,
		diasSla: 2,
		estadosIncluidos: [],
	},
	{
		key: "4",
		estadoMora: "mora_120",
		min: 4,
		max: 4,
		label: "Última Instancia / Pre Jurídico",
		prefijo: "B4",
		color: null,
		orden: 4,
		diasSla: 2,
		estadosIncluidos: [],
	},
	{
		key: "5",
		estadoMora: "mora_120_plus",
		min: 5,
		max: null,
		label: "Jurídico",
		prefijo: "B5",
		color: null,
		orden: 5,
		diasSla: 1,
		// Espejo del catálogo real: INCOBRABLE fuerza B5 vía `estados_incluidos`
		// en `cartera.buckets`. Ver `apps/cartera-back/src/controllers/credits.ts`.
		estadosIncluidos: ["INCOBRABLE"],
	},
] as const;

// `casos_cobros.estado_mora` es un pgEnum de 9 valores fijos en el CRM (ver
// db/schema/cobros.ts), pero el catálogo de cartera-back (`buckets.estado_mora`)
// solo representa los 6 buckets de AGING (B0-B5) — `en_convenio`/`pagado`/
// `incobrable` son estados de STATUS del crédito, resueltos aparte (ver
// mapearEstadoMora en sync-casos-cobros.ts), nunca filas del catálogo de
// buckets. Este set, derivado de MORA_BUCKETS en vez de repetir la lista a
// mano, es la whitelist real para cualquier estado_mora que venga del
// catálogo (varchar(24) editable a mano): aceptar un valor de status aquí
// sería válido en el enum de Postgres pero semánticamente incorrecto — un
// bucket de CUOTAS no debería poder tener un estado de status.
export const ESTADOS_AGING_VALIDOS = new Set(
	MORA_BUCKETS.map((b) => b.estadoMora),
);

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
		// Solo se aceptan `numero` conocidos en MORA_BUCKETS ("0".."5"). Un
		// `numero` fuera de ese conjunto (bucket nuevo agregado al catálogo sin
		// que el código sepa mapearlo) se descarta ENTERO, sin importar si su
		// estado_mora es válido: aceptarlo permitiría que un bucket huérfano con
		// `orden` bajo (ej. -1) gane el first-match de estadoMoraPorCuotas sobre
		// el bucket real y ensombrezca su clasificación para CUALQUIER crédito
		// en ese rango de cuotas — no solo el rango del bucket nuevo. Añadir un
		// bucket nuevo real requiere agregar su homólogo a MORA_BUCKETS primero.
		const catalogoConocido = catalogo.filter((b) =>
			MORA_BUCKETS.some((f) => f.key === String(b.numero)),
		);
		// Dedup por `numero`: si el catálogo trae dos filas con el mismo numero
		// (bug de query en cartera-back, o edición manual duplicada), quedarse
		// con la de `orden` más bajo de forma determinística — sin este dedup,
		// dos entradas con la misma key coexistirían en el cache y cuál gana el
		// first-match de `estadoMoraPorCuotas`/`rangoCuotasPorEstadoMora`
		// dependería del orden de iteración, no de una regla explícita.
		const porNumero = new Map<number, (typeof catalogoConocido)[number]>();
		for (const b of [...catalogoConocido].sort((a, b) => a.orden - b.orden)) {
			if (!porNumero.has(b.numero)) porNumero.set(b.numero, b);
		}
		// `estado_mora` null/inválido/de-status: la fila SÍ se conserva (numero
		// conocido, solo falta un estado de aging válido) usando el homólogo de
		// MORA_BUCKETS — nunca se propaga un valor fuera de ESTADOS_AGING_VALIDOS
		// (un valor de status como "en_convenio" sería válido en el pgEnum
		// completo pero semánticamente incorrecto para un bucket de CUOTAS, y un
		// valor fuera del enum entero revienta el INSERT/UPDATE en
		// sync-casos-cobros.ts).
		const mapped = Array.from(porNumero.values())
			.sort((a, b) => a.orden - b.orden)
			.map((b) => {
				const fallback = MORA_BUCKETS.find((f) => f.key === String(b.numero));
				const fallbackEstado = fallback?.estadoMora as string;
				const estadoMora =
					b.estado_mora && ESTADOS_AGING_VALIDOS.has(b.estado_mora)
						? b.estado_mora
						: fallbackEstado;
				return {
					key: String(b.numero),
					estadoMora,
					min: b.cuotas_min,
					max: b.cuotas_max,
					label: b.nombre,
					prefijo: b.prefijo,
					color: b.color,
					orden: b.orden,
					diasSla: b.dias_sla ?? fallback?.diasSla ?? null,
					estadosIncluidos: b.estados_incluidos ?? [],
				};
			});
		// Guard: catálogo vacío, o sin cubrir cada bucket conocido (siembra
		// parcial, fila desactivada/borrada por error) — un catálogo incompleto
		// reemplazando el cache dejaría rangos de cuotas sin cobertura. Todo-o-
		// nada: o el catálogo cubre cada key de MORA_BUCKETS, o no se usa y se
		// conserva el cache/fallback previo.
		const keysCubiertas = new Set(mapped.map((b) => b.key));
		const faltantes = MORA_BUCKETS.filter((f) => !keysCubiertas.has(f.key));
		if (faltantes.length > 0) {
			// Actualiza cachedAt igual que el catch de abajo: sin esto, con el
			// catálogo incompleto persistiendo (migración a medias, fila borrada
			// sin restaurar), cada llamada síncrona siguiente reintentaría el
			// fetch sin respetar el TTL, machacando cartera-back fila por fila.
			cachedAt = Date.now();
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
 * módulo en el mismo tick con el cache recién expirado). Devuelve el
 * refresh en vuelo (o `undefined` si el cache seguía vigente) para que
 * callers async opcionalmente lo esperen — los callers síncronos existentes
 * (hot paths como estadoMoraPorCuotas, llamados por fila en sync de casos)
 * ignoran el retorno y siguen sin bloquear.
 */
function maybeRefreshInBackground(): Promise<void> | undefined {
	if (Date.now() - cachedAt > CACHE_TTL_MS && !refreshInFlight) {
		refreshInFlight = refreshMoraBucketsCache().finally(() => {
			refreshInFlight = null;
		});
	}
	return refreshInFlight ?? undefined;
}

/**
 * CB-128: espera a que el catálogo dinámico esté cargado antes de seguir.
 *
 * Los helpers de este módulo son síncronos y refrescan en background, así que
 * la PRIMERA llamada tras un deploy (o tras expirar el TTL) responde con el
 * fallback estático MORA_BUCKETS. Para un filtro de UI eso da igual — la
 * siguiente carga ya trae el catálogo real. Pero `bucket_snapshot` CONGELA el
 * valor en la fila: un rango calculado con el catálogo equivocado queda como
 * dato histórico falso permanente, justo en la columna que existe para
 * preservar la verdad del momento.
 *
 * Llamar UNA vez al inicio de un flujo que va a grabar snapshots en lote (el
 * envío masivo de WhatsApp graba cientos de filas de golpe), nunca por fila: el
 * refresh está deduplicado, pero esperarlo por fila serializaría el lote.
 *
 * ── Por qué el guard es sobre el cache y NO sobre el TTL ──────────────────
 *
 * `refreshMoraBucketsCache` marca `cachedAt` incluso cuando FALLA (fetch caído
 * o catálogo incompleto), dejando `dynamicBucketsCache` en null. Ese backoff es
 * correcto para los helpers síncronos —evita machacar cartera-back fila por
 * fila mientras esté caído—, pero delegar en `maybeRefreshInBackground` lo
 * heredaba acá: un fallo hace 4 minutos hacía que esta función volviera al
 * instante sin esperar NADA, y el lote entero se grababa desde el fallback
 * estático aunque cartera-back ya estuviera sano. El costo no es una lectura
 * degradada que se corrige sola: son cientos de `bucket_snapshot` congelados
 * con el valor equivocado, para siempre.
 *
 * Por eso, si el catálogo nunca se pobló, este camino IGNORA el backoff y
 * fuerza el refresh. Es seguro justamente porque este flujo es raro y en lote
 * (un envío masivo, no una fila): el reintento que acá se fuerza no puede
 * multiplicarse por N filas como sí pasaría en los helpers síncronos. Se reusa
 * `refreshInFlight` para no duplicar un refresh que ya venga en camino.
 *
 * No lanza: si cartera-back no responde, `refreshMoraBucketsCache` conserva el
 * fallback y el flujo sigue — es lo mismo que pasaba antes, solo que ahora se
 * intentó primero.
 *
 * ── Por qué esperar con un timeout corto y no el del cliente ──────────────
 *
 * El cliente de cartera-back reintenta 3 veces con backoff exponencial sobre
 * un timeout de 30s cada una: ~127s en el peor caso. Sin cota acá, ese peor
 * caso se paga ANTES de que el envío masivo llame a un solo proveedor de
 * WhatsApp, y probablemente hace expirar el request completo (Codex, PR
 * #1299). El refresh en sí no se cancela (el cliente maneja su propio
 * timeout/reintentos); esta espera simplemente deja de bloquear cuando gana
 * el timer, igual que `capturarBucketSnapshot` más abajo en `routers/cobros.ts`.
 */
const TIMEOUT_ESPERAR_CATALOGO_MS = 5000;

export async function esperarCatalogoBuckets(): Promise<void> {
	const refresh =
		dynamicBucketsCache === null
			? (refreshInFlight ??= refreshMoraBucketsCache().finally(() => {
					refreshInFlight = null;
				}))
			: maybeRefreshInBackground();
	if (!refresh) return;

	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			refresh,
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, TIMEOUT_ESPERAR_CATALOGO_MS);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
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
		const dentro =
			b.max === null ? cuotas >= b.min : cuotas >= b.min && cuotas <= b.max;
		if (dentro) return b.estadoMora;
	}
	return "al_dia";
}

/**
 * CB-128: estados de `statusCredit` que dejan al crédito FUERA del funnel de
 * cobros y por lo tanto sin bucket.
 *
 * Espejo EXACTO de `STATUS_BUCKET_FUERA` en
 * apps/cartera-back/src/lib/buckets-classification.ts — mismos 4 estados, no
 * más, no menos. NO incluye INCOBRABLE: ese status SÍ tiene bucket (fuerza B5,
 * ver `numeroBucketPorCuotas`), la lista aquí es solo "sin aging por cuotas".
 * Un crédito en convenio ya se está pagando bajo otro acuerdo, uno cancelado
 * no se cobra y uno caído salió de cartera activa, así que sus cuotas
 * atrasadas no representan una etapa de aging.
 */
const STATUS_FUERA_DEL_FUNNEL: ReadonlySet<string> = new Set([
	"EN_CONVENIO",
	"CANCELADO",
	"PENDIENTE_CANCELACION",
	"CAIDO",
]);

/**
 * CB-128: ¿este `statusCredit` tiene bucket de cobros?
 *
 * Se exporta para que los callers que ya tienen el estado en memoria puedan
 * decidir sin ir a la red. `null`/`undefined` cuentan como fuera del funnel:
 * si no sabemos el estado, no inventamos un bucket.
 */
export function estaEnFunnelCobros(
	statusCredit: string | null | undefined,
): boolean {
	if (!statusCredit) return false;
	return !STATUS_FUERA_DEL_FUNNEL.has(statusCredit);
}

/**
 * CB-128: número de bucket (0-5) a partir de las cuotas atrasadas y el estado
 * del crédito.
 *
 * Hermano de `estadoMoraPorCuotas` pero devolviendo el número, que es lo que
 * guarda `contactos_cobros.bucket_snapshot`. Misma regla que
 * `bucketDeCredito()` de cartera-back (B0=0 cuotas, B1=1, … B5=≥5), evaluada
 * localmente: sirve para los flujos que YA tienen `cuotas_atrasadas` en memoria
 * y no necesitan una llamada de red para saber el bucket.
 *
 * `statusCredit` es OBLIGATORIO justamente para no repetir el bug que tenía la
 * primera versión de esta función: sin él, un crédito EN_CONVENIO con 3 cuotas
 * atrasadas se grababa como B3 e inflaba la segmentación por bucket del
 * historial con créditos que ya salieron del funnel. Devuelve `null` para esos
 * estados, igual que cartera-back.
 *
 * Orden idéntico a `bucketDeCredito()` de cartera-back: (1) fuera del funnel →
 * null; (2) status que FUERZA un bucket vía `estadosIncluidos` del catálogo
 * (p.ej. INCOBRABLE → B5, hoy); (3) rango de cuotas atrasadas. El paso (2) lee
 * el catálogo en vez de hardcodear el número — si un admin reasigna qué status
 * fuerza qué bucket en `cartera.buckets`, este helper lo sigue sin cambio de
 * código (Codex, PR #1299).
 *
 * ⚠️ Es SÍNCRONA: refresca en background y responde con lo que haya en cache,
 * que puede ser el fallback estático MORA_BUCKETS. Cuando el resultado va a
 * grabarse en `bucket_snapshot` —donde queda congelado— el caller DEBE haber
 * hecho `await esperarCatalogoBuckets()` antes del lote; esta función no lo
 * puede garantizar por sí sola. Hoy los rangos de cuotas coinciden entre el
 * catálogo dinámico y el estático, así que la diferencia no se nota, pero eso
 * es una coincidencia del dato actual y no un invariante: un admin puede
 * reconfigurar los rangos en cartera.buckets cuando quiera.
 */
export function numeroBucketPorCuotas(
	cuotas: number,
	statusCredit: string | null | undefined,
): number | null {
	if (!estaEnFunnelCobros(statusCredit)) return null;
	maybeRefreshInBackground();
	// (2) Status que fuerza un bucket vía el catálogo (p.ej. INCOBRABLE → B5).
	if (statusCredit) {
		const porStatus = activeBuckets().find((b) =>
			b.estadosIncluidos.includes(statusCredit),
		);
		if (porStatus) {
			const numero = Number(porStatus.key);
			return Number.isFinite(numero) ? numero : null;
		}
	}
	// (3) Por rango de cuotas atrasadas.
	for (const b of activeBuckets()) {
		const dentro =
			b.max === null ? cuotas >= b.min : cuotas >= b.min && cuotas <= b.max;
		if (dentro) {
			const numero = Number(b.key);
			return Number.isFinite(numero) ? numero : null;
		}
	}
	return null;
}

export type BucketParaUI = {
	/**
	 * Número real de bucket (0-5) del catálogo dinámico — `key` es su forma
	 * string. CB-026: el web lo usa para comparar divergencia motor/estadoMora
	 * por NÚMERO en vez de reindexar `estadoMora` contra el array hardcodeado
	 * ESTADO_MORA_POR_NUMERO, que puede desalinearse si un admin reasigna qué
	 * estado_mora corresponde a qué numero en cartera.buckets (Codex, PR #1205).
	 */
	numero: number;
	estadoMora: string;
	label: string;
	prefijo: string | null;
	color: string | null;
	orden: number;
	diasSla: number | null;
};

function mapearBucketsParaUI(): BucketParaUI[] {
	return activeBuckets()
		.map((b) => ({
			numero: Number(b.key),
			estadoMora: b.estadoMora,
			label: b.label,
			prefijo: b.prefijo,
			color: b.color,
			orden: b.orden,
			diasSla: b.diasSla,
		}))
		.sort((a, b) => a.orden - b.orden);
}

/**
 * Catálogo de buckets para RENDER en la web (label/color/orden por etapa) —
 * evita que el frontend mantenga sus propias copias hardcodeadas. `color`
 * puede venir `null` (catálogo dinámico sin color asignado, o fallback
 * estático): la UI debe tener su propio default visual en ese caso.
 *
 * Síncrona a propósito — dispara el refresh en background sin esperarlo,
 * igual que el resto de funciones de este módulo (estadoMoraPorCuotas, etc).
 * Para el endpoint ORPC (async, sin hot path) usar getBucketsParaUIAsync().
 */
export function getBucketsParaUI(): BucketParaUI[] {
	maybeRefreshInBackground();
	return mapearBucketsParaUI();
}

/**
 * Variante async de getBucketsParaUI() para callers que SÍ pueden esperar
 * (el endpoint ORPC, no un hot path). Si el cache nunca se pobló
 * (cold-start o recién reseteado), espera el primer refresh antes de
 * responder — sin esto, el primer caller tras un restart del server recibe
 * el fallback estático (color: null, labels genéricos) aunque cartera-back
 * esté sano, porque maybeRefreshInBackground() no bloquea. Si el cache ya
 * está poblado (aunque expirado), no espera — el refresh sigue en
 * background y esta llamada usa el valor cacheado, igual que la síncrona.
 */
export async function getBucketsParaUIAsync(): Promise<BucketParaUI[]> {
	const refresh = maybeRefreshInBackground();
	if (dynamicBucketsCache === null && refresh) {
		await refresh;
	}
	return mapearBucketsParaUI();
}

/**
 * True si el catálogo dinámico de cartera-back logró cargarse al menos una
 * vez (aunque esté expirado / pendiente de refresh). False si seguimos en
 * el fallback estático MORA_BUCKETS — ej. cold-start antes del primer fetch,
 * o cartera-back caído. Lo usa CB-020 (config de SLA) para no dejar guardar
 * con dias_sla placeholder del fallback como si fueran los valores reales.
 */
export function isDynamicCatalogLoaded(): boolean {
	return dynamicBucketsCache !== null;
}
