/**
 * CB-127 · Catálogos y helpers de formato para la bitácora y las acciones
 * de supervisor de Págalo. `fechaHora`/`partesGT` se reexportan de
 * historial/formato.ts (fijadas a zona GT) — no se redefinen acá.
 */
export {
	fechaHora,
	partesGT,
	soloFecha,
} from "@/components/cobros/historial/formato";

export const EVENTO_LABEL: Record<string, string> = {
	GROUP_CREATED: "Grupo creado",
	LINK_ACTIVE: "Link activo",
	LINK_PAID: "Link pagado",
	// Págalo dio por vencido/cancelado el link del otro lado — no es una
	// expiración por política nuestra (D-51: los links no expiran acá).
	LINK_TERMINAL: "Link cerrado por Págalo",
	REPLACED_LINK_PAID: "Se pagó un link reemplazado",
	GROUP_READY: "Grupo listo para aplicar",
	GROUP_PARTIALLY_PAID: "Grupo con pago parcial",
	GROUP_COMPLETED: "Grupo completado",
	GROUP_REVIEW_REQUIRED: "Grupo enviado a revisión",
	GROUP_REPLACED: "Grupo reemplazado",
	GROUP_ABORTED: "Grupo cancelado",
	GROUP_ABORTED_WITH_PAYMENT: "Grupo cancelado con pago",
	GROUP_INVALIDATED_BY_SUPERVISOR: "Invalidado por supervisor",
	GROUP_REGENERATED: "Regenerado por supervisor",
	DISPATCH_RETRY_FORCED: "Reintento de aplicación forzado",
	LINK_CREATE_FAILED: "Falló la creación del link",
	POLL_RETRY_EXHAUSTED: "Reintentos de verificación agotados",
	DISPATCH_RETRY_EXHAUSTED: "Reintentos de aplicación agotados",
};

export function etiquetaEvento(eventType: string): string {
	return EVENTO_LABEL[eventType] ?? eventType;
}

export const FUENTE_LABEL: Record<string, string> = {
	ASESOR: "Asesor",
	BOT: "Bot de WhatsApp",
	SUPERVISOR: "Supervisor",
	PAGALO: "Págalo",
	PAGALO_POLLER: "Sincronización",
	PAGALO_DISPATCHER: "Aplicación en cartera",
};

export function etiquetaFuente(source: string): string {
	return FUENTE_LABEL[source] ?? source;
}

/**
 * `lastDispatchError` guarda uno de estos códigos cuando el grupo llega a
 * REVIEW_REQUIRED vía dispatch (pagalo-import-client.ts / pagalo-dispatch.ts)
 * — o un mensaje libre en otros casos de fallo transitorio, que se muestra
 * tal cual si no matchea ningún código conocido.
 */
export const MOTIVO_REVISION_LABEL: Record<string, string> = {
	PAGALO_PAYLOAD_HASH_CONFLICT:
		"El comando cambió respecto a un intento previo con el mismo pago",
	PAGALO_LIVE_DEBT_REVIEW:
		"La deuda viva del crédito no coincide con lo esperado",
	PAGALO_LIVE_CREDIT_IDENTITY_REVIEW:
		"La identidad del crédito no coincide con lo esperado",
	PAGALO_TRANSACTION_ALREADY_IMPORTED:
		"Esta transacción ya fue importada antes",
	PAGALO_INVALID_COMMAND:
		"El comando de aplicación no pasó validación (revisar con backend)",
	PAGALO_REVIEW_REQUIRED_UNKNOWN_REASON:
		"Cartera pidió revisión sin especificar motivo",
};

export function etiquetaMotivoRevision(codigo: string | null): string | null {
	if (!codigo) return null;
	return MOTIVO_REVISION_LABEL[codigo] ?? codigo;
}

export type EstadoGrupoInfo = { label: string; className: string };

export const ESTADO_GRUPO_INFO: Record<string, EstadoGrupoInfo> = {
	DRAFT: { label: "Borrador", className: "bg-muted text-muted-foreground" },
	LINKS_PENDING: {
		label: "Creando links",
		className: "bg-blue-50 text-blue-700",
	},
	PENDING_PAYMENT: {
		label: "Esperando pago",
		className: "bg-amber-50 text-amber-700",
	},
	PARTIALLY_PAID: {
		label: "Pago parcial",
		className: "bg-amber-50 text-amber-700",
	},
	READY_TO_APPLY: {
		label: "Listo para aplicar",
		className: "bg-blue-50 text-blue-700",
	},
	APPLYING: { label: "Aplicando", className: "bg-blue-50 text-blue-700" },
	COMPLETED: {
		label: "Completado",
		className: "bg-green-50 text-green-700",
	},
	APPLICATION_FAILED: {
		label: "Falló al aplicar",
		className: "bg-red-50 text-red-700",
	},
	REVIEW_REQUIRED: {
		label: "Requiere revisión",
		className: "bg-red-50 text-red-700",
	},
	CANCELLED: {
		label: "Cancelado",
		className: "bg-muted text-muted-foreground",
	},
};

export function estadoGrupoInfo(status: string): EstadoGrupoInfo {
	return (
		ESTADO_GRUPO_INFO[status] ?? {
			label: status,
			className: "bg-muted text-muted-foreground",
		}
	);
}

/** Umbral puramente visual (D-19) — no dispara ninguna acción automática. */
const ANTIGUEDAD_ALERTA_DIAS = 7;

export type AntiguedadLink = {
	dias: number;
	etiqueta: string;
	alerta: boolean;
};

export function antiguedadLink(
	desde: string | Date | null,
): AntiguedadLink | null {
	if (!desde) return null;
	const dias = Math.floor(
		(Date.now() - new Date(desde).getTime()) / (24 * 60 * 60 * 1000),
	);
	if (dias < 0) return null;
	return {
		dias,
		etiqueta: dias === 0 ? "Hoy" : dias === 1 ? "1 día" : `${dias} días`,
		alerta: dias >= ANTIGUEDAD_ALERTA_DIAS,
	};
}
