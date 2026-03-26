import { ORPCError } from "@orpc/server";
import { SimpleTechClient } from "@repo/simpletech";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { leads } from "../db/schema/crm";
import { protectedProcedure } from "../lib/orpc";

const simpletechClient = process.env.SIMPLETECH_TOKEN
	? new SimpleTechClient({
			credentials: { token: process.env.SIMPLETECH_TOKEN },
			baseUrl: process.env.SIMPLETECH_BASE_URL!,
		})
	: null;

export interface ContractLink {
	contractName: string;
	clientSigningLink: string;
}

/**
 * Arma el mensaje de WhatsApp con los links de firma de contratos.
 * Exportable para reutilizar desde el front u otros routers.
 */
export function buildContractLinksMessage(
	clientName: string,
	contracts: ContractLink[],
): string {
	const linksText = contracts
		.map((c) => `📄 ${c.contractName}:\n${c.clientSigningLink}`)
		.join("\n\n");

	return `Hola ${clientName}, tus contratos están listos para firmar. Por favor ingresa a los siguientes enlaces:\n\n${linksText}\n\nSi tienes alguna duda, no dudes en contactarnos.`;
}

/**
 * Envía los links de contratos por WhatsApp al lead.
 * Solo envía si SIMPLETECH_TOKEN existe, no hay cofirmantes,
 * y todos los contratos tienen clientSigningLink.
 * Retorna null si no se cumplieron las condiciones.
 */
export async function sendContractLinksToLead(params: {
	leadId: string;
	opportunityId: string;
}): Promise<{ sent: boolean; reason?: string }> {
	if (!simpletechClient) {
		return { sent: false, reason: "SIMPLETECH_TOKEN no configurado" };
	}

	const { coDebtors } = await import("../db/schema/crm");
	const { generatedLegalContracts } = await import(
		"../db/schema/legal-contracts"
	);
	const { count } = await import("drizzle-orm");

	// Verificar que no haya cofirmantes
	const [{ count: coDebtorCount }] = await db
		.select({ count: count() })
		.from(coDebtors)
		.where(eq(coDebtors.opportunityId, params.opportunityId));

	if (Number(coDebtorCount) > 0) {
		return { sent: false, reason: "La oportunidad tiene cofirmantes" };
	}

	// Obtener contratos de la oportunidad
	const contracts = await db
		.select({
			contractName: generatedLegalContracts.contractName,
			clientSigningLink: generatedLegalContracts.clientSigningLink,
		})
		.from(generatedLegalContracts)
		.where(
			eq(generatedLegalContracts.opportunityId, params.opportunityId),
		);

	if (contracts.length === 0) {
		return { sent: false, reason: "No hay contratos asociados" };
	}

	// Verificar que TODOS tengan clientSigningLink
	const allHaveLink = contracts.every((c) => c.clientSigningLink);
	if (!allHaveLink) {
		return {
			sent: false,
			reason:
				"No todos los contratos tienen link de firma para el cliente",
		};
	}

	// Obtener datos del lead
	const [lead] = await db
		.select({
			firstName: leads.firstName,
			lastName: leads.lastName,
			phone: leads.phone,
		})
		.from(leads)
		.where(eq(leads.id, params.leadId))
		.limit(1);

	if (!lead?.phone) {
		return { sent: false, reason: "El lead no tiene teléfono registrado" };
	}

	const message = buildContractLinksMessage(
		`${lead.firstName} ${lead.lastName}`,
		contracts as ContractLink[],
	);

	await simpletechClient.sendText(lead.phone, "WHATSAPP", message);

	return { sent: true };
}

export const messagingRouter = {
	sendWhatsAppMessage: protectedProcedure
		.input(
			z.object({
				leadId: z.string(),
				message: z.string().min(1),
			}),
		)
		.handler(async ({ input }) => {
			const [lead] = await db
				.select({ phone: leads.phone })
				.from(leads)
				.where(eq(leads.id, input.leadId))
				.limit(1);

			if (!lead) {
				throw new ORPCError("NOT_FOUND", {
					message: "Lead no encontrado",
				});
			}

			if (!lead.phone) {
				throw new ORPCError("BAD_REQUEST", {
					message: "El lead no tiene un número de teléfono registrado",
				});
			}

			if (!simpletechClient) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Servicio de mensajería no configurado",
				});
			}

			const result = await simpletechClient.sendText(
				lead.phone,
				"WHATSAPP",
				input.message,
			);

			return result;
		}),

	/**
	 * Arma el mensaje de contratos para un lead + oportunidad.
	 * Útil desde el front para previsualizar el mensaje.
	 */
	getContractLinksMessage: protectedProcedure
		.input(
			z.object({
				leadId: z.string().uuid(),
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			const { generatedLegalContracts } = await import(
				"../db/schema/legal-contracts"
			);

			const [lead] = await db
				.select({
					firstName: leads.firstName,
					lastName: leads.lastName,
				})
				.from(leads)
				.where(eq(leads.id, input.leadId))
				.limit(1);

			if (!lead) {
				throw new ORPCError("NOT_FOUND", {
					message: "Lead no encontrado",
				});
			}

			const contracts = await db
				.select({
					contractName: generatedLegalContracts.contractName,
					clientSigningLink: generatedLegalContracts.clientSigningLink,
				})
				.from(generatedLegalContracts)
				.where(
					eq(
						generatedLegalContracts.opportunityId,
						input.opportunityId,
					),
				);

			const validContracts = contracts.filter(
				(c) => c.clientSigningLink,
			) as ContractLink[];

			const clientName = `${lead.firstName} ${lead.lastName}`;

			return {
				clientName,
				contracts: validContracts,
				message:
					validContracts.length > 0
						? buildContractLinksMessage(clientName, validContracts)
						: null,
				allContractsHaveLink:
					validContracts.length === contracts.length,
			};
		}),
};
