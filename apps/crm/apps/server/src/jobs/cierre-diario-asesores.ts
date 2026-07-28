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
 *    atribución va por `asesor_id` (dueño ACTUAL del crédito, NOT NULL) y NO
 *    por `asesor_atribucion_id` (buckets_historial.asesor_id) ni por el pool
 *    del bucket de origen — ver el comentario en
 *    _generarCierreMovimientosBucket para el porqué de cada descarte. El
 *    asesor en cartera-back tiene id numérico distinto al user.id (texto) del
 *    CRM — se resuelve cruzando por NOMBRE contra el pool completo de
 *    /buckets/pool (ver construirMapaAsesorUsuarioPorCarga). Se reemplaza
 *    completo (DELETE + INSERT) en cada corrida: son datos derivados de
 *    cartera-back, recalculables, sin un "contacto" que ancle un ON CONFLICT.
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

// Buckets fijos del funnel operativo (B0-B5) — se recorren para armar el pool
// completo de asesores, igual que en getCierreDiarioPorRango (routers/cobros.ts).
const BUCKETS_NUMEROS = [0, 1, 2, 3, 4, 5] as const;

/**
 * Mapa `asesor_id (cartera) → user.id (CRM)`, cruzando por NOMBRE.
 *
 * NO se usa `getCargaPorAsesorBucket` (como antes): esa lista solo incluye
 * asesores con al menos un crédito ACTUALMENTE en el funnel operativo
 * (excluye CANCELADO/PENDIENTE_CANCELACION/EN_CONVENIO/CAIDO — ver
 * STATUS_BUCKET_FUERA en cartera-back). `getBucketsHistorial` no tiene ese
 * filtro: si el único crédito de un asesor se resolvió (se pagó, se canceló)
 * ENTRE el movimiento de bucket y esta corrida (00:15 GT del día siguiente),
 * ese asesor desaparecía del mapa y su movimiento se descartaba en silencio
 * — un caso frecuente en cobros, no un edge case (hallado por Codex en PR
 * #1185).
 *
 * En su lugar, el pool sale de `getPoolAsesoresPorBucket` (6 llamadas, una
 * por bucket) — es `asesor_bucket WHERE activo=true` tal cual, sin depender
 * de créditos ni de su estado. Ese endpoint no trae email, así que el cruce
 * con `user` del CRM va por NOMBRE normalizado (trim + lowercase) en vez de
 * correo — menos preciso que el email, pero los nombres son únicos en la
 * práctica y es preferible a perder movimientos reales.
 */
async function construirMapaAsesorUsuarioPorCarga(): Promise<
	Map<number, string>
> {
	const [pools, usuarios] = await Promise.all([
		Promise.all(
			BUCKETS_NUMEROS.map((bucket) =>
				carteraBackClient.getPoolAsesoresPorBucket(bucket),
			),
		),
		db.select({ id: user.id, name: user.name }).from(user),
	]);
	const nombreToUserId = new Map(
		usuarios.map((u) => [u.name.trim().toLowerCase(), u.id]),
	);
	const mapa = new Map<number, string>();
	for (const pool of pools) {
		for (const a of pool) {
			if (mapa.has(a.asesor_id)) continue;
			const userId = nombreToUserId.get(a.nombre.trim().toLowerCase());
			if (userId) mapa.set(a.asesor_id, userId);
		}
	}
	return mapa;
}

async function _generarCierreMovimientosBucket(fecha: string) {
	const mapaAsesorUsuario = await construirMapaAsesorUsuarioPorCarga();
	if (mapaAsesorUsuario.size === 0) {
		console.log(
			"[CierreDiarioAsesor] Sin mapa asesor→usuario, se omiten movimientos de bucket",
		);
		return;
	}

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
			// Se atribuye por evento.asesor_id — el dueño ACTUAL del crédito
			// (creditos.asesor_id, NOT NULL, "hoy siempre hay dueño" según la
			// decisión de raíz 2026-07-07 de cartera-back). NO
			// asesor_atribucion_id (buckets_historial.asesor_id): ese campo lo
			// deja NULL el proceso automático nocturno (latefee.ts:1181, comentario
			// "Opción B: se llena con el nuevo flujo de pago" — no implementado
			// todavía), así que filtrar por él descarta el 100% de los movimientos
			// del motor normal, no solo un caso borde (hallado por Codex en PR
			// #1183 tras el primer intento con asesor_atribucion_id). El costo
			// aceptado: si el crédito se reasigna después de moverse de bucket, la
			// atribución "sigue" al nuevo dueño en vez de quedar congelada al
			// momento del evento — trade-off necesario porque la alternativa es
			// cero movimientos reportados, siempre.
			// Tampoco se usa el pool del bucket de origen: varios asesores
			// comparten bucket (B2 lo atienden 3), así que por pool un mismo
			// movimiento se contaba varias veces y los totales no cuadraban con
			// los eventos reales. Eventos sin asesor, o cuyo asesor no cruza con un
			// usuario del CRM, se omiten.
			if (evento.asesor_id == null) continue;
			const asesorId = mapaAsesorUsuario.get(evento.asesor_id);
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
