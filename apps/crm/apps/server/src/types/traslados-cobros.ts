export type SolicitudTraslado = {
	asesorOrigenId: number;
	asesorDestinoId?: number;
	asesorDestinoEspecialId?: number;
	destinosPorBucket?: Record<string, number>;
	modo: "traslado_completo" | "redistribucion" | "destino_por_bucket";
	motivo: string;
	/** M5: reparte por utilización (carga ÷ capacidad) y no por cantidad de cuentas. */
	ponderarPorCapacidad?: boolean;
	/** M5: las cuentas fuera del funnel se quedan con el asesor de origen. */
	mantenerEspeciales?: boolean;
	/** M5: el asesor de origen sale de su pool en la misma transacción que el traslado. */
	pausarPoolOrigen?: boolean;
};
export type PreviewTraslado = {
	previewId: string;
	venceEn: string;
	asignaciones: {
		creditoId: number;
		numeroCreditoSifco: string;
		cliente: string | null;
		asesorAnteriorId: number | null;
		asesorNuevoId: number;
		bucket: number | null;
		prioridad: 0 | 1;
		estadoEspecial?:
			| "INCOBRABLE"
			| "CANCELADO"
			| "PENDIENTE_CANCELACION"
			| "CAIDO";
	}[];
	bloqueos: { bucket: number; creditoId: number; razon: string }[];
	excluidos: {
		creditoId: number;
		razon: string;
		numeroCreditoSifco: string;
		cliente: string | null;
		estado: string;
	}[];
	carga: {
		asesorId: number;
		nombre: string;
		bucket: number;
		antes: number;
		despues: number;
		capacidad: number;
	}[];
};
export type ResultadoTraslado = {
	success: true;
	operacionId: string;
	cuentas: number;
	/** Solo con `pausarPoolOrigen`: los buckets que estaban activos y se pausaron. */
	bucketsPausados?: number[];
};
export type HistorialTraslado = {
	id: string;
	modo: string;
	motivo: string;
	asesor_origen_id: number;
	actor_email: string;
	created_at: string;
	cuentas: number;
};

/** Respuesta de `GET /buckets/traslados/historial` (M3): con paginación real. */
export type HistorialTrasladosPaginado = {
	success: true;
	data: HistorialTraslado[];
	pagination: {
		page: number;
		perPage: number;
		total: number;
		totalPages: number;
	};
};

/** Respuesta de `POST /buckets/traslados/:id/devolver` (M5). */
export type ResultadoDevolucionTraslado = {
	success: true;
	asesor_id: number;
	devueltos: number;
	total: number;
	retenidos: {
		credito_id: number;
		motivo: "cambio_de_dueno" | "fuera_del_funnel" | "bucket_fuera_del_pool";
	}[];
};
