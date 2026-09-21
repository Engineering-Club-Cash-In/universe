import { ORPCError } from "@orpc/server";
import { and, count, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { coDebtors, leads } from "../db/schema/crm";
import {
	contractSignatories,
	generatedLegalContracts,
} from "../db/schema/legal-contracts";
import {
	whatsappLogRecipients,
	whatsappLogs,
} from "../db/schema/whatsapp-logs";
import { auditRecord } from "../lib/audit";
import { getTestPhone, isTestModeEnabled } from "../lib/messaging-test-mode";
import { crmProcedure } from "../lib/orpc";
import { getSimpletechClient, sendWhatsappTemplate } from "../lib/simpletech";
import { getFileUrl, getFileUrlWithBucketInKey } from "../lib/storage";

const R2_LEGAL_DOCS_BUCKET_NAME =
	process.env.R2_BUCKET_LEGAL_DOCS ||
	process.env.R2_BUCKET_NAME_LEGAL_DOCS ||
	"legal-documents";

async function resolvePdfUrl(pdfLink: string | null): Promise<string | null> {
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

interface DestinatarioDeFirma {
	nombre: string;
	/** Con el que se emparejan los links: WeeTrust identifica por correo. */
	email: string | null;
	phone: string | null;
	leadId?: string;
	coDebtorId?: string;
}

/**
 * Manda por WhatsApp los links de firma, uno por persona.
 *
 * Hasta ahora esto estaba apagado, y por una buena razón: los links se
 * guardaban por posición, así que con cofirmante el que se mandaba como "del
 * cliente" podía ser el del cofirmante. El código se protegía cortando el envío
 * en cuanto había cofirmantes, que es justo el caso en que más falta hace.
 *
 * Ahora cada firmante tiene su propio link guardado con su rol, así que a cada
 * uno se le manda EL SUYO, emparejado por correo. Quien no tiene link en un
 * contrato (porque no firma ese documento) simplemente no lo recibe.
 */
export async function sendContractLinksToLead(params: {
	leadId: string;
	opportunityId: string;
}): Promise<{ sent: boolean; reason?: string }> {
	const [lead] = await db
		.select({
			firstName: leads.firstName,
			lastName: leads.lastName,
			email: leads.email,
			phone: leads.phone,
		})
		.from(leads)
		.where(eq(leads.id, params.leadId))
		.limit(1);

	const coDebtorsList = await db
		.select({
			id: coDebtors.id,
			fullName: coDebtors.fullName,
			email: coDebtors.email,
			phone: coDebtors.phone,
		})
		.from(coDebtors)
		.where(eq(coDebtors.opportunityId, params.opportunityId));

	const contracts = await db
		.select({
			id: generatedLegalContracts.id,
			contractName: generatedLegalContracts.contractName,
			signatureMode: generatedLegalContracts.signatureMode,
			clientSigningLink: generatedLegalContracts.clientSigningLink,
			pdfLink: generatedLegalContracts.pdfLink,
		})
		.from(generatedLegalContracts)
		.where(eq(generatedLegalContracts.opportunityId, params.opportunityId));

	// Los contratos de papel no llevan link: mandarlos sólo confunde.
	const contratosDeFirma = contracts.filter(
		(c) => c.signatureMode !== "fisica",
	);

	const firmantes = contratosDeFirma.length
		? await db
				.select({
					contractId: contractSignatories.contractId,
					email: contractSignatories.email,
					signingUrl: contractSignatories.signingUrl,
				})
				.from(contractSignatories)
				.where(
					inArray(
						contractSignatories.contractId,
						contratosDeFirma.map((c) => c.id),
					),
				)
		: [];

	/**
	 * contractId → (email en minúsculas → link). El link puede ser null: la
	 * persona firma ese contrato pero WeeTrust no devolvió su enlace. Se guarda
	 * igual para que el contrato aparezca en el envío manual y se pueda pegar.
	 */
	const linksPorContrato = new Map<string, Map<string, string | null>>();
	for (const f of firmantes) {
		const porEmail = linksPorContrato.get(f.contractId) ?? new Map();
		porEmail.set(f.email.toLowerCase(), f.signingUrl ?? null);
		linksPorContrato.set(f.contractId, porEmail);
	}

	const pdfResueltos = new Map<string, string | null>();
	for (const c of contratosDeFirma) {
		pdfResueltos.set(c.id, await resolvePdfUrl(c.pdfLink));
	}

	const leadName = lead ? `${lead.firstName} ${lead.lastName}` : "Cliente";

	const destinatarios: DestinatarioDeFirma[] = [
		{
			nombre: leadName,
			email: lead?.email ?? null,
			phone: lead?.phone ?? null,
			leadId: params.leadId,
		},
		...coDebtorsList.map((cd) => ({
			nombre: cd.fullName,
			email: cd.email,
			phone: cd.phone,
			coDebtorId: cd.id,
		})),
	];

	const [log] = await db
		.insert(whatsappLogs)
		.values({ opportunityId: params.opportunityId })
		.returning();

	const stClient = getSimpletechClient();

	// Con TEST_MESSAGE=true los mensajes van a nuestros números en vez de a los
	// del cliente. Es el mismo interruptor que usa cobros, y es lo que permite
	// probar el flujo completo con datos reales sin escribirle a nadie de afuera.
	// Cada destinatario rota por la lista para que no lleguen todos al mismo.
	const modoPrueba = isTestModeEnabled();
	let algunoEnviado = false;
	let motivoDelLead: string | undefined;

	for (const [indice, destinatario] of destinatarios.entries()) {
		// Los contratos de ESTA persona: aquellos donde tiene link propio.
		// Para los contratos viejos, que no tienen firmantes guardados, se cae al
		// link del cliente, pero sólo para el titular: ese es el único de quien
		// sabemos con certeza que la columna decía la verdad.
		const susContratos = contratosDeFirma
			.map((c) => {
				const porEmail = linksPorContrato.get(c.id);
				const clave = destinatario.email?.toLowerCase();
				const firmaEste = Boolean(clave && porEmail?.has(clave));
				const legado =
					!porEmail && destinatario.leadId ? c.clientSigningLink : null;

				return {
					contractName: c.contractName,
					link: firmaEste ? (porEmail?.get(clave as string) ?? null) : legado,
					pdfLink: pdfResueltos.get(c.id) ?? null,
					esSuyo: firmaEste || Boolean(legado),
				};
			})
			.filter((c) => c.esSuyo)
			.map(({ esSuyo: _, ...c }) => c);

		// Si a alguno de SUS contratos le falta el enlace, no se manda nada: un
		// mensaje con la mitad de los contratos queda marcado como enviado y el
		// que falta no lo vuelve a buscar nadie. Queda pendiente para mandarlo a
		// mano, con el hueco a la vista.
		const sinEnlace = susContratos.filter((c) => !c.link);
		const mensaje =
			susContratos.length > 0 && sinEnlace.length === 0
				? buildContractLinksMessage(
						destinatario.nombre,
						susContratos as ContractLink[],
					)
				: null;

		let status: "sent" | "pending" | "failed" = "pending";
		let motivo: string | undefined;
		let enviadoEn: Date | undefined;

		// En modo prueba el teléfono del cliente no hace falta: igual no se usa.
		const telefonoDestino = modoPrueba
			? getTestPhone(indice)
			: destinatario.phone;

		if (!stClient) {
			motivo = "Servicio de mensajería no configurado";
		} else if (contratosDeFirma.length === 0) {
			motivo = "No hay contratos con firma electrónica";
		} else if (sinEnlace.length > 0) {
			motivo = `Falta el enlace de firma de: ${sinEnlace.map((c) => c.contractName).join(", ")}`;
		} else if (!mensaje) {
			motivo = destinatario.email
				? "No tiene links de firma en estos contratos"
				: "No tiene correo registrado, no se le pueden asociar sus links";
		} else if (!telefonoDestino) {
			motivo = "No tiene teléfono registrado";
		} else {
			const resultado = await sendWhatsappTemplate({
				phone: telefonoDestino,
				message: mensaje,
				logPrefix: modoPrueba
					? "[SimpleTech][contratos][TEST]"
					: "[SimpleTech][contratos]",
			});

			if (resultado.success) {
				status = "sent";
				enviadoEn = new Date();
				algunoEnviado = true;
				if (modoPrueba) {
					// Queda anotado a quién le habría llegado de verdad, para que la
					// fila no parezca un envío normal al cliente.
					motivo = `TEST_MESSAGE: enviado a ${telefonoDestino} en lugar de ${destinatario.phone ?? "sin teléfono"}`;
				}
			} else {
				status = "failed";
				motivo = resultado.error ?? "Error enviando el mensaje";
			}
		}

		if (destinatario.leadId) motivoDelLead = motivo;

		await db.insert(whatsappLogRecipients).values({
			whatsappLogId: log.id,
			leadId: destinatario.leadId,
			coDebtorId: destinatario.coDebtorId,
			recipientName: destinatario.nombre,
			// El teléfono REAL, también en modo prueba. El envío manual arranca con
			// este número y lo guarda en el lead o el codeudor: si acá quedara el de
			// prueba, reintentar sin tocarlo le pisaba el teléfono al cliente con
			// uno nuestro. El desvío queda anotado en `reason`.
			phone: destinatario.phone,
			message: mensaje,
			contracts: susContratos,
			status,
			reason: motivo,
			sentAt: enviadoEn,
		});
	}

	return { sent: algunoEnviado, reason: motivoDelLead };
}

export const messagingRouter = {
	sendWhatsAppMessage: crmProcedure
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

			const result = await sendWhatsappTemplate({
				phone: lead.phone,
				message: input.message,
				logPrefix: "[SimpleTech][msg]",
			});

			if (!result.success) {
				throw new ORPCError("BAD_REQUEST", {
					message: result.error ?? "Error enviando mensaje",
				});
			}

			return result;
		}),

	/**
	 * Arma el mensaje de contratos para un lead + oportunidad.
	 */
	getContractLinksMessage: crmProcedure
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

			// El link del titular sale de sus firmantes; `clientSigningLink` sólo
			// se usa para los contratos viejos, que no los tienen guardados.
			const contracts = await db
				.select({
					id: generatedLegalContracts.id,
					contractName: generatedLegalContracts.contractName,
					clientSigningLink: generatedLegalContracts.clientSigningLink,
					titularSigningUrl: contractSignatories.signingUrl,
				})
				.from(generatedLegalContracts)
				.leftJoin(
					contractSignatories,
					and(
						eq(contractSignatories.contractId, generatedLegalContracts.id),
						eq(contractSignatories.role, "TITULAR"),
					),
				)
				.where(
					and(
						eq(generatedLegalContracts.opportunityId, input.opportunityId),
						// Los de papel no llevan link: incluirlos hacía que
						// `allContractsHaveLink` fuera siempre falso.
						ne(generatedLegalContracts.signatureMode, "fisica"),
					),
				);

			const mapped = contracts.map((c) => ({
				contractName: c.contractName,
				link: c.titularSigningUrl ?? c.clientSigningLink ?? null,
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
				allContractsHaveLink: validContracts.length === contracts.length,
			};
		}),

	/**
	 * Obtiene el log de WhatsApp de una oportunidad con sus destinatarios.
	 */
	getWhatsappLog: crmProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			const logs = await db
				.select()
				.from(whatsappLogs)
				.where(eq(whatsappLogs.opportunityId, input.opportunityId));

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
						| {
								contractName: string;
								link: string | null;
								pdfLink?: string | null;
						  }[]
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
	updateWhatsappLog: crmProcedure
		.meta({ audit: { entity: "lead", action: "update_phone" } })
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
				auditRecord({
					entity: "lead",
					id: recipient.leadId,
					action: "update_phone",
					data: { recipientId: input.recipientId, phone: input.phone },
				});
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

			// Enviar por WhatsApp. TEST_MESSAGE rige también el envío manual: si
			// no, reintentar desde la ficha en modo prueba le escribía al cliente.
			const modoPrueba = isTestModeEnabled();
			const sendResult = await sendWhatsappTemplate({
				phone: modoPrueba ? getTestPhone() : input.phone,
				message,
				logPrefix: modoPrueba
					? "[SimpleTech][manual][TEST]"
					: "[SimpleTech][manual]",
			});
			const status: "sent" | "failed" = sendResult.success ? "sent" : "failed";
			const reason: string | null = sendResult.success
				? null
				: (sendResult.error ?? "Error desconocido al enviar");

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
