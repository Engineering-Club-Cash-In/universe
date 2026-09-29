/**
 * CB-041 — Lógica pura de la máquina de estados de una solicitud de
 * inmovilización (apagado) o reactivación de unidad.
 *
 * Separado del router para poder testear las transiciones y las reglas de
 * negocio (buckets permitidos, estado derivado de la unidad) sin tocar la
 * base de datos — mismo criterio que caso-vigente.ts y business-days-gt.ts.
 */

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
