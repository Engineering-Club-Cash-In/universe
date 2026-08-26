import { randomUUID } from "node:crypto";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "../db";
import { casosCobros, contratosFinanciamiento } from "../db/schema/cobros";
import { leads, opportunities } from "../db/schema/crm";
import {
	pagaloPaymentEvents,
	pagaloPaymentGroups,
	pagaloPaymentLinks,
} from "../db/schema/pagalo-payments";
import { vehicles } from "../db/schema/vehicles";
import { isTestModeEnabled } from "../lib/messaging-test-mode";
import {
	buildPagaloAllocations,
	type PagaloInstallment,
} from "../lib/pagalo-allocations";
import { assertPagaloInstallmentSelection } from "../lib/pagalo-selection";
import { primerTelefono } from "../lib/phone-utils";
import { carteraBackClient } from "./cartera-back-client";
import {
	createPagaloClient,
	getPagaloSandboxConfig,
	toPagaloProviderAmount,
} from "./pagalo-client";
import { sendPagaloLinksWhatsapp } from "./send-pagalo-links-whatsapp";

type CreatePagaloLinksInput = {
	casoCobroId: string;
	numeroSifco: string;
	creditoId: number;
	cuotaIds: number[];
	requestedBy: string;
};

// TEST_MESSAGE=true redirige también el contacto real del cliente que se
// manda a Págalo — mismo patrón que WhatsApp (messaging-test-mode.ts): sirve
// para probar el checkout real en sandbox sin exponer datos de un cliente
// real al proveedor.
const PAGALO_TEST_EMAIL = "j.alvarez@clubcashin.com";
const PAGALO_TEST_PHONE = "35219722";

const pickString = (value: unknown, names: string[]): string | undefined => {
	if (!value || typeof value !== "object") return undefined;
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		if (names.includes(key.toLowerCase()) && typeof child === "string" && child)
			return child;
		const nested = pickString(child, names);
		if (nested) return nested;
	}
	return undefined;
};

const deduplicarCuotas = <T extends { numero_cuota: number; pago_id?: number }>(
	cuotas: T[],
): T[] => {
	const porNumero = new Map<number, T>();
	for (const cuota of cuotas) {
		const actual = porNumero.get(cuota.numero_cuota);
		if (!actual || (cuota.pago_id ?? 0) > (actual.pago_id ?? 0)) {
			porNumero.set(cuota.numero_cuota, cuota);
		}
	}
	return [...porNumero.values()].sort(
		(a, b) => a.numero_cuota - b.numero_cuota,
	);
};

/** CRM orchestration. Solo sandbox; una llamada externa por componente > Q0. */
export async function createPagaloLinks(input: CreatePagaloLinksInput) {
	const credit = await carteraBackClient.getCredito(input.numeroSifco, false);
	if (credit.credito.credito_id !== input.creditoId) {
		throw new Error("Crédito Págalo no coincide con SIFCO.");
	}
	const vencidas = deduplicarCuotas(
		credit.cuotasAtrasadas.filter((cuota) => cuota.numero_cuota > 0),
	);
	// cuotasPendientes es "todas las no pagadas" (sin filtro de fecha), no
	// "solo próximas" — ya incluye las vencidas. Sin excluirlas acá, [0] cae
	// siempre en la misma cuota que ya está en `vencidas` y la cuota vigente
	// real nunca se ofrece (hallazgo del usuario, crédito 9216).
	const proximaPendiente = deduplicarCuotas(
		credit.cuotasPendientes.filter(
			(cuota) =>
				cuota.numero_cuota > 0 &&
				!vencidas.some((v) => v.numero_cuota === cuota.numero_cuota),
		),
	)[0];
	const cuotasDisponibles = deduplicarCuotas(
		proximaPendiente ? [...vencidas, proximaPendiente] : vencidas,
	);
	const selectable = cuotasDisponibles.filter((cuota) =>
		input.cuotaIds.includes(cuota.cuota_id),
	);
	if (selectable.length !== input.cuotaIds.length) {
		throw new Error(
			"Una cuota Págalo ya no está vencida o no pertenece al crédito.",
		);
	}
	assertPagaloInstallmentSelection(
		selectable.map((cuota) => cuota.numero_cuota),
		cuotasDisponibles.map((cuota) => cuota.numero_cuota),
	);
	const installments: PagaloInstallment[] = selectable
		.sort((a, b) => a.numero_cuota - b.numero_cuota)
		.map((cuota) => ({
			cuotaId: cuota.cuota_id,
			numeroCuota: cuota.numero_cuota,
			capital: cuota.capital_restante,
			interes: cuota.interes_restante,
			iva: cuota.iva_12_restante,
			seguro: cuota.seguro_restante,
			gps: cuota.gps_restante,
			membresias: cuota.membresias_restante,
		}));
	// Mora se cobra siempre que exista. Para grupo solo-mora necesita una cuota
	// de referencia, pero sus rubros quedan vacíos: no se inventa capital/link.
	const installmentsForCalculation =
		installments.length > 0
			? installments
			: vencidas[0]
				? [
						{
							cuotaId: vencidas[0].cuota_id,
							numeroCuota: vencidas[0].numero_cuota,
						},
					]
				: [];
	const calculation = buildPagaloAllocations({
		installments: installmentsForCalculation,
		mora: credit.moraActual,
	});

	// Datos de contacto: casos_cobros es la fuente principal; leads (vía
	// opportunities.numeroSifco) rellena lo que falte. cartera-back no expone
	// teléfono/email/dirección en /credito.
	const [caso] = await db
		.select({
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			telefonoPrincipal: casosCobros.telefonoPrincipal,
			emailContacto: casosCobros.emailContacto,
			direccionContacto: casosCobros.direccionContacto,
			vehiculoMarca: vehicles.make,
			vehiculoModelo: vehicles.model,
			vehiculoYear: vehicles.year,
			vehiculoPlaca: vehicles.licensePlate,
		})
		.from(casosCobros)
		.leftJoin(
			contratosFinanciamiento,
			eq(casosCobros.contratoId, contratosFinanciamiento.id),
		)
		.leftJoin(vehicles, eq(contratosFinanciamiento.vehicleId, vehicles.id))
		.where(eq(casosCobros.id, input.casoCobroId))
		.limit(1);
	if (!caso || caso.numeroCreditoSifco !== input.numeroSifco) {
		throw new Error("Caso de cobro no corresponde al crédito Págalo.");
	}
	// D-04 pedía siempre "crédito {sifco}" en el mensaje; ahora el pedido es
	// identificar el vehículo (marca modelo año · placa) cuando esté cargado,
	// cayendo a SIFCO si el contrato o la placa no están disponibles.
	const identificadorCredito =
		caso.vehiculoMarca && caso.vehiculoPlaca
			? `vehículo ${`${caso.vehiculoMarca} ${caso.vehiculoModelo ?? ""} ${caso.vehiculoYear ?? ""}`
					.replace(/\s+/g, " ")
					.trim()} · ${caso.vehiculoPlaca}`
			: `crédito ${input.numeroSifco}`;
	const [leadInfo] = await db
		.select({
			email: leads.email,
			phone: leads.phone,
			direccion: leads.direccion,
			departamento: leads.departamento,
			municipio: leads.municipio,
			zona: leads.zona,
		})
		.from(opportunities)
		.leftJoin(leads, eq(opportunities.leadId, leads.id))
		.where(eq(opportunities.numeroSifco, input.numeroSifco))
		.limit(1);

	const telefono = primerTelefono(
		caso?.telefonoPrincipal ?? leadInfo?.phone,
	)?.replace(/\D/g, "");
	const email = caso?.emailContacto || leadInfo?.email;
	const location = caso?.direccionContacto || leadInfo?.direccion;
	if (!telefono || !email || !location) {
		throw new Error(
			"Págalo requiere teléfono, correo y dirección reales del cliente.",
		);
	}
	// Sustitución de test mode DESPUÉS de validar que el caso sí tiene
	// contacto real cargado — testMode no debe ocultar un caso mal cargado.
	// Solo phone/email se redirigen (para que cualquier correo/mensaje real
	// que dispare Págalo llegue acá); nombre, ciudad, departamento y
	// dirección se quedan reales por trazabilidad — decisión explícita del
	// usuario.
	const testMode = isTestModeEnabled();
	const clientContact = {
		phone: testMode ? PAGALO_TEST_PHONE : telefono,
		email: testMode ? PAGALO_TEST_EMAIL : email,
		country: "GT" as const,
		...(leadInfo?.municipio ? { city: leadInfo.municipio } : {}),
		...(leadInfo?.departamento ? { state: leadInfo.departamento } : {}),
		location,
	};

	// Cualquier grupo ACTIVO del crédito —en revisión, esperando pago, o uno
	// que el BOT creó desde WhatsApp— se devuelve tal cual en vez de intentar
	// otro insert: el índice único parcial (un grupo activo por crédito) lo
	// rechazaría y salía como error interno (hallazgo de Codex, PR #1445).
	const grupoActivo = await db
		.select({
			groupId: pagaloPaymentGroups.id,
			status: pagaloPaymentGroups.status,
			origen: pagaloPaymentGroups.origen,
			capitalTotal: pagaloPaymentGroups.capitalTotal,
			facturableTotal: pagaloPaymentGroups.facturableTotal,
			totalAmount: pagaloPaymentGroups.totalAmount,
			linkType: pagaloPaymentLinks.linkType,
			linkStatus: pagaloPaymentLinks.status,
			paymentUrl: pagaloPaymentLinks.paymentUrl,
		})
		.from(pagaloPaymentGroups)
		.leftJoin(
			pagaloPaymentLinks,
			eq(pagaloPaymentLinks.groupId, pagaloPaymentGroups.id),
		)
		.where(
			and(
				eq(pagaloPaymentGroups.carteraCreditoId, input.creditoId),
				notInArray(pagaloPaymentGroups.status, ["COMPLETED", "CANCELLED"]),
			),
		);
	if (grupoActivo.length > 0) {
		const group = grupoActivo[0]!;
		return {
			groupId: group.groupId,
			status: group.status,
			origen: group.origen,
			capitalTotal: group.capitalTotal,
			facturableTotal: group.facturableTotal,
			totalAmount: group.totalAmount,
			links: grupoActivo.flatMap((link) =>
				link.linkType && link.paymentUrl && link.linkStatus === "ACTIVE"
					? [
							{
								linkType: link.linkType,
								paymentUrl: link.paymentUrl,
								status: link.linkStatus as "ACTIVE",
								amount:
									link.linkType === "CAPITAL"
										? group.capitalTotal
										: group.facturableTotal,
							},
						]
					: [],
			),
			// Grupo ya existía (reintento o creado por el BOT) — este llamado no
			// disparó un envío de WhatsApp nuevo.
			whatsappEnviado: false,
		};
	}
	const config = getPagaloSandboxConfig();
	if (!config.linkCreationEnabled) {
		throw new Error(
			"Creación de links Págalo deshabilitada por configuración.",
		);
	}
	const client = createPagaloClient(config);
	const components = [
		["CAPITAL", calculation.capitalTotal] as const,
		["MORA_INTERES", calculation.facturableTotal] as const,
	];
	const providerAmounts = new Map(
		components
			.filter(([, amount]) => amount !== "0.00")
			.map(([linkType, amount]) => [linkType, toPagaloProviderAmount(amount)]),
	);

	const group = await db.transaction(async (tx) => {
		const [created] = await tx
			.insert(pagaloPaymentGroups)
			.values({
				casoCobroId: input.casoCobroId,
				numeroCreditoSifco: input.numeroSifco,
				carteraCreditoId: input.creditoId,
				pagaloEnvironment: "STAGING",
				origen: "ASESOR",
				carteraAsesorId: credit.asesor?.asesor_id ?? null,
				capitalTotal: calculation.capitalTotal,
				facturableTotal: calculation.facturableTotal,
				totalAmount: calculation.totalAmount,
				allocationsSnapshot: calculation.allocations,
				status: "LINKS_PENDING",
				expirationEnabled: false,
				expirationHours: null,
				createdBy: input.requestedBy,
			})
			.returning();
		if (!created) throw new Error("No se pudo crear grupo Págalo.");
		await tx.insert(pagaloPaymentEvents).values({
			groupId: created.id,
			eventType: "GROUP_CREATED",
			source: "ASESOR",
			actorUserId: input.requestedBy,
			toStatus: "LINKS_PENDING",
			payload: {
				capitalTotal: calculation.capitalTotal,
				facturableTotal: calculation.facturableTotal,
			},
		});
		return created;
	});

	// D-04 (docs/features/pagalo/DECISIONES.md): texto visible al cliente
	// siempre neutro — nunca "CAPITAL" ni "MORA_INTERES". Con dos links reales,
	// se numeran en orden fijo (CAPITAL siempre 1 de 2) sin importar cuál se
	// crea primero; con uno solo, "Pago" a secas.
	const dosLinks = providerAmounts.size === 2;
	const etiquetaPago = (linkType: "CAPITAL" | "MORA_INTERES") =>
		dosLinks
			? linkType === "CAPITAL"
				? "Pago 1 de 2"
				: "Pago 2 de 2"
			: "Pago";

	const links = [] as Array<{
		linkType: "CAPITAL" | "MORA_INTERES";
		paymentUrl: string;
		status: "ACTIVE";
		amount: string;
	}>;
	for (const component of components) {
		const [linkType, amount] = component;
		if (amount === "0.00") continue;
		const providerAmount = providerAmounts.get(linkType);
		if (providerAmount === undefined)
			throw new Error("Monto Págalo no disponible.");
		const externalIdentifier = `pagalo-${group.id}-${linkType}-${randomUUID().slice(0, 8)}`;
		const etiqueta = etiquetaPago(linkType);
		const requestPayload = {
			total_amount: providerAmount,
			currency: "GTQ" as const,
			description: `Crédito ${input.numeroSifco} · ${etiqueta}`,
			external_identifier: externalIdentifier,
			type_request: "SP" as const,
			n_quotas: false,
			expiration: false as const,
			client: {
				first_name: credit.usuario.nombre?.split(" ")[0] || "Cliente",
				last_name:
					credit.usuario.nombre?.split(" ").slice(1).join(" ") || "Cashin",
				...clientContact,
			},
			products: [
				{
					product_uuid: 0,
					name: etiqueta,
					product_name: etiqueta,
					amount: providerAmount,
					quantity: 1,
					subtotal: providerAmount,
				},
			],
		};
		const [stored] = await db
			.insert(pagaloPaymentLinks)
			.values({
				groupId: group.id,
				linkType,
				externalIdentifier,
				apiBaseUrl: config.baseUrl,
				status: "CREATING",
				requestPayload,
				requestedBy: input.requestedBy,
			})
			.returning({ id: pagaloPaymentLinks.id });
		if (!stored) throw new Error("No se pudo persistir link Págalo.");
		try {
			const response = await client.createPaymentRequest(requestPayload);
			const paymentUrl = pickString(response, [
				"payment_url",
				"paymenturl",
				"url",
				"link",
			]);
			const requestUuid = pickString(response, ["uuid", "request_uuid"]);
			if (!paymentUrl || !requestUuid)
				throw new Error("Págalo no devolvió URL y UUID de request.");
			await db.transaction(async (tx) => {
				await tx
					.update(pagaloPaymentLinks)
					.set({
						status: "ACTIVE",
						paymentUrl,
						pagaloRequestUuid: requestUuid,
						responsePayload: response,
						activatedAt: new Date(),
						nextPollAt: new Date(),
						updatedAt: new Date(),
					})
					.where(eq(pagaloPaymentLinks.id, stored.id));
				await tx.insert(pagaloPaymentEvents).values({
					groupId: group.id,
					linkId: stored.id,
					eventType: "LINK_ACTIVE",
					source: "PAGALO",
					actorUserId: input.requestedBy,
					fromStatus: "CREATING",
					toStatus: "ACTIVE",
					payload: { linkType },
				});
			});
			links.push({ linkType, paymentUrl, status: "ACTIVE", amount });
		} catch (error) {
			await db
				.update(pagaloPaymentLinks)
				.set({
					status: "ERROR",
					errorCode: error instanceof Error ? error.name : "PAGALO_ERROR",
					errorMessage: error instanceof Error ? error.message : String(error),
					updatedAt: new Date(),
				})
				.where(eq(pagaloPaymentLinks.id, stored.id));
			await db
				.update(pagaloPaymentGroups)
				.set({ status: "REVIEW_REQUIRED", updatedAt: new Date() })
				.where(eq(pagaloPaymentGroups.id, group.id));
			throw error;
		}
	}
	await db
		.update(pagaloPaymentGroups)
		.set({ status: "PENDING_PAYMENT", updatedAt: new Date() })
		.where(eq(pagaloPaymentGroups.id, group.id));

	// D-04: un solo mensaje, con TODOS los links requeridos, solo cuando el
	// grupo ya está completo (arriba de esta línea). Fallo de WhatsApp nunca
	// revierte la creación de links, que ya ocurrió y es válida sin importar
	// si el mensaje llega — el asesor igual ve las URLs en el modal.
	let whatsappEnviado = false;
	try {
		const resultado = await sendPagaloLinksWhatsapp({
			numeroSifco: input.numeroSifco,
			identificadorCredito,
			telefono,
			clienteNombre: credit.usuario.nombre ?? "",
			links,
			createdBy: input.requestedBy,
		});
		whatsappEnviado = resultado.sent;
	} catch (error) {
		console.error(
			`[Págalo] Error enviando links por WhatsApp para ${input.numeroSifco}:`,
			error instanceof Error ? error.message : error,
		);
	}

	return {
		groupId: group.id,
		capitalTotal: calculation.capitalTotal,
		facturableTotal: calculation.facturableTotal,
		totalAmount: calculation.totalAmount,
		links,
		whatsappEnviado,
	};
}
