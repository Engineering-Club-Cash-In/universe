/**
 * CB-127 · Catálogos y helpers de formato para la bitácora y las acciones de
 * supervisor sobre grupos Págalo. Mismo patrón que
 * components/cobros/historial/formato.ts (de donde se reexportan
 * fechaHora/partesGT, fijadas a la zona de Guatemala — no redefinir acá).
 */

export { fechaHora, partesGT } from "@/components/cobros/historial/formato";

export const ESTADO_GRUPO_INFO: Record<
	string,
	{ label: string; className: string }
> = {
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

export function getEstadoGrupoInfo(status: string) {
	return (
		ESTADO_GRUPO_INFO[status] ?? {
			label: status,
			className: "bg-muted text-muted-foreground",
		}
	);
}

export const EVENTO_LABEL: Record<string, string> = {
	GROUP_CREATED: "Grupo creado",
	LINK_ACTIVE: "Link activo",
	LINK_CREATE_FAILED: "Falló creación de link",
	LINK_PAID: "Link pagado",
	LINK_TERMINAL: "Link cerrado por Págalo",
	REPLACED_LINK_PAID: "Se pagó un link reemplazado",
	GROUP_READY: "Listo para aplicar",
	GROUP_PARTIALLY_PAID: "Pago parcial",
	GROUP_COMPLETED: "Aplicado en cartera",
	GROUP_REVIEW_REQUIRED: "Requiere revisión",
	GROUP_REPLACED: "Grupo reemplazado",
	GROUP_ABORTED: "Emisión abortada",
	GROUP_ABORTED_WITH_PAYMENT: "Emisión abortada con pago",
	GROUP_INVALIDATED_BY_SUPERVISOR: "Invalidado por supervisor",
	GROUP_REGENERATED: "Regenerado por supervisor",
	LINK_INVALIDATED_BY_SUPERVISOR: "Link invalidado por supervisor",
	LINK_REGENERATED_BY_SUPERVISOR: "Link regenerado por supervisor",
	DISPATCH_RETRY_FORCED: "Reintento forzado por supervisor",
	POLL_RETRY_EXHAUSTED: "Reintentos de sincronización agotados",
	DISPATCH_RETRY_EXHAUSTED: "Reintentos de aplicación agotados",
};

export function etiquetaEvento(eventType: string): string {
	return EVENTO_LABEL[eventType] ?? eventType;
}

export const FUENTE_LABEL: Record<string, string> = {
	ASESOR: "Asesor",
	BOT: "Bot WhatsApp",
	PAGALO: "Págalo",
	PAGALO_POLLER: "Sincronización",
	PAGALO_DISPATCHER: "Aplicación en cartera",
	SUPERVISOR: "Supervisor",
};

export function etiquetaFuente(source: string): string {
	return FUENTE_LABEL[source] ?? source;
}

export const MOTIVO_REVISION_LABEL: Record<string, string> = {
	PAGALO_PAYLOAD_HASH_CONFLICT:
		"Conflicto de contenido con un reintento previo",
	PAGALO_LIVE_DEBT_REVIEW: "La deuda viva no coincide con el snapshot",
	PAGALO_LIVE_CREDIT_IDENTITY_REVIEW:
		"El crédito ya no coincide (SIFCO cambió)",
	PAGALO_TRANSACTION_ALREADY_IMPORTED: "La transacción ya fue importada",
	PAGALO_INVALID_COMMAND: "Comando inválido para cartera",
	PAGALO_REVIEW_REQUIRED_UNKNOWN_REASON: "Motivo de revisión no identificado",
};

export function etiquetaMotivo(codigo: string | null): string | null {
	if (!codigo) return null;
	return MOTIVO_REVISION_LABEL[codigo] ?? codigo;
}

/** Umbral puramente visual (sin efecto de negocio — D-19, docs/features/pagalo/DECISIONES.md). */
const DIAS_ALERTA_ANTIGUEDAD = 7;

export function antiguedadLink(desde: string | Date | null): {
	dias: number | null;
	etiqueta: string;
	alerta: boolean;
} {
	if (!desde) return { dias: null, etiqueta: "—", alerta: false };
	const ms = Date.now() - new Date(desde).getTime();
	const dias = Math.floor(ms / 86_400_000);
	if (dias <= 0) return { dias: 0, etiqueta: "hoy", alerta: false };
	return {
		dias,
		etiqueta: dias === 1 ? "1 día" : `${dias} días`,
		alerta: dias >= DIAS_ALERTA_ANTIGUEDAD,
	};
}
