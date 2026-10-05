/**
 * Armado de "Mis pendientes" de apagado/reactivación para Mi día. Lógica pura,
 * sin base de datos: el router (`routers/mis-pendientes-inmovilizacion.ts`) lee
 * las filas y acá se les da forma, para poder probar el mapeo y la deduplicación.
 */

export type PendienteInmovilizacion = {
	inmovilizacionId: string;
	casoId: string;
	numeroCreditoSifco: string;
	accion: "apagado" | "reactivacion";
	tipo: "por_ejecutar" | "llamar_cliente" | "rechazada";
	/** Desde cuándo espera: decisión (por ejecutar, rechazada) o ejecución (llamada). */
	desde: Date | null;
};

export type FilaPendiente = {
	inmovilizacionId: string;
	casoId: string;
	numeroCreditoSifco: string;
	accion: "apagado" | "reactivacion";
	estado: string;
	decididoAt: Date | null;
	ejecutadoAt: Date | null;
};

/**
 * `decididas`: aprobadas (por ejecutar) y rechazadas recientes. `llamadas`:
 * ejecutadas con la llamada al cliente pendiente. Una misma solicitud puede
 * llegar repetida si tiene más de un aviso asignado al usuario (no hay índice
 * único sobre esos avisos); se deja una sola fila por solicitud y tipo.
 */
export function armarPendientes(
	decididas: FilaPendiente[],
	llamadas: FilaPendiente[],
): PendienteInmovilizacion[] {
	const vistos = new Set<string>();
	const salida: PendienteInmovilizacion[] = [];
	const agregar = (p: PendienteInmovilizacion) => {
		const clave = `${p.inmovilizacionId}:${p.tipo}`;
		if (vistos.has(clave)) return;
		vistos.add(clave);
		salida.push(p);
	};

	for (const f of decididas) {
		agregar({
			inmovilizacionId: f.inmovilizacionId,
			casoId: f.casoId,
			numeroCreditoSifco: f.numeroCreditoSifco,
			accion: f.accion,
			tipo: f.estado === "rechazada" ? "rechazada" : "por_ejecutar",
			desde: f.decididoAt,
		});
	}
	for (const f of llamadas) {
		agregar({
			inmovilizacionId: f.inmovilizacionId,
			casoId: f.casoId,
			numeroCreditoSifco: f.numeroCreditoSifco,
			accion: f.accion,
			tipo: "llamar_cliente",
			desde: f.ejecutadoAt,
		});
	}
	return salida;
}
