import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { coDebtors, leads, opportunities } from "../db/schema/crm";
import {
	contractSignatories,
	generatedLegalContracts,
} from "../db/schema/legal-contracts";
import {
	whatsappLogRecipients,
	whatsappLogs,
} from "../db/schema/whatsapp-logs";
import { auditRecord } from "../lib/audit";
import { conCandadoDeFirma } from "../lib/contratos-candado";
import { aplicarCorreosDePrueba } from "../lib/contratos-correos-prueba";
import {
	REP_LEGAL_EMAIL,
	REP_LEGAL_NOMBRE,
	REP_LEGAL_TELEFONO,
} from "../lib/contratos-rep-legal";
import { getTestPhone, isTestModeEnabled } from "../lib/messaging-test-mode";
import { crmProcedure } from "../lib/orpc";
import { PERMISSIONS } from "../lib/roles";
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
 * Los enlaces que le tocan HOY a una persona de una oportunidad.
 *
 * El reintento manual no puede confiar en los enlaces que trae la pantalla:
 * pueden ser de un contrato que ya se regeneró, o de otro firmante (pegado a
 * mano), y mandarle a alguien el enlace de otro lo deja firmando en su nombre.
 * Así que se resuelven acá, por rol y correo, igual que el envío automático.
 *
 * Quien ya firmó no aparece: su enlace es de un documento cerrado.
 */
async function enlacesDeLaPersona(
	opportunityId: string,
	recipient: { leadId: string | null; coDebtorId: string | null },
): Promise<{
	destinatario: DestinatarioDeFirma | null;
	contratos: { contractName: string; link: string | null }[];
}> {
	const [oportunidad] = await db
		.select({ leadId: opportunities.leadId })
		.from(opportunities)
		.where(eq(opportunities.id, opportunityId))
		.limit(1);

	const [lead] = oportunidad?.leadId
		? await db
				.select({
					id: leads.id,
					firstName: leads.firstName,
					lastName: leads.lastName,
					email: leads.email,
					phone: leads.phone,
				})
				.from(leads)
				.where(eq(leads.id, oportunidad.leadId))
				.limit(1)
		: [];

	// Mismo orden que al mandar: el reparto de correos de prueba es posicional.
	const coDebtorsList = await db
		.select({
			id: coDebtors.id,
			fullName: coDebtors.fullName,
			email: coDebtors.email,
			phone: coDebtors.phone,
		})
		.from(coDebtors)
		.where(eq(coDebtors.opportunityId, opportunityId))
		.orderBy(coDebtors.createdAt);

	const reales: DestinatarioDeFirma[] = [
		{
			role: "TITULAR",
			nombre: lead ? `${lead.firstName} ${lead.lastName}` : "Cliente",
			email: lead?.email ?? null,
			phone: lead?.phone ?? null,
			...(lead ? { leadId: lead.id } : {}),
		},
		...coDebtorsList.map((cd) => ({
			role: "COFIRMANTE",
			nombre: cd.fullName,
			email: cd.email,
			phone: cd.phone,
			coDebtorId: cd.id,
		})),
		{
			role: "REP_LEGAL",
			nombre: REP_LEGAL_NOMBRE,
			email: REP_LEGAL_EMAIL,
			phone: REP_LEGAL_TELEFONO || null,
		},
	];

	const lista = isTestModeEnabled() ? aplicarCorreosDePrueba(reales) : reales;

	const destinatario =
		lista.find((d) =>
			recipient.leadId
				? d.leadId === recipient.leadId
				: recipient.coDebtorId
					? d.coDebtorId === recipient.coDebtorId
					: d.role === "REP_LEGAL",
		) ?? null;

	if (!destinatario?.email) return { destinatario, contratos: [] };

	const filas = await db
		.select({
			contractName: generatedLegalContracts.contractName,
			link: contractSignatories.signingUrl,
		})
		.from(contractSignatories)
		.innerJoin(
			generatedLegalContracts,
			eq(contractSignatories.contractId, generatedLegalContracts.id),
		)
		.where(
			and(
				eq(generatedLegalContracts.opportunityId, opportunityId),
				ne(generatedLegalContracts.status, "cancelled"),
				isNull(generatedLegalContracts.replacedByContractId),
				eq(contractSignatories.role, destinatario.role),
				// WeeTrust puede devolver el correo en minúsculas.
				sql`lower(${contractSignatories.email}) = lower(${destinatario.email})`,
				ne(contractSignatories.status, "signed"),
			),
		)
		.orderBy(generatedLegalContracts.generatedAt);

	return { destinatario, contratos: filas };
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
	// Con el candado de la oportunidad tomado de punta a punta: entre armar los
	// mensajes y mandarlos hay varias llamadas a SimpleTech, y una regeneración
	// que entrara en ese rato borraba en WeeTrust los documentos de los enlaces
	// que se estaban mandando. Al cliente le llegaban links ya muertos.
	return conCandadoDeFirma(params.opportunityId, () =>
		enviarEnlacesDeFirma(params),
	);
}

/**
 * Topes del envío. Existen porque el candado dura lo que dura esta función y
 * Neon corta las transacciones inactivas a los 300s: si el envío se pasara de
 * ahí, el candado se soltaría solo mientras los mensajes siguen saliendo, y una
 * regeneración podría borrar en WeeTrust los documentos de esos enlaces.
 *
 * El tope por mensaje se le pasa al cliente de SimpleTech, que aborta la
 * petición: se espera el resultado, no se deja de esperarlo. Soltar el candado
 * con una petición todavía en vuelo es justo lo que no puede pasar.
 */
const LIMITE_POR_MENSAJE_MS = 30_000;
const LIMITE_DEL_ENVIO_MS = 120_000;

async function enviarEnlacesDeFirma(params: {
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
				// Un anulado (a mano o por reemplazo) no se manda: su documento en
				// WeeTrust puede seguir vivo y el cliente firmaría uno sin efecto.
				ne(generatedLegalContracts.status, "cancelled"),
				// Reclamado por un reemplazo que todavía no terminó de anularlo: ya
				// no es el vigente, aunque su estado aún no lo diga.
				isNull(generatedLegalContracts.replacedByContractId),
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
					role: contractSignatories.role,
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
	 * La llave es rol + correo, no sólo el correo: si el cliente y un codeudor
	 * compartieran correo, buscar por correo le daría al codeudor el enlace del
	 * titular.
	 */
	const claveDe = (role: string, email: string) =>
		`${role}|${email.toLowerCase()}`;

	/**
	 * contractId → (rol|email → link). El link puede ser null: la
	 * persona firma ese contrato pero WeeTrust no devolvió su enlace. Se guarda
	 * igual para que el contrato aparezca en el envío manual y se pueda pegar.
	 */
	const linksPorContrato = new Map<string, Map<string, string | null>>();
	/** Contratos con firmantes guardados, firmados o no. */
	const conFirmantes = new Set<string>();
	/** Firmantes (rol|email) con al menos un contrato firmado. */
	const firmaronAlgo = new Set<string>();
	for (const f of firmantes) {
		conFirmantes.add(f.contractId);
		// Quien ya firmó ese contrato no recibe su enlace otra vez: le llegaba un
		// link de un documento cerrado cada vez que se reenviaba por otro motivo.
		if (f.status === "signed") {
			firmaronAlgo.add(claveDe(f.role, f.email));
			continue;
		}
		const porEmail = linksPorContrato.get(f.contractId) ?? new Map();
		porEmail.set(claveDe(f.role, f.email), f.signingUrl ?? null);
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

	const stClient = getSimpletechClient();

	// Contratos nuevos (tienen documento en el proveedor) que se quedaron sin
	// firmantes guardados: el guardado es best-effort y pudo fallar. No se
	// confunden con los viejos, y no se manda nada hasta revisarlos: si no, el
	// resto sale como "enviado" y ese contrato no lo recibe nadie.
	const sinFirmantesGuardados = contratosDeFirma.filter(
		(c) =>
			(c.weetrustDocumentId || c.signingProvider) && !conFirmantes.has(c.id),
	);

	// Primero se decide qué le toca a cada uno, sin tocar la red.
	const planes: Array<{
		destinatario: DestinatarioDeFirma;
		susContratos: {
			contractName: string;
			link: string | null;
			pdfLink: string | null;
		}[];
		mensaje: string | null;
		telefonoDestino: string | null;
		/** Por qué no se le manda. Sin motivo, se le manda. */
		motivo?: string;
	}> = [];

	for (const [indice, destinatario] of destinatarios.entries()) {
		// Los contratos de ESTA persona: aquellos donde tiene fila de firmante.
		// Los contratos viejos (sin firmantes guardados) NO se mandan: se
		// emitieron sin la verificación de identidad por rol de ahora, y su
		// columna `clientSigningLink` no dice de quién es cada link. Sólo salen
		// por WhatsApp los enlaces generados con el flujo nuevo.
		const clave = destinatario.email
			? claveDe(destinatario.role, destinatario.email)
			: null;
		const susContratos = contratosDeFirma
			.filter((c) => Boolean(clave && linksPorContrato.get(c.id)?.has(clave)))
			.map((c) => ({
				contractName: c.contractName,
				link: linksPorContrato.get(c.id)?.get(clave as string) ?? null,
				pdfLink: pdfResueltos.get(c.id) ?? null,
			}));

		// Ya firmó todo lo suyo: no hay nada que mandarle ni que dejar pendiente.
		if (susContratos.length === 0 && clave && firmaronAlgo.has(clave)) {
			continue;
		}

		// El rep legal no firma todos los contratos (la cobertura, por ejemplo,
		// no lo lleva). Si no le toca ninguno, no se le deja una fila pendiente
		// que nadie puede cerrar.
		if (destinatario.role === "REP_LEGAL" && susContratos.length === 0) {
			continue;
		}

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

		// En modo prueba el teléfono del cliente no hace falta: igual no se usa.
		const telefonoDestino = modoPrueba
			? getTestPhone(indice)
			: destinatario.phone;

		let motivo: string | undefined;
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
		}

		planes.push({
			destinatario,
			susContratos,
			mensaje,
			telefonoDestino,
			motivo,
		});
	}

	// Todas las filas se guardan como pendientes ANTES de mandar nada. La
	// aprobación dispara esto sin esperarlo: si se fueran guardando a medida que
	// sale cada mensaje, la ficha podía leer el log a medio llenar y mostrar
	// "enviado" con codeudores que todavía no tenían fila.
	const filas = await db.transaction(async (tx) => {
		const [log] = await tx
			.insert(whatsappLogs)
			.values({ opportunityId: params.opportunityId })
			.returning();

		if (planes.length === 0) return [];

		return tx
			.insert(whatsappLogRecipients)
			.values(
				planes.map((p) => ({
					whatsappLogId: log.id,
					leadId: p.destinatario.leadId,
					coDebtorId: p.destinatario.coDebtorId,
					recipientName: p.destinatario.nombre,
					// El teléfono REAL, también en modo prueba. El envío manual arranca
					// con este número y lo guarda en el lead o el codeudor: si acá
					// quedara el de prueba, reintentar sin tocarlo le pisaba el teléfono
					// al cliente con uno nuestro. El desvío queda anotado en `reason`.
					phone: p.destinatario.phone,
					message: p.mensaje,
					contracts: p.susContratos,
					status: "pending" as const,
					reason: p.motivo,
				})),
			)
			.returning({ id: whatsappLogRecipients.id });
	});

	let algunoEnviado = false;
	let motivoDelLead: string | undefined;
	const finDelEnvio = Date.now() + LIMITE_DEL_ENVIO_MS;

	for (const [i, plan] of planes.entries()) {
		let motivo = plan.motivo;

		if (!motivo && plan.mensaje && plan.telefonoDestino) {
			// Se acabó el tiempo de toda la tanda: los que faltan se quedan
			// pendientes con el motivo a la vista, para mandarlos desde la ficha.
			// Seguir sería pasarse del corte de Postgres y soltar el candado con
			// los mensajes todavía saliendo.
			if (Date.now() >= finDelEnvio) {
				motivo =
					"No dio tiempo en este envío: quedó pendiente para mandarlo desde la ficha";
				await db
					.update(whatsappLogRecipients)
					.set({ reason: motivo, updatedAt: new Date() })
					.where(eq(whatsappLogRecipients.id, filas[i].id));
			} else {
				const resultado = await sendWhatsappTemplate({
					phone: plan.telefonoDestino,
					message: plan.mensaje,
					logPrefix: modoPrueba
						? "[SimpleTech][contratos][TEST]"
						: "[SimpleTech][contratos]",
					ocultarEnlacesEnLog: true,
					timeoutMs: LIMITE_POR_MENSAJE_MS,
				});

				const enviado = resultado.success;
				if (enviado) {
					algunoEnviado = true;
					// En modo prueba queda anotado a quién le habría llegado de verdad,
					// para que la fila no parezca un envío normal al cliente.
					motivo = modoPrueba
						? `TEST_MESSAGE: enviado a ${plan.telefonoDestino} en lugar de ${plan.destinatario.phone ?? "sin teléfono"}`
						: undefined;
				} else {
					// La petición se aborta desde acá: SimpleTech pudo haberla recibido
					// igual, así que el motivo lo dice en vez de invitar a reenviar.
					motivo = resultado.error?.startsWith("Timeout:")
						? `${resultado.error} (se canceló desde el CRM; puede haber llegado igual, revisá antes de reenviar)`
						: (resultado.error ?? "Error enviando el mensaje");
				}

				await db
					.update(whatsappLogRecipients)
					.set({
						status: enviado ? "sent" : "failed",
						reason: motivo ?? null,
						sentAt: enviado ? new Date() : undefined,
						updatedAt: new Date(),
					})
					.where(eq(whatsappLogRecipients.id, filas[i].id));
			}
		}

		if (plan.destinatario.leadId) motivoDelLead = motivo;
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
						isNull(generatedLegalContracts.replacedByContractId),
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
			}),
		)
		.handler(async ({ input, context }) => {
			// Le escribe al cliente con sus enlaces de firma, al teléfono que diga
			// quien llama: la misma regla que el reenvío desde la ficha. Si no,
			// ventas podía mandar los enlaces de otro a un número suyo.
			if (!PERMISSIONS.canResendContractLinks(context.userRole)) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tenés permiso para reenviar los enlaces de firma",
				});
			}

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

			// La oportunidad del envío: de ahí salen los enlaces vigentes.
			const [log] = await db
				.select({ opportunityId: whatsappLogs.opportunityId })
				.from(whatsappLogs)
				.where(eq(whatsappLogs.id, recipient.whatsappLogId))
				.limit(1);

			if (!log?.opportunityId) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Este envío no está asociado a una oportunidad: no se puede reintentar.",
				});
			}

			return conCandadoDeFirma(log.opportunityId, async () => {
				// Los enlaces se resuelven acá, no se toman de la pantalla: los que
				// ésta tiene pueden ser de un contrato ya regenerado, o de otro
				// firmante, y mandarle a alguien el enlace de otro lo deja firmando
				// en su nombre. Con el candado tomado, además, no se cuela una
				// regeneración entre resolverlos y mandarlos.
				const { destinatario, contratos } = await enlacesDeLaPersona(
					log.opportunityId,
					recipient,
				);

				if (!destinatario) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"No se pudo ubicar a esta persona en la oportunidad. Reenviá desde la ficha.",
					});
				}

				if (contratos.length === 0) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"Esta persona no tiene enlaces de firma pendientes: o ya firmó, o sus contratos se reemplazaron. Revisá la ficha.",
					});
				}

				const sinEnlace = contratos.filter((c) => !c.link);
				if (sinEnlace.length > 0) {
					throw new ORPCError("BAD_REQUEST", {
						message: `Falta el enlace de firma de: ${sinEnlace.map((c) => c.contractName).join(", ")}. Hay que regenerarlo antes de mandarlo.`,
					});
				}

				const message = buildContractLinksMessage(
					recipient.recipientName,
					contratos as ContractLink[],
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
					ocultarEnlacesEnLog: true,
				});
				const status: "sent" | "failed" = sendResult.success
					? "sent"
					: "failed";
				const reason: string | null = sendResult.success
					? null
					: (sendResult.error ?? "Error desconocido al enviar");

				const [updated] = await db
					.update(whatsappLogRecipients)
					.set({
						status,
						phone: input.phone,
						contracts: contratos,
						message,
						reason,
						sentAt: status === "sent" ? new Date() : undefined,
						updatedAt: new Date(),
					})
					.where(eq(whatsappLogRecipients.id, input.recipientId))
					.returning();

				return updated;
			});
		}),
};
