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
	/**
	 * A quién iba dirigido el aviso del trámite (o, si no hay, quien lo pidió):
	 * solo sirve de respaldo cuando no se puede saber quién lleva el crédito hoy.
	 */
	destinatario: string | null;
};

/**
 * Deja las filas que le tocan AL USUARIO.
 *
 * Lo que hay que ejecutar o llamar (aprobadas por ejecutar, llamadas
 * pendientes) es de quien lleva el crédito en cartera HOY, no de a quién se le
 * mandó el aviso: cartera puede reasignar el crédito después de la decisión o de
 * la ejecución, y entonces el aviso sigue apuntando al dueño anterior.
 * `ejecutarPorAsesor` revalida el dueño vigente, así que el anterior vería un
 * pendiente que no puede completar y el nuevo no vería nada.
 *
 * Un RECHAZO, en cambio, es respuesta a lo que alguien pidió: se queda con
 * quien solicitó (su aviso, o el pedido si no hay aviso), igual que lo asigna
 * `notificarInmovilizacionResuelta`, aunque después cambie el dueño del crédito.
 * Así también lo conserva quien pidió como suplente por una cobertura.
 *
 * `duenos` es SIFCO → usuario del CRM (`usuariosDuenosPorSifco`, best-effort).
 * Si el SIFCO no está —cartera no respondió, o el dueño no tiene usuario en el
 * CRM— no se sabe de quién es y se cae al destinatario del aviso, igual que el
 * resto de los avisos de inmovilización.
 */
export function filasDelUsuario(
	filas: FilaPendiente[],
	duenos: ReadonlyMap<string, string>,
	userId: string,
): FilaPendiente[] {
	return filas.filter((f) => {
		if (f.estado === "rechazada") return f.destinatario === userId;
		return (duenos.get(f.numeroCreditoSifco) ?? f.destinatario) === userId;
	});
}

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
