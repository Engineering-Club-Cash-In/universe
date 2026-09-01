/**
 * Dispatcher Págalo (CB-028, paso 3): toma grupos en READY_TO_APPLY y los
 * envía a cartera-back, que es quien de verdad aplica el pago.
 *
 * D-05 (docs/features/pagalo/DECISIONES.md): cartera recibe importación
 * únicamente cuando CRM ya tiene un ACCEPT por cada lado requerido y sus
 * vouchers — eso ya lo garantiza el poller (`pagalo-poll.ts`) antes de
 * marcar READY_TO_APPLY; este job solo transporta esa evidencia.
 *
 * D-10: el pago nace validado del lado de cartera — este job no valida
 * nada de negocio, solo arma el comando exacto y lo envía. La validación
 * de negocio (montos, deuda viva, duplicados) vive en cartera-back
 * (`pagaloPaymentImportPolicy.ts`), que es quien tiene el estado real del
 * crédito bajo lock.
 *
 * D-13: idempotencia por `crm_group_id` + `payload_hash`. Un retry exacto
 * (mismo grupo, mismo hash) siempre es seguro — cartera-back devuelve el
 * mismo resultado sin duplicar nada. Por eso el backoff de este job puede
 * ser generoso: no hay urgencia en reintentar rápido, solo en no perder el
 * grupo.
 *
 * `REVIEW_REQUIRED` (409) nunca se reintenta solo — significa que cartera
 * ya evaluó el comando bajo lock y encontró algo que un humano debe
 * revisar (hash distinto para el mismo grupo, o deuda viva incompatible).
 * Reintentar automáticamente ese caso sería exactamente lo que D-05
 * prohíbe: aplicar con datos ambiguos.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "../db";
import { notifications } from "../db/schema/notifications";
import {
	pagaloPaymentEvents,
	pagaloPaymentGroups,
	pagaloPaymentLinks,
} from "../db/schema/pagalo-payments";
import {
	calcularPagaloPayloadHash,
	ordenarAllocations,
	type PagaloAllocationForHash,
	type PagaloSourceForHash,
} from "../lib/pagalo-payload-hash";
import { carteraBackClient } from "../services/cartera-back-client";
import {
	construirMapaAsesorUsuario,
	resolverUsuarioSistemaCobros,
} from "../services/cobros-notif-helpers";
import { postPagaloPaymentImport } from "../services/pagalo-import-client";

/** Tope por corrida. Si hay más, se atienden en la siguiente. */
const MAXIMO_POR_CORRIDA = 50;
/** Lease: si un proceso murió a mitad de un batch, otro puede reclamarlo. */
const MINUTOS_LEASE = 2;
/** Backoff exponencial con techo — sin urgencia de segundos (D-13: retry siempre seguro). */
const BACKOFF_BASE_SEGUNDOS = 30;
const BACKOFF_TOPE_SEGUNDOS = 30 * 60;

type GrupoClaimado = typeof pagaloPaymentGroups.$inferSelect;

const proximoIntento = (dispatchAttemptCount: number): Date => {
	const segundos = Math.min(
		BACKOFF_BASE_SEGUNDOS * 2 ** dispatchAttemptCount,
		BACKOFF_TOPE_SEGUNDOS,
	);
	return new Date(Date.now() + segundos * 1000);
};

/**
 * Sandbox de una instancia — no hace falta `FOR UPDATE SKIP LOCKED` todavía
 * (mismo criterio que `reclamarLinksPendientes` en pagalo-poll.ts; el propio
 * comentario del schema en pagalo-payments.ts ya anticipa esa mejora si
 * algún día corre más de una instancia).
 */
/**
 * Incluye `APPLYING`: si un proceso murió a mitad de aplicar (crash, deploy,
 * kill -9) el grupo queda en ese estado y jamás volvería a seleccionarse sin
 * esto (hallazgo Codex) — el lease vencido es la única señal de que el
 * dueño anterior ya no sigue vivo. Reclamarlo de nuevo es seguro por D-13:
 * el mismo `crm_group_id`+`payload_hash` es idempotente en cartera-back, así
 * que reintentar el POST nunca duplica el pago aunque la corrida anterior sí
 * haya llegado a aplicarse y solo faltara que el CRM se enterara.
 */
const ESTADOS_RECLAMABLES = [
	"READY_TO_APPLY",
	"APPLICATION_FAILED",
	"APPLYING",
] as const;

/**
 * Solo IDS candidatos — el claim real ocurre uno por uno en
 * `reclamarYProcesarGrupo`, justo antes de procesar cada grupo. Reclamar el
 * batch entero de una vez (como antes) estampaba el mismo lease de 2 min a
 * los 50 grupos por adelantado; si el batch tardaba más que eso (plausible:
 * hasta 10s por request HTTP), un segundo worker podía reclamar de nuevo los
 * grupos todavía en cola del primero y ambos los procesaban en paralelo sin
 * que ninguna escritura de resultado verificara el lease (hallazgo Codex).
 */
async function buscarCandidatosListos(): Promise<string[]> {
	const ahora = new Date();
	const leaseVencido = new Date(Date.now() - MINUTOS_LEASE * 60 * 1000);
	const candidatos = await db
		.select({ id: pagaloPaymentGroups.id })
		.from(pagaloPaymentGroups)
		.where(
			and(
				inArray(pagaloPaymentGroups.status, ESTADOS_RECLAMABLES),
				or(
					isNull(pagaloPaymentGroups.nextDispatchAt),
					lt(pagaloPaymentGroups.nextDispatchAt, ahora),
				),
				or(
					isNull(pagaloPaymentGroups.dispatchClaimedAt),
					lt(pagaloPaymentGroups.dispatchClaimedAt, leaseVencido),
				),
			),
		)
		.orderBy(asc(pagaloPaymentGroups.readyToApplyAt))
		.limit(MAXIMO_POR_CORRIDA);
	return candidatos.map((c) => c.id);
}

/** Claim atómico puntual, con lease vencido — mismo criterio en todos lados. */
async function reclamarGrupo(
	groupId: string,
): Promise<GrupoClaimado | undefined> {
	const ahora = new Date();
	const leaseVencido = new Date(Date.now() - MINUTOS_LEASE * 60 * 1000);
	const [group] = await db
		.update(pagaloPaymentGroups)
		.set({
			status: "APPLYING",
			dispatchClaimedAt: ahora,
			dispatchClaimToken: randomUUID(),
			applicationStartedAt: ahora,
		})
		.where(
			and(
				eq(pagaloPaymentGroups.id, groupId),
				inArray(pagaloPaymentGroups.status, ESTADOS_RECLAMABLES),
				or(
					isNull(pagaloPaymentGroups.dispatchClaimedAt),
					lt(pagaloPaymentGroups.dispatchClaimedAt, leaseVencido),
				),
				// Mismo predicado que buscarCandidatosListos: si el dispatcher
				// programado y el dispatch del poll corren solapados, uno puede
				// fallar el grupo y fijar nextDispatchAt (backoff) DESPUÉS de que
				// el otro ya lo tenía en su lista de candidatos — sin repetir el
				// chequeo acá, el segundo lo reclama igual y reintenta de
				// inmediato, saltándose el backoff recién configurado (hallazgo
				// Codex).
				or(
					isNull(pagaloPaymentGroups.nextDispatchAt),
					lt(pagaloPaymentGroups.nextDispatchAt, ahora),
				),
			),
		)
		.returning();
	return group;
}

/**
 * Todo update de resultado exige `status='APPLYING'` + el mismo
 * `dispatchClaimToken` con el que se reclamó — no solo el id. Un solo
 * `getCarteraAccessToken()` (verify/login sin timeout, cartera-auth.service.ts)
 * puede tardar más que el lease de 2 min por sí solo, así que un worker
 * reemplazante puede reclamar y hasta completar el grupo antes de que el
 * worker viejo (que sigue esperando su fetch colgado) escriba su resultado.
 * Sin este guard, ese resultado atrasado podía pisar un COMPLETED con
 * APPLICATION_FAILED o duplicar el evento (hallazgo Codex).
 */
const filtroClaimVigente = (group: GrupoClaimado) => {
	// El token siempre se setea junto con status='APPLYING' en el mismo
	// UPDATE que reclama (reclamarGrupo/reclamarYProcesarGrupo) — si llega
	// null acá, algo llamó a este código con un `group` que nunca pasó por
	// un claim real, y comparar contra NULL en SQL fallaría siempre en
	// falso de forma silenciosa. Mejor un error explícito.
	if (!group.dispatchClaimToken) {
		throw new Error(
			`Grupo ${group.id} sin dispatchClaimToken — no fue reclamado correctamente.`,
		);
	}
	return and(
		eq(pagaloPaymentGroups.id, group.id),
		eq(pagaloPaymentGroups.status, "APPLYING"),
		eq(pagaloPaymentGroups.dispatchClaimToken, group.dispatchClaimToken),
	);
};

/** Mismo criterio que POLL_RETRY_EXHAUSTED (pagalo-poll.ts): un evento solo
 * al cruzar el umbral, no en cada intento — CB-127 G3. */
const UMBRAL_DISPATCH_RETRY_EXHAUSTED = 5;

async function registrarIntentoFallido(
	group: GrupoClaimado,
	errorMessage: string,
): Promise<void> {
	const dispatchAttemptCount = group.dispatchAttemptCount + 1;
	await db.transaction(async (tx) => {
		const [actualizado] = await tx
			.update(pagaloPaymentGroups)
			.set({
				status: "APPLICATION_FAILED",
				dispatchAttemptCount,
				nextDispatchAt: proximoIntento(dispatchAttemptCount),
				dispatchClaimedAt: null,
				lastDispatchError: errorMessage,
				updatedAt: new Date(),
			})
			.where(filtroClaimVigente(group))
			.returning({ id: pagaloPaymentGroups.id });
		if (!actualizado) return;
		if (dispatchAttemptCount === UMBRAL_DISPATCH_RETRY_EXHAUSTED) {
			await tx.insert(pagaloPaymentEvents).values({
				groupId: group.id,
				eventType: "DISPATCH_RETRY_EXHAUSTED",
				source: "PAGALO_DISPATCHER",
				payload: {
					dispatchAttemptCount,
					lastDispatchError: errorMessage.slice(0, 500),
				},
			});
		}
	});
}

type FuenteLink = { linkType: "CAPITAL" | "MORA_INTERES" } & Pick<
	typeof pagaloPaymentLinks.$inferSelect,
	| "pagaloTransactionUuid"
	| "externalIdentifier"
	| "requestId"
	| "requestAuth"
	| "paidAt"
	| "voucherStorageKey"
>;

function fuenteDesdeLink(link: FuenteLink | undefined): PagaloSourceForHash {
	if (
		!link ||
		!link.pagaloTransactionUuid ||
		!link.paidAt ||
		!link.voucherStorageKey
	)
		return null;
	return {
		transaction_uuid: link.pagaloTransactionUuid,
		external_identifier: link.externalIdentifier,
		request_id: link.requestId ?? undefined,
		request_auth: link.requestAuth ?? undefined,
		paid_at: link.paidAt.toISOString(),
		voucher_storage_key: link.voucherStorageKey,
	};
}

/**
 * Arma el comando completo o devuelve `null` si el grupo todavía no tiene
 * todos los links requeridos con isApplicationSource=true — carrera con el
 * poller que no debería pasar (el poller solo marca READY_TO_APPLY cuando
 * ya están todos), pero se verifica en vez de enviar evidencia incompleta.
 */
async function armarComando(group: GrupoClaimado) {
	const links = await db
		.select()
		.from(pagaloPaymentLinks)
		.where(
			and(
				eq(pagaloPaymentLinks.groupId, group.id),
				eq(pagaloPaymentLinks.isApplicationSource, true),
			),
		);

	const capitalLink = links.find((l) => l.linkType === "CAPITAL");
	const facturableLink = links.find((l) => l.linkType === "MORA_INTERES");
	const requiereCapital = Number(group.capitalTotal) > 0;
	const requiereFacturable = Number(group.facturableTotal) > 0;
	if (
		(requiereCapital && !capitalLink) ||
		(requiereFacturable && !facturableLink)
	) {
		return null;
	}

	const allocationsSnapshot =
		group.allocationsSnapshot as PagaloAllocationForHash[];
	const allocations = ordenarAllocations(allocationsSnapshot);
	const cuotaInicial = Math.min(...allocations.map((a) => a.numero_cuota));

	const command = {
		crm_group_id: group.id,
		credito_id: group.carteraCreditoId,
		numero_credito_sifco: group.numeroCreditoSifco,
		currency: group.currency,
		capital_total: group.capitalTotal,
		facturable_total: group.facturableTotal,
		otros_total: group.otrosTotal,
		total_amount: group.totalAmount,
		cuota_inicial: cuotaInicial,
		allocations,
		capital: fuenteDesdeLink(capitalLink),
		facturable: fuenteDesdeLink(facturableLink),
	};

	if (requiereCapital && !command.capital) return null;
	if (requiereFacturable && !command.facturable) return null;

	const payload_hash = calcularPagaloPayloadHash(command);
	return { ...command, payload_hash };
}

/**
 * EL asesor único que tiene asignado el crédito HOY — no el snapshot fijo
 * de `group.carteraAsesorId` (tomado al crear el link, puede quedar
 * desactualizado si el crédito se reasignó después), y no el pool de
 * buckets (`getAsignacionesPoolPorSifco`), que puede devolver varios
 * asesores solapados y no sirve para "un solo destinatario". Misma fuente
 * (`getCredito` → `credito.asesor_id`) que usa `pago-link.ts` al crear el
 * link originalmente.
 */
async function resolverAsesorVigente(
	numeroCreditoSifco: string,
	asesorMap: Map<number, string>,
): Promise<string | null> {
	const credito = await carteraBackClient
		.getCredito(numeroCreditoSifco, false)
		.catch(() => null);
	const asesorId = credito?.credito.asesor_id;
	return asesorId ? (asesorMap.get(asesorId) ?? null) : null;
}

async function marcarCompletado(
	group: GrupoClaimado,
	payloadHash: string,
	importId: number,
	asesorMap?: Map<number, string>,
): Promise<void> {
	// Resuelto ANTES de la tx (llama a cartera-back) — nunca red mientras una
	// tx de DB sigue abierta, mismo criterio que el resto del job (ver
	// comentario en pagalo-poll.ts sobre el dispatch inline).
	const mapa = asesorMap ?? (await construirMapaAsesorUsuario());
	const asesorUserId = await resolverAsesorVigente(
		group.numeroCreditoSifco,
		mapa,
	);
	const usuarioSistema = asesorUserId
		? await resolverUsuarioSistemaCobros()
		: null;

	await db.transaction(async (tx) => {
		const [actualizado] = await tx
			.update(pagaloPaymentGroups)
			.set({
				status: "COMPLETED",
				completedAt: new Date(),
				sentToCarteraAt: group.sentToCarteraAt ?? new Date(),
				carteraImportId: importId,
				applicationPayloadHash: payloadHash,
				dispatchClaimedAt: null,
				nextDispatchAt: null,
				updatedAt: new Date(),
			})
			.where(filtroClaimVigente(group))
			.returning({ id: pagaloPaymentGroups.id });
		if (!actualizado) return;
		await tx.insert(pagaloPaymentEvents).values({
			groupId: group.id,
			eventType: "GROUP_COMPLETED",
			source: "PAGALO_DISPATCHER",
			fromStatus: "APPLYING",
			toStatus: "COMPLETED",
			payload: { carteraImportId: importId },
		});
		if (usuarioSistema && asesorUserId) {
			await tx.insert(notifications).values({
				titulo: `Pago aplicado - Crédito ${group.numeroCreditoSifco}`,
				descripcion: `Se aplicó el pago de Q${group.totalAmount} sobre el crédito ${group.numeroCreditoSifco}.`,
				type: "aviso",
				createdBy: usuarioSistema,
				createdByRole: "cobros_supervisor",
				assignedToRole: "cobros",
				assignedTo: asesorUserId,
				...(group.casoCobroId
					? {
							relatedEntityType: "collection_case" as const,
							relatedEntityId: group.casoCobroId,
						}
					: {}),
				redirectPage: "cobros_detail",
			});
		}
	});
}

async function marcarRevisionRequerida(
	group: GrupoClaimado,
	code: string,
	importId: number | undefined,
	detalle?: unknown,
): Promise<void> {
	await db.transaction(async (tx) => {
		const [actualizado] = await tx
			.update(pagaloPaymentGroups)
			.set({
				status: "REVIEW_REQUIRED",
				lastDispatchError: code,
				dispatchClaimedAt: null,
				updatedAt: new Date(),
				// cartera-back crea igual un ledger REVIEW_REQUIRED para un
				// rechazo de deuda viva/identidad de crédito y devuelve su id —
				// antes solo quedaba en el payload del evento, y getPagaloHistorial
				// lee la columna del grupo, no los payloads (hallazgo Codex). No
				// implica que el pago se aplicó — solo deja el identificador para
				// que el operador pueda inspeccionar el import rechazado.
				...(importId !== undefined ? { carteraImportId: importId } : {}),
			})
			.where(filtroClaimVigente(group))
			.returning({ id: pagaloPaymentGroups.id });
		if (!actualizado) return;
		await tx.insert(pagaloPaymentEvents).values({
			groupId: group.id,
			eventType: "GROUP_REVIEW_REQUIRED",
			source: "PAGALO_DISPATCHER",
			fromStatus: "APPLYING",
			toStatus: "REVIEW_REQUIRED",
			payload: {
				code,
				carteraImportId: importId ?? null,
				...(detalle ? { detalle } : {}),
			},
		});
	});
}

export type ResultadoProcesarGrupo = "COMPLETADO" | "REVIEW_REQUIRED" | "ERROR";

/**
 * Arma el comando de un grupo ya reclamado (status=APPLYING) y lo envía a
 * cartera-back. Reusada por `correrDispatchPagalo` (loop de grupos
 * `READY_TO_APPLY`/`APPLICATION_FAILED` reclamados) y por el poller
 * (`pagalo-poll.ts`), que la llama inline apenas el ÚLTIMO link de un grupo
 * queda pagado — sin esperar el próximo ciclo del dispatcher. Requiere que
 * el caller ya haya reclamado el grupo (`status='APPLYING'`) antes de llamar,
 * para no duplicar el claim en dos lugares.
 */
export async function procesarGrupoParaAplicar(
	group: GrupoClaimado,
	asesorMap?: Map<number, string>,
): Promise<ResultadoProcesarGrupo> {
	let command: Awaited<ReturnType<typeof armarComando>>;
	try {
		command = await armarComando(group);
	} catch (error) {
		await registrarIntentoFallido(
			group,
			error instanceof Error ? error.message : String(error),
		);
		return "ERROR";
	}
	if (!command) {
		await registrarIntentoFallido(
			group,
			"Grupo READY_TO_APPLY sin todos los links requeridos con isApplicationSource=true.",
		);
		return "ERROR";
	}

	const respuesta = await postPagaloPaymentImport(command);

	if (respuesta.success && respuesta.status === "APPLIED") {
		await marcarCompletado(
			group,
			command.payload_hash,
			respuesta.import_id,
			asesorMap,
		);
		return "COMPLETADO";
	}

	if (!respuesta.success && respuesta.status === "REVIEW_REQUIRED") {
		// `postPagaloPaymentImport` castea el JSON de cartera-back sin
		// validación runtime — un replay de un import ya REVIEW_REQUIRED podía
		// venir sin `code` pese al tipo estricto. Fallback defensivo para
		// nunca guardar "undefined" como motivo (hallazgo Codex).
		const code = respuesta.code ?? "PAGALO_REVIEW_REQUIRED_UNKNOWN_REASON";
		// PAGALO_TRANSACTION_ALREADY_IMPORTED manda conflicting_import_id (el
		// import PREEXISTENTE con la misma evidencia), no import_id — usar el
		// campo correcto según el código, si no el operador pierde la
		// referencia al import que realmente causó el conflicto (hallazgo
		// Codex).
		const importId =
			code === "PAGALO_TRANSACTION_ALREADY_IMPORTED"
				? respuesta.conflicting_import_id
				: respuesta.import_id;
		await marcarRevisionRequerida(group, code, importId);
		return "REVIEW_REQUIRED";
	}

	// INVALID_COMMAND es determinístico: el comando se arma desde datos
	// inmutables del grupo (allocations_snapshot, links pagados, hash) —
	// reintentar el mismo comando nunca cambia el resultado. Reintentarlo con
	// backoff bloqueaba para siempre el grupo (constraint de "un grupo activo
	// por crédito" impide crear uno de reemplazo) sin que nadie se enterara
	// salvo mirando logs (hallazgo Codex). Va a REVIEW_REQUIRED con los
	// errores de validación preservados, igual que cualquier otro caso que
	// solo un humano puede resolver.
	if (!respuesta.success && respuesta.status === "INVALID_COMMAND") {
		await marcarRevisionRequerida(
			group,
			"PAGALO_INVALID_COMMAND",
			undefined,
			respuesta.errors,
		);
		console.error(
			`[Págalo][DISPATCH] grupo ${group.id} con comando inválido, requiere revisión:`,
			respuesta.errors,
		);
		return "REVIEW_REQUIRED";
	}

	// NETWORK_ERROR, AUTH_ERROR, UNEXPECTED_RESPONSE — transitorios, sí vale
	// reintentar con backoff.
	await registrarIntentoFallido(group, respuesta.message);
	console.error(
		`[Págalo][DISPATCH] grupo ${group.id} falló: ${respuesta.message}`,
	);
	return "ERROR";
}

/**
 * Reclama un grupo puntual y lo procesa — usada tanto por el poller (ya sabe
 * cuál grupo acaba de quedar READY_TO_APPLY) como por el loop de
 * `correrDispatchPagalo` (reclama cada candidato del batch justo antes de
 * procesarlo, no todos de antemano).
 */
export async function reclamarYProcesarGrupo(
	groupId: string,
	asesorMap?: Map<number, string>,
): Promise<ResultadoProcesarGrupo | "NO_RECLAMADO"> {
	const group = await reclamarGrupo(groupId);
	if (!group) return "NO_RECLAMADO";
	return procesarGrupoParaAplicar(group, asesorMap);
}

export type ResultadoDispatchPagalo = {
	revisados: number;
	completados: number;
	revisionRequerida: number;
	errores: number;
};

export async function correrDispatchPagalo(): Promise<ResultadoDispatchPagalo> {
	const candidatoIds = await buscarCandidatosListos();
	const resultado: ResultadoDispatchPagalo = {
		revisados: candidatoIds.length,
		completados: 0,
		revisionRequerida: 0,
		errores: 0,
	};
	if (candidatoIds.length === 0) return resultado;

	const asesorMap = await construirMapaAsesorUsuario();
	for (const groupId of candidatoIds) {
		const resultadoGrupo = await reclamarYProcesarGrupo(groupId, asesorMap);
		if (resultadoGrupo === "COMPLETADO") resultado.completados++;
		else if (resultadoGrupo === "REVIEW_REQUIRED")
			resultado.revisionRequerida++;
		else if (resultadoGrupo !== "NO_RECLAMADO") resultado.errores++;
	}

	return resultado;
}
