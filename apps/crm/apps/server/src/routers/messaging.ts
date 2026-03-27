import { ORPCError } from "@orpc/server";
import { SimpleTechClient } from "@repo/simpletech";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { coDebtors, leads } from "../db/schema/crm";
import { generatedLegalContracts } from "../db/schema/legal-contracts";
import {
	whatsappLogRecipients,
	whatsappLogs,
} from "../db/schema/whatsapp-logs";
import { protectedProcedure } from "../lib/orpc";
import { getFileUrl, getFileUrlWithBucketInKey } from "../lib/storage";

const R2_LEGAL_DOCS_BUCKET_NAME =
	process.env.R2_BUCKET_LEGAL_DOCS ||
	process.env.R2_BUCKET_NAME_LEGAL_DOCS ||
	"legal-documents";

async function resolvePdfUrl(
	pdfLink: string | null,
): Promise<string | null> {
	if (!pdfLink) return null;
	if (pdfLink.startsWith("http")) return pdfLink;
	try {
		if (pdfLink.includes(R2_LEGAL_DOCS_BUCKET_NAME)) {
			return await getFileUrlWithBucketInKey(pdfLink);
		}
		return await getFileUrl(pdfLink);
	} catch {
		return null;
	}
}

const simpletechClient = process.env.SIMPLETECH_TOKEN
	? new SimpleTechClient({
			credentials: { token: process.env.SIMPLETECH_TOKEN },
			baseUrl: process.env.SIMPLETECH_BASE_URL!,
		})
	: null;

export interface ContractLink {
	contractName: string;
	link: string;
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
		.map((c) => `📄 ${c.contractName}:\n${c.link}`)
		.join("\n\n");

	return `Hola ${clientName}, tus contratos están listos para firmar. Por favor ingresa a los siguientes enlaces:\n\n${linksText}\n\nSi tienes alguna duda, no dudes en contactarnos.`;
}

/**
 * Crea el log padre + destinatarios (lead + cofirmantes).
 * Envía automáticamente solo al lead si se cumplen las condiciones.
 * Cofirmantes siempre quedan como "pending" (por ahora).
 */
export async function sendContractLinksToLead(params: {
	leadId: string;
	opportunityId: string;
}): Promise<{ sent: boolean; reason?: string }> {
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

	// Obtener cofirmantes
	const coDebtorsList = await db
		.select({
			id: coDebtors.id,
			fullName: coDebtors.fullName,
			phone: coDebtors.phone,
		})
		.from(coDebtors)
		.where(eq(coDebtors.opportunityId, params.opportunityId));

	const hasCoDebtors = coDebtorsList.length > 0;

	// Obtener contratos
	const contracts = await db
		.select({
			contractName: generatedLegalContracts.contractName,
			clientSigningLink: generatedLegalContracts.clientSigningLink,
			pdfLink: generatedLegalContracts.pdfLink,
		})
		.from(generatedLegalContracts)
		.where(
			eq(generatedLegalContracts.opportunityId, params.opportunityId),
		);

	const leadName = lead
		? `${lead.firstName} ${lead.lastName}`
		: "Cliente";

	// Resolver URLs firmadas de los PDFs
	const resolvedPdfLinks = await Promise.all(
		contracts.map((c) => resolvePdfUrl(c.pdfLink)),
	);

	// Cuando hay cofirmantes, los links no son confiables → todos null
	// Cuando NO hay cofirmantes, usar los links disponibles
	const recipientContracts = contracts.map((c, i) => ({
		contractName: c.contractName,
		link: hasCoDebtors ? null : (c.clientSigningLink ?? null),
		pdfLink: resolvedPdfLinks[i],
	}));

	const allLinksReady =
		!hasCoDebtors &&
		recipientContracts.length > 0 &&
		recipientContracts.every((c) => c.link);

	const leadMessage = allLinksReady
		? buildContractLinksMessage(
				leadName,
				recipientContracts as ContractLink[],
			)
		: null;

	// Crear log padre
	const [log] = await db
		.insert(whatsappLogs)
		.values({
			opportunityId: params.opportunityId,
		})
		.returning();

	// Determinar estado del lead
	let leadStatus: "sent" | "pending" | "failed" = "pending";
	let leadReason: string | undefined;

	if (!simpletechClient) {
		leadReason = "SIMPLETECH_TOKEN no configurado";
	} else if (hasCoDebtors) {
		leadReason = "La oportunidad tiene cofirmantes";
	} else if (contracts.length === 0) {
		leadReason = "No hay contratos asociados";
	} else if (!allLinksReady) {
		leadReason =
			"No todos los contratos tienen link de firma para el cliente";
	} else if (!lead?.phone) {
		leadReason = "El lead no tiene teléfono registrado";
	} else {
		// Todo OK — intentar enviar
		try {
			await simpletechClient.sendText(
				lead.phone,
				"WHATSAPP",
				leadMessage!,
			);
			leadStatus = "sent";
		} catch (err) {
			leadStatus = "failed";
			leadReason =
				err instanceof Error ? err.message : "Error desconocido";
		}
	}

	// Insertar destinatario lead
	await db.insert(whatsappLogRecipients).values({
		whatsappLogId: log.id,
		leadId: params.leadId,
		recipientName: leadName,
		phone: lead?.phone,
		message: leadMessage,
		contracts: recipientContracts,
		status: leadStatus,
		reason: leadReason,
		sentAt: leadStatus === "sent" ? new Date() : undefined,
	});

	// Cofirmantes: mismos contratos pero siempre sin links
	const coDebtorContracts = contracts.map((c, i) => ({
		contractName: c.contractName,
		link: null,
		pdfLink: resolvedPdfLinks[i],
	}));

	for (const coDebtor of coDebtorsList) {
		await db.insert(whatsappLogRecipients).values({
			whatsappLogId: log.id,
			coDebtorId: coDebtor.id,
			recipientName: coDebtor.fullName,
			phone: coDebtor.phone,
			message: null,
			contracts: coDebtorContracts,
			status: "pending",
			reason: "Links de firma pendientes",
		});
	}

	return {
		sent: leadStatus === "sent",
		reason: leadReason,
	};
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
	 */
	getContractLinksMessage: protectedProcedure
		.input(
			z.object({
				leadId: z.string().uuid(),
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
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
					clientSigningLink:
						generatedLegalContracts.clientSigningLink,
				})
				.from(generatedLegalContracts)
				.where(
					eq(
						generatedLegalContracts.opportunityId,
						input.opportunityId,
					),
				);

			const mapped = contracts.map((c) => ({
				contractName: c.contractName,
				link: c.clientSigningLink ?? null,
			}));

			const validContracts = mapped.filter(
				(c): c is ContractLink => c.link !== null,
			);

			const clientName = `${lead.firstName} ${lead.lastName}`;

			return {
				clientName,
				contracts: mapped,
				message:
					validContracts.length > 0
						? buildContractLinksMessage(clientName, validContracts)
						: null,
				allContractsHaveLink:
					validContracts.length === contracts.length,
			};
		}),

	/**
	 * Obtiene el log de WhatsApp de una oportunidad con sus destinatarios.
	 */
	getWhatsappLog: protectedProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			const logs = await db
				.select()
				.from(whatsappLogs)
				.where(
					eq(whatsappLogs.opportunityId, input.opportunityId),
				);

			if (logs.length === 0) {
				return null; 
			}

			const log = logs[0];

			const recipients = await db
				.select()
				.from(whatsappLogRecipients)
				.where(eq(whatsappLogRecipients.whatsappLogId, log.id));

			// Resolver URLs firmadas de los PDFs para cada recipient
			const recipientsWithUrls = await Promise.all(
				recipients.map(async (r) => {
					const contracts = r.contracts as
						| { contractName: string; link: string | null; pdfLink?: string | null }[]
						| null;
					if (!contracts) return r;

					const resolved = await Promise.all(
						contracts.map(async (c) => ({
							...c,
							pdfLink: await resolvePdfUrl(c.pdfLink ?? null),
						})),
					);
					return { ...r, contracts: resolved };
				}),
			);

			return {
				...log,
				recipients: recipientsWithUrls,
			};
		}),

	/**
	 * Envía el mensaje de WhatsApp a un destinatario.
	 * Recibe los links individuales por contrato, arma el mensaje, lo envía,
	 * y guarda el resultado real (sent/failed).
	 */
	updateWhatsappLog: protectedProcedure
		.input(
			z.object({
				recipientId: z.string().uuid(),
				phone: z.string().min(1),
				contracts: z.array(
					z.object({
						contractName: z.string(),
						link: z.string().nullable(),
					}),
				),
			}),
		)
		.handler(async ({ input }) => {
			const [recipient] = await db
				.select()
				.from(whatsappLogRecipients)
				.where(eq(whatsappLogRecipients.id, input.recipientId))
				.limit(1);

			if (!recipient) {
				throw new ORPCError("NOT_FOUND", {
					message: "Destinatario no encontrado",
				});
			}

			// Actualizar teléfono del lead o cofirmante
			if (recipient.leadId) {
				await db
					.update(leads)
					.set({ phone: input.phone })
					.where(eq(leads.id, recipient.leadId));
			}
			if (recipient.coDebtorId) {
				await db
					.update(coDebtors)
					.set({ phone: input.phone })
					.where(eq(coDebtors.id, recipient.coDebtorId));
			}

			// Armar mensaje
			const completeContracts = input.contracts.filter(
				(c): c is ContractLink => c.link !== null,
			);

			if (completeContracts.length === 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Todos los contratos deben tener link de firma",
				});
			}

			const message = buildContractLinksMessage(
				recipient.recipientName,
				completeContracts,
			);

			// Enviar por WhatsApp
			let status: "sent" | "failed" = "failed";
			let reason: string | null = null;

			if (!simpletechClient) {
				reason = "Servicio de mensajería no configurado";
			} else {
				try {
					await simpletechClient.sendText(
						input.phone,
						"WHATSAPP",
						message,
					);
					status = "sent";
				} catch (err) {
					reason =
						err instanceof Error
							? err.message
							: "Error desconocido al enviar";
				}
			}

			const [updated] = await db
				.update(whatsappLogRecipients)
				.set({
					status,
					phone: input.phone,
					contracts: input.contracts,
					message,
					reason,
					sentAt: status === "sent" ? new Date() : undefined,
					updatedAt: new Date(),
				})
				.where(eq(whatsappLogRecipients.id, input.recipientId))
				.returning();

			return updated;
		}),
};
