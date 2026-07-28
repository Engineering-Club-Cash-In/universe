/**
 * CB-024: Job de cierre diario de cobros.
 * Corre todos los días a las 22:00 GT (ver scheduleAtCierreDiarioGT en index.ts)
 * y hace un snapshot de DETALLE en `cierre_diario_credito_cobros` — una fila
 * por crédito, no un agregado — con dos orígenes distintos (columna `tipo`):
 *
 *  - Paso A 'contacto': cada contacto real del día. "Contacto efectivo" = el
 *    cliente CONTESTÓ y el contacto fue manual del asesor. Las categorías son
 *    EXCLUYENTES (definición cerrada con el usuario): 'promesa_pago' NO cuenta
 *    como efectivo — se reporta aparte como promesa; 'no_contesta' y
 *    'numero_equivocado' no cuentan en ninguna. Se excluyen además los
 *    contactos que el sistema genera automáticamente (recordatorios premora,
 *    envío masivo de WhatsApp) — no tienen columna de origen propia, se
 *    identifican por el prefijo de `comentarios` que ya usan
 *    send-premora-reminders.ts y cobros.ts (createMassWhatsapp). Si cambia el
 *    texto de esos prefijos, actualizar también aquí. Idempotente vía
 *    ON CONFLICT (contacto_id) DO NOTHING — un contacto ya registrado es
 *    histórico inmutable, nunca se duplica.
 *
 *  - Paso B 'subida'/'bajada': de los créditos que un asesor tenía AL EMPEZAR
 *    el día, cuáles subieron y cuáles bajaron de bucket. Definición del
 *    usuario: "de mis créditos de la mañana, cuántos subieron y cuántos
 *    bajaron" — no "a quién se le atribuye cada evento puntual" (enfoque
 *    anterior, descartado por problemas de escala — ver
 *    resolverIdsDuenoManana para el detalle y el porqué de los intentos
 *    previos). El dueño de la mañana es el dueño ACTUAL que ya trae
 *    getBucketsHistorial, salvo que el crédito se haya reasignado HOY (ahí se
 *    retrocede al asesor_anterior_id de esa reasignación, vía
 *    credito_asesor_historial/getAsesorHistorial acotado al día). El asesor
 *    en cartera-back no tiene id de usuario del CRM propio — se resuelve
 *    cruzando `asesor_id` numérico → `email_cash_in` (getPoolPorAsesor()) →
 *    `user.email` (constraint único en ambos extremos). Se reemplaza completo
 *    (DELETE + INSERT) en cada corrida: son datos derivados de cartera-back,
 *    recalculables, sin un "contacto" que ancle un ON CONFLICT.
 */

import { inArray } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { casosCobros } from "../db/schema/cobros";
import { toDateStrGT } from "../lib/guatemala-month-window";
import { carteraBackClient } from "../services/cartera-back-client";

/**
 * Prefijos con los que el sistema marca los contactos que genera solo
 * (`contactos_cobros` no tiene columna de origen). Los escriben
 * send-premora-reminders.ts y cobros.ts::enviarWhatsappMasivoCobros; acá se
 * leen para excluirlos de la gestión del asesor. Se exportan porque el reporte
 * (routers/cobros.ts) aplica el mismo criterio al contar promesas y al
 * etiquetar el origen en el detalle — así el filtro de escritura y el de
 * lectura no pueden divergir.
 */
export const PREFIJO_PREMORA_AUTO = "Recordatorio automático";
export const PREFIJO_WSP_MASIVO = "Envío masivo de WhatsApp";

// Two-component advisory lock key: namespace=1 (cobros jobs), key=2 (cierre diario asesor)
const CIERRE_DIARIO_LOCK = [1, 2] as const;

interface RawClient {
	query<T extends object>(
		text: string,
		values?: unknown[],
	): Promise<{ rows: T[] }>;
}

export async function generarCierreDiario(fechaGT?: string) {
	const fecha = fechaGT ?? toDateStrGT(new Date());
	const client = await db.$client.connect();
	let acquired = false;
	try {
		const { rows } = await client.query<{ acquired: boolean }>(
			"SELECT pg_try_advisory_lock($1, $2) AS acquired",
			[...CIERRE_DIARIO_LOCK],
		);
		acquired = rows[0].acquired;
		if (!acquired) {
			console.log(
				"[CierreDiarioAsesor] Already running (distributed lock held), skipping",
			);
			return;
		}
		await _generarCierreContactos(client, fecha);
		await _generarCierreMovimientosBucket(fecha);
	} finally {
		if (acquired) {
			await client.query("SELECT pg_advisory_unlock($1, $2)", [
				...CIERRE_DIARIO_LOCK,
			]);
		}
		client.release();
	}
}

async function _generarCierreContactos(client: RawClient, fecha: string) {
	const { rows } = await client.query<{ asesor_id: string }>(
		`INSERT INTO cierre_diario_credito_cobros
			(fecha, asesor_id, tipo, caso_cobro_id, numero_credito_sifco,
			 contacto_id, estado_contacto, es_efectivo_manual, fecha_contacto)
		SELECT
			$1::date,
			cc.realizado_por,
			'contacto',
			cc.caso_cobro_id,
			ccb.numero_credito_sifco,
			cc.id,
			cc.estado_contacto,
			(
				cc.estado_contacto IN ('contactado', 'acuerdo_parcial', 'rechaza_pagar')
				AND cc.comentarios NOT LIKE $2 || '%'
				AND cc.comentarios NOT LIKE $3 || '%'
			),
			cc.fecha_contacto
		FROM contactos_cobros cc
		JOIN casos_cobros ccb ON ccb.id = cc.caso_cobro_id
		WHERE (cc.fecha_contacto - INTERVAL '6 hours')::date = $1::date
		ON CONFLICT (contacto_id) WHERE contacto_id IS NOT NULL DO NOTHING
		RETURNING asesor_id`,
		[fecha, PREFIJO_PREMORA_AUTO, PREFIJO_WSP_MASIVO],
	);

	console.log(
		`[CierreDiarioAsesor] ${fecha}: ${rows.length} contactos insertados`,
	);
}

/**
 * Mapa `asesor_id numérico (cartera-back) → user.id (CRM)`, cruzando por
 * email (`email_cash_in` de getPoolPorAsesor() vs `user.email`, ambos con
 * constraint único). Reemplaza un cruce anterior por `user.name` — sin
 * constraint de unicidad en ese campo, dos asesores con el mismo nombre
 * (caso real en dev: "Lucia Salvatierra" x2) se pisaban en silencio y
 * atribuían mal el movimiento.
 */
async function mapaAsesorIdAUserId(
	usuarios: readonly { id: string; email: string }[],
): Promise<Map<number, string>> {
	const emailToUserId = new Map(
		usuarios.map((u) => [u.email.trim().toLowerCase(), u.id]),
	);
	const asesores = await carteraBackClient.getPoolPorAsesor();
	const mapa = new Map<number, string>();
	for (const a of asesores) {
		const email = a.email_cash_in?.trim().toLowerCase();
		if (!email) continue;
		const userId = emailToUserId.get(email);
		if (userId) mapa.set(a.asesor_id, userId);
	}
	return mapa;
}

function resolverAsesorId(
	asesorIdCartera: number | null,
	asesorIdToUserId: ReadonlyMap<number, string>,
): string | null {
	if (asesorIdCartera == null) return null;
	return asesorIdToUserId.get(asesorIdCartera) ?? null;
}

/**
 * Dueño de cada crédito AL EMPEZAR el día que se está cerrando (no el dueño
 * actual al momento de la corrida, 00:15 GT del día siguiente).
 *
 * Reemplaza un enfoque anterior ("¿de quién era el crédito exactamente en el
 * instante del movimiento?", resuelto reconstruyendo desde TODO el histórico
 * de `credito_asesor_historial`) por uno más simple y acotado en escala,
 * alineado a cómo se define el cierre: "de mis créditos de la mañana, cuántos
 * subieron y cuántos bajaron" (definición del usuario, no "a quién se le
 * atribuye cada evento puntual"). El enfoque anterior tenía dos problemas de
 * fondo hallados por Codex en PR #1185 (5to round):
 *   - Sin filtro por crédito ni ventana de fecha razonable, la consulta traía
 *     la bitácora COMPLETA del sistema (crece sin límite con el tiempo).
 *   - Paginación por OFFSET sobre `ORDER BY fecha DESC` mientras
 *     `latefee.ts` (23:59 GT) puede seguir insertando filas nuevas 16 minutos
 *     antes de esta corrida (00:15 GT) — un insert a mitad de la paginación
 *     desplaza todo y puede saltarse silenciosamente la fila que se busca.
 *
 * Este enfoque solo necesita las reasignaciones de HOY (`desde: fecha, hasta:
 * fecha` — acotado, no la bitácora completa): para un crédito reasignado hoy,
 * el dueño de la mañana es `asesor_anterior` de esa reasignación (retroceder
 * un paso). Para el resto de créditos (la mayoría — la reasignación
 * automática solo ocurre si el asesor deja de ser elegible en el bucket
 * destino, ver `latefee.ts` FASE 3), no hubo cambio hoy, así que el dueño
 * ACTUAL que ya trae `getBucketsHistorial().data[].asesor` YA ES el dueño de
 * la mañana — no hace falta reconstruir nada.
 *
 * No cubre reasignaciones MANUALES intra-día (supervisor reasigna a mano
 * durante la jornada, no a medianoche) que no dejen rastro en `desde: fecha,
 * hasta: fecha` de forma coherente con "mañana" — ese caso es igual de raro
 * que los que ya se aceptaron como fallback en versiones anteriores.
 *
 * Devuelve, por cada evento (identificado por su posición en `eventos`), el
 * asesor_id numérico (cartera-back) del dueño de la mañana a usar.
 */
async function resolverIdsDuenoManana(
	eventos: readonly { credito_id: number; asesorId: number | null }[],
	fecha: string,
): Promise<(number | null)[]> {
	if (eventos.length === 0) return [];

	// Reasignaciones SOLO de hoy — acotado, no la bitácora completa del
	// sistema. En un día normal son pocas decenas, cabe en 1-2 páginas.
	const reasignacionesHoy: {
		credito_id: number;
		asesor_anterior_id: number | null;
	}[] = [];
	let page = 1;
	const pageSize = 200;
	const MAX_PAGINAS_HISTORIAL = 50;
	let truncadoHistorial = false;
	for (; page <= MAX_PAGINAS_HISTORIAL; page++) {
		const resp = await carteraBackClient.getAsesorHistorial({
			desde: fecha,
			hasta: fecha,
			page,
			pageSize,
		});
		reasignacionesHoy.push(
			...resp.data.map((r) => ({
				credito_id: r.credito_id,
				asesor_anterior_id: r.asesor_anterior_id,
			})),
		);
		if (page >= resp.pagination.totalPages) break;
		if (page === MAX_PAGINAS_HISTORIAL) truncadoHistorial = true;
	}
	if (truncadoHistorial) {
		console.warn(
			`[CierreDiarioAsesor] ${fecha}: se alcanzó el tope de ${MAX_PAGINAS_HISTORIAL} páginas de reasignaciones del día — posible totalPages corrupto de cartera-back`,
		);
	}

	// Si un crédito tuvo VARIAS reasignaciones en el mismo día, el dueño de la
	// mañana es el `asesor_anterior_id` de la PRIMERA (la más antigua) — las
	// intermedias ya no son "la mañana". La respuesta viene ordenada
	// `fecha DESC, historial_id DESC` (asesorHistorial.ts), así que la última
	// del array es la más antigua del día.
	const duenoMananaPorCredito = new Map<number, number | null>();
	for (const r of reasignacionesHoy) {
		duenoMananaPorCredito.set(r.credito_id, r.asesor_anterior_id);
	}

	return eventos.map((evento) => {
		if (!duenoMananaPorCredito.has(evento.credito_id)) return evento.asesorId;
		const asesorAnteriorId = duenoMananaPorCredito.get(evento.credito_id);
		// asesor_anterior_id nullable (siembra/primera asignación, o asesor
		// borrado) — sin dato de "antes", el mejor fallback disponible sigue
		// siendo el dueño actual del evento.
		return asesorAnteriorId ?? evento.asesorId;
	});
}

async function _generarCierreMovimientosBucket(fecha: string) {
	const usuarios = await db
		.select({ id: user.id, email: user.email })
		.from(user);
	const asesorIdToUserId = await mapaAsesorIdAUserId(usuarios);

	type EventoBucket = {
		credito_id: number;
		numero_credito_sifco: string;
		fecha: string;
		asesorId: number | null;
		bucket_anterior: number;
		bucket_nuevo: number;
		tipo: "subida" | "bajada";
	};
	const eventos: EventoBucket[] = [];

	let page = 1;
	const pageSize = 200;
	// Tope duro: corre dentro del advisory lock, así que un totalPages corrupto
	// o desincronizado de cartera-back no debe colgar el job para siempre y
	// bloquear toda corrida futura del cierre.
	const MAX_PAGINAS = 500;
	let truncado = false;
	for (; page <= MAX_PAGINAS; page++) {
		const resp = await carteraBackClient.getBucketsHistorial({
			desde: fecha,
			hasta: fecha,
			tipo_evento: "SUBIDA,BAJADA",
			page,
			pageSize,
		});
		for (const evento of resp.data ?? []) {
			if (evento.bucket_anterior == null) continue;
			eventos.push({
				credito_id: evento.credito_id,
				numero_credito_sifco: evento.numero_credito_sifco,
				fecha: evento.fecha,
				asesorId: evento.asesor_id,
				bucket_anterior: evento.bucket_anterior,
				bucket_nuevo: evento.bucket_nuevo,
				tipo: evento.tipo_evento === "SUBIDA" ? "subida" : "bajada",
			});
		}
		if (typeof resp.pagination?.totalPages !== "number") {
			console.warn(
				`[CierreDiarioAsesor] ${fecha}: pagination.totalPages ausente/corrupto en getBucketsHistorial (página ${page}) — se asume sin más páginas, revisar cartera-back`,
			);
			break;
		}
		if (page >= resp.pagination.totalPages) break;
		if (page === MAX_PAGINAS) truncado = true;
	}
	if (truncado) {
		console.warn(
			`[CierreDiarioAsesor] ${fecha}: se alcanzó el tope de ${MAX_PAGINAS} páginas de movimientos de bucket — posible totalPages corrupto de cartera-back`,
		);
	}

	type FilaMovimiento = {
		asesorId: string;
		numeroCreditoSifco: string;
		bucketAnterior: number;
		bucketNuevo: number;
		tipo: "subida" | "bajada";
	};
	const filas: FilaMovimiento[] = [];

	const idsDueno = await resolverIdsDuenoManana(eventos, fecha);
	let descartados = 0;
	eventos.forEach((evento, i) => {
		const asesorId = resolverAsesorId(idsDueno[i], asesorIdToUserId);
		if (!asesorId) {
			descartados++;
			return;
		}
		filas.push({
			asesorId,
			numeroCreditoSifco: evento.numero_credito_sifco,
			bucketAnterior: evento.bucket_anterior,
			bucketNuevo: evento.bucket_nuevo,
			tipo: evento.tipo,
		});
	});
	if (descartados > 0) {
		console.warn(
			`[CierreDiarioAsesor] ${fecha}: ${descartados} movimiento(s) de bucket descartado(s) — asesor_id sin cruce a user.email (sin pool activo o email_cash_in no coincide)`,
		);
	}

	// Resolver caso_cobro_id por número SIFCO — un crédito de cartera-back puede
	// no tener caso creado todavía en CRM (queda NULL; la UI navega por SIFCO).
	// El filtro va EN LA QUERY: traer casos_cobros entera para descartar en JS
	// crecía con la tabla, no con los pocos SIFCO del día. En lotes de 1000
	// (mismo CHUNK_SIZE que controllers/vehicles.ts): con hasta 500 páginas de
	// movimientos, `sifcos` puede acercarse al límite de bind params de
	// Postgres (~65535) igual que el INSERT de más abajo.
	const sifcos = [...new Set(filas.map((f) => f.numeroCreditoSifco))];
	const CHUNK_SIZE = 1000;
	const casos: { id: string; numeroCreditoSifco: string | null }[] = [];
	for (let i = 0; i < sifcos.length; i += CHUNK_SIZE) {
		const chunk = sifcos.slice(i, i + CHUNK_SIZE);
		const parte = await db
			.select({
				id: casosCobros.id,
				numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			})
			.from(casosCobros)
			.where(inArray(casosCobros.numeroCreditoSifco, chunk));
		casos.push(...parte);
	}
	const sifcoToCasoId = new Map(
		casos
			.filter((c) => c.numeroCreditoSifco)
			.map((c) => [c.numeroCreditoSifco as string, c.id]),
	);

	const client = await db.$client.connect();
	try {
		await client.query("BEGIN");
		await client.query(
			`DELETE FROM cierre_diario_credito_cobros
			 WHERE fecha = $1::date AND tipo IN ('subida', 'bajada')`,
			[fecha],
		);

		// Postgres tiene un tope de ~65535 bind params por statement (7 por fila
		// → ~9360 filas). Se manda en lotes para no reventar en un día pesado
		// (una migración masiva de cartera podría acercarse a ese número).
		const TAMANO_LOTE = 1000;
		for (let inicio = 0; inicio < filas.length; inicio += TAMANO_LOTE) {
			const lote = filas.slice(inicio, inicio + TAMANO_LOTE);
			const params: unknown[] = [];
			const placeholders = lote
				.map((f, i) => {
					const b = i * 7;
					params.push(
						fecha,
						f.asesorId,
						sifcoToCasoId.get(f.numeroCreditoSifco) ?? null,
						f.numeroCreditoSifco,
						f.bucketAnterior,
						f.bucketNuevo,
						f.tipo,
					);
					return `($${b + 1}::date, $${b + 2}::text, $${b + 3}::uuid, $${b + 4}::text, $${b + 5}::int, $${b + 6}::int, $${b + 7}::cierre_credito_tipo)`;
				})
				.join(", ");

			await client.query(
				`INSERT INTO cierre_diario_credito_cobros
					(fecha, asesor_id, caso_cobro_id, numero_credito_sifco,
					 bucket_anterior, bucket, tipo)
				VALUES ${placeholders}`,
				params,
			);
		}
		await client.query("COMMIT");
	} catch (e) {
		await client.query("ROLLBACK");
		throw e;
	} finally {
		client.release();
	}

	console.log(
		`[CierreDiarioAsesor] ${fecha}: ${filas.length} movimientos de bucket insertados`,
	);
}
