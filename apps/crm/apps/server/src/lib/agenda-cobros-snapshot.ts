import { ESTADOS_CONTESTO, esContactoAutomatico } from "./gestion-temprana-b1";

export type MotivoAgenda = "D-0" | "sla_hoy" | "promesa_hoy";

export interface AgendaSnapshotItemFuente {
	asesorId: string;
	asesorNombre: string;
	numeroCreditoSifco: string;
	casoCobroId: string | null;
	bucketSnapshot: number | null;
	motivoAgenda: MotivoAgenda;
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

function prioridadMotivo(motivo: MotivoAgenda): number {
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
	return (
		contacto.realizadoPor === item.asesorId &&
		((item.casoCobroId !== null && contacto.casoCobroId === item.casoCobroId) ||
			contacto.numeroCreditoSifco === item.numeroCreditoSifco)
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
