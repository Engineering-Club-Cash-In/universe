import { db } from "../db";
import {
	type AgendaSnapshotItemFuente,
	type AgendaSnapshotRepository,
	capturarSnapshots,
	fechaAnteriorGuatemala,
} from "../lib/agenda-cobros-snapshot";
import {
	ESTADOS_CONTESTO,
	PREFIJO_CONVENIO_AUTO,
	PREFIJO_PREMORA_AUTO,
	PREFIJO_WSP_MASIVO,
} from "../lib/gestion-temprana-b1";
import { toDateStrGT } from "../lib/guatemala-month-window";
import { obtenerAgendaTodosAsesores } from "../services/agenda-cobros-source";

// namespace=1 (jobs cobros), key=4 (snapshot de cumplimiento de agenda)
const AGENDA_COBROS_LOCK = [1, 4] as const;

interface RawClient {
	query<T extends object = Record<string, unknown>>(
		text: string,
		values?: unknown[],
	): Promise<{ rows: T[]; rowCount?: number | null }>;
	release(): void;
}

class SqlAgendaSnapshotRepository implements AgendaSnapshotRepository {
	constructor(private readonly client: RawClient) {}

	async crearSiAusente(
		fechaGT: string,
		asesorId: string,
		items: readonly AgendaSnapshotItemFuente[],
	): Promise<boolean> {
		await this.client.query("BEGIN");
		try {
			const snapshot = await this.client.query<{ id: string }>(
				`INSERT INTO agenda_cobros_snapshots
					(fecha_gt, asesor_id, total_planificado, total_atendidos,
					 total_pendientes, estado)
				 VALUES ($1::date, $2, $3, 0, $3, 'abierto')
				 ON CONFLICT (fecha_gt, asesor_id) DO NOTHING
				 RETURNING id`,
				[fechaGT, asesorId, items.length],
			);
			const snapshotId = snapshot.rows[0]?.id;
			if (!snapshotId) {
				await this.client.query("COMMIT");
				return false;
			}

			const params: unknown[] = [snapshotId];
			const values = items.map((item, index) => {
				const base = index * 4 + 2;
				params.push(
					item.casoCobroId,
					item.numeroCreditoSifco,
					item.bucketSnapshot,
					item.motivoAgenda,
				);
				return `($1, $${base}, $${base + 1}, $${base + 2}, $${base + 3})`;
			});
			await this.client.query(
				`INSERT INTO agenda_cobros_snapshot_items
					(snapshot_id, caso_cobro_id, numero_credito_sifco,
					 bucket_snapshot, motivo_agenda)
				 VALUES ${values.join(", ")}`,
				params,
			);
			await this.client.query("COMMIT");
			return true;
		} catch (error) {
			await this.client.query("ROLLBACK");
			throw error;
		}
	}
}

export async function cerrarSnapshotsAgenda(
	client: RawClient,
	fechaGT: string,
	asesorId?: string,
): Promise<number> {
	await client.query("BEGIN");
	try {
		await client.query(
			`UPDATE agenda_cobros_snapshot_items i
			 SET atendido = false,
			     contacto_cobro_id = NULL,
			     atendido_en = NULL,
			     resultado_contacto = NULL,
			     realizado_por = NULL,
			     promesa_cumplida = false,
			     promesa_contacto_cobro_id = NULL,
			     promesa_cumplida_en = NULL
			 FROM agenda_cobros_snapshots s
			 WHERE i.snapshot_id = s.id
			   AND s.fecha_gt = $1::date
			   AND ($2::text IS NULL OR s.asesor_id = $2)`,
			[fechaGT, asesorId ?? null],
		);

		// Sin filtro por motivo_agenda: deduplicarAgenda colapsa un crédito con
		// D-0 y promesa_hoy simultáneos a un solo item con motivo 'D-0' (D-0
		// gana prioridad). Filtrar por 'promesa_hoy' acá dejaba ese caso sin
		// acreditar el pago aunque la promesa se cumpliera.
		await client.query(
			`WITH promesas_cumplidas AS (
				SELECT DISTINCT ON (i.id)
					i.id AS item_id,
					cc.id AS promesa_contacto_id,
					COALESCE(cc.updated_at, cc.fecha_contacto) AS cumplida_en
				FROM agenda_cobros_snapshots s
				JOIN agenda_cobros_snapshot_items i ON i.snapshot_id = s.id
				JOIN contactos_cobros cc
				  ON cc.realizado_por = s.asesor_id
				 AND cc.estado_contacto = 'promesa_pago'
				 AND cc.estado_promesa = 'cumplida'
				 AND cc.fecha_proximo_contacto >= ($1::date + interval '6 hours')
				 AND cc.fecha_proximo_contacto < ($1::date + interval '1 day 6 hours')
				JOIN casos_cobros caso_promesa ON caso_promesa.id = cc.caso_cobro_id
				WHERE s.fecha_gt = $1::date
				  AND ($2::text IS NULL OR s.asesor_id = $2)
				  AND (i.caso_cobro_id = cc.caso_cobro_id OR caso_promesa.numero_credito_sifco = i.numero_credito_sifco)
				ORDER BY i.id, cc.updated_at ASC NULLS LAST, cc.id ASC
			)
			UPDATE agenda_cobros_snapshot_items i
			SET promesa_cumplida = true,
				promesa_contacto_cobro_id = promesas_cumplidas.promesa_contacto_id,
				promesa_cumplida_en = promesas_cumplidas.cumplida_en
			FROM promesas_cumplidas
			WHERE i.id = promesas_cumplidas.item_id`,
			[fechaGT, asesorId ?? null],
		);

		await client.query(
			`WITH primeros AS (
				SELECT DISTINCT ON (i.id)
					i.id AS item_id,
					cc.id AS contacto_id,
					cc.fecha_contacto,
					cc.estado_contacto,
					cc.realizado_por
				FROM agenda_cobros_snapshots s
				JOIN agenda_cobros_snapshot_items i ON i.snapshot_id = s.id
				JOIN contactos_cobros cc
				  ON cc.realizado_por = s.asesor_id
				 AND cc.fecha_contacto >= ($1::date + interval '6 hours')
				 AND cc.fecha_contacto < ($1::date + interval '1 day 6 hours')
				 AND cc.estado_contacto = ANY($2::estado_contacto[])
				 AND cc.comentarios NOT LIKE $4 || '%'
				 AND cc.comentarios NOT LIKE $5 || '%'
				 AND cc.comentarios NOT LIKE $6 || '%'
				JOIN casos_cobros caso_contacto ON caso_contacto.id = cc.caso_cobro_id
			 WHERE s.fecha_gt = $1::date
			   AND ($3::text IS NULL OR s.asesor_id = $3)
			  AND (
					i.caso_cobro_id = cc.caso_cobro_id
					OR caso_contacto.numero_credito_sifco = i.numero_credito_sifco
				  )
				ORDER BY i.id, cc.fecha_contacto ASC, cc.id ASC
			)
			UPDATE agenda_cobros_snapshot_items i
			SET atendido = true,
			    contacto_cobro_id = primeros.contacto_id,
			    atendido_en = primeros.fecha_contacto,
			    resultado_contacto = primeros.estado_contacto,
			    realizado_por = primeros.realizado_por
			FROM primeros
			WHERE i.id = primeros.item_id`,
			[
				fechaGT,
				[...ESTADOS_CONTESTO],
				asesorId ?? null,
				PREFIJO_CONVENIO_AUTO,
				PREFIJO_PREMORA_AUTO,
				PREFIJO_WSP_MASIVO,
			],
		);

		// Completado = atendido POR CONTACTO (gestión) O promesa_cumplida POR
		// PAGO real (evaluarPromesa vs. cartera-back, sin depender de que el
		// asesor haya llamado). Un item con la cuota ya pagada no debe seguir
		// contando como pendiente en el % de cumplimiento del asesor.
		const cerrados = await client.query<{ id: string }>(
			`UPDATE agenda_cobros_snapshots s
			 SET total_planificado = totales.planificados,
			     total_atendidos = totales.atendidos,
			     total_pendientes = totales.planificados - totales.atendidos,
			     estado = 'cerrado',
			     cerrado_en = COALESCE(s.cerrado_en, now())
			 FROM (
				SELECT i.snapshot_id,
				       count(*)::integer AS planificados,
				       count(*) FILTER (WHERE i.atendido OR i.promesa_cumplida)::integer AS atendidos
				FROM agenda_cobros_snapshot_items i
				JOIN agenda_cobros_snapshots s2 ON s2.id = i.snapshot_id
				WHERE s2.fecha_gt = $1::date
				  AND ($2::text IS NULL OR s2.asesor_id = $2)
				GROUP BY i.snapshot_id
			 ) totales
			 WHERE s.id = totales.snapshot_id
			   AND s.fecha_gt = $1::date
			   AND ($2::text IS NULL OR s.asesor_id = $2)
			 RETURNING s.id`,
			[fechaGT, asesorId ?? null],
		);
		await client.query("COMMIT");
		return cerrados.rows.length;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
}

export async function ejecutarAgendaCobrosDiaria(
	fechaHoyGT = toDateStrGT(new Date()),
	opciones: { asesorId?: string } = {},
): Promise<void> {
	// El advisory lock es de sesión: vive atado a ESTA conexión física
	// mientras dure el job, para que una segunda corrida concurrente lo vea
	// ocupado. Pero esa conexión NO debe usarse para las queries de negocio:
	// obtenerAgendaTodosAsesores hace HTTP secuencial a cartera-back (un
	// asesor a la vez, puede tardar minutos) y si el `client` del lock quedara
	// pineado durante ese tiempo, una caída/lentitud de cartera-back deja esa
	// conexión atascada en vez de devolverla al pool. cerrarSnapshotsAgenda y
	// SqlAgendaSnapshotRepository abren su PROPIA conexión de corta vida (con
	// su propia transacción BEGIN/COMMIT) justo antes de usarla.
	const lockClient = (await db.$client.connect()) as RawClient;
	let acquired = false;
	try {
		const lock = await lockClient.query<{ acquired: boolean }>(
			"SELECT pg_try_advisory_lock($1, $2) AS acquired",
			[...AGENDA_COBROS_LOCK],
		);
		acquired = lock.rows[0]?.acquired === true;
		if (!acquired) {
			console.log("[AgendaCobrosSnapshot] Lock ocupado; corrida omitida");
			return;
		}

		const ayer = fechaAnteriorGuatemala(fechaHoyGT);

		const cierreClient = (await db.$client.connect()) as RawClient;
		let cerrados: number;
		try {
			cerrados = await cerrarSnapshotsAgenda(
				cierreClient,
				ayer,
				opciones.asesorId,
			);
		} finally {
			cierreClient.release();
		}

		const agenda = await obtenerAgendaTodosAsesores(
			opciones.asesorId,
			fechaHoyGT,
		);

		const capturaClient = (await db.$client.connect()) as RawClient;
		let captura: { creados: number; existentes: number };
		try {
			captura = await capturarSnapshots(
				fechaHoyGT,
				agenda,
				new SqlAgendaSnapshotRepository(capturaClient),
			);
		} finally {
			capturaClient.release();
		}

		console.log(
			`[AgendaCobrosSnapshot]${opciones.asesorId ? ` asesor ${opciones.asesorId}` : ""} cierre ${ayer}: ${cerrados}; captura ${fechaHoyGT}: ${captura.creados} nuevos, ${captura.existentes} existentes`,
		);
	} finally {
		if (acquired) {
			await lockClient.query("SELECT pg_advisory_unlock($1, $2)", [
				...AGENDA_COBROS_LOCK,
			]);
		}
		lockClient.release();
	}
}
