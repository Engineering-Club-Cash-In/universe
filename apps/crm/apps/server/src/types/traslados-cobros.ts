export type SolicitudTraslado = {
	asesorOrigenId: number;
	asesorDestinoId?: number;
	asesorDestinoEspecialId?: number;
	destinosPorBucket?: Record<string, number>;
	modo: "traslado_completo" | "redistribucion" | "destino_por_bucket";
	motivo: string;
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
