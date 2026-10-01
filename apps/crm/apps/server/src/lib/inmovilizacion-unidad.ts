/**
 * CB-041 — Lógica pura de la máquina de estados de una solicitud de
 * inmovilización (apagado) o reactivación de unidad.
 *
 * Separado del router para poder testear las transiciones y las reglas de
 * negocio (buckets permitidos, estado derivado de la unidad) sin tocar la
 * base de datos — mismo criterio que caso-vigente.ts y business-days-gt.ts.
 */

import { toDateStrGT } from "./guatemala-month-window";
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
	if (motivos.length === 0) return "Seleccione al menos un motivo.";
	const invalido = motivos.find((m) => !(m in MOTIVOS_INMOVILIZACION));
	if (invalido) return `Motivo no válido para un apagado: ${invalido}`;
	if (new Set(motivos).size !== motivos.length) return "Hay motivos repetidos.";
	if (motivos.includes("otro") && !detalle?.trim()) {
		return "Seleccionó «Otro»: indique el motivo en el detalle.";
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
	return "Falta la ubicación del vehículo: consúltela en el GPS o ingrese la dirección.";
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
	return "Adjunte la confirmación de LEGION (archivo) o escriba una nota.";
}

/** Formatos de la confirmación de LEGION: captura, foto o PDF del mensaje. */
export const MIME_EVIDENCIA_INMOVILIZACION = [
	"image/jpeg",
	"image/png",
	"image/webp",
	"application/pdf",
] as const;

// ── Solicitud de reactivación: qué pasó y con qué se respalda ───────────────

/**
 * Por qué se devuelve la unidad. Son las tres salidas reales de una visita o
 * llamada que justifican reactivar; "entrega voluntaria" y "sin contacto" no
 * aplican (la primera lleva a recuperación).
 */
export const QUE_PASO_REACTIVACION = {
	pago: {
		label: "Pago",
		descripcion: "Pagó lo vencido. El pago tiene que estar registrado.",
	},
	promesa: {
		label: "Promesa de pago",
		descripcion:
			"Se comprometió a pagar en una fecha. La promesa tiene que estar registrada.",
	},
	pago_parcial_promesa: {
		label: "Pago parcial + promesa",
		descripcion:
			"Pagó una parte ahora y promete el resto en una fecha. Pago y promesa registrados.",
	},
} as const;
export type QuePasoReactivacion = keyof typeof QUE_PASO_REACTIVACION;
export const CLAVES_QUE_PASO_REACTIVACION = Object.keys(
	QUE_PASO_REACTIVACION,
) as [QuePasoReactivacion, ...QuePasoReactivacion[]];

export const quePasoRequierePago = (q: QuePasoReactivacion) =>
	q === "pago" || q === "pago_parcial_promesa";
export const quePasoRequierePromesa = (q: QuePasoReactivacion) =>
	q === "promesa" || q === "pago_parcial_promesa";

/** Un pago de cartera-back ofrecido como respaldo (ya posterior al apagado). */
export type PagoRespaldo = {
	pagoId: number;
	/** Fecha del pago (YYYY-MM-DD, día de Guatemala). */
	fechaPago: string;
	monto: string;
	referencia: string | null;
	/**
	 * Estado de validación en cartera-back: `pending` = contabilidad todavía no lo
	 * validó. Es solo informativo (no bloquea la reactivación): el supervisor lo ve
	 * al decidir. Null en solicitudes anteriores a que se guardara.
	 */
	validacion?: "validated" | "pending" | "no_required" | null;
};

/** La promesa activa del caso que respalda la reactivación. */
export type PromesaRespaldo = {
	contactoId: string;
	/** ISO de la fecha prometida. */
	fechaPrometida: string;
	monto: string | null;
};

/** Lo que se guarda con la solicitud: qué vio el supervisor al decidir. */
export type RespaldoReactivacion = {
	pago?: PagoRespaldo;
	promesa?: PromesaRespaldo;
};

/**
 * Día (YYYY-MM-DD, Guatemala) de la `fecha_pago` que devuelve cartera-back: a
 * veces una fecha a medianoche UTC (columna `date`, se toma tal cual) y a veces
 * un instante con hora (se pasa a día de Guatemala). Null si no hay fecha.
 */
function diaDelPago(fechaPago: string | null | undefined): string | null {
	if (!fechaPago) return null;
	const f = fechaPago.trim();
	// Solo lo que empieza como fecha: un texto de estado ("pending", "N/A") no es
	// un día y no debe colarse al filtro ni a la pantalla.
	if (!/^\d{4}-\d{2}-\d{2}/.test(f)) return null;
	if (f.length <= 10 || /T00:00:00(\.0+)?Z?$/.test(f)) return f.slice(0, 10);
	const d = new Date(f);
	return Number.isNaN(d.getTime()) ? f.slice(0, 10) : toDateStrGT(d);
}

/**
 * Pagos de cartera que pueden respaldar una reactivación: los registrados el
 * día del apagado o después, con monto y sin anular. Cartera-back también
 * devuelve filas sin fecha o con monto 0 (cuotas todavía sin pagar): no son un
 * pago. Más reciente primero.
 */
export function pagosPosterioresAlApagado(
	pagos: readonly {
		pago_id: number;
		fecha_pago: string | null;
		monto_boleta: string | null;
		numeroAutorizacion: string | null;
		paymentFalse?: boolean;
		validationStatus?: string | null;
	}[],
	apagadoEjecutadoAt: Date,
): PagoRespaldo[] {
	const desde = toDateStrGT(apagadoEjecutadoAt);
	const respaldos: PagoRespaldo[] = [];
	for (const p of pagos) {
		const dia = diaDelPago(p.fecha_pago);
		const monto = Number(p.monto_boleta);
		if (!dia || dia < desde) continue;
		if (p.paymentFalse || !Number.isFinite(monto) || monto <= 0) continue;
		respaldos.push({
			pagoId: p.pago_id,
			fechaPago: dia,
			monto: p.monto_boleta as string,
			referencia: p.numeroAutorizacion,
			validacion:
				p.validationStatus === "validated" ||
				p.validationStatus === "pending" ||
				p.validationStatus === "no_required"
					? p.validationStatus
					: null,
		});
	}
	return respaldos.sort(
		(a, b) => b.fechaPago.localeCompare(a.fechaPago) || b.pagoId - a.pagoId,
	);
}

/**
 * Primer problema del respaldo para esa opción, o null si alcanza. "Pago" pide
 * un pago elegido; "Promesa", una promesa activa; "50% + promesa", las dos.
 */
export function erroresRespaldoReactivacion(
	quePaso: QuePasoReactivacion,
	respaldo: { pago?: unknown; promesa?: unknown },
): string | null {
	if (quePasoRequierePago(quePaso) && !respaldo.pago) {
		return "Seleccione el pago que respalda la reactivación (debe estar registrado después del apagado).";
	}
	if (quePasoRequierePromesa(quePaso) && !respaldo.promesa) {
		return "El caso no tiene una promesa de pago activa: regístrela primero en «Promesa / Convenio».";
	}
	return null;
}

/**
 * Una reactivación pedida antes de que hiciera falta el respaldo (la abría la
 * llamada posterior al apagado, o se pedía con un texto libre) no tiene
 * `quePaso` ni `respaldoReactivacion`: ni se aprueba ni se ejecuta, se pide de
 * nuevo con el pago o la promesa.
 */
export function reactivacionSinRespaldo(fila: {
	accion: string;
	quePaso: string | null;
	respaldoReactivacion: unknown;
}): boolean {
	return (
		fila.accion === "reactivacion" &&
		(!fila.quePaso || !fila.respaldoReactivacion)
	);
}

export const MENSAJE_REACTIVACION_SIN_RESPALDO =
	"Esta reactivación se solicitó sin el respaldo de pago o promesa de pago que ahora se exige. Solicítela de nuevo y seleccione el respaldo.";

/** Texto de la columna `motivo` de una reactivación: opción elegida y detalle. */
export function componerMotivoReactivacion(
	quePaso: QuePasoReactivacion,
	detalle: string | null | undefined,
): string {
	const base = QUE_PASO_REACTIVACION[quePaso].label;
	const extra = detalle?.trim();
	return extra ? `${base} — ${extra}` : base;
}
