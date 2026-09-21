import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
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
import { aplicarCorreosDePrueba } from "../lib/contratos-correos-prueba";
import {
	REP_LEGAL_EMAIL,
	REP_LEGAL_NOMBRE,
	REP_LEGAL_TELEFONO,
} from "../lib/contratos-rep-legal";
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
	/** TITULAR | COFIRMANTE | REP_LEGAL. Decide qué correo de prueba le toca. */
	role: string;
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

	// Orden estable: el reparto de correos de prueba es posicional, así que hay
	// que recorrer los codeudores igual que cuando se armaron los firmantes.
	const coDebtorsList = await db
		.select({
			id: coDebtors.id,
			fullName: coDebtors.fullName,
			email: coDebtors.email,
			phone: coDebtors.phone,
		})
		.from(coDebtors)
		.where(eq(coDebtors.opportunityId, params.opportunityId))
		.orderBy(coDebtors.createdAt);

	const contracts = await db
		.select({
			id: generatedLegalContracts.id,
			contractName: generatedLegalContracts.contractName,
			signatureMode: generatedLegalContracts.signatureMode,
			pdfLink: generatedLegalContracts.pdfLink,
			weetrustDocumentId: generatedLegalContracts.weetrustDocumentId,
			signingProvider: generatedLegalContracts.signingProvider,
		})
		.from(generatedLegalContracts)
		.where(
			and(
				eq(generatedLegalContracts.opportunityId, params.opportunityId),
				// Un anulado quedó reemplazado: sus enlaces no se mandan.
				ne(generatedLegalContracts.status, "cancelled"),
			),
		);

	// Los contratos de papel no llevan link: mandarlos sólo confunde.
	const contratosDeFirma = contracts.filter(
		(c) => c.signatureMode !== "fisica",
	);

	// Si todo se firma en papel no hay nada que mandar. No se crea el registro:
	// quedaría "pendiente" para siempre en la ficha y el envío manual no lo
	// puede cerrar, porque no tiene ningún contrato que ofrecer.
	if (contratosDeFirma.length === 0) {
		return { sent: false, reason: "No hay contratos con firma electrónica" };
	}

	const firmantes = contratosDeFirma.length
		? await db
				.select({
					contractId: contractSignatories.contractId,
					email: contractSignatories.email,
					signingUrl: contractSignatories.signingUrl,
					status: contractSignatories.status,
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
	/** Contratos con firmantes guardados, firmados o no. */
	const conFirmantes = new Set<string>();
	/** Correos (en minúsculas) con al menos un contrato firmado. */
	const firmaronAlgo = new Set<string>();
	for (const f of firmantes) {
		conFirmantes.add(f.contractId);
		// Quien ya firmó ese contrato no recibe su enlace otra vez: le llegaba un
		// link de un documento cerrado cada vez que se reenviaba por otro motivo.
		if (f.status === "signed") {
			firmaronAlgo.add(f.email.toLowerCase());
			continue;
		}
		const porEmail = linksPorContrato.get(f.contractId) ?? new Map();
		porEmail.set(f.email.toLowerCase(), f.signingUrl ?? null);
		linksPorContrato.set(f.contractId, porEmail);
	}

	const pdfResueltos = new Map<string, string | null>();
	for (const c of contratosDeFirma) {
		pdfResueltos.set(c.id, await resolvePdfUrl(c.pdfLink));
	}

	const leadName = lead ? `${lead.firstName} ${lead.lastName}` : "Cliente";

	// Con TEST_MESSAGE=true los mensajes van a nuestros números en vez de a los
	// del cliente. Es el mismo interruptor que usa cobros, y es lo que permite
	// probar el flujo completo con datos reales sin escribirle a nadie de afuera.
	// Cada destinatario rota por la lista para que no lleguen todos al mismo.
	const modoPrueba = isTestModeEnabled();

	const destinatariosReales: DestinatarioDeFirma[] = [
		{
			role: "TITULAR",
			nombre: leadName,
			email: lead?.email ?? null,
			phone: lead?.phone ?? null,
			leadId: params.leadId,
		},
		...coDebtorsList.map((cd) => ({
			role: "COFIRMANTE",
			nombre: cd.fullName,
			email: cd.email,
			phone: cd.phone,
			coDebtorId: cd.id,
		})),
		// El representante legal firma varios de estos contratos y hasta ahora sólo
		// se enteraba por el correo de WeeTrust. Va al final porque es interno, y
		// sin `leadId` ni `coDebtorId`: no es ninguno de los dos, y las dos
		// columnas admiten nulo.
		{
			role: "REP_LEGAL",
			nombre: REP_LEGAL_NOMBRE,
			email: REP_LEGAL_EMAIL,
			phone: REP_LEGAL_TELEFONO || null,
		},
	];

	// En modo de prueba los enlaces se emitieron contra los correos de prueba, no
	// contra los del cliente. Buscar por el correo real no calza con nada y nadie
	// recibe su link: le pasó al titular y al codeudor. El representante legal se
	// salvó porque su correo sale de una env y era el mismo de los dos lados.
	// Se aplica al arreglo completo y no persona por persona, porque el reparto
	// entre codeudores es posicional.
	const destinatarios = modoPrueba
		? aplicarCorreosDePrueba(destinatariosReales)
		: destinatariosReales;

	const [log] = await db
		.insert(whatsappLogs)
		.values({ opportunityId: params.opportunityId })
		.returning();

	const stClient = getSimpletechClient();

	let algunoEnviado = false;
	let motivoDelLead: string | undefined;

	// Contratos nuevos (tienen documento en el proveedor) que se quedaron sin
	// firmantes guardados: el guardado es best-effort y pudo fallar. No se
	// confunden con los viejos, y no se manda nada hasta revisarlos: si no, el
	// resto sale como "enviado" y ese contrato no lo recibe nadie.
	const sinFirmantesGuardados = contratosDeFirma.filter(
		(c) =>
			(c.weetrustDocumentId || c.signingProvider) && !conFirmantes.has(c.id),
	);

	for (const [indice, destinatario] of destinatarios.entries()) {
		// Los contratos de ESTA persona: aquellos donde tiene fila de firmante.
		// Los contratos viejos (sin firmantes guardados) NO se mandan: se
		// emitieron sin la verificación de identidad por rol de ahora, y su
		// columna `clientSigningLink` no dice de quién es cada link. Sólo salen
		// por WhatsApp los enlaces generados con el flujo nuevo.
		const susContratos = contratosDeFirma
			.filter((c) => {
				const clave = destinatario.email?.toLowerCase();
				return Boolean(clave && linksPorContrato.get(c.id)?.has(clave));
			})
			.map((c) => ({
				contractName: c.contractName,
				link:
					linksPorContrato
						.get(c.id)
						?.get(destinatario.email?.toLowerCase() as string) ?? null,
				pdfLink: pdfResueltos.get(c.id) ?? null,
			}));

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

		// Ya firmó todo lo suyo: no hay nada que mandarle ni que dejar pendiente.
		if (
			susContratos.length === 0 &&
			destinatario.email &&
			firmaronAlgo.has(destinatario.email.toLowerCase())
		) {
			continue;
		}

		let status: "sent" | "pending" | "failed" = "pending";
		let motivo: string | undefined;
		let enviadoEn: Date | undefined;

		// En modo prueba el teléfono del cliente no hace falta: igual no se usa.
		const telefonoDestino = modoPrueba
			? getTestPhone(indice)
			: destinatario.phone;

		if (!stClient) {
			motivo = "Servicio de mensajería no configurado";
		} else if (sinFirmantesGuardados.length > 0) {
			motivo = `No se guardaron los firmantes de: ${sinFirmantesGuardados.map((c) => c.contractName).join(", ")}. Hay que reemplazarlos desde jurídico antes de mandar.`;
		} else if (
			susContratos.length === 0 &&
			contratosDeFirma.every((c) => !conFirmantes.has(c.id))
		) {
			motivo =
				"Los contratos son anteriores a la firma por rol: hay que reemplazarlos desde jurídico para mandarlos";
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

			// El link del titular sale de sus firmantes. Los contratos viejos, sin
			// firmantes guardados, quedan sin link: no se mandan por WhatsApp.
			const contracts = await db
				.select({
					id: generatedLegalContracts.id,
					contractName: generatedLegalContracts.contractName,
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
						ne(generatedLegalContracts.status, "cancelled"),
					),
				);

			const mapped = contracts.map((c) => ({
				contractName: c.contractName,
				link: c.titularSigningUrl ?? null,
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
			// El más reciente. Una oportunidad junta varios envíos: cada vez que se
			// aprueba se crea un log nuevo. Sin ordenar, `logs[0]` devolvía una fila
			// cualquiera —en la práctica la más vieja—, así que la ficha mostraba
			// "pendientes de enviar" aunque el último envío hubiera salido completo.
			const logs = await db
				.select()
				.from(whatsappLogs)
				.where(eq(whatsappLogs.opportunityId, input.opportunityId))
				.orderBy(desc(whatsappLogs.createdAt))
				.limit(1);

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
