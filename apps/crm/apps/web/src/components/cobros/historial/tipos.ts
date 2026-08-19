/**
 * Contrato de `routers/historial-agendas.ts`, escrito a mano.
 *
 * Normalmente esto lo infiere oRPC de punta a punta, pero el tipo del cliente
 * está truncado por TS7056 (ver la nota en `cumplimiento-agenda-panel.tsx` y en
 * el router del server). Estos tipos son el reemplazo manual mientras eso siga
 * así.
 *
 * Compartido entre el tab "Historial de gestiones" y el bloque de gestiones
 * del asesor dentro de "Cumplimiento de agenda" — ambos renderizan filas con
 * `FilaHistorial`.
 */
export type FilaHistorialData = {
	id: string;
	fechaContacto: string | Date;
	usuarioId: string;
	usuarioNombre: string | null;
	usuarioRol: string | null;
	bucketSnapshot: number | null;
	casoCobroId: string;
	numeroCreditoSifco: string | null;
	clienteNombre: string | null;
	metodoContacto: string | null;
	estadoContacto: string | null;
	comentarios: string | null;
	fechaProximoContacto: string | Date | null;
	proximoPaso: string | null;
	requiereSeguimiento: boolean | null;
	estadoPromesa: string | null;
	cuotaInicio: number | null;
	cuotaFin: number | null;
	incluyeMora: boolean | null;
	montoComprometido: string | null;
	fechaAlerta: string | Date | null;
	/** Última escritura sobre la fila. NULL = nunca se tocó desde que se creó. */
	updatedAt: string | Date | null;
	origen: string;
	fueEditadoManual: boolean;
	ultimaEdicion: string | Date | null;
	vecesEditado: number;
	/**
	 * Si el crédito de esta gestión estaba en el snapshot de agenda del asesor
	 * ese día. `null` cuando el caller no pidió `marcarEnAgenda` o no hay
	 * agenda cerrada para esa fecha — no es lo mismo que `false`.
	 *
	 * Este PR (refactor de `FilaHistorial`) no lo llena — llega en `undefined`
	 * desde `getHistorialAgendas` hasta que el PR que agrega
	 * `marcarEnAgenda` al backend se mergee. Se deja tipado ahora para no
	 * reabrir este archivo compartido en ese PR solo por un campo.
	 */
	enAgenda?: boolean | null;
};

export type RespuestaHistorial = {
	items: FilaHistorialData[];
	// `null` cuando se pidió con `incluirConteo: false` (el export): ahí el
	// servidor no cuenta, y devolver un número lo dejaría plausible pero mal.
	total: number | null;
	totalEsAproximado: boolean;
	page: number;
	pageSize: number;
	totalPaginas: number | null;
	rangoAplicado: { desde: string; hasta: string; esDefault: boolean };
	verTodos: boolean;
};

export type EntradaAuditoria = {
	id: string;
	accion: string;
	origen: string;
	valoresAnteriores: unknown;
	editadoPor: string | null;
	editadoPorNombre: string | null;
	editadoEn: string | Date;
};
