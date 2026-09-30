/**
 * CB-041 — Lógica pura de la máquina de estados de una solicitud de
 * inmovilización (apagado) o reactivación de unidad.
 *
 * Separado del router para poder testear las transiciones y las reglas de
 * negocio (buckets permitidos, estado derivado de la unidad) sin tocar la
 * base de datos — mismo criterio que caso-vigente.ts y business-days-gt.ts.
 */

import { MOTIVOS_RECUPERACION_FORZOSA } from "./recuperacion-vehiculo";

export type InmovilizacionAccion = "apagado" | "reactivacion";

export type InmovilizacionEstado =
	| "pendiente_aprobacion"
	| "aprobada"
	| "rechazada"
	| "ejecutada"
	| "cancelada";

export type InmovilizacionEvento =
	| "aprobar"
	| "rechazar"
	| "marcar_ejecutada"
	| "cancelar";

/**
 * Buckets donde se habilita el flujo: B2/B3 (Asesor Sr) y B4 (Asesor
 * Especializado, CB-120). El rol lo define el bucket del caso, no un atributo
 * del usuario. Se cambia SOLO acá, no en el router.
 *
 * Limitación conocida: la ejecución automática sobre la unidad (Wialon/LEGION,
 * `unit/exec_cmd`) NO forma parte de este flujo. Ver
 * services/inmovilizacion/ejecutor.ts.
 */
export const BUCKETS_INMOVILIZACION: readonly number[] = [2, 3, 4];

/** Texto legible de los buckets habilitados, para mensajes de error ("B2/B3/B4"). */
export function bucketsInmovilizacionTexto(): string {
	return BUCKETS_INMOVILIZACION.map((b) => `B${b}`).join("/");
}

/**
 * Tabla de transiciones válidas. Una transición fuera de esta tabla es un
 * error de negocio (CONFLICT en el router, típicamente "otro supervisor ya
 * decidió" o "la solicitud ya no está en ese estado").
 */
const TRANSICIONES: Record<
	InmovilizacionEstado,
	Partial<Record<InmovilizacionEvento, InmovilizacionEstado>>
> = {
	pendiente_aprobacion: {
		aprobar: "aprobada",
		rechazar: "rechazada",
		cancelar: "cancelada",
	},
	aprobada: {
		marcar_ejecutada: "ejecutada",
	},
	rechazada: {},
	ejecutada: {},
	cancelada: {},
};

/**
 * ¿Es válido aplicar `evento` a una solicitud que está en `estadoActual`?
 * Pura — no decide QUIÉN puede aplicarlo (eso lo valida el router con el
 * rol y el dueño de la solicitud).
 */
export function transicionValida(
	estadoActual: InmovilizacionEstado,
	evento: InmovilizacionEvento,
): boolean {
	return TRANSICIONES[estadoActual]?.[evento] !== undefined;
}

/**
 * Estado resultante de aplicar `evento` sobre `estadoActual`, o `null` si la
 * transición no es válida.
 */
export function siguienteEstado(
	estadoActual: InmovilizacionEstado,
	evento: InmovilizacionEvento,
): InmovilizacionEstado | null {
	return TRANSICIONES[estadoActual]?.[evento] ?? null;
}

export type EstadoUnidad = "activa" | "inmovilizada";

/**
 * Fila mínima del historial que necesita `estadoUnidad` para derivar si la
 * unidad está inmovilizada — no el registro completo de la tabla.
 */
export interface InmovilizacionHistorialItem {
	accion: InmovilizacionAccion;
	estado: InmovilizacionEstado;
	ejecutadoAt: Date | string | null;
}

/**
 * Estado de la unidad (activa/inmovilizada) DERIVADO del historial — nunca
 * se persiste como columna aparte, para no arriesgar que quede
 * desincronizado del historial real.
 *
 * Regla: la unidad está inmovilizada si la ÚLTIMA fila `ejecutada` (por
 * `ejecutadoAt`) fue un `apagado`. Si la última ejecutada fue una
 * `reactivacion`, o no hay ninguna ejecutada, está activa.
 */
export function estadoUnidad(
	historial: readonly InmovilizacionHistorialItem[],
): EstadoUnidad {
	const ejecutadas = historial.filter(
		(
			item,
		): item is InmovilizacionHistorialItem & { ejecutadoAt: Date | string } =>
			item.estado === "ejecutada" && item.ejecutadoAt != null,
	);
	if (ejecutadas.length === 0) return "activa";

	const ultima = ejecutadas.reduce((masReciente, actual) => {
		const tActual = new Date(actual.ejecutadoAt).getTime();
		const tMasReciente = new Date(masReciente.ejecutadoAt).getTime();
		return tActual > tMasReciente ? actual : masReciente;
	});

	return ultima.accion === "apagado" ? "inmovilizada" : "activa";
}

/**
 * ¿Se puede solicitar `accion` sobre una unidad en `estado`, dado el
 * `bucket` actual del crédito?
 *
 * - `apagado` exige unidad activa Y bucket habilitado. null/undefined (no se
 *   pudo resolver el bucket desde cartera-back) NO habilita: fail closed,
 *   mismo criterio que ubicaciones-clave.ts para B4.
 * - `reactivacion` exige SOLO unidad inmovilizada, sin mirar el bucket: el
 *   caso normal es justamente que el cliente pagó y su crédito bajó a B0/B1
 *   (o salió del funnel, p. ej. EN_CONVENIO). Exigir un bucket habilitado dejaría el carro
 *   apagado sin forma de reactivarlo.
 */
export function puedeSolicitar(
	accion: InmovilizacionAccion,
	estado: EstadoUnidad,
	bucket: number | null | undefined,
): boolean {
	if (accion === "reactivacion") return estado === "inmovilizada";
	if (bucket == null || !BUCKETS_INMOVILIZACION.includes(bucket)) {
		return false;
	}
	return estado === "activa";
}

// ── Solicitud de apagado: motivos y ubicación ───────────────────────────────

/**
 * Motivos que el asesor marca al pedir un apagado: los mismos de la
 * recuperación forzosa, menos "Se inmovilizó la unidad y no pagó", que solo
 * tiene sentido DESPUÉS de haber apagado la unidad.
 */
export const MOTIVOS_INMOVILIZACION: Record<string, string> =
	Object.fromEntries(
		Object.entries(MOTIVOS_RECUPERACION_FORZOSA).filter(
			([clave]) => clave !== "inmovilizada_sin_pago",
		),
	);

/**
 * Dónde estaba el vehículo al solicitar o al ejecutar el apagado. `gps` viene
 * de una consulta auditada a Wialon (`consultaLogId` la enlaza con
 * `gps_consulta_logs`); `manual` es lo que escribió el asesor; `sin_ubicacion`
 * es una ejecución con Wialon caído (solo válida al ejecutar).
 */
export type UbicacionInmovilizacion = {
	fuente: "gps" | "manual" | "sin_ubicacion";
	lat?: number | null;
	lng?: number | null;
	unidad?: string | null;
	/** ISO de la última posición/señal que reportó la unidad. */
	senalAt?: string | null;
	velocidadKmh?: number | null;
	ignicion?: boolean | null;
	consultaLogId?: string | null;
	direccion?: string | null;
	enlace?: string | null;
	/** Por qué no hay posición GPS (Wialon caído, sin posición, etc.). */
	aviso?: string | null;
};

/** Por encima de esta velocidad (km/h) se considera que la unidad va en marcha. */
const VELOCIDAD_EN_MARCHA_KMH = 5;

/**
 * Advertencia si la unidad parece estar en uso. Solo se muestra y se guarda:
 * no bloquea (decisión de negocio) — la seguridad del apagado la valora quien
 * lo aprueba y LEGION.
 */
export function advertenciaEnMarcha(
	u:
		| Pick<UbicacionInmovilizacion, "velocidadKmh" | "ignicion">
		| null
		| undefined,
): string | null {
	if (!u) return null;
	if (u.velocidadKmh != null && u.velocidadKmh >= VELOCIDAD_EN_MARCHA_KMH) {
		return `El vehículo va en movimiento (${Math.round(u.velocidadKmh)} km/h).`;
	}
	if (u.ignicion === true) return "El vehículo tiene el motor encendido.";
	return null;
}

/**
 * Primer problema de los motivos marcados (catálogo, repetidos, "Otro" sin
 * detalle) o null si están completos. Mismas reglas que la recuperación
 * forzosa (`erroresDetalleRecuperacion`).
 */
export function erroresMotivosInmovilizacion(
	motivos: readonly string[],
	detalle: string | null | undefined,
): string | null {
	if (motivos.length === 0) return "Elegí al menos un motivo.";
	const invalido = motivos.find((m) => !(m in MOTIVOS_INMOVILIZACION));
	if (invalido) return `Motivo no válido para un apagado: ${invalido}`;
	if (new Set(motivos).size !== motivos.length) return "Hay motivos repetidos.";
	if (motivos.includes("otro") && !detalle?.trim()) {
		return "Marcaste «Otro»: contá en el detalle cuál es el motivo.";
	}
	return null;
}

/**
 * Texto que va en la columna `motivo` (NOT NULL): etiquetas de los motivos y,
 * si hay, el detalle. Es lo que leen la cola, el historial y las
 * notificaciones, que no conocen la lista estructurada.
 */
export function componerMotivoApagado(
	motivos: readonly string[],
	detalle: string | null | undefined,
): string {
	const etiquetas = motivos
		.map((m) => MOTIVOS_INMOVILIZACION[m] ?? m)
		.join(", ");
	const extra = detalle?.trim();
	return extra ? `${etiquetas} — ${extra}` : etiquetas;
}

/**
 * La ubicación del apagado es obligatoria al solicitar: o la consulta GPS, o
 * una dirección/enlace que escribió el asesor (si Wialon no respondió).
 */
export function erroresUbicacionSolicitud(u: {
	consultaLogId?: string | null;
	direccion?: string | null;
	enlace?: string | null;
}): string | null {
	if (u.consultaLogId || u.direccion?.trim() || u.enlace?.trim()) return null;
	return "Falta la ubicación del vehículo: tomala del GPS o escribí la dirección.";
}

/**
 * Para declarar el apagado ejecutado el asesor adjunta la confirmación de
 * LEGION como archivo, como nota, o ambos — pero no ninguno.
 */
export function erroresEvidenciaEjecucion(e: {
	evidencia?: { key: string } | null;
	nota?: string | null;
}): string | null {
	if (e.evidencia?.key || e.nota?.trim()) return null;
	return "Adjuntá la confirmación de LEGION (archivo) o escribí una nota.";
}

/** Formatos de la confirmación de LEGION: captura, foto o PDF del mensaje. */
export const MIME_EVIDENCIA_INMOVILIZACION = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"application/pdf",
] as const;
