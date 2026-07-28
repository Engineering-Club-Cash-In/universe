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
 *  - Paso B 'subida'/'bajada': créditos que cambiaron de bucket ese día, con su
 *    ruta (bucket_anterior → bucket). Definición confirmada por Jhairo Nájera
 *    (responsable CB-024): el reporte muestra "hoy subieron N / bajaron M". La
 *    atribución va por `evento.asesor` (nombre del dueño del crédito, tal como
 *    lo trae CADA fila de getBucketsHistorial) — ver resolverAsesorId para el
 *    porqué de descartar `asesor_atribucion_id` y los mapas externos
 *    (pool/carga) que se probaron antes. El asesor en cartera-back no tiene
 *    id de usuario del CRM propio — se resuelve cruzando por nombre contra
 *    `user.name`. Se reemplaza completo (DELETE + INSERT) en cada corrida:
 *    son datos derivados de cartera-back, recalculables, sin un "contacto"
 *    que ancle un ON CONFLICT.
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
 * Mapa `nombre normalizado → user.id (CRM)`. Cruzar por nombre en vez de
 * asesor_id/email porque el nombre viaja EN CADA FILA del evento
 * (`getBucketsHistorial().data[].asesor`), sin necesitar una llamada aparte
 * a un pool o catálogo que puede cambiar entre el movimiento y esta corrida.
 *
 * Se descartaron dos fuentes externas antes de llegar acá, ambas por la misma
 * clase de bug (mapa construido de un catálogo "vigente ahora", que puede
 * haber perdido al asesor entre el evento y la corrida — 00:15 GT del día
 * siguiente):
 *   - `getCargaPorAsesorBucket`: excluye créditos CANCELADO/
 *     PENDIENTE_CANCELACION/EN_CONVENIO/CAIDO (STATUS_BUCKET_FUERA en
 *     cartera-back) — si el único crédito del asesor se resolvió antes de la
 *     corrida, desaparecía del mapa (hallado por Codex en PR #1185, 1er round).
 *   - `getPoolAsesoresPorBucket`: solo pool ACTIVO ahora — si desactivan al
 *     asesor del pool entre el evento y la corrida, mismo problema, y además
 *     el DELETE+INSERT de abajo podía BORRAR filas ya capturadas en una
 *     corrida anterior si un re-run perdía a ese asesor del mapa (hallado por
 *     Codex en PR #1185, 2do round).
 * Usar el nombre que trae el propio evento es inmune a ambos: no depende de
 * ningún estado "actual" externo al evento mismo.
 */
function resolverAsesorId(
	nombreAsesor: string | null,
	nombreToUserId: ReadonlyMap<string, string>,
): string | null {
	if (!nombreAsesor) return null;
	return nombreToUserId.get(nombreAsesor.trim().toLowerCase()) ?? null;
}

async function _generarCierreMovimientosBucket(fecha: string) {
	const usuarios = await db.select({ id: user.id, name: user.name }).from(user);
	const nombreToUserId = new Map(
		usuarios.map((u) => [u.name.trim().toLowerCase(), u.id]),
	);

	type FilaMovimiento = {
		asesorId: string;
		numeroCreditoSifco: string;
		bucketAnterior: number;
		bucketNuevo: number;
		tipo: "subida" | "bajada";
	};
	const filas: FilaMovimiento[] = [];

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
			// Se atribuye por evento.asesor (nombre) — el dueño ACTUAL del crédito
			// al momento del evento (creditos.asesor_id vía el JOIN de
			// cartera-back, "hoy siempre hay dueño" según la decisión de raíz
			// 2026-07-07 de ese repo). NO asesor_atribucion_id
			// (buckets_historial.asesor_id): ese campo lo deja NULL el proceso
			// automático nocturno (latefee.ts:1181, "se llena con el nuevo flujo
			// de pago" — no implementado todavía), así que filtrar por él descarta
			// el 100% de los movimientos del motor normal (hallado por Codex en
			// PR #1183). Tampoco el pool del bucket de origen: varios asesores
			// comparten bucket, un mismo movimiento se contaba varias veces. Y NO
			// un mapa externo (pool/carga) resuelto aparte: ambos dependían de un
			// catálogo "vigente ahora" que puede haber perdido al asesor entre el
			// evento y esta corrida — ver resolverAsesorId. Eventos sin asesor, o
			// cuyo nombre no cruza con un usuario del CRM, se omiten.
			const asesorId = resolverAsesorId(evento.asesor, nombreToUserId);
			if (!asesorId) continue;
			filas.push({
				asesorId,
				numeroCreditoSifco: evento.numero_credito_sifco,
				bucketAnterior: evento.bucket_anterior,
				bucketNuevo: evento.bucket_nuevo,
				tipo: evento.tipo_evento === "SUBIDA" ? "subida" : "bajada",
			});
		}
		const totalPages = resp.pagination?.totalPages ?? 1;
		if (page >= totalPages) break;
		if (page === MAX_PAGINAS) truncado = true;
	}
	if (truncado) {
		console.warn(
			`[CierreDiarioAsesor] ${fecha}: se alcanzó el tope de ${MAX_PAGINAS} páginas de movimientos de bucket — posible totalPages corrupto de cartera-back`,
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
