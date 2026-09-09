import { ESTADOS_CONTESTO, esContactoAutomatico } from "./gestion-temprana-b1";

export type MotivoAgenda = "D-0" | "sla_hoy" | "promesa_hoy";

export interface AgendaSnapshotItemFuente {
	asesorId: string;
	asesorNombre: string;
	numeroCreditoSifco: string;
	casoCobroId: string | null;
	bucketSnapshot: number | null;
	motivoAgenda: MotivoAgenda;
	/**
	 * CB-114: durante una cobertura, tanto el titular (asesorId) como el
	 * suplente pueden cerrar el item. Sin esto, `contactoPerteneceAlItem`
	 * solo aceptaba una gestión de exactamente `asesorId` — con cobertura
	 * eso deja SIEMPRE afuera a uno de los dos según cuál se use ahí.
	 * Opcional: los callers sin cobertura no lo mandan y el comportamiento
	 * es idéntico al de antes (solo `asesorId`).
	 */
	realizadoPorValidos?: readonly string[];
	/**
	 * CB-114: si la cobertura se registró a mitad de día, un contacto del
	 * suplente ANTERIOR a ese registro no era trabajo de cobertura —podía
	 * ser una coincidencia de pool sin relación real— y no debe cerrar el
	 * item del titular. Mismo criterio que ya aplican `cerrarSnapshotsAgenda`
	 * y `columnaEnAgendaDeTitular`.
	 *
	 * LISTA de ventanas, no una sola: la validación de solape al crear
	 * cobertura solo mira coberturas ACTIVAS (ver `crearCobertura`), así que
	 * cancelar y recrear el mismo par titular/suplente el mismo día es
	 * válido. Con un único intervalo, un contacto legítimo hecho durante la
	 * cobertura VIEJA (ya cancelada) se evaluaba contra el `createdAt` de la
	 * NUEVA y se rechazaba de más. El contacto es válido si cae dentro de
	 * CUALQUIERA de las ventanas — mismo criterio que ya aplica el job
	 * nocturno en SQL (ahí no hace falta esta lista porque el `LEFT JOIN`
	 * evalúa cada fila de cobertura por separado antes del `DISTINCT ON`).
	 *
	 * Se aplica SOLO a contactos de usuarios AJENOS al item — no basta con
	 * excluir a `asesorId`: si el mismo crédito ya estaba en el propio
	 * snapshot del suplente (pool compartido, fusionado por el dedupe), ese
	 * crédito ya era legítimamente suyo antes de que existiera la cobertura,
	 * y su contacto no puede sufrir un corte pensado para trabajo AJENO.
	 * `contactoExentoDelCorte` lista a todos los dueños reales de ALGÚN
	 * snapshot que trajo este item (no solo `asesorId`); se aplica junto con
	 * `realizadoPorValidos`, nunca en su lugar.
	 */
	ventanasCoberturaValida?: readonly { desde: Date; hasta: Date | null }[];
	contactoExentoDelCorte?: readonly string[];
}

export interface ContactoAgenda {
	id: string;
	casoCobroId: string;
	numeroCreditoSifco: string | null;
	realizadoPor: string;
	fechaContacto: Date;
	estadoContacto: string;
	comentarios: string | null;
}

export interface AgendaItemCerrado extends AgendaSnapshotItemFuente {
	atendido: boolean;
	contactoCobroId: string | null;
	atendidoEn: Date | null;
	resultadoContacto: string | null;
	realizadoPor: string | null;
}

export interface AgendaSnapshotRepository {
	crearSiAusente(
		fechaGT: string,
		asesorId: string,
		items: readonly AgendaSnapshotItemFuente[],
	): Promise<boolean>;
}

/**
 * D-0 (pago programado) es más urgente que sla_hoy, que a su vez es más
 * urgente que el resto. `deduplicarAgenda` la usa para decidir cuál motivo
 * gana cuando el mismo crédito aparece dos veces en la agenda de UN asesor;
 * `getMiAgendaHoy` (routers/agenda-cobros.ts) la reutiliza para el mismo
 * criterio al fusionar el mismo crédito entre DOS snapshots distintos
 * (titular/suplente compartiendo pool de bucket).
 */
export function prioridadMotivo(motivo: MotivoAgenda): number {
	if (motivo === "D-0") return 0;
	if (motivo === "sla_hoy") return 1;
	return 2;
}

export function deduplicarAgenda(
	items: readonly AgendaSnapshotItemFuente[],
): AgendaSnapshotItemFuente[] {
	const porAsesorCredito = new Map<string, AgendaSnapshotItemFuente>();
	for (const item of items) {
		const llave = `${item.asesorId}\u0000${item.numeroCreditoSifco}`;
		const actual = porAsesorCredito.get(llave);
		if (
			!actual ||
			prioridadMotivo(item.motivoAgenda) < prioridadMotivo(actual.motivoAgenda)
		) {
			porAsesorCredito.set(llave, item);
		}
	}
	return [...porAsesorCredito.values()];
}

export async function capturarSnapshots(
	fechaGT: string,
	items: readonly AgendaSnapshotItemFuente[],
	repository: AgendaSnapshotRepository,
): Promise<{ creados: number; existentes: number }> {
	const deduplicados = deduplicarAgenda(items);
	const porAsesor = new Map<string, AgendaSnapshotItemFuente[]>();
	for (const item of deduplicados) {
		const lista = porAsesor.get(item.asesorId) ?? [];
		lista.push(item);
		porAsesor.set(item.asesorId, lista);
	}

	let creados = 0;
	let existentes = 0;
	for (const [asesorId, agenda] of porAsesor) {
		if (await repository.crearSiAusente(fechaGT, asesorId, agenda)) creados++;
		else existentes++;
	}
	return { creados, existentes };
}

export function ventanaDiaGuatemala(fechaGT: string): {
	desde: Date;
	hasta: Date;
} {
	// Date normaliza fechas de calendario inexistentes en vez de fallar (p.
	// ej. "2026-02-30" se vuelve 2026-03-02) — Number.isNaN no lo detecta.
	// Comparar contra los componentes parseados sí: si el mes/día se corrió,
	// el round-trip ya no coincide con el string de entrada.
	if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaGT))
		throw new Error(`Fecha GT inválida: ${fechaGT}`);
	const desde = new Date(`${fechaGT}T06:00:00.000Z`);
	if (Number.isNaN(desde.getTime()))
		throw new Error(`Fecha GT inválida: ${fechaGT}`);
	const [anio, mes, dia] = fechaGT.split("-").map(Number);
	if (
		desde.getUTCFullYear() !== anio ||
		desde.getUTCMonth() + 1 !== mes ||
		desde.getUTCDate() !== dia
	)
		throw new Error(`Fecha GT inválida: ${fechaGT}`);
	const hasta = new Date(desde.getTime() + 24 * 60 * 60 * 1000);
	return { desde, hasta };
}

export function fechaAnteriorGuatemala(fechaGT: string): string {
	const { desde } = ventanaDiaGuatemala(fechaGT);
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Guatemala",
	}).format(new Date(desde.getTime() - 1));
}

function contactoPerteneceAlItem(
	item: AgendaSnapshotItemFuente,
	contacto: ContactoAgenda,
): boolean {
	const dueniosValidos = item.realizadoPorValidos ?? [item.asesorId];
	if (!dueniosValidos.includes(contacto.realizadoPor)) return false;
	// El corte por fecha de registro solo aplica a un contacto AJENO — de
	// alguien cuyo PROPIO snapshot no traía este crédito. No basta con
	// comparar contra `item.asesorId`: si el crédito ya estaba en el
	// snapshot del suplente (pool compartido, fusionado por el dedupe), ya
	// era legítimamente suyo antes de la cobertura, sin importar que
	// `asesorId` del item termine siendo el titular.
	const dueniosReales = item.contactoExentoDelCorte ?? [item.asesorId];
	if (
		item.ventanasCoberturaValida &&
		!dueniosReales.includes(contacto.realizadoPor)
	) {
		// Válido si cae en CUALQUIERA de las ventanas: cancelar y recrear la
		// cobertura el mismo par el mismo día es posible (la validación de
		// solape solo mira coberturas activas), y un contacto legítimo bajo
		// la ventana VIEJA no debe rechazarse solo porque exista una nueva.
		const dentroDeAlgunaVentana = item.ventanasCoberturaValida.some(
			(v) =>
				contacto.fechaContacto >= v.desde &&
				(v.hasta === null || contacto.fechaContacto < v.hasta),
		);
		if (!dentroDeAlgunaVentana) return false;
	}
	return (
		(item.casoCobroId !== null && contacto.casoCobroId === item.casoCobroId) ||
		contacto.numeroCreditoSifco === item.numeroCreditoSifco
	);
}

export function cerrarItemsAgenda(
	fechaGT: string,
	items: readonly AgendaSnapshotItemFuente[],
	contactos: readonly ContactoAgenda[],
): AgendaItemCerrado[] {
	const { desde, hasta } = ventanaDiaGuatemala(fechaGT);
	return items.map((item) => {
		const primero = contactos
			.filter(
				(contacto) =>
					contactoPerteneceAlItem(item, contacto) &&
					contacto.fechaContacto >= desde &&
					contacto.fechaContacto < hasta &&
					(ESTADOS_CONTESTO as readonly string[]).includes(
						contacto.estadoContacto,
					) &&
					!esContactoAutomatico(contacto.comentarios),
			)
			.sort(
				(a, b) =>
					a.fechaContacto.getTime() - b.fechaContacto.getTime() ||
					a.id.localeCompare(b.id),
			)[0];

		return {
			...item,
			atendido: Boolean(primero),
			contactoCobroId: primero?.id ?? null,
			atendidoEn: primero?.fechaContacto ?? null,
			resultadoContacto: primero?.estadoContacto ?? null,
			realizadoPor: primero?.realizadoPor ?? null,
		};
	});
}
