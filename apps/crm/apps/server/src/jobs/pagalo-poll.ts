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
 */
import { createHash } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
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
} from "drizzle-orm";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { db } from "../db";
import {
	pagaloPaymentEvents,
	pagaloPaymentGroups,
	pagaloPaymentLinks,
} from "../db/schema/pagalo-payments";
import { getFileUrl, R2_BUCKET_NAME, r2Client } from "../lib/storage";
import {
	createPagaloClient,
	getPagaloSandboxConfig,
} from "../services/pagalo-client";

/** Tope por corrida. Si hay más, se atienden en la siguiente. */
const MAXIMO_POR_CORRIDA = 50;
/** Lease: si un proceso murió a mitad de un batch, otro puede reclamarlo. */
const MINUTOS_LEASE = 2;
/** Backoff exponencial con techo. */
const BACKOFF_BASE_SEGUNDOS = 30;
const BACKOFF_TOPE_SEGUNDOS = 30 * 60;

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

const proximoIntento = (pollAttempts: number): Date => {
	const segundos = Math.min(
		BACKOFF_BASE_SEGUNDOS * 2 ** pollAttempts,
		BACKOFF_TOPE_SEGUNDOS,
	);
	return new Date(Date.now() + segundos * 1000);
};

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
async function reclamarLinksPendientes(): Promise<LinkClaimado[]> {
	const ahora = new Date();
	const leaseVencido = new Date(Date.now() - MINUTOS_LEASE * 60 * 1000);
	const candidatos = await db
		.select({ id: pagaloPaymentLinks.id })
		.from(pagaloPaymentLinks)
		.where(
			and(
				lt(pagaloPaymentLinks.nextPollAt, ahora),
				inArray(pagaloPaymentLinks.status, ["CREATING", "ACTIVE", "REPLACED"]),
				or(
					isNull(pagaloPaymentLinks.pollClaimedAt),
					lt(pagaloPaymentLinks.pollClaimedAt, leaseVencido),
				),
			),
		)
		.orderBy(asc(pagaloPaymentLinks.nextPollAt))
		.limit(MAXIMO_POR_CORRIDA);
	if (candidatos.length === 0) return [];

	const reclamados: LinkClaimado[] = [];
	for (const candidato of candidatos) {
		const [link] = await db
			.update(pagaloPaymentLinks)
			.set({ pollClaimedAt: ahora })
			.where(
				and(
					eq(pagaloPaymentLinks.id, candidato.id),
					lt(pagaloPaymentLinks.nextPollAt, ahora),
					inArray(pagaloPaymentLinks.status, [
						"CREATING",
						"ACTIVE",
						"REPLACED",
					]),
					or(
						isNull(pagaloPaymentLinks.pollClaimedAt),
						lt(pagaloPaymentLinks.pollClaimedAt, leaseVencido),
					),
				),
			)
			.returning();
		if (link) reclamados.push(link);
	}
	return reclamados;
}

async function registrarIntentoFallido(
	link: LinkClaimado,
	errorMessage?: string,
): Promise<void> {
	const pollAttempts = link.pollAttempts + 1;
	await db
		.update(pagaloPaymentLinks)
		.set({
			pollAttempts,
			lastPolledAt: new Date(),
			lastPollError: errorMessage ?? null,
			nextPollAt: proximoIntento(pollAttempts),
			updatedAt: new Date(),
		})
		.where(eq(pagaloPaymentLinks.id, link.id));
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
	const voucherStorageKey = `pagalo/${groupId}/${link.linkType}-${link.generation}.pdf`;
	await r2Client.send(
		new PutObjectCommand({
			Bucket: R2_BUCKET_NAME,
			Key: voucherStorageKey,
			Body: Buffer.from(buffer),
			ContentType: "application/pdf",
		}),
	);
	// `voucherStorageKey` es la fuente de verdad para volver a generar una URL
	// firmada cuando haga falta mostrarla (getFileUrl); esta URL guardada en DB
	// expira igual que el resto de firmas del repo (SIGNED_URL_EXPIRY).
	const voucherUrl = await getFileUrl(voucherStorageKey);
	return { voucherStorageKey, voucherSha256, voucherUrl };
}

/**
 * Todos los `linkType` del grupo con monto > 0 (D-48: un lado puede ser Q0 y
 * no generar link) ya tienen isApplicationSource=true → READY_TO_APPLY. Si
 * falta alguno, PARTIALLY_PAID (solo si el grupo no está ya ahí).
 */
async function evaluarGrupo(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	groupId: string,
): Promise<void> {
	const [group] = await tx
		.select({
			capitalTotal: pagaloPaymentGroups.capitalTotal,
			facturableTotal: pagaloPaymentGroups.facturableTotal,
			status: pagaloPaymentGroups.status,
		})
		.from(pagaloPaymentGroups)
		.where(eq(pagaloPaymentGroups.id, groupId));
	if (!group) return;

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
		await tx
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
			);
		await tx.insert(pagaloPaymentEvents).values({
			groupId,
			eventType: "GROUP_READY",
			source: "PAGALO_POLLER",
			fromStatus: group.status,
			toStatus: "READY_TO_APPLY",
			payload: {},
		});
	} else if (group.status === "PENDING_PAYMENT") {
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
}

async function marcarLinkPagado(
	link: LinkClaimado,
	transaccion: TransaccionPagalo,
	voucher: {
		voucherStorageKey: string;
		voucherSha256: string;
		voucherUrl: string;
	},
): Promise<void> {
	await db.transaction(async (tx) => {
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
		if (!fresco || fresco.status === "PAID") return;
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
				paidAt: new Date(),
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
		if (!updated) return;
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
			if (!objetivo) return;
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
			if (!escalado) return;
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
			return;
		}
		await evaluarGrupo(tx, link.groupId);
	});
}

async function marcarLinkTerminal(
	link: LinkClaimado,
	status: "CANCELLED" | "EXPIRED",
): Promise<void> {
	await db.transaction(async (tx) => {
		const [grupo] = await tx
			.select({
				id: pagaloPaymentGroups.id,
				status: pagaloPaymentGroups.status,
			})
			.from(pagaloPaymentGroups)
			.where(eq(pagaloPaymentGroups.id, link.groupId))
			.for("update");
		const [fresco] = await tx
			.select({ status: pagaloPaymentLinks.status })
			.from(pagaloPaymentLinks)
			.where(eq(pagaloPaymentLinks.id, link.id))
			.for("update");
		if (!fresco || fresco.status === "PAID") return;
		await tx
			.update(pagaloPaymentLinks)
			.set({
				status,
				nextPollAt: null,
				lastPolledAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(pagaloPaymentLinks.id, link.id));
		await tx.insert(pagaloPaymentEvents).values({
			groupId: link.groupId,
			linkId: link.id,
			eventType: "LINK_TERMINAL",
			source: "PAGALO_POLLER",
			fromStatus: fresco.status,
			toStatus: status,
			payload: {},
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
	});
}

export type ResultadoPollPagalo = {
	revisados: number;
	pagados: number;
	sinCambios: number;
	errores: number;
};

export async function correrPollPagalo(): Promise<ResultadoPollPagalo> {
	const links = await reclamarLinksPendientes();
	const resultado: ResultadoPollPagalo = {
		revisados: links.length,
		pagados: 0,
		sinCambios: 0,
		errores: 0,
	};
	if (links.length === 0) return resultado;

	const config = getPagaloSandboxConfig();
	const client = createPagaloClient(config);

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
		if (status === "3" || status === "4") {
			await marcarLinkTerminal(link, status === "3" ? "CANCELLED" : "EXPIRED");
			resultado.sinCambios++;
			continue;
		}
		if (status !== "2") {
			await registrarIntentoFallido(link);
			resultado.sinCambios++;
			continue;
		}

		// Pagado. Traer el detalle real de la transacción (no. de transacción,
		// tarjeta, fecha) por id_external — mismo authorization fijo, sin login.
		try {
			const detalle: any = await client.getTransactionByIdExternalRaw(
				link.externalIdentifier,
			);
			const transaccion: TransaccionPagalo | undefined = detalle?.transaction;
			if (!transaccion) {
				await registrarIntentoFallido(
					link,
					"Págalo confirma link pagado pero no encontró la transacción por id_external.",
				);
				resultado.errores++;
				continue;
			}
			validarTransaccionPagalo(link, transaccion);
			const pdf = await generarVoucherPdf(transaccion, "Club Cashin");
			const subida = await subirVoucher(pdf, link.groupId, link);
			await marcarLinkPagado(link, transaccion, subida);
			resultado.pagados++;
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

	return resultado;
}
