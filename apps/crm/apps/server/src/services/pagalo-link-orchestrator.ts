import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { casosCobros } from "../db/schema/cobros";
import { leads, opportunities } from "../db/schema/crm";
import {
	pagaloPaymentEvents,
	pagaloPaymentGroups,
	pagaloPaymentLinks,
} from "../db/schema/pagalo-payments";
import { buildPagaloAllocations, type PagaloInstallment } from "../lib/pagalo-allocations";
import { assertPagaloInstallmentSelection } from "../lib/pagalo-selection";
import { primerTelefono } from "../lib/phone-utils";
import { carteraBackClient } from "./cartera-back-client";
import { createPagaloClient, getPagaloSandboxConfig, toPagaloProviderAmount } from "./pagalo-client";

type CreatePagaloLinksInput = {
	casoCobroId: string;
	numeroSifco: string;
	creditoId: number;
	cuotaIds: number[];
	requestedBy: string;
};

const pickString = (value: unknown, names: string[]): string | undefined => {
	if (!value || typeof value !== "object") return undefined;
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		if (names.includes(key.toLowerCase()) && typeof child === "string" && child) return child;
		const nested = pickString(child, names);
		if (nested) return nested;
	}
	return undefined;
};

/** CRM orchestration. Solo sandbox; una llamada externa por componente > Q0. */
export async function createPagaloLinks(input: CreatePagaloLinksInput) {
	const credit = await carteraBackClient.getCredito(input.numeroSifco, false);
	if (credit.credito.credito_id !== input.creditoId) {
		throw new Error("Crédito Págalo no coincide con SIFCO.");
	}
	const vencidas = credit.cuotasAtrasadas
		.filter((cuota) => cuota.numero_cuota > 0)
		.sort((a, b) => a.numero_cuota - b.numero_cuota);
	const proximaPendiente = [...credit.cuotasPendientes]
		.filter((cuota) => cuota.numero_cuota > 0)
		.sort((a, b) => a.numero_cuota - b.numero_cuota)[0];
	const cuotasDisponibles = proximaPendiente ? [...vencidas, proximaPendiente] : vencidas;
	const selectable = cuotasDisponibles.filter((cuota) => input.cuotaIds.includes(cuota.cuota_id));
	if (selectable.length !== input.cuotaIds.length) {
		throw new Error("Una cuota Págalo ya no está vencida o no pertenece al crédito.");
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
			: credit.cuotasAtrasadas[0]
				? [{ cuotaId: credit.cuotasAtrasadas[0].cuota_id, numeroCuota: credit.cuotasAtrasadas[0].numero_cuota }]
				: [];
	const calculation = buildPagaloAllocations({ installments: installmentsForCalculation, mora: credit.moraActual });

	// Datos de contacto: casos_cobros es la fuente principal; leads (vía
	// opportunities.numeroSifco) rellena lo que falte. cartera-back no expone
	// teléfono/email/dirección en /credito.
	const [caso] = await db
		.select({
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			telefonoPrincipal: casosCobros.telefonoPrincipal,
			emailContacto: casosCobros.emailContacto,
			direccionContacto: casosCobros.direccionContacto,
		})
		.from(casosCobros)
		.where(eq(casosCobros.id, input.casoCobroId))
		.limit(1);
	if (!caso || caso.numeroCreditoSifco !== input.numeroSifco) {
		throw new Error("Caso de cobro no corresponde al crédito Págalo.");
	}
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

	const telefono = primerTelefono(caso?.telefonoPrincipal ?? leadInfo?.phone)?.replace(/\D/g, "");
	const email = caso?.emailContacto || leadInfo?.email;
	const location = caso?.direccionContacto || leadInfo?.direccion;
	if (!telefono || !email || !location) {
		throw new Error("Págalo requiere teléfono, correo y dirección reales del cliente.");
	}
	const clientContact = {
		phone: telefono,
		email,
		country: "GT" as const,
		...(leadInfo?.municipio ? { city: leadInfo.municipio } : {}),
		...(leadInfo?.departamento ? { state: leadInfo.departamento } : {}),
		location,
	};

	const config = getPagaloSandboxConfig();
	const client = createPagaloClient(config);
	const grupoEnRevision = await db
		.select({
			groupId: pagaloPaymentGroups.id,
			capitalTotal: pagaloPaymentGroups.capitalTotal,
			facturableTotal: pagaloPaymentGroups.facturableTotal,
			totalAmount: pagaloPaymentGroups.totalAmount,
			linkType: pagaloPaymentLinks.linkType,
			paymentUrl: pagaloPaymentLinks.paymentUrl,
		})
		.from(pagaloPaymentGroups)
		.leftJoin(pagaloPaymentLinks, eq(pagaloPaymentLinks.groupId, pagaloPaymentGroups.id))
		.where(and(
			eq(pagaloPaymentGroups.carteraCreditoId, input.creditoId),
			eq(pagaloPaymentGroups.status, "REVIEW_REQUIRED"),
		));
	if (grupoEnRevision.length > 0) {
		const group = grupoEnRevision[0]!;
		return {
			groupId: group.groupId,
			status: "REVIEW_REQUIRED" as const,
			capitalTotal: group.capitalTotal,
			facturableTotal: group.facturableTotal,
			totalAmount: group.totalAmount,
			links: grupoEnRevision.flatMap((link) =>
				link.linkType && link.paymentUrl
					? [{ linkType: link.linkType, paymentUrl: link.paymentUrl }]
					: [],
			),
		};
	}

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
			payload: { capitalTotal: calculation.capitalTotal, facturableTotal: calculation.facturableTotal },
		});
		return created;
	});

	const links = [] as Array<{ linkType: "CAPITAL" | "MORA_INTERES"; paymentUrl: string }>;
	for (const component of [
		["CAPITAL", calculation.capitalTotal] as const,
		["MORA_INTERES", calculation.facturableTotal] as const,
	]) {
		const [linkType, amount] = component;
		if (amount === "0.00") continue;
		const providerAmount = toPagaloProviderAmount(amount);
		const externalIdentifier = `pagalo-${group.id}-${linkType}-${randomUUID().slice(0, 8)}`;
		const requestPayload = {
			total_amount: providerAmount,
			currency: "GTQ" as const,
			description: `Pago Club Cashin ${input.numeroSifco}`,
			external_identifier: externalIdentifier,
			type_request: "SP" as const,
			n_quotas: false,
			expiration: false as const,
			client: {
				first_name: credit.usuario.nombre?.split(" ")[0] || "Cliente",
				last_name: credit.usuario.nombre?.split(" ").slice(1).join(" ") || "Cashin",
				...clientContact,
			},
			products: [{ product_uuid: 0, name: linkType, product_name: linkType, amount: providerAmount, quantity: 1, subtotal: providerAmount }],
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
			const paymentUrl = pickString(response, ["payment_url", "paymenturl", "url", "link"]);
			const requestUuid = pickString(response, ["uuid", "request_uuid"]);
			if (!paymentUrl || !requestUuid) throw new Error("Págalo no devolvió URL y UUID de request.");
			await db.transaction(async (tx) => {
				await tx.update(pagaloPaymentLinks).set({
					status: "ACTIVE", paymentUrl, pagaloRequestUuid: requestUuid,
					responsePayload: response, activatedAt: new Date(), nextPollAt: new Date(), updatedAt: new Date(),
				}).where(eq(pagaloPaymentLinks.id, stored.id));
				await tx.insert(pagaloPaymentEvents).values({ groupId: group.id, linkId: stored.id, eventType: "LINK_ACTIVE", source: "PAGALO", actorUserId: input.requestedBy, fromStatus: "CREATING", toStatus: "ACTIVE", payload: { linkType } });
			});
			links.push({ linkType, paymentUrl });
		} catch (error) {
			await db.update(pagaloPaymentLinks).set({ status: "ERROR", errorCode: error instanceof Error ? error.name : "PAGALO_ERROR", errorMessage: error instanceof Error ? error.message : String(error), updatedAt: new Date() }).where(eq(pagaloPaymentLinks.id, stored.id));
			await db.update(pagaloPaymentGroups).set({ status: "REVIEW_REQUIRED", updatedAt: new Date() }).where(eq(pagaloPaymentGroups.id, group.id));
			throw error;
		}
	}
	await db.update(pagaloPaymentGroups).set({ status: "PENDING_PAYMENT", updatedAt: new Date() }).where(eq(pagaloPaymentGroups.id, group.id));
	return { groupId: group.id, capitalTotal: calculation.capitalTotal, facturableTotal: calculation.facturableTotal, totalAmount: calculation.totalAmount, links };
}
