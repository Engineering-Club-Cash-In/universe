/**
 * Poller de links Págalo (CB-028).
 *
 * D-49 (docs/features/bot-whatsapp-cobros/DECISIONES.md): la verdad es el
 * poller, no un callback. Págalo no documenta webhooks firmados; los únicos
 * callbacks del create son redirects del navegador del cliente, falsificables.
 * Este job es la única fuente que marca un link como pagado.
 *
 * D-50: cuando TODOS los links requeridos de un grupo (uno o dos, según D-48
 * — cualquier lado puede ser Q0 y no tener link) están pagados y con voucher
 * propio, el grupo pasa a READY_TO_APPLY. Ningún paso previo toca cartera.
 * Apenas eso ocurre, este job dispara el dispatch de ESE grupo inline (ver
 * `reclamarYProcesarGrupo` en `pagalo-dispatch.ts`) en vez de esperar el
 * próximo ciclo programado del dispatcher — evita hasta 5 min extra de
 * espera. El dispatcher programado sigue corriendo igual como respaldo para
 * reintentar cualquier grupo que haya quedado `APPLICATION_FAILED`.
 *
 * D-51: los links no expiran. Un link REPLACED sigue en el barrido hasta
 * observar su destino final (pagado/cancelado/expirado) — sacarlo del poll
 * volvería invisible un pago real.
 *
 * D-12: antes de contar un link como application_source, su voucher debe
 * estar copiado a almacenamiento propio.
 *
 * VOUCHER — por qué es generado, no descargado de Págalo. Confirmado en
 * sandbox con datos reales: /v1/integration/transactions (único endpoint de
 * Págalo con el campo `voucher`) exige el Bearer de /v1/login (V2), un login
 * separado del `authorization` fijo del comercio que decidimos NO usar (ver
 * decisión del usuario). Con el `authorization` fijo, dos endpoints SÍ dan
 * el detalle completo de la transacción real (no. de transacción, tarjeta
 * enmascarada, fecha, monto) pero ninguno trae un archivo:
 * /v1/payment/request/uuid (status del link) y /v1/payment/transaction/uuid
 * con `id_external` = nuestro externalIdentifier (confirmado: `transactions_
 * uuid` con el uuid del link no encuentra nada; `id_external` sí). Con esos
 * datos reales, el worker genera su propio comprobante en el mismo formato
 * visual del que emite Págalo (ver generarVoucherPdf) usando pdf-lib.
 *
 * DÓNDE SE SUBE EL VOUCHER — a cartera-back, no al bucket del CRM. El comando
 * de importación (`pagaloPaymentImportPolicy.ts`) exige una key que
 * cartera-back pueda resolver en SU PROPIO bucket R2 (`R2_BUCKET`, distinto
 * del bucket del CRM) — cartera-back nunca sube ni descarga nada él mismo,
 * solo persiste el string recibido (`insertarBoletas`/`prepararURLsBoletas`
 * en registerPayment.ts, confirmado leyendo el código: cero I/O de storage).
 * Por eso el worker sube el PDF reutilizando `carteraBackClient.uploadFile`
 * — el mismo `POST /upload` que ya usan carteraFront y el bot de cobros para
 * boletas de depósito, con el mismo Bearer JWT — en vez de un bucket propio.
 */
import { createHash } from "node:crypto";
import {
	and,
	asc,
	eq,
	inArray,
	isNull,
	lt,
	ne,
	notInArray,
	or,
	sql,
} from "drizzle-orm";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { db } from "../db";
import {
	pagaloPaymentEvents,
	pagaloPaymentGroups,
	pagaloPaymentLinks,
} from "../db/schema/pagalo-payments";
import { proximoIntentoPoll } from "../lib/pagalo-poll-cadencia";
import { carteraBackClient } from "../services/cartera-back-client";
import { construirMapaAsesorUsuario } from "../services/cobros-notif-helpers";
import {
	createPagaloClient,
	getPagaloSandboxConfig,
	PagaloClientError,
} from "../services/pagalo-client";
import {
	correrDispatchPagalo,
	reclamarYProcesarGrupo,
} from "./pagalo-dispatch";

/** Tope por corrida. Si hay más, se atienden en la siguiente. */
const MAXIMO_POR_CORRIDA = 50;
/** Lease: si un proceso murió a mitad de un batch, otro puede reclamarlo. */
const MINUTOS_LEASE = 2;
/** Backoff exponencial con techo. */

type LinkClaimado = typeof pagaloPaymentLinks.$inferSelect;

type TransaccionPagalo = {
	uuid: string;
	status_transaction: string;
	request_id: string;
	request_auth: string;
	total: number;
	currency: string;
	date_transaction: string;
	value_payment: string;
	business?: { name?: string };
	client_name?: string;
};

// La cadencia (primera revisión y backoff) vive en lib/pagalo-poll-cadencia.ts
// porque también la necesita quien CREA el link, para sembrar next_poll_at.
const proximoIntento = (pollAttempts: number): Date =>
	proximoIntentoPoll(pollAttempts);

function validarTransaccionPagalo(
	link: LinkClaimado,
	transaccion: TransaccionPagalo,
): void {
	if (transaccion.status_transaction !== "ACCEPT") {
		throw new Error("Transacción Págalo no está ACCEPT.");
	}
	const payload = link.requestPayload as { total_amount?: unknown } | null;
	const expected = Number(payload?.total_amount);
	const received = Number(transaccion.total);
	if (
		!Number.isFinite(expected) ||
		!Number.isFinite(received) ||
		expected.toFixed(2) !== received.toFixed(2)
	) {
		throw new Error("Monto Págalo no coincide con monto congelado del link.");
	}
	if (transaccion.currency !== "GTQ") {
		throw new Error("Moneda Págalo no coincide con GTQ.");
	}
}

/**
 * Sandbox de una instancia — no hace falta `FOR UPDATE SKIP LOCKED` todavía.
 * Si algún día corre más de una instancia de este job, hace falta ese patrón
 * (igual que el outbox de dispatch en pagaloPaymentGroups.dispatchClaimedAt).
 */
async function reclamarLinksPendientes(
	// Verificación puntual de un grupo (botón "Verificar ahora" de la Ficha
	// 360): se salta `nextPollAt` a propósito — la persona está preguntando
	// AHORA y esperar el backoff es justo lo que quiere evitar. El lease sí
	// se respeta: si el ciclo automático ya tiene el link agarrado, esta
	// corrida no se lo pelea.
	groupId?: string,
): Promise<LinkClaimado[]> {
	const ahora = new Date();
	const leaseVencido = new Date(Date.now() - MINUTOS_LEASE * 60 * 1000);
	const leTocaYa = groupId
		? eq(pagaloPaymentLinks.groupId, groupId)
		: lt(pagaloPaymentLinks.nextPollAt, ahora);
	const pollable = and(
		leTocaYa,
		inArray(pagaloPaymentLinks.status, ["CREATING", "ACTIVE", "REPLACED"]),
		or(
			isNull(pagaloPaymentLinks.pollClaimedAt),
			lt(pagaloPaymentLinks.pollClaimedAt, leaseVencido),
		),
	);
	const candidatos = await db
		.select({ id: pagaloPaymentLinks.id })
		.from(pagaloPaymentLinks)
		.where(pollable)
		.orderBy(asc(pagaloPaymentLinks.nextPollAt))
		.limit(MAXIMO_POR_CORRIDA);
	if (candidatos.length === 0) return [];

	const reclamados: LinkClaimado[] = [];
	for (const candidato of candidatos) {
		const [link] = await db
			.update(pagaloPaymentLinks)
			.set({ pollClaimedAt: ahora })
			.where(and(eq(pagaloPaymentLinks.id, candidato.id), pollable))
			.returning();
		if (link) reclamados.push(link);
	}
	return reclamados;
}

/** Umbral de reintentos de poll a partir del cual se registra un evento
 * (no en cada intento: con backoff exponencial hasta 30 min, eso serían
 * decenas de filas por link y ahogaría la bitácora — CB-127 G3). */
const UMBRAL_POLL_RETRY_EXHAUSTED = 5;

async function registrarIntentoFallido(
	link: LinkClaimado,
	errorMessage?: string,
): Promise<void> {
	const pollAttempts = link.pollAttempts + 1;
	await db.transaction(async (tx) => {
		// Condicionado al pollClaimedAt que ESTA corrida puso al reclamar el
		// link (reclamarLinksPendientes) — sin esto, dos corridas reclamando
		// el mismo link casi a la vez (dos requests concurrentes al botón
		// manual probarPollPagalo, o dos réplicas del cron si algún día corre
		// en más de una instancia) calculaban pollAttempts en memoria a
		// partir del mismo snapshot y ambas insertaban POLL_RETRY_EXHAUSTED
		// al cruzar el umbral — evento duplicado en la bitácora sin que el
		// umbral realmente se cruzara dos veces (hallazgo de code review).
		// Solo la corrida que sigue siendo dueña del lease escribe; la otra
		// pierde la carrera en silencio (su próximo poll ya verá el estado
		// fresco).
		//
		// El lease por sí solo no alcanza: si ESTA corrida (dueña legítima
		// del lease) leyó un status pendiente de Págalo, pero mientras tanto
		// otra corrida con un lease vencido (que igual sigue procesando, el
		// vencimiento solo permite que OTRO worker reclame, no mata al
		// original) termina y marca el link PAID/terminal sin tocar
		// pollClaimedAt (ni marcarLinkPagado ni marcarLinkTerminal lo
		// limpian), este UPDATE seguía matchereando por pollClaimedAt y podía
		// sobrescribir pollAttempts/lastPollError — o insertar
		// POLL_RETRY_EXHAUSTED — sobre un link que ya salió del ciclo de
		// polling (hallazgo de code review). Mismos 3 estados pollables que
		// reclamarLinksPendientes.
		const [actualizado] = await tx
			.update(pagaloPaymentLinks)
			.set({
				pollAttempts,
				lastPolledAt: new Date(),
				lastPollError: errorMessage ?? null,
				nextPollAt: proximoIntento(pollAttempts),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(pagaloPaymentLinks.id, link.id),
					inArray(pagaloPaymentLinks.status, [
						"CREATING",
						"ACTIVE",
						"REPLACED",
					]),
					link.pollClaimedAt
						? eq(pagaloPaymentLinks.pollClaimedAt, link.pollClaimedAt)
						: isNull(pagaloPaymentLinks.pollClaimedAt),
				),
			)
			.returning({ id: pagaloPaymentLinks.id });
		if (!actualizado) return;
		if (pollAttempts === UMBRAL_POLL_RETRY_EXHAUSTED) {
			await tx.insert(pagaloPaymentEvents).values({
				groupId: link.groupId,
				linkId: link.id,
				eventType: "POLL_RETRY_EXHAUSTED",
				source: "PAGALO_POLLER",
				payload: { pollAttempts, lastPollError: errorMessage?.slice(0, 500) },
			});
		}
	});
}

/**
 * Avanza `terminalNotFoundAttempts` — contador aparte de `pollAttempts` (que
 * mezcla cualquier causa de fallo). Solo se llama cuando Págalo reporta el
 * link cancelado/expirado (status "3"/"4") Y la consulta de transacción
 * devuelve 400 (no encontrada) — el único caso donde ese conteo consecutivo
 * importa para decidir si ya es seguro finalizar. Usar `link.pollAttempts`
 * (genérico) para ese umbral finalizaba un link en el primer 400 con status
 * 3/4 si venía arrastrando fallos previos no relacionados (p.ej. varios
 * ciclos con status "1" sin pagar) — el bug que este contador dedicado
 * corrige (hallazgo de code review).
 *
 * El cruce de umbral se decide y se aplica DENTRO de esta misma transacción,
 * con el valor recién escrito bajo el lease actual — no con el snapshot
 * `link` en memoria capturado al reclamar. Si la consulta HTTP de transacción
 * tardó más que el lease y otro worker ya reclamó el link (reseteando el
 * contador porque para ese worker el patrón se rompió), este UPDATE
 * simplemente no matchea nada y la corrida vieja no hace nada más — nunca
 * finaliza con un conteo obsoleto que otra corrida ya invalidó (hallazgo de
 * code review).
 */
async function registrarIntentoNoEncontradoTerminal(
	link: LinkClaimado,
	statusTerminal: "CANCELLED" | "EXPIRED",
): Promise<void> {
	const pollAttempts = link.pollAttempts + 1;
	await db.transaction(async (tx) => {
		// Candado del GRUPO primero, del LINK después — mismo orden que
		// marcarLinkPagado y el reemplazo de grupo (pago-link.ts). Esta tx
		// puede terminar llamando a marcarLinkTerminalEnTx, que toma el
		// candado del grupo; si el UPDATE del link (que toma su candado
		// implícito) corriera primero, un pago real llegando en paralelo por
		// marcarLinkPagado (grupo→link) cruzaría los candados en orden
		// inverso — deadlock, y si Postgres elige la transacción de PAGO
		// como víctima, ese pago real queda sin observar (hallazgo de code
		// review).
		await tx
			.select({ id: pagaloPaymentGroups.id })
			.from(pagaloPaymentGroups)
			.where(eq(pagaloPaymentGroups.id, link.groupId))
			.for("update");
		const [actualizado] = await tx
			.update(pagaloPaymentLinks)
			.set({
				pollAttempts,
				terminalNotFoundAttempts: sql`${pagaloPaymentLinks.terminalNotFoundAttempts} + 1`,
				lastPolledAt: new Date(),
				lastPollError: null,
				nextPollAt: proximoIntento(pollAttempts),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(pagaloPaymentLinks.id, link.id),
					inArray(pagaloPaymentLinks.status, [
						"CREATING",
						"ACTIVE",
						"REPLACED",
					]),
					link.pollClaimedAt
						? eq(pagaloPaymentLinks.pollClaimedAt, link.pollClaimedAt)
						: isNull(pagaloPaymentLinks.pollClaimedAt),
				),
			)
			.returning({
				terminalNotFoundAttempts: pagaloPaymentLinks.terminalNotFoundAttempts,
			});
		if (!actualizado) return;
		if (actualizado.terminalNotFoundAttempts >= UMBRAL_POLL_RETRY_EXHAUSTED) {
			await marcarLinkTerminalEnTx(tx, link, statusTerminal);
		}
	});
}

/**
 * Resetea `terminalNotFoundAttempts` a 0 — se llama en cualquier ciclo donde
 * el link NO cae en el patrón "status 3/4 + transacción no encontrada", para
 * que un conteo viejo no se sume a confirmaciones futuras no consecutivas.
 *
 * Gateado por los mismos status pollables y el mismo `pollClaimedAt` que
 * `registrarIntentoNoEncontradoTerminal`: sin esto, un worker con el lease ya
 * vencido (consulta HTTP que tardó más de MINUTOS_LEASE) podía llegar tarde y
 * resetear con su observación vieja un contador que un worker MÁS NUEVO ya
 * incrementó — borrando confirmaciones válidas y manteniendo indefinidamente
 * activo un link genuinamente cancelado/expirado (hallazgo de code review).
 * Best-effort: si no matchea nada (lease perdido, o el link ya salió del
 * ciclo de polling) no pasa nada.
 */
async function resetearContadorTerminalNoEncontrado(
	link: LinkClaimado,
): Promise<void> {
	await db
		.update(pagaloPaymentLinks)
		.set({ terminalNotFoundAttempts: 0 })
		.where(
			and(
				eq(pagaloPaymentLinks.id, link.id),
				ne(pagaloPaymentLinks.terminalNotFoundAttempts, 0),
				inArray(pagaloPaymentLinks.status, ["CREATING", "ACTIVE", "REPLACED"]),
				link.pollClaimedAt
					? eq(pagaloPaymentLinks.pollClaimedAt, link.pollClaimedAt)
					: isNull(pagaloPaymentLinks.pollClaimedAt),
			),
		);
}

/**
 * Comprobante propio, mismo formato visual del voucher que emite Págalo
 * (comercio, ubicación, fecha, Ref/no. de transacción, tarjeta enmascarada,
 * monto, cliente, estado). Campo AUDIT del voucher real de Págalo se omite
 * a propósito: no aparece en ningún endpoint al que tenemos acceso con el
 * `authorization` fijo — no se inventa un valor sin fuente.
 */
async function generarVoucherPdf(
	transaccion: TransaccionPagalo,
	businessName: string,
): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	const page = doc.addPage([320, 420]);
	const font = await doc.embedFont(StandardFonts.CourierBold);
	const { height } = page.getSize();
	let y = height - 60;
	const centrado = (texto: string, tamano: number, salto = 20) => {
		const ancho = font.widthOfTextAtSize(texto, tamano);
		page.drawText(texto, {
			x: (320 - ancho) / 2,
			y,
			size: tamano,
			font,
			color: rgb(0, 0, 0),
		});
		y -= salto;
	};

	centrado(businessName, 16, 40);
	centrado("Guatemala", 11);
	y -= 20;
	centrado(`Guatemala, ${transaccion.date_transaction}`, 10);
	centrado(
		`Ref: ${transaccion.request_id}  Aut: ${transaccion.request_auth}`,
		10,
	);
	centrado(`No.Tarjeta **** **** **** ${transaccion.value_payment}`, 10, 30);
	centrado(
		`Compra: ${transaccion.currency} ${Number(transaccion.total).toFixed(2)}`,
		11,
		30,
	);
	if (transaccion.client_name) centrado(transaccion.client_name, 10);
	centrado("(01) PAGADO ELECTRÓNICAMENTE", 10, 30);
	centrado("Procesado por Págalo", 9);

	return doc.save();
}

async function subirVoucher(
	buffer: Uint8Array,
	groupId: string,
	link: LinkClaimado,
): Promise<{
	voucherStorageKey: string;
	voucherSha256: string;
	voucherUrl: string;
}> {
	const voucherSha256 = createHash("sha256")
		.update(Buffer.from(buffer))
		.digest("hex");
	// Mismo proceso que carteraFront/bot de cobros: solo se manda el archivo,
	// sin pedir una key propia — cartera-back siempre devuelve un nombre
	// aleatorio plano (uuid.pdf). La key queda atada a este grupo por el resto
	// del comando de importación (crm_group_id, transaction_uuid), no por su
	// propio nombre de archivo (ver pagaloPaymentImportPolicy.ts, voucherValid).
	const nombreSugerido = `voucher-pagalo-${groupId}-${link.linkType}.pdf`;
	const archivo = new Blob([new Uint8Array(buffer)], {
		type: "application/pdf",
	});
	const subida = await carteraBackClient.uploadFile(archivo, nombreSugerido);
	const voucherStorageKey = subida.filename;
	// cartera-back arma la URL pública final (URL_PUBLIC_R2 + key) del lado
	// suyo cuando persiste la boleta — el comprobante se revisa ahí, no desde
	// el CRM (fuera de alcance por ahora, hallazgo Codex: el historial Págalo
	// del CRM no debe pretender un link clicable sin ese dominio).
	return { voucherStorageKey, voucherSha256, voucherUrl: voucherStorageKey };
}

/**
 * Todos los `linkType` del grupo con monto > 0 (D-48: un lado puede ser Q0 y
 * no generar link) ya tienen isApplicationSource=true → READY_TO_APPLY. Si
 * falta alguno, PARTIALLY_PAID (solo si el grupo no está ya ahí). Devuelve
 * `true` si el grupo quedó `READY_TO_APPLY` en esta llamada — el caller usa
 * eso para disparar el dispatch inline apenas la transacción cierre.
 */
async function evaluarGrupo(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	groupId: string,
): Promise<boolean> {
	const [group] = await tx
		.select({
			capitalTotal: pagaloPaymentGroups.capitalTotal,
			facturableTotal: pagaloPaymentGroups.facturableTotal,
			status: pagaloPaymentGroups.status,
		})
		.from(pagaloPaymentGroups)
		.where(eq(pagaloPaymentGroups.id, groupId));
	if (!group) return false;

	const linkTypesDelGrupo = new Set<"CAPITAL" | "MORA_INTERES">();
	if (Number(group.capitalTotal) > 0) linkTypesDelGrupo.add("CAPITAL");
	if (Number(group.facturableTotal) > 0) linkTypesDelGrupo.add("MORA_INTERES");

	const pagados = await tx
		.select({ linkType: pagaloPaymentLinks.linkType })
		.from(pagaloPaymentLinks)
		.where(
			and(
				eq(pagaloPaymentLinks.groupId, groupId),
				eq(pagaloPaymentLinks.isApplicationSource, true),
			),
		);
	const linkTypesPagados = new Set(pagados.map((p) => p.linkType));
	const todosPagados = [...linkTypesDelGrupo].every((t) =>
		linkTypesPagados.has(t),
	);

	if (todosPagados) {
		// El grupo puede estar en REVIEW_REQUIRED (p.ej. un link REPLACED
		// pagado escaló el grupo activo, ver marcarLinkPagado) cuando llegan a
		// pagarse todos los links requeridos — el UPDATE condicional no toca
		// nada en ese caso, pero antes se emitía GROUP_READY y se retornaba
		// true igual, mintiendo en el historial y disparando un dispatch
		// inline sobre un grupo que en realidad sigue en revisión (hallazgo
		// Codex). Solo emitir el evento/reportar listo si el UPDATE realmente
		// afectó la fila.
		const [actualizado] = await tx
			.update(pagaloPaymentGroups)
			.set({
				status: "READY_TO_APPLY",
				readyToApplyAt: new Date(),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(pagaloPaymentGroups.id, groupId),
					inArray(pagaloPaymentGroups.status, [
						"PENDING_PAYMENT",
						"PARTIALLY_PAID",
					]),
				),
			)
			.returning({ id: pagaloPaymentGroups.id });
		if (!actualizado) return false;
		await tx.insert(pagaloPaymentEvents).values({
			groupId,
			eventType: "GROUP_READY",
			source: "PAGALO_POLLER",
			fromStatus: group.status,
			toStatus: "READY_TO_APPLY",
			payload: {},
		});
		return true;
	}
	if (group.status === "PENDING_PAYMENT") {
		await tx
			.update(pagaloPaymentGroups)
			.set({ status: "PARTIALLY_PAID", updatedAt: new Date() })
			.where(eq(pagaloPaymentGroups.id, groupId));
		await tx.insert(pagaloPaymentEvents).values({
			groupId,
			eventType: "GROUP_PARTIALLY_PAID",
			source: "PAGALO_POLLER",
			fromStatus: "PENDING_PAYMENT",
			toStatus: "PARTIALLY_PAID",
			payload: {},
		});
	}
	return false;
}

/**
 * Devuelve `true` cuando este link fue el que dejó al grupo `READY_TO_APPLY`
 * — el caller usa eso para disparar el dispatch inline apenas la transacción
 * cierre (no llamar cartera-back desde dentro de una tx de DB abierta).
 */
/**
 * Instante real del pago según Págalo, no el momento en que el poller lo
 * observó — si el polling corre con retraso (backoff, batch grande,
 * medianoche guatemalteca de por medio), `paidAt` quedaría con la fecha
 * contable equivocada aunque el proveedor sí trae el instante real
 * (hallazgo Codex). Fallback al momento de observación si Págalo manda un
 * formato no parseable — mejor una fecha aproximada que romper el flujo.
 */
function instanteTransaccion(transaccion: TransaccionPagalo): Date {
	const instante = new Date(transaccion.date_transaction);
	return Number.isNaN(instante.getTime()) ? new Date() : instante;
}

type ResultadoMarcarLinkPagado = {
	listoParaAplicar: boolean;
	// `false` cuando otro worker (lease vencido, poll solapado) ya ganó la
	// carrera antes de que este llegara a actualizar el link: cada worker
	// sube su propio voucher a una key R2 aleatoria distinta, y solo la del
	// ganador queda referenciada. El caller debe borrar la key perdedora de
	// cartera-back — nunca queda huérfana con datos de cliente/pago sin
	// limpieza (hallazgo Codex).
	voucherConsumido: boolean;
};

/**
 * Cuando `marcarLinkPagado` lanza, la promesa puede rechazar por un error de
 * conexión aunque Postgres SÍ haya hecho commit de la transacción antes de
 * que el ACK llegara a este proceso — el link ya referenciaría esta key
 * (hallazgo Codex). Releer el estado real fuera de cualquier tx evita borrar
 * evidencia que un dispatcher está a punto de usar: solo se confirma "no
 * consumido" si el link, en la DB real, efectivamente no apunta a esta key.
 */
async function voucherRealmenteNoConsumido(
	linkId: string,
	voucherStorageKey: string,
): Promise<boolean> {
	const [actual] = await db
		.select({ voucherStorageKey: pagaloPaymentLinks.voucherStorageKey })
		.from(pagaloPaymentLinks)
		.where(eq(pagaloPaymentLinks.id, linkId));
	return actual?.voucherStorageKey !== voucherStorageKey;
}

async function marcarLinkPagado(
	link: LinkClaimado,
	transaccion: TransaccionPagalo,
	voucher: {
		voucherStorageKey: string;
		voucherSha256: string;
		voucherUrl: string;
	},
): Promise<ResultadoMarcarLinkPagado> {
	return db.transaction(async (tx) => {
		// Se serializa contra el reemplazo del grupo (/crear con otra selección,
		// pago-link.ts): primero el candado del GRUPO, después el del link —
		// mismo orden que el reemplazo, para no cruzarse en deadlock— y se
		// decide con el estado FRESCO del link, no con el snapshot del reclamo.
		// Sin esto un pago que llega en medio del reemplazo se anotaba como
		// application_source de un grupo ya cancelado (hallazgo de Codex).
		await tx
			.select({ id: pagaloPaymentGroups.id })
			.from(pagaloPaymentGroups)
			.where(eq(pagaloPaymentGroups.id, link.groupId))
			.for("update");
		const [fresco] = await tx
			.select({ status: pagaloPaymentLinks.status })
			.from(pagaloPaymentLinks)
			.where(eq(pagaloPaymentLinks.id, link.id))
			.for("update");
		if (!fresco || fresco.status === "PAID") {
			return { listoParaAplicar: false, voucherConsumido: false };
		}
		const esReemplazado = fresco.status === "REPLACED";
		const [updated] = await tx
			.update(pagaloPaymentLinks)
			.set({
				status: "PAID",
				transactionStatus: transaccion.status_transaction,
				pagaloTransactionUuid: transaccion.uuid,
				transactionAmount: String(transaccion.total),
				transactionCurrency: transaccion.currency,
				requestId: transaccion.request_id,
				requestAuth: transaccion.request_auth,
				isApplicationSource: !esReemplazado,
				voucherSource: "GENERATED",
				voucherUrl: voucher.voucherUrl,
				voucherStorageKey: voucher.voucherStorageKey,
				voucherSha256: voucher.voucherSha256,
				voucherGeneratedAt: new Date(),
				paidAt: instanteTransaccion(transaccion),
				nextPollAt: null,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(pagaloPaymentLinks.id, link.id),
					ne(pagaloPaymentLinks.status, "PAID"),
				),
			)
			.returning({ id: pagaloPaymentLinks.id });
		if (!updated) return { listoParaAplicar: false, voucherConsumido: false };
		await tx.insert(pagaloPaymentEvents).values({
			groupId: link.groupId,
			linkId: link.id,
			eventType: "LINK_PAID",
			source: "PAGALO_POLLER",
			fromStatus: fresco.status,
			toStatus: "PAID",
			payload: {
				transactionUuid: transaccion.uuid,
				amount: transaccion.total,
				replaced: esReemplazado,
			},
		});
		if (esReemplazado) {
			// Un link REPLACED que se paga es dinero real fuera de la intención
			// viva. Si el crédito ya tiene OTRO grupo activo (el que reemplazó a
			// este), es ESE el que pasa a REVIEW_REQUIRED: reabrir el grupo
			// viejo (CANCELLED) chocaría con el índice único de un grupo activo
			// por crédito y el poller reintentaría para siempre sin registrar
			// el pago (hallazgo de Codex, PR #1445). Sin grupo activo, se
			// reabre el viejo como antes.
			const [viejo] = await tx
				.select({
					id: pagaloPaymentGroups.id,
					carteraCreditoId: pagaloPaymentGroups.carteraCreditoId,
					status: pagaloPaymentGroups.status,
				})
				.from(pagaloPaymentGroups)
				.where(eq(pagaloPaymentGroups.id, link.groupId));
			const [activo] = viejo
				? await tx
						.select({
							id: pagaloPaymentGroups.id,
							status: pagaloPaymentGroups.status,
						})
						.from(pagaloPaymentGroups)
						.where(
							and(
								eq(
									pagaloPaymentGroups.carteraCreditoId,
									viejo.carteraCreditoId,
								),
								ne(pagaloPaymentGroups.id, viejo.id),
								notInArray(pagaloPaymentGroups.status, [
									"COMPLETED",
									"CANCELLED",
								]),
							),
						)
						.limit(1)
						// Candado sobre el objetivo: si otro /crear lo está
						// reemplazando, el SELECT espera a que termine y re-evalúa
						// el WHERE — un grupo que quedó CANCELLED ya no se devuelve
						// (hallazgo de Codex). El UPDATE es además condicional.
						.for("update")
				: [];
			const objetivo = activo ?? viejo;
			if (!objetivo) return { listoParaAplicar: false, voucherConsumido: true };
			const [escalado] = await tx
				.update(pagaloPaymentGroups)
				.set({ status: "REVIEW_REQUIRED", updatedAt: new Date() })
				.where(
					and(
						eq(pagaloPaymentGroups.id, objetivo.id),
						objetivo === activo
							? notInArray(pagaloPaymentGroups.status, [
									"COMPLETED",
									"CANCELLED",
								])
							: eq(pagaloPaymentGroups.status, objetivo.status),
					),
				)
				.returning({ id: pagaloPaymentGroups.id });
			if (!escalado) return { listoParaAplicar: false, voucherConsumido: true };
			await tx.insert(pagaloPaymentEvents).values({
				groupId: objetivo.id,
				eventType: "REPLACED_LINK_PAID",
				source: "PAGALO_POLLER",
				fromStatus: objetivo.status,
				toStatus: "REVIEW_REQUIRED",
				payload: {
					linkId: link.id,
					grupoDelLink: link.groupId,
					transactionUuid: transaccion.uuid,
					amount: transaccion.total,
				},
			});
			return { listoParaAplicar: false, voucherConsumido: true };
		}
		const listoParaAplicar = await evaluarGrupo(tx, link.groupId);
		return { listoParaAplicar, voucherConsumido: true };
	});
}

/**
 * Cuerpo transaccional de "finalizar link terminal", extraído para poder
 * correr DENTRO de una transacción ya abierta por el caller (ver
 * `registrarIntentoNoEncontradoTerminal`, que decide el cruce de umbral y
 * finaliza en la misma tx que incrementa el contador, atómico bajo el mismo
 * lease — hallazgo de code review).
 */
async function marcarLinkTerminalEnTx(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	link: LinkClaimado,
	status: "CANCELLED" | "EXPIRED",
): Promise<void> {
	const [grupo] = await tx
		.select({
			id: pagaloPaymentGroups.id,
			status: pagaloPaymentGroups.status,
		})
		.from(pagaloPaymentGroups)
		.where(eq(pagaloPaymentGroups.id, link.groupId))
		.for("update");
	const [fresco] = await tx
		.select({
			status: pagaloPaymentLinks.status,
			pollClaimedAt: pagaloPaymentLinks.pollClaimedAt,
		})
		.from(pagaloPaymentLinks)
		.where(eq(pagaloPaymentLinks.id, link.id))
		.for("update");
	if (!fresco || fresco.status === "PAID") return;
	// Gateado por el mismo pollClaimedAt del lease bajo el que se decidió
	// finalizar: si la consulta HTTP que llevó a esta decisión tardó más que
	// el lease y otro worker ya reclamó el link (pudo haber observado una
	// transacción real PENDING que este worker viejo nunca vio), esta
	// corrida no debe pisar esa observación más fresca con un CANCELLED/
	// EXPIRED basado en datos obsoletos — perdería ese pago para siempre
	// (hallazgo de code review).
	const leaseVigente = link.pollClaimedAt
		? fresco.pollClaimedAt?.getTime() === link.pollClaimedAt.getTime()
		: fresco.pollClaimedAt === null;
	if (!leaseVigente) return;
	await tx
		.update(pagaloPaymentLinks)
		.set({
			status,
			nextPollAt: null,
			lastPolledAt: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(pagaloPaymentLinks.id, link.id));
	const desde = link.activatedAt ?? link.createdAt;
	await tx.insert(pagaloPaymentEvents).values({
		groupId: link.groupId,
		linkId: link.id,
		eventType: "LINK_TERMINAL",
		source: "PAGALO_POLLER",
		fromStatus: fresco.status,
		toStatus: status,
		payload: {
			motivo:
				status === "EXPIRED" ? "expirado_en_pagalo" : "cancelado_en_pagalo",
			providerStatus: status === "EXPIRED" ? "4" : "3",
			pollAttempts: link.pollAttempts,
			antiguedadHoras: desde
				? Math.round((Date.now() - desde.getTime()) / 3_600_000)
				: null,
		},
	});
	// Un link REPLACED que Págalo da por cancelado/expirado es el final
	// ESPERADO del reemplazo: no reabre su grupo (CANCELLED) — chocaría con
	// el índice único de un grupo activo por crédito y tumbaba la corrida
	// entera del poller (hallazgo de Codex). Solo un link vivo que muere
	// afuera deja su grupo en revisión.
	if (
		fresco.status === "REPLACED" ||
		!grupo ||
		grupo.status === "CANCELLED" ||
		grupo.status === "COMPLETED"
	) {
		return;
	}
	await tx
		.update(pagaloPaymentGroups)
		.set({ status: "REVIEW_REQUIRED", updatedAt: new Date() })
		.where(eq(pagaloPaymentGroups.id, link.groupId));
}

async function marcarLinkTerminal(
	link: LinkClaimado,
	status: "CANCELLED" | "EXPIRED",
): Promise<void> {
	await db.transaction((tx) => marcarLinkTerminalEnTx(tx, link, status));
}

export type ResultadoPollPagalo = {
	revisados: number;
	pagados: number;
	sinCambios: number;
	errores: number;
	dispatchReintentados: number;
	dispatchCompletados: number;
	dispatchErrores: number;
};

/**
 * Antes de barrer links nuevos, reintenta grupos que quedaron
 * READY_TO_APPLY/APPLICATION_FAILED de una corrida anterior (p.ej. si
 * cartera-back estuvo caído). Así un solo botón/ciclo cubre tanto "detectar
 * pago nuevo" como "reintentar aplicación pendiente" sin depender del
 * dispatcher programado por separado.
 */
export async function correrPollPagalo(
	/**
	 * Sin alcance = el ciclo automático de siempre (todos los links a los que
	 * ya les toca + el backlog de dispatch). Con `groupId` = la verificación a
	 * demanda de UN grupo: solo sus links, sin esperar la cadencia, y sin
	 * tocar el backlog de otros grupos.
	 */
	alcance: { groupId?: string } = {},
): Promise<ResultadoPollPagalo> {
	const resultado: ResultadoPollPagalo = {
		revisados: 0,
		pagados: 0,
		sinCambios: 0,
		errores: 0,
		dispatchReintentados: 0,
		dispatchCompletados: 0,
		dispatchErrores: 0,
	};

	// Detectar pagos nuevos va PRIMERO: correrDispatchPagalo puede recorrer
	// hasta 50 grupos, cada uno con hasta 10s de timeout HTTP (más el tiempo
	// sin límite de getCarteraAccessToken) — si eso corriera antes, un
	// backlog de dispatch con cartera-back lenta/caída podía retrasar
	// minutos la detección de un pago que el cliente ya hizo (hallazgo
	// Codex). El reintento del backlog corre al final, sin bloquear esto.
	const links = await reclamarLinksPendientes(alcance.groupId);
	resultado.revisados = links.length;
	if (links.length > 0) {
		const config = getPagaloSandboxConfig();
		const client = createPagaloClient(config);
		// Construido una sola vez por corrida — reusado por cada dispatch inline
		// del loop, en vez de reconstruirlo (llama a cartera-back) por grupo.
		// Best-effort: un fallo acá (cartera-back caído) no puede bloquear la
		// detección de pagos, que ya viene después con los links reclamados.
		const asesorMap = await construirMapaAsesorUsuario().catch(
			() => new Map<number, string>(),
		);

		for (const link of links) {
			if (!link.pagaloRequestUuid) {
				await registrarIntentoFallido(link, "Link sin pagaloRequestUuid.");
				resultado.errores++;
				continue;
			}
			let estado: any;
			try {
				estado = await client.getRequestByUuid(link.pagaloRequestUuid);
			} catch (error) {
				await registrarIntentoFallido(
					link,
					error instanceof Error ? error.message : String(error),
				);
				resultado.errores++;
				continue;
			}
			const status = estado?.message?.status ?? estado?.data?.status;

			// La fuente de verdad de "pagado" es la transacción
			// (status_transaction === "ACCEPT" via validarTransaccionPagalo), no
			// el status del request/link. Confirmado en sandbox: un link puede
			// tener una transacción ACCEPT real (no. de transacción y auth
			// asignados) mientras su `status` de request se queda en "1"
			// (creado) sin transicionar nunca a "2" (pagado) — depender solo del
			// status del link dejaba el pago invisible para siempre. La misma
			// inconsistencia aplica a "3"/"4" (cancelado/expirado): se consulta
			// la transacción ANTES de finalizar el link como terminal — si
			// Págalo reporta cancelado/expirado pero la transacción ya cerró
			// ACCEPT, marcarLinkTerminal limpiaría nextPollAt y ese pago real
			// quedaría perdido para siempre sin reintento (hallazgo de code
			// review).
			let detalle: any;
			try {
				detalle = await client.getTransactionByIdExternalRaw(
					link.externalIdentifier,
				);
			} catch (error) {
				// Un link que nadie pagó todavía es el caso común de cada ciclo:
				// Págalo puede devolver 400 (no encontró transacción para ese
				// id_external) en vez de 200 con `transaction: null` — confirmado
				// que ambas formas ocurren en sandbox según el link. No es un
				// error real salvo que el `status` del propio link ya diga "2"
				// (Págalo afirma pagado y aun así no aparece la transacción —
				// ahí sí hay una anomalía que merece quedar visible en
				// lastPollError, hallazgo de code review).
				//
				// Un 400 aislado NO marca terminal (status 3/4) directamente:
				// solo confirma "no encontré transacción en este intento", no
				// "no existe ninguna ACCEPT" — misma ambigüedad documentada
				// arriba para el caso "2". Marcar terminal en el primer 400
				// reintroduce el mismo bug que este PR arregla, por el camino
				// del error (hallazgo de code review). Pero tampoco reintentar
				// para siempre: si Págalo confirma "no encontrado" de forma
				// consistente durante UMBRAL_POLL_RETRY_EXHAUSTED intentos, ya
				// no es una inconsistencia pasajera — un link genuinamente
				// cancelado/expirado sin transacción real quedaría ACTIVE para
				// siempre, su grupo nunca escala a REVIEW_REQUIRED, y el poll
				// lo sigue consultando cada 30 min sin fin (hallazgo de code
				// review).
				//
				// El conteo usa `terminalNotFoundAttempts`, NO `pollAttempts`:
				// este último se incrementa por cualquier causa de fallo
				// (incluidos ciclos previos con status "1" sin pagar) — un link
				// que arrastraba 5 fallos no relacionados y recién ahora pasa a
				// status 3/4 se finalizaba en el primer 400 de ese nuevo
				// estado, mismo bug que esto arregla (hallazgo de code
				// review). El contador dedicado solo avanza cuando este patrón
				// exacto se repite consecutivamente.
				if (
					error instanceof PagaloClientError &&
					error.status === 400 &&
					status !== "2"
				) {
					if (status === "3" || status === "4") {
						// Decide y aplica el cruce de umbral atómicamente,
						// dentro de la misma transacción y bajo el mismo lease
						// — nunca con un conteo obsoleto capturado en memoria
						// (hallazgo de code review).
						await registrarIntentoNoEncontradoTerminal(
							link,
							status === "3" ? "CANCELLED" : "EXPIRED",
						);
					} else {
						await registrarIntentoFallido(link);
						await resetearContadorTerminalNoEncontrado(link);
					}
					resultado.sinCambios++;
					continue;
				}
				await registrarIntentoFallido(
					link,
					error instanceof Error ? error.message : String(error),
				);
				await resetearContadorTerminalNoEncontrado(link);
				resultado.errores++;
				continue;
			}
			// La consulta de transacción respondió 200 (con o sin transacción):
			// el patrón "3/4 + 400" se rompió este ciclo, se resetea el
			// contador dedicado para no arrastrar confirmaciones no
			// consecutivas a la próxima vez que sí ocurra un 400.
			await resetearContadorTerminalNoEncontrado(link);
			try {
				// Doc publicada de Págalo (`POST /v1/payment/transaction/uuid`)
				// documenta el detalle bajo `data`; sandbox responde con
				// `transaction` para esta misma consulta por `id_external`. Se
				// leen ambas formas — si el proveedor cambia de nombre, la
				// transacción real no debe volverse invisible para siempre
				// (mismo bug que este PR arregla, espejado, hallazgo de code
				// review).
				const transaccion: TransaccionPagalo | undefined =
					detalle?.transaction ?? detalle?.data;
				if (!transaccion || transaccion.status_transaction !== "ACCEPT") {
					// Doc de Págalo (status_transaction): solo dos valores
					// existen, "ACCEPT" o "REJECT" — no hay un tercer estado
					// "en proceso"/"pendiente" documentado para este campo. Con
					// el link ya en "3"/"4" (cancelado/expirado) Y una
					// transacción REJECT observada, ambas señales confirman
					// terminal — no hay pago que esperar, y reintentar para
					// siempre dejaba el grupo sin escalar a REVIEW_REQUIRED
					// (hallazgo de code review). Sin transacción en absoluto
					// (400/`null`) igual se finaliza si el link ya es 3/4: no
					// hay pago real que proteger.
					if (
						(status === "3" || status === "4") &&
						(!transaccion || transaccion.status_transaction === "REJECT")
					) {
						await marcarLinkTerminal(
							link,
							status === "3" ? "CANCELLED" : "EXPIRED",
						);
						resultado.sinCambios++;
						continue;
					}
					// status "2": Págalo afirma que el link está pagado, pero
					// acá no hay transacción ACCEPT que lo respalde — anomalía
					// real (no un simple "aún no pagado"), se cuenta como
					// error para que el toast del botón manual y cualquier
					// alerta del supervisor la reflejen (antes de este fix
					// quedaba contada como sinCambios, ocultando la anomalía —
					// hallazgo de code review).
					if (status === "2") {
						await registrarIntentoFallido(
							link,
							transaccion
								? `Transacción Págalo en estado ${transaccion.status_transaction}, no ACCEPT.`
								: "Págalo confirma link pagado pero no encontró la transacción por id_external.",
						);
						resultado.errores++;
						continue;
					}
					if (!transaccion) {
						await registrarIntentoFallido(link);
					} else {
						// Transacción existe pero no cerró ACCEPT (p.ej.
						// todavía procesándose) y el link no está 3/4 ni "2" —
						// no es un error del job, es el estado normal de "aún
						// no pagado".
						await registrarIntentoFallido(
							link,
							`Transacción Págalo en estado ${transaccion.status_transaction}, no ACCEPT.`,
						);
					}
					resultado.sinCambios++;
					continue;
				}
				validarTransaccionPagalo(link, transaccion);
				const pdf = await generarVoucherPdf(transaccion, "Club Cashin");
				const subida = await subirVoucher(pdf, link.groupId, link);
				// Otro worker (lease vencido, poll solapado) puede ganar la
				// carrera antes de que este llegue a actualizar el link — cada
				// worker sube su voucher a una key R2 aleatoria distinta, y la
				// de este nunca queda referenciada. Se borra en vez de dejarla
				// huérfana con datos de cliente/pago, tanto si marcarLinkPagado
				// resuelve voucherConsumido=false como si lanza (la tx de DB
				// puede reventar a mitad — hallazgo Codex tras el fix anterior,
				// que solo cubría el camino resuelto). Best-effort: un fallo al
				// borrar no debe tumbar el poll.
				let resultadoMarcado: ResultadoMarcarLinkPagado;
				try {
					resultadoMarcado = await marcarLinkPagado(link, transaccion, subida);
				} catch (error) {
					// La promesa puede rechazar por un error de conexión aunque
					// Postgres SÍ haya comiteado antes de que el ACK llegara acá —
					// el link real podría ya referenciar esta key. Borrar sin
					// verificar arriesgaba dejar un pago READY_TO_APPLY apuntando a
					// un archivo que ya no existe (hallazgo Codex tras el fix
					// anterior, que asumía "lanzó = no se guardó nada").
					if (
						await voucherRealmenteNoConsumido(link.id, subida.voucherStorageKey)
					) {
						await carteraBackClient
							.deleteArchivoBoletaHuerfano(subida.voucherStorageKey)
							.catch((deleteError) =>
								console.error(
									`[Págalo][POLL] no se pudo borrar voucher huérfano ${subida.voucherStorageKey}:`,
									deleteError,
								),
							);
					}
					throw error;
				}
				const { listoParaAplicar, voucherConsumido } = resultadoMarcado;
				if (!voucherConsumido) {
					await carteraBackClient
						.deleteArchivoBoletaHuerfano(subida.voucherStorageKey)
						.catch((error) =>
							console.error(
								`[Págalo][POLL] no se pudo borrar voucher huérfano ${subida.voucherStorageKey}:`,
								error,
							),
						);
					resultado.sinCambios++;
					continue;
				}
				resultado.pagados++;
				// Fuera de la transacción de arriba a propósito: nunca llamar
				// cartera-back (red) mientras una tx de DB sigue abierta. Si esto
				// falla, el grupo queda READY_TO_APPLY/APPLICATION_FAILED y el
				// dispatcher programado lo recoge en su propio ciclo — nunca se pierde.
				if (listoParaAplicar) {
					try {
						const resultadoInline = await reclamarYProcesarGrupo(
							link.groupId,
							asesorMap,
						);
						// El resultado del retry del backlog (más abajo) también
						// suma acá — esto solo cubre lo que antes se descartaba
						// del dispatch inline, que dejaba el reporte del botón
						// manual mintiendo "0 completados" aunque sí aplicara el
						// pago (hallazgo Codex).
						if (resultadoInline === "COMPLETADO")
							resultado.dispatchCompletados++;
						else if (
							resultadoInline === "ERROR" ||
							resultadoInline === "REVIEW_REQUIRED"
						) {
							resultado.dispatchErrores++;
						}
					} catch (error) {
						resultado.dispatchErrores++;
						console.error(
							`[Págalo][POLL] grupo ${link.groupId} quedó READY_TO_APPLY pero falló el dispatch inline:`,
							error instanceof Error ? error.message : error,
						);
					}
				}
			} catch (error) {
				await registrarIntentoFallido(
					link,
					error instanceof Error ? error.message : String(error),
				);
				resultado.errores++;
				console.error(
					`[Págalo][POLL] link ${link.id} pagado pero falló generar/subir voucher:`,
					error instanceof Error ? error.message : error,
				);
			}
		}
	}

	// Verificación puntual: no se le arrastra a la persona el backlog de
	// otros grupos (puede tardar minutos con cartera-back lento). El grupo
	// propio ya se aplicó inline arriba si quedó listo; si venía de antes
	// esperando aplicación, lo empuja `verificarGrupoPagalo`.
	if (alcance.groupId) return resultado;

	// Backlog de grupos READY_TO_APPLY/APPLICATION_FAILED/APPLYING de una
	// corrida anterior (p.ej. si cartera-back estuvo caído). Va AL FINAL,
	// después de detectar pagos nuevos, para que un backlog grande con
	// cartera-back lento no retrase la detección de un pago que el cliente
	// ya hizo (hallazgo Codex).
	const dispatchPrevio = await correrDispatchPagalo();
	resultado.dispatchReintentados += dispatchPrevio.revisados;
	resultado.dispatchCompletados += dispatchPrevio.completados;
	resultado.dispatchErrores +=
		dispatchPrevio.errores + dispatchPrevio.revisionRequerida;

	return resultado;
}

export type ResultadoVerificacionGrupo = ResultadoPollPagalo & {
	/** Estado del grupo DESPUÉS de verificar y, si correspondía, aplicar. */
	statusFinal: string;
	/** `true` si en esta corrida se aplicó el pago en cartera. */
	aplicado: boolean;
};

/**
 * "Verificar ahora" de la Ficha 360: le pregunta a Págalo por los links de UN
 * grupo sin esperar la cadencia y, si con eso queda listo, lo aplica.
 *
 * Verificar y aplicar son un solo botón a propósito: aplicar exige tener la
 * evidencia verificada (D-05), así que ofrecerlos por separado obligaba a
 * apretar dos veces sabiendo de antemano el orden. Si los links ya estaban
 * pagados y el grupo venía esperando aplicación de antes, no hay nada que
 * verificar y se va derecho al despacho.
 *
 * No fuerza estados que necesitan una persona: desde REVIEW_REQUIRED (cartera
 * ya lo evaluó y lo mandó a revisión) verifica pero no aplica — eso sigue
 * siendo la acción de admin.
 */
export async function verificarGrupoPagalo(
	groupId: string,
): Promise<ResultadoVerificacionGrupo> {
	const resultado = await correrPollPagalo({ groupId });

	const [grupo] = await db
		.select({ status: pagaloPaymentGroups.status })
		.from(pagaloPaymentGroups)
		.where(eq(pagaloPaymentGroups.id, groupId))
		.limit(1);
	let statusFinal = grupo?.status ?? "DESCONOCIDO";
	let aplicado = statusFinal === "COMPLETED";

	// Quedó con la evidencia completa pero sin aplicar: o el despacho inline
	// falló, o venía esperando de una corrida anterior con su backoff todavía
	// corriendo. Se limpia ese backoff porque acá lo pidió una persona.
	if (
		statusFinal === "READY_TO_APPLY" ||
		statusFinal === "APPLICATION_FAILED"
	) {
		await db
			.update(pagaloPaymentGroups)
			.set({ nextDispatchAt: null, dispatchClaimedAt: null })
			.where(
				and(
					eq(pagaloPaymentGroups.id, groupId),
					eq(pagaloPaymentGroups.status, statusFinal),
				),
			);
		const despacho = await reclamarYProcesarGrupo(groupId);
		resultado.dispatchReintentados++;
		if (despacho === "COMPLETADO") resultado.dispatchCompletados++;
		else if (despacho !== "NO_RECLAMADO") resultado.dispatchErrores++;

		const [fresco] = await db
			.select({ status: pagaloPaymentGroups.status })
			.from(pagaloPaymentGroups)
			.where(eq(pagaloPaymentGroups.id, groupId))
			.limit(1);
		statusFinal = fresco?.status ?? statusFinal;
		aplicado = statusFinal === "COMPLETED";
	}

	return { ...resultado, statusFinal, aplicado };
}
