import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { investorContractBatches } from "../db/schema/investor-contracts";
import {
	contractSignatories,
	generatedLegalContracts,
} from "../db/schema/legal-contracts";
import {
	type NewNotification,
	notifications,
} from "../db/schema/notifications";
import { recalcularEstadoDeLaBateria } from "../lib/bateria-de-contratos";
import {
	alguienFirmo,
	filasDeFirmantes,
	linksPorRol,
} from "../lib/contract-signatories";
import { getSignatureMode } from "../lib/contract-signature-mode";
import { conMarcaDeBiometriaOmitida } from "../lib/contrato-biometria";
import {
	estadoEnWeeTrust,
	sincronizarEstadoDeFirma,
} from "../lib/contrato-estado-firma";
import { conMarcaDeSubidoAMano } from "../lib/contrato-subido-a-mano";
import {
	etiquetaDeMotivo,
	MOTIVOS_DE_ANULACION_KEYS,
} from "../lib/contratos-anulacion";
import { claveDeBateria, conCandadoDeBateria } from "../lib/contratos-candado";
import {
	aplicarCorreosDePrueba,
	correoRepetido,
	correosDePruebaFaltantes,
} from "../lib/contratos-correos-prueba";
import {
	contratosDeCategoria,
	esContratoDeInversion,
} from "../lib/contratos-inversiones";
import { CONTRATOS_OBSERVADORES } from "../lib/contratos-rep-legal";
import {
	keyDelPdfDelContrato,
	mandarContratosAlHilo,
} from "../lib/correo-contratos-inversion";
import { espejarEstadoDeFirmaEnCartera } from "../lib/espejo-contratos-inversionista";
import { firmantesDeContratoDeInversion } from "../lib/firmantes-inversionista";
import { isTestModeEnabled } from "../lib/messaging-test-mode";
import { createNotification } from "../lib/notificaciones";
import { juridicoProcedure, viewInvestorContractsProcedure } from "../lib/orpc";
import { PERMISSIONS, ROLES } from "../lib/roles";
import { getFileUrlWithBucketInKey } from "../lib/storage";
import {
	borrarDocumentoDeWeeTrust,
	consultarEstadoFirma,
	type DocumentResult,
	type EstadoDocumentoFirma,
	generateContractsBatch,
	getDocumentTypes,
	motivoDeFalla,
	reemitirContratoEnWeeTrust,
	reenviarCorreoDeFirma,
	reintentarBiometria,
	type SignerRole,
	subirContratoParaFirma,
} from "../services/legal-docs-api";

/**
 * Las baterías de contratos de inversionistas: el trabajo que le abre a
 * jurídico cada compra de cartera aceptada.
 *
 * La fila la crea cartera (`routes/cartera-compra-aceptada.ts`). Acá se lee y se
 * mueve de estado; los contratos en sí cuelgan de ella y viven en
 * `generated_legal_contracts`.
 */

/**
 * URL firmada del PDF de un contrato, o null si no se puede armar.
 *
 * Con el contrato ya firmado devuelve el **PDF firmado**, que es el que vale:
 * el de `pdfLink` es el borrador que se generó y no tiene ninguna firma. El
 * firmado se baja de WeeTrust una sola vez, al cerrarse la firma, y queda en
 * R2 como cualquier otro archivo nuestro.
 *
 * Hay contratos que guardaron en `pdfLink` una URL firmada (la que se muestra,
 * que vence) en vez de la key: con una URL entera como key, R2 no encuentra
 * nada. Para esos se recupera la key de la respuesta del generador.
 */
async function urlDelPdf(contrato: {
	pdfLink: string | null;
	signedPdfLink: string | null;
	apiResponse: unknown;
}): Promise<string | null> {
	const key = keyDelPdfDelContrato(contrato);
	if (!key) return null;

	try {
		return await getFileUrlWithBucketInKey(key);
	} catch (error) {
		console.error(`[listInvestorContracts] no se pudo firmar ${key}:`, error);
		return null;
	}
}

/** El nombre del inversionista, servible como nombre de archivo en R2. */
function prefijoDeArchivo(nombre: string): string {
	const limpio = nombre
		.normalize("NFD")
		// Sin tildes ni eñes: el nombre termina siendo una key de R2 y una URL.
		.replace(/[̀-ͯ]/g, "")
		.trim()
		.replace(/\s+/g, "_")
		.replace(/[^\w-]/g, "");
	return limpio.slice(0, 60) || "inversionista";
}

/**
 * La batería, siempre que todavía se le puedan emitir contratos.
 *
 * La cerrada no: se cierra cuando están firmados todos sus contratos, y a
 * partir de ahí la papelería está completa. La descartada tampoco: alguien dijo
 * que esa compra no llevaba papelería, y emitirle contratos sería desdecirlo
 * por la espalda.
 */
async function bateriaAbierta(batchId: string) {
	const [bateria] = await db
		.select()
		.from(investorContractBatches)
		.where(eq(investorContractBatches.id, batchId))
		.limit(1);

	if (!bateria) {
		throw new ORPCError("NOT_FOUND", {
			message: "Esa batería de contratos no existe",
		});
	}

	if (bateria.status === "descartada") {
		throw new ORPCError("BAD_REQUEST", {
			message:
				"Esta batería se descartó: si hay que hacer contratos, primero hay que decir por qué se descartó mal.",
		});
	}

	if (bateria.status === "completada") {
		throw new ORPCError("BAD_REQUEST", {
			message:
				"Esta batería está cerrada: todos sus contratos están firmados y ya no admite cambios.",
		});
	}

	return bateria;
}

/**
 * El contrato, siempre que sea de un inversionista y tenga documento en WeeTrust.
 *
 * Se corta acá y no más adelante para no dejar que un contrato de ventas entre
 * por las acciones de inversiones: los permisos son de otra gente.
 */
/**
 * Deja pendientes a los firmantes que WeeTrust ya no da por firmados.
 *
 * Pedir de nuevo la verificación facial **deshace la firma** de esa persona y
 * le da un enlace nuevo: el documento y las demás firmas quedan, pero ella
 * tiene que volver a entrar. El sincronizador no lo escribe porque nunca baja a
 * nadie de "firmado" —protege contra consultas y webhooks que llegan tarde— y
 * sin esto la ficha la seguía mostrando firmada, con el enlace viejo y sin nada
 * que hacer. Acá sí se sabe que se deshizo: es lo que se acaba de pedir.
 */
async function devolverAFirmar(
	contractId: string,
	estado: EstadoDocumentoFirma,
): Promise<void> {
	const ahora = new Date();

	for (const firmante of estado.signatories) {
		if (firmante.isSigned) continue;

		await db
			.update(contractSignatories)
			.set({
				status: "pending",
				signedAt: null,
				...(firmante.signingUrl ? { signingUrl: firmante.signingUrl } : {}),
				...(firmante.signatoryID
					? { weetrustSignatoryId: firmante.signatoryID }
					: {}),
				...(firmante.expiry
					? { signingUrlExpiry: new Date(firmante.expiry) }
					: {}),
				updatedAt: ahora,
			})
			.where(
				and(
					eq(contractSignatories.contractId, contractId),
					sql`lower(${contractSignatories.email}) = lower(${firmante.emailID})`,
				),
			);
	}
}

async function contratoDeInversionista(contractId: string): Promise<{
	contrato: typeof generatedLegalContracts.$inferSelect;
	documentID: string;
}> {
	const [contrato] = await db
		.select()
		.from(generatedLegalContracts)
		.where(eq(generatedLegalContracts.id, contractId))
		.limit(1);

	if (!contrato) {
		throw new ORPCError("NOT_FOUND", { message: "Contrato no encontrado" });
	}

	if (!contrato.investorId) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Ese contrato no es de un inversionista.",
		});
	}

	if (!contrato.weetrustDocumentId) {
		throw new ORPCError("BAD_REQUEST", {
			message:
				"Este contrato no tiene documento en WeeTrust. Hay que emitirlo de nuevo.",
		});
	}

	return { contrato, documentID: contrato.weetrustDocumentId };
}

/**
 * Guarda un contrato recién emitido con sus firmantes, o falla sin dejar rastro.
 *
 * Todo en una transacción con un candado por batería y tipo: dos pedidos del
 * mismo contrato a la vez (doble clic, reintento) pasaban los dos el control de
 * "ya hay uno vigente" —no hay fila que bloquear todavía— y quedaban dos
 * documentos activos. El segundo espera acá y, al volver a mirar, ve el del
 * primero.
 *
 * Los firmantes van adentro y no best-effort: sin ellos no se pueden renovar ni
 * reenviar los enlaces, así que ese contrato no sirve y es mejor deshacerlo que
 * dejarlo a medias.
 */
async function guardarContratoDeInversion(params: {
	batchId: string;
	investorId: number;
	contractType: string;
	contractName: string;
	resultado: DocumentResult;
	userId: string;
	/** Lo armó una persona por fuera, no la plantilla. */
	subidoAMano?: boolean;
	/**
	 * El contrato al que reemplaza, con el motivo por el que se anula.
	 *
	 * Va en la misma transacción que el nuevo: si dos personas reemplazan el
	 * mismo contrato a la vez, la segunda espera el bloqueo, ve que ya fue
	 * reclamado y pierde. Su documento se borra en WeeTrust.
	 */
	reemplaza?: { contractId: string; motivo: string };
}): Promise<string> {
	const { resultado } = params;
	const firmantes = resultado.signatories ?? [];

	if (firmantes.length === 0) {
		throw new Error(
			"El generador no devolvió firmantes: sin ellos no se pueden renovar ni reenviar los enlaces",
		);
	}

	return db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext(${`contrato-inversion:${params.batchId}:${params.contractType}`}::text))`,
		);
		// Y el de la batería, el mismo que toma el descarte: la batería se miró
		// abierta antes de generar, pero en ese rato pudo descartarse, y un
		// contrato vivo colgado de una descartada no vuelve a ninguna lista.
		await tx.execute(
			sql`select pg_advisory_xact_lock(${claveDeBateria(params.batchId)})`,
		);
		const [bateria] = await tx
			.select({
				status: investorContractBatches.status,
				acceptedAt: investorContractBatches.acceptedAt,
			})
			.from(investorContractBatches)
			.where(eq(investorContractBatches.id, params.batchId))
			.limit(1);
		// Tampoco una que se completó en ese rato (se firmaron todos los que
		// tenía): una cerrada no admite cambios, y guardar éste la reabría con
		// un contrato nuevo que nadie pidió sobre una batería ya terminada.
		if (bateria?.status === "descartada" || bateria?.status === "completada") {
			throw new ORPCError("CONFLICT", {
				message:
					bateria.status === "descartada"
						? "La batería se descartó mientras se generaba el contrato: no se guardó."
						: "La batería se completó mientras se generaba el contrato: no se guardó.",
			});
		}

		// Guardar dos veces el mismo documento (reintento, doble clic) no inserta
		// otra fila: se devuelve la que ya lo registra.
		if (resultado.documentID) {
			const [existente] = await tx
				.select({ id: generatedLegalContracts.id })
				.from(generatedLegalContracts)
				.where(
					eq(generatedLegalContracts.weetrustDocumentId, resultado.documentID),
				)
				.limit(1);
			if (existente) return existente.id;
		}

		// Uno vigente por tipo en ESTA compra: los de una compra anterior sobre
		// los mismos créditos siguen en la batería, firmados, y no cuentan.
		const [otroVigente] = await tx
			.select({ id: generatedLegalContracts.id })
			.from(generatedLegalContracts)
			.where(
				and(
					eq(generatedLegalContracts.batchId, params.batchId),
					eq(generatedLegalContracts.contractType, params.contractType),
					ne(generatedLegalContracts.status, "cancelled"),
					...(bateria
						? [gte(generatedLegalContracts.generatedAt, bateria.acceptedAt)]
						: []),
					...(params.reemplaza
						? [ne(generatedLegalContracts.id, params.reemplaza.contractId)]
						: []),
				),
			)
			.limit(1);
		if (otroVigente) {
			throw new Error(
				"Otro pedido emitió este mismo contrato mientras se generaba",
			);
		}

		// Se reclama el viejo ANTES de insertar el nuevo: bloquea la fila, y si
		// otra persona ya lo reemplazó, ésta pierde acá y no llega a guardar nada.
		if (params.reemplaza) {
			const [original] = await tx
				.select({
					status: generatedLegalContracts.status,
					reemplazadoPor: generatedLegalContracts.replacedByContractId,
				})
				.from(generatedLegalContracts)
				.where(eq(generatedLegalContracts.id, params.reemplaza.contractId))
				.for("update")
				.limit(1);

			if (
				!original ||
				original.status === "cancelled" ||
				original.reemplazadoPor
			) {
				throw new ORPCError("CONFLICT", {
					message:
						"Otra persona acaba de reemplazar este contrato. Recargá para ver el nuevo.",
				});
			}
		}

		const [guardado] = await tx
			.insert(generatedLegalContracts)
			.values({
				investorId: params.investorId,
				batchId: params.batchId,
				contractType: params.contractType,
				contractName: params.contractName,
				...linksPorRol(firmantes, resultado.signing_links),
				signingProvider: resultado.signingProvider ?? null,
				weetrustDocumentId: resultado.documentID ?? null,
				observerUrl: resultado.observerUrl ?? null,
				signatureMode: getSignatureMode(params.contractType),
				templateId: resultado.templateId,
				// Con la marca, la ficha pide mirar dónde quedaron las firmas: el
				// documento lo armó una persona y puede traer las líneas en otro lado
				// que la plantilla.
				apiResponse: params.subidoAMano
					? conMarcaDeSubidoAMano(resultado)
					: resultado,
				// La key de R2, no la URL firmada que se muestra: esa vence en una
				// hora, y con ella no se puede volver a emitir el documento.
				pdfLink: resultado.r2Key || resultado.linkDocument || null,
				status: "pending",
				generatedBy: params.userId,
				generatedAt: new Date(),
			})
			.returning({ id: generatedLegalContracts.id });

		if (!guardado) throw new Error("No se pudo guardar el contrato");

		await tx
			.insert(contractSignatories)
			.values(filasDeFirmantes(guardado.id, firmantes));

		if (params.reemplaza) {
			await tx
				.update(generatedLegalContracts)
				.set({
					status: "cancelled",
					cancellationReason: `Reemplazado: ${params.reemplaza.motivo}`,
					cancelledAt: new Date(),
					replacedByContractId: guardado.id,
					updatedAt: new Date(),
				})
				.where(eq(generatedLegalContracts.id, params.reemplaza.contractId));
		}

		return guardado.id;
	});
}

/**
 * Borra en WeeTrust el documento del contrato que se acaba de anular.
 *
 * Va después de guardar el nuevo y fuera de la transacción: si se borrara
 * antes y el guardado fallara, la batería se quedaba sin ninguno de los dos.
 *
 * Lo que diga WeeTrust antes de borrar es una foto —alguien puede firmar entre
 * la consulta y el borrado—, así que la fila se conserva siempre y lo que
 * cambia es el detalle que queda escrito en el motivo.
 */
async function borrarElViejoEnWeeTrust(params: {
	contractId: string;
	status: string | null;
	weetrustDocumentId: string | null;
	/** El motivo ya armado, al que se le agrega cómo quedó allá. */
	razon: string;
	origen: string;
}): Promise<void> {
	if (params.status === "signed" || !params.weetrustDocumentId) return;

	const conFirmasParciales =
		(await alguienFirmo(params.contractId)) ||
		((await estadoEnWeeTrust(params.weetrustDocumentId))?.conFirmas ?? true);

	let detalle: string;
	try {
		await borrarDocumentoDeWeeTrust(params.weetrustDocumentId);
		detalle = conFirmasParciales
			? "tenía firmas parciales; el documento se borró en WeeTrust"
			: "el documento se borró en WeeTrust";
	} catch (error) {
		console.error(
			`[${params.origen}] no se pudo borrar ${params.weetrustDocumentId}:`,
			error,
		);
		detalle = "no se pudo borrar en WeeTrust: hay que borrarlo a mano";
	}

	await db
		.update(generatedLegalContracts)
		.set({ cancellationReason: `${params.razon} (${detalle})` })
		.where(eq(generatedLegalContracts.id, params.contractId));
}

const ESTADOS = [
	"pendiente",
	"en_proceso",
	"completada",
	"descartada",
] as const;

/** Estados en los que la batería todavía es trabajo por hacer. */
const ABIERTAS = ["pendiente", "en_proceso"] as const;

/**
 * A quiénes les toca el trabajo cuando jurídico termina.
 *
 * Son los mismos que pueden ver los contratos del inversionista: el asesor que
 * lo atiende le pasa los enlaces, y la gerencia mira cómo va.
 */
const ROLES_DE_INVERSIONES = [
	ROLES.INVESTMENT_ADVISOR_JR,
	ROLES.INVESTMENT_ADVISOR_SR,
	ROLES.INVESTMENT_MANAGER,
] as const;

/**
 * Le avisa a inversiones que la batería ya tiene contratos en firma.
 *
 * Sale con el "Listo" de jurídico, junto con el correo al hilo de la compra: el
 * correo llega a todos, y esto le deja la tarea en el CRM a quien le da
 * seguimiento. Lo que se agregue después aparece en la misma ficha, así que se
 * avisa una sola vez por batería.
 *
 * Una notificación por rol de inversiones: la columna guarda un solo rol, y el
 * aviso le sirve tanto a quien atiende al inversionista como a su gerencia.
 * Mirar si ya se avisó y avisar van en una transacción con un candado por
 * batería: dos emisiones a la vez veían las dos que no había aviso y mandaban
 * el doble.
 *
 * Best-effort: el contrato ya quedó emitido, y un aviso que no sale no lo
 * deshace.
 */
async function avisarAInversiones(
	batchId: string,
	quien: Pick<NewNotification, "createdBy" | "createdByRole">,
): Promise<void> {
	try {
		const [bateria] = await db
			.select()
			.from(investorContractBatches)
			.where(eq(investorContractBatches.id, batchId))
			.limit(1);

		if (!bateria) return;

		const monto = Number(bateria.montoTotal).toLocaleString("es-GT", {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		});

		await db.transaction(async (tx) => {
			await tx.execute(
				sql`select pg_advisory_xact_lock(hashtext(${`bateria-aviso:${batchId}`}::text))`,
			);

			const [yaAvisado] = await tx
				.select({ id: notifications.id })
				.from(notifications)
				.where(
					and(
						eq(notifications.relatedEntityId, batchId),
						eq(notifications.relatedEntityType, "contract"),
						inArray(notifications.assignedToRole, ROLES_DE_INVERSIONES),
					),
				)
				.limit(1);

			if (yaAvisado) return;

			for (const rol of ROLES_DE_INVERSIONES) {
				await createNotification(
					{
						titulo: `Contratos en firma: ${bateria.investorName}`,
						descripcion:
							`Jurídico emitió los contratos de la compra de Q${monto}. ` +
							"Los enlaces de firma están en la ficha del inversionista, y lo que se agregue después aparece ahí también.",
						type: "aviso",
						...quien,
						assignedToRole: rol,
						relatedEntityType: "contract",
						relatedEntityId: batchId,
					},
					tx,
				);
			}
		});
	} catch (error) {
		console.error(
			`[avisarAInversiones] no se pudo avisar la batería ${batchId}:`,
			error,
		);
	}
}

/**
 * Lo que se emite o se sube después del "Listo" va solo al hilo de la compra.
 *
 * Antes del Listo no: jurídico todavía está armando —mira los PDF, reemplaza,
 * sube— y el Listo manda todo junto. Después, un contrato que se agrega o se
 * reemplaza es algo que la gente del hilo tiene que saber, con su PDF y sus
 * enlaces; y si reemplaza a otro, que los enlaces de aquél ya no sirven.
 *
 * Best-effort: el contrato ya quedó emitido. Si el correo no sale se devuelve
 * el motivo, para que la pantalla lo diga, pero no se deshace nada.
 */
async function mandarAlHiloSiYaSeMando(
	batchId: string,
	nuevos: Array<{ id: string; reemplazo: boolean }>,
): Promise<{ enviado: boolean; enHilo: boolean; error?: string } | null> {
	// Con el candado de la batería, como el "Listo": si éste está mandando y
	// falla, devuelve la batería a pendiente; un agregado que saliera en ese
	// rato quedaba en el hilo y el reintento del "Listo" lo mandaba otra vez.
	return conCandadoDeBateria(batchId, async () => {
		const [bateria] = await db
			.select({ status: investorContractBatches.status })
			.from(investorContractBatches)
			.where(eq(investorContractBatches.id, batchId))
			.limit(1);

		if (bateria?.status !== "en_proceso") return null;

		try {
			const reemplazos = nuevos.filter((n) => n.reemplazo).map((n) => n.id);
			const agregados = nuevos.filter((n) => !n.reemplazo).map((n) => n.id);
			let resultado: Awaited<ReturnType<typeof mandarContratosAlHilo>> | null =
				null;

			// Un correo por qué pasó: "se reemplazó" y "se agregó" dicen cosas
			// distintas sobre los enlaces que ya estaban en el hilo.
			if (reemplazos.length > 0) {
				resultado = await mandarContratosAlHilo({
					batchId,
					contractIds: reemplazos,
					motivo: { tipo: "reemplazo" },
				});
			}
			if (agregados.length > 0) {
				const deAgregados = await mandarContratosAlHilo({
					batchId,
					contractIds: agregados,
					motivo: { tipo: "agregado" },
				});
				if (!resultado || resultado.enviado) resultado = deAgregados;
			}
			return resultado;
		} catch (error) {
			console.error(
				`[mandarAlHiloSiYaSeMando] no se pudo mandar lo nuevo de ${batchId}:`,
				error,
			);
			return {
				enviado: false,
				enHilo: false,
				error: error instanceof Error ? error.message : "No se pudo mandar",
			};
		}
	});
}

export const investorContractsRouter = {
	listInvestorContractBatches: juridicoProcedure
		.input(
			z.object({
				/** Sin esto se devuelven sólo las que siguen abiertas. */
				status: z.array(z.enum(ESTADOS)).optional(),
				investorId: z.number().int().positive().optional(),
				limit: z.number().int().min(1).max(200).default(50),
			}),
		)
		.handler(async ({ input }) => {
			const estados = input.status?.length ? input.status : [...ABIERTAS];

			const filas = await db
				.select()
				.from(investorContractBatches)
				.where(
					and(
						inArray(investorContractBatches.status, estados),
						...(input.investorId
							? [eq(investorContractBatches.investorId, input.investorId)]
							: []),
					),
				)
				// Las abiertas primero, las más viejas arriba: son las que llevan más
				// tiempo esperando. Después las cerradas, las más recientes arriba. Con
				// todo mezclado y por fecha, al juntarse historial el tope dejaba
				// afuera justo el trabajo nuevo.
				.orderBy(
					sql`case when ${investorContractBatches.status} in ('pendiente', 'en_proceso') then 0 else 1 end`,
					sql`case when ${investorContractBatches.status} in ('pendiente', 'en_proceso') then ${investorContractBatches.acceptedAt} end asc`,
					desc(investorContractBatches.acceptedAt),
				)
				.limit(input.limit);

			return filas;
		}),

	getInvestorContractBatch: juridicoProcedure
		.input(z.object({ batchId: z.string().uuid() }))
		.handler(async ({ input }) => {
			const [fila] = await db
				.select()
				.from(investorContractBatches)
				.where(eq(investorContractBatches.id, input.batchId))
				.limit(1);

			if (!fila) {
				throw new ORPCError("NOT_FOUND", {
					message: "Esa batería de contratos no existe",
				});
			}

			return fila;
		}),

	/**
	 * Últimas baterías de un inversionista, abiertas o no.
	 *
	 * La ficha del inversionista la usa para mostrar de qué compra salió cada
	 * contrato.
	 */
	listInvestorContractBatchesByInvestor: juridicoProcedure
		.input(
			z.object({
				investorId: z.number().int().positive(),
				limit: z.number().int().min(1).max(50).default(10),
			}),
		)
		.handler(async ({ input }) => {
			return db
				.select()
				.from(investorContractBatches)
				.where(eq(investorContractBatches.investorId, input.investorId))
				.orderBy(desc(investorContractBatches.acceptedAt))
				.limit(input.limit);
		}),

	/**
	 * Jurídico toma la batería.
	 *
	 * Deja dicho quién la está trabajando, para que dos personas no emitan los
	 * mismos contratos en paralelo. No bloquea: avisa.
	 */
	startInvestorContractBatch: juridicoProcedure
		.input(z.object({ batchId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			// Sólo anota quién la tomó. `en_proceso` quiere decir que ya salió al
			// hilo de la compra (lo pone el "Listo"): pasarla ahí al tomarla hacía
			// que lo que se emitiera después saliera solo, a medio revisar, y que
			// el "Listo" ya no se pudiera dar.
			const [actualizada] = await db
				.update(investorContractBatches)
				.set({
					startedAt: new Date(),
					startedBy: context.session.user.id,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(investorContractBatches.id, input.batchId),
						// Sólo desde pendiente: volver a "en_proceso" una completada
						// reabriría trabajo que alguien ya dio por terminado.
						eq(investorContractBatches.status, "pendiente"),
					),
				)
				.returning();

			if (!actualizada) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Esa batería ya fue tomada, completada o descartada. Recargá la pantalla.",
				});
			}

			return actualizada;
		}),

	/**
	 * Descarta la batería: la compra que no lleva papelería.
	 *
	 * Es la única forma de cerrarla a mano. Completada no: una batería se cierra
	 * cuando se firman todos sus contratos, y dejar cerrarla antes sacaba de la
	 * lista de jurídico baterías con firmas trabadas.
	 *
	 * Descartar exige motivo escrito. Una batería que desaparece sin explicación
	 * no se distingue de una que se olvidó.
	 */
	closeInvestorContractBatch: juridicoProcedure
		.input(
			z.object({
				batchId: z.string().uuid(),
				resultado: z.literal("descartada"),
				motivo: z.string().trim().min(3).optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			if (!input.motivo) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Hay que decir por qué se descarta la batería.",
				});
			}

			// Con el candado de la batería, el mismo que toma el guardado de un
			// contrato: si no, uno que terminaba de guardarse después de esta
			// revisión quedaba vivo en una batería descartada.
			return conCandadoDeBateria(input.batchId, async () => {
				// Descartar es para la compra que NO lleva papelería. Con contratos ya
				// emitidos deja de ser cierto: sus documentos siguen vivos en WeeTrust
				// pidiendo firma, y la batería descartada ni se recalcula ni vuelve a
				// la lista, así que nadie se acuerda de ellos. Se anulan primero.
				const [vigente] = await db
					.select({ contractName: generatedLegalContracts.contractName })
					.from(generatedLegalContracts)
					.where(
						and(
							eq(generatedLegalContracts.batchId, input.batchId),
							ne(generatedLegalContracts.status, "cancelled"),
						),
					)
					.limit(1);

				if (vigente) {
					throw new ORPCError("BAD_REQUEST", {
						message: `Esta batería ya tiene contratos emitidos («${vigente.contractName}»). Anulalos antes de descartarla.`,
					});
				}

				const ahora = new Date();
				const [actualizada] = await db
					.update(investorContractBatches)
					.set({
						status: "descartada",
						discardedAt: ahora,
						discardedBy: context.session.user.id,
						discardReason: input.motivo,
						updatedAt: ahora,
					})
					.where(
						and(
							eq(investorContractBatches.id, input.batchId),
							inArray(investorContractBatches.status, [...ABIERTAS]),
						),
					)
					.returning();

				if (!actualizada) {
					throw new ORPCError("BAD_REQUEST", {
						message: "Esa batería ya estaba cerrada. Recargá la pantalla.",
					});
				}

				return actualizada;
			});
		}),

	/**
	 * Los contratos de inversión que se pueden emitir, por categoría.
	 *
	 * El catálogo del generador sólo devuelve los de inversiones si se le pide
	 * la categoría: sin ella contesta los de ventas, que no son estos. Y de los
	 * que devuelve se dejan sólo los que tienen layout de firmas auditado,
	 * porque los demás repartirían las firmas por orden de llegada.
	 */
	getInvestmentContractTypes: juridicoProcedure
		.input(z.object({ categoria: z.enum(["individual", "sociedad"]) }))
		.handler(async ({ input }) => {
			const catalogo = await getDocumentTypes(
				input.categoria === "sociedad" ? "inversiones_sociedad" : "inversiones",
			);

			const conLayout = new Set(
				contratosDeCategoria(input.categoria).map((c) => c.tipo),
			);

			return {
				success: true,
				data: (catalogo.data ?? []).filter((tipo) => conLayout.has(tipo.enum)),
			};
		}),

	/**
	 * Emite los contratos que jurídico eligió para una batería.
	 *
	 * Genera y guarda en el mismo pedido, a diferencia de ventas, donde el wizard
	 * genera primero y enlaza después. Acá no hay paso intermedio que aprobar, y
	 * separarlos abría la ventana en la que un documento ya existe en WeeTrust
	 * —con sus invitaciones mandadas— sin fila que lo registre.
	 *
	 * Los firmantes NO vienen del navegador: se arman acá con los datos de la
	 * batería y los representantes de la casa. Si vinieran de afuera, cualquiera
	 * podría mandar su correo con rol de representante y quedarse con el enlace de
	 * firma de la entidad.
	 */
	generateInvestorContracts: juridicoProcedure
		.input(
			z.object({
				batchId: z.string().uuid(),
				contracts: z
					.array(
						z.object({
							contractType: z.string().min(1),
							contractName: z.string().min(1),
							/** Campos del template, tal como los llenó jurídico. */
							data: z.record(z.string(), z.unknown()),
							gender: z.enum(["male", "female"]),
						}),
					)
					.min(1)
					.max(20),
			}),
		)
		.handler(async ({ input, context }) => {
			const bateria = await bateriaAbierta(input.batchId);

			const tipos = input.contracts.map((c) => c.contractType);

			const sinLayout = tipos.filter((tipo) => !esContratoDeInversion(tipo));
			if (sinLayout.length > 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Estos contratos no son de inversiones o no tienen layout de firmas auditado: ${sinLayout.join(", ")}.`,
				});
			}

			if (new Set(tipos).size !== tipos.length) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Hay un contrato repetido en el pedido.",
				});
			}

			// Volver a emitir un tipo que la batería ya tiene lo REEMPLAZA: el nuevo
			// ocupa su lugar y el viejo se anula y se borra en WeeTrust. Es lo que
			// jurídico quiere decir cuando lo genera de nuevo —el anterior salió con
			// un error—, y dejar los dos vivos le mandaría al inversionista dos
			// enlaces del mismo contrato para que firme el que no es.
			//
			// Sólo los de ESTA compra. Otra compra sobre los mismos créditos reusa
			// la batería con los contratos de la anterior adentro, ya firmados: ésos
			// son otro acuerdo, y la compra nueva lleva los suyos al lado, no en su
			// lugar.
			const yaVigentes = await db
				.select({
					id: generatedLegalContracts.id,
					contractType: generatedLegalContracts.contractType,
					status: generatedLegalContracts.status,
					weetrustDocumentId: generatedLegalContracts.weetrustDocumentId,
				})
				.from(generatedLegalContracts)
				.where(
					and(
						eq(generatedLegalContracts.batchId, input.batchId),
						ne(generatedLegalContracts.status, "cancelled"),
						inArray(generatedLegalContracts.contractType, tipos),
						gte(generatedLegalContracts.generatedAt, bateria.acceptedAt),
					),
				);

			const vigentePorTipo = new Map(
				yaVigentes.map((contrato) => [contrato.contractType, contrato]),
			);

			// Puede cortar: sin correo del inversionista, con correos repetidos, o
			// en modo prueba sin las envs. Se hace antes de generar nada.
			const aGenerar = input.contracts.map((contrato) => ({
				contractType: contrato.contractType,
				data: contrato.data,
				signers: firmantesDeContratoDeInversion(contrato.contractType, {
					nombre: bateria.investorName,
					email: bateria.investorEmail,
				}),
				observers: CONTRATOS_OBSERVADORES,
				options: {
					gender: contrato.gender,
					generatePdf: true,
					filenamePrefix: prefijoDeArchivo(bateria.investorName),
					// Lo que lee el inversionista en WeeTrust y en el correo: su
					// nombre y qué está firmando. Sin esto, el generador cae al nombre
					// de archivo, que lleva el tipo de contrato y un timestamp.
					documentName: bateria.investorName,
				},
			}));

			const respuesta = await generateContractsBatch({ contracts: aGenerar });

			// El mismo formato que devuelve la generación de ventas: la pantalla de
			// resultados es la misma para las dos áreas.
			const results: Array<{
				contractType: string;
				contractName: string;
				success: boolean;
				contractId?: string;
				documentLink?: string;
				signingLinks?: string[];
				// Con su forma: la pantalla de resultados los rotula por rol.
				signatories?: DocumentResult["signatories"];
				error?: string;
			}> = [];
			const emitidos: Array<{
				id: string;
				contractType: string;
				reemplazo: boolean;
			}> = [];

			for (let i = 0; i < input.contracts.length; i++) {
				const pedido = input.contracts[i];
				const resultado = respuesta.results?.[i];

				if (!resultado) {
					results.push({
						contractType: pedido.contractType,
						contractName: pedido.contractName,
						success: false,
						error: "El generador no devolvió resultado para este contrato",
					});
					continue;
				}

				const falla = motivoDeFalla(resultado);
				if (falla) {
					results.push({
						contractType: pedido.contractType,
						contractName: pedido.contractName,
						success: false,
						error: falla,
					});
					continue;
				}

				try {
					const reemplazado = vigentePorTipo.get(pedido.contractType);

					const id = await guardarContratoDeInversion({
						batchId: input.batchId,
						investorId: bateria.investorId,
						contractType: pedido.contractType,
						contractName: pedido.contractName,
						resultado,
						userId: context.userId,
						...(reemplazado
							? {
									reemplaza: {
										contractId: reemplazado.id,
										motivo: "se volvió a emitir desde jurídico",
									},
								}
							: {}),
					});

					// El documento viejo, ya con su fila anulada: se borra allá para
					// que sus enlaces no sigan firmando, y la papelería del
					// inversionista deja de ofrecerlos.
					if (reemplazado) {
						await borrarElViejoEnWeeTrust({
							contractId: reemplazado.id,
							status: reemplazado.status,
							weetrustDocumentId: reemplazado.weetrustDocumentId,
							razon: "Reemplazado: se volvió a emitir desde jurídico",
							origen: "generateInvestorContracts",
						});
						void espejarEstadoDeFirmaEnCartera(reemplazado.id);
					}
					emitidos.push({
						id,
						contractType: pedido.contractType,
						reemplazo: Boolean(reemplazado),
					});
					results.push({
						contractType: pedido.contractType,
						contractName: pedido.contractName,
						success: true,
						contractId: id,
						// URL firmada para poder abrir el PDF desde la pantalla. Vence en
						// una hora; lo que queda guardado es la key.
						documentLink: resultado.r2Key
							? await getFileUrlWithBucketInKey(resultado.r2Key)
							: resultado.linkDocument,
						signingLinks: resultado.signing_links,
						signatories: resultado.signatories,
					});
				} catch (error) {
					// El documento ya salió a WeeTrust con sus invitaciones: se borra
					// allá para que un reintento no deje dos vivos del mismo contrato.
					if (resultado.documentID) {
						await borrarDocumentoDeWeeTrust(resultado.documentID).catch((e) =>
							console.error(
								`[generateInvestorContracts] no se pudo borrar ${resultado.documentID}:`,
								e,
							),
						);
					}
					results.push({
						contractType: pedido.contractType,
						contractName: pedido.contractName,
						success: false,
						error:
							error instanceof Error
								? error.message
								: "No se pudo guardar el contrato",
					});
				}
			}

			// Antes del "Listo" jurídico está armando y no sale nada. Después, lo
			// que emite va solo al hilo de la compra.
			let correo: Awaited<ReturnType<typeof mandarAlHiloSiYaSeMando>> = null;
			if (emitidos.length > 0) {
				await recalcularEstadoDeLaBateria(input.batchId, context.userId);
				correo = await mandarAlHiloSiYaSeMando(input.batchId, emitidos);
			}

			const successCount = results.filter((r) => r.success).length;

			return {
				success: successCount === results.length,
				totalRequested: input.contracts.length,
				successCount,
				failCount: results.length - successCount,
				results,
				correo,
			};
		}),

	/**
	 * Sube un contrato de inversión que jurídico armó por fuera y lo manda a
	 * firmar.
	 *
	 * Termina igual que el generado: enlaces por rol, fila en el CRM y copia en
	 * la papelería del inversionista. Lo único que cambia es de dónde sale el
	 * PDF, y que queda marcado como subido a mano para que la ficha pida mirar
	 * dónde quedaron las firmas: el documento lo armó una persona y puede traer
	 * las líneas en otro lugar que la plantilla.
	 *
	 * El tipo tiene que ser uno de inversión con layout auditado. El generador
	 * ubica las líneas de firma por ese layout, así que el PDF tiene que ser de
	 * verdad ese contrato; si no las encuentra, no manda nada a firmar.
	 *
	 * Los firmantes NO vienen del navegador, igual que al generar: se arman acá
	 * con los datos de la batería y los representantes de la casa.
	 */
	uploadInvestorContract: juridicoProcedure
		.input(
			z.object({
				batchId: z.string().uuid(),
				contractType: z.string().min(1),
				contractName: z.string().min(1),
				filename: z.string().min(1),
				/** PDF en base64, sin el prefijo `data:`. */
				pdfBase64: z.string().min(1),
				/**
				 * Contrato al que reemplaza. Es para corregir uno ya emitido: el
				 * nuevo ocupa su lugar y el viejo se anula y se borra en WeeTrust.
				 */
				replaceContractId: z.string().uuid().optional(),
				/** Por qué se anula el que se reemplaza. Obligatorio si hay reemplazo. */
				motivo: z.enum(MOTIVOS_DE_ANULACION_KEYS).optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			if (input.replaceContractId && !input.motivo) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Hay que decir por qué se anula el contrato anterior.",
				});
			}

			const bateria = await bateriaAbierta(input.batchId);

			if (!esContratoDeInversion(input.contractType)) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Ese tipo no es de inversiones o no tiene layout de firmas auditado.",
				});
			}

			// ~15 MB de PDF. Un contrato pesa bastante menos; lo que pasa de ahí es
			// un escaneo sin comprimir y conviene frenarlo antes de pasearlo.
			const bytes = Math.floor((input.pdfBase64.length * 3) / 4);
			if (bytes > 15 * 1024 * 1024) {
				throw new ORPCError("BAD_REQUEST", {
					message: "El PDF pesa más de 15 MB. Comprimilo antes de subirlo.",
				});
			}

			// El que se reemplaza tiene que ser de esta batería, de esta compra y
			// del mismo tipo: cambiar un contrato por otro de distinto tipo no es
			// reemplazar, es subir uno nuevo, y dejaría a la batería sin el que se
			// anuló. Y uno de una compra anterior sobre los mismos créditos es otro
			// acuerdo, casi siempre ya firmado: no se anula desde la compra nueva.
			let reemplazado:
				| {
						id: string;
						status: string | null;
						weetrustDocumentId: string | null;
				  }
				| undefined;

			if (input.replaceContractId) {
				[reemplazado] = await db
					.select({
						id: generatedLegalContracts.id,
						status: generatedLegalContracts.status,
						weetrustDocumentId: generatedLegalContracts.weetrustDocumentId,
					})
					.from(generatedLegalContracts)
					.where(
						and(
							eq(generatedLegalContracts.id, input.replaceContractId),
							eq(generatedLegalContracts.batchId, input.batchId),
							eq(generatedLegalContracts.contractType, input.contractType),
							ne(generatedLegalContracts.status, "cancelled"),
							gte(generatedLegalContracts.generatedAt, bateria.acceptedAt),
						),
					)
					.limit(1);

				if (!reemplazado) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"Ese contrato no es de esta compra, no es del mismo tipo o ya está anulado.",
					});
				}
			}

			// Un contrato vigente por tipo en cada compra, lo mismo que al generar:
			// con dos, el inversionista recibe dos enlaces del mismo contrato y
			// firma el que no es. Los de una compra anterior no cuentan. Se vuelve a
			// mirar, bloqueado, al guardar.
			const [yaVigente] = await db
				.select({ id: generatedLegalContracts.id })
				.from(generatedLegalContracts)
				.where(
					and(
						eq(generatedLegalContracts.batchId, input.batchId),
						eq(generatedLegalContracts.contractType, input.contractType),
						ne(generatedLegalContracts.status, "cancelled"),
						gte(generatedLegalContracts.generatedAt, bateria.acceptedAt),
						...(input.replaceContractId
							? [ne(generatedLegalContracts.id, input.replaceContractId)]
							: []),
					),
				)
				.limit(1);
			if (yaVigente) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Esta batería ya tiene ese contrato. Reemplazalo o anulalo antes de subir otro.",
				});
			}

			// Puede cortar: sin correo del inversionista, con correos repetidos, o
			// en modo prueba sin las envs. Se hace antes de mandar nada.
			const signers = firmantesDeContratoDeInversion(input.contractType, {
				nombre: bateria.investorName,
				email: bateria.investorEmail,
			});

			const resultado = await subirContratoParaFirma({
				contractType: input.contractType,
				pdfBase64: input.pdfBase64,
				filenamePrefix: input.filename.replace(/\.pdf$/i, ""),
				// En WeeTrust se ve quién firma y qué firma, no el nombre con el que
				// jurídico guardó el archivo en su computadora.
				documentName: bateria.investorName,
				signers,
				observers: CONTRATOS_OBSERVADORES,
			});

			const falla = motivoDeFalla(resultado);
			if (falla) {
				throw new ORPCError("BAD_REQUEST", { message: falla });
			}

			let contractId: string;
			try {
				contractId = await guardarContratoDeInversion({
					batchId: input.batchId,
					investorId: bateria.investorId,
					contractType: input.contractType,
					contractName: input.contractName,
					resultado,
					userId: context.userId,
					subidoAMano: true,
					...(reemplazado && input.motivo
						? {
								reemplaza: {
									contractId: reemplazado.id,
									motivo: etiquetaDeMotivo(input.motivo),
								},
							}
						: {}),
				});
			} catch (error) {
				// El documento ya salió a WeeTrust con sus invitaciones: se borra allá
				// para que un reintento no deje dos vivos del mismo contrato.
				if (resultado.documentID) {
					await borrarDocumentoDeWeeTrust(resultado.documentID).catch((e) =>
						console.error(
							`[uploadInvestorContract] no se pudo borrar ${resultado.documentID}:`,
							e,
						),
					);
				}
				throw error instanceof ORPCError
					? error
					: new ORPCError("INTERNAL_SERVER_ERROR", {
							message:
								error instanceof Error
									? error.message
									: "No se pudo guardar el contrato",
						});
			}

			// Recién ahora el documento viejo: su fila ya quedó anulada, y borrarlo
			// antes de guardar el nuevo dejaba a la batería sin ninguno de los dos.
			if (reemplazado && input.motivo) {
				await borrarElViejoEnWeeTrust({
					contractId: reemplazado.id,
					status: reemplazado.status,
					weetrustDocumentId: reemplazado.weetrustDocumentId,
					razon: `Reemplazado: ${etiquetaDeMotivo(input.motivo)}`,
					origen: "uploadInvestorContract",
				});

				// El anulado, en la papelería, seguía figurando con sus enlaces: que
				// diga que está anulado es lo que evita que alguien se los pase al
				// inversionista.
				void espejarEstadoDeFirmaEnCartera(reemplazado.id);
			}

			await recalcularEstadoDeLaBateria(input.batchId, context.userId);
			const correo = await mandarAlHiloSiYaSeMando(input.batchId, [
				{ id: contractId, reemplazo: Boolean(reemplazado && input.motivo) },
			]);

			return {
				success: true,
				correo,
				message: reemplazado
					? "Contrato reemplazado y mandado a firmar"
					: "Contrato subido y mandado a firmar",
				contractId,
				contractType: input.contractType,
				contractName: input.contractName,
				// URL firmada para poder abrirlo desde la pantalla. Vence en una hora;
				// lo que queda guardado es la key.
				documentLink: resultado.r2Key
					? await getFileUrlWithBucketInKey(resultado.r2Key)
					: resultado.linkDocument,
				signingLinks: resultado.signing_links,
				signatories: resultado.signatories,
			};
		}),

	/**
	 * Anula un contrato de inversión, sin reemplazarlo.
	 *
	 * Es para cuando el documento no va y punto: datos equivocados, o se emitió
	 * el que no era. Lo hace jurídico mientras la batería sigue abierta; una vez
	 * que los firman todos ya no hay nada que anular, y WeeTrust tampoco deja
	 * borrar un documento completo.
	 *
	 * Qué pasa del lado de WeeTrust: si falta firmar alguien —haya firmado otro
	 * o nadie—, el documento se borra allá y sus enlaces mueren, porque un
	 * contrato anulado no tiene que seguir recibiendo firmas.
	 *
	 * La fila no se borra nunca: es el registro de lo que se descartó y de quién
	 * lo había firmado. Queda en «Ver anulados», con su motivo.
	 */
	cancelInvestorContract: juridicoProcedure
		.input(
			z.object({
				contractId: z.string().uuid(),
				motivo: z.enum(MOTIVOS_DE_ANULACION_KEYS),
			}),
		)
		.handler(async ({ input, context }) => {
			const [contrato] = await db
				.select()
				.from(generatedLegalContracts)
				.where(eq(generatedLegalContracts.id, input.contractId))
				.limit(1);

			if (!contrato) {
				throw new ORPCError("NOT_FOUND", { message: "Contrato no encontrado" });
			}

			if (!contrato.investorId || !contrato.batchId) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Ese contrato no es de un inversionista.",
				});
			}

			if (contrato.status === "cancelled" || contrato.replacedByContractId) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Este contrato ya está anulado o fue reemplazado.",
				});
			}

			const quien = context.session?.user?.name ?? "alguien del CRM";
			const razon = `${etiquetaDeMotivo(input.motivo)} (anulado por ${quien})`;
			const ahora = new Date();

			// La fila se marca primero y bloqueada: si dos personas anulan a la
			// vez, la segunda ve que ya no está vigente y no vuelve a pedirle nada
			// a WeeTrust.
			await db.transaction(async (tx) => {
				const [actual] = await tx
					.select({
						status: generatedLegalContracts.status,
						reemplazadoPor: generatedLegalContracts.replacedByContractId,
					})
					.from(generatedLegalContracts)
					.where(eq(generatedLegalContracts.id, input.contractId))
					.for("update")
					.limit(1);

				if (!actual || actual.status === "cancelled" || actual.reemplazadoPor) {
					throw new ORPCError("CONFLICT", {
						message:
							"Otra persona acaba de anular o reemplazar este contrato. Recargá para ver cómo quedó.",
					});
				}

				await tx
					.update(generatedLegalContracts)
					.set({
						status: "cancelled",
						cancellationReason: razon,
						cancelledAt: ahora,
						updatedAt: ahora,
					})
					.where(eq(generatedLegalContracts.id, input.contractId));
			});

			// Recién ahora el documento allá, con el detalle de cómo quedó pegado
			// al motivo.
			await borrarElViejoEnWeeTrust({
				contractId: input.contractId,
				status: contrato.status,
				weetrustDocumentId: contrato.weetrustDocumentId,
				razon,
				origen: "cancelInvestorContract",
			});

			// Que la papelería del inversionista diga que quedó anulado: si no,
			// alguien puede seguir pasando sus enlaces.
			void espejarEstadoDeFirmaEnCartera(input.contractId);

			// Sin este contrato, la batería puede volver a "pendiente" (si era el
			// único) o quedar completa (si los que restan ya están firmados).
			const estado = await recalcularEstadoDeLaBateria(
				contrato.batchId,
				context.userId,
			);

			return {
				success: true,
				estadoDeLaBateria: estado,
				message:
					"Contrato anulado. Queda en «Ver anulados» con el motivo y cómo quedó en la plataforma de firma.",
			};
		}),

	/**
	 * "Corregir y regenerar": descarta lo que jurídico emitió antes del "Listo"
	 * para volver al formulario y emitirlo de nuevo con los datos corregidos.
	 *
	 * Es el mismo botón que en ventas, que borra en WeeTrust lo generado sin
	 * enlazar: si no, los firmantes quedan con invitaciones de documentos que
	 * nadie sigue. Acá los contratos ya tienen fila —se guardan al emitirlos—,
	 * así que se anulan por el mismo camino que "Anular": se borran allá, el
	 * espejo en cartera deja de mostrarse, y la fila queda en «Ver anulados»
	 * como registro.
	 *
	 * Sólo antes del Listo: después ya salieron en el hilo de la compra, y
	 * descartarlos así dejaría enlaces muertos sin avisarle a nadie.
	 */
	descartarVistaPrevia: juridicoProcedure
		.input(z.object({ batchId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const [bateria] = await db
				.select({
					status: investorContractBatches.status,
					acceptedAt: investorContractBatches.acceptedAt,
				})
				.from(investorContractBatches)
				.where(eq(investorContractBatches.id, input.batchId))
				.limit(1);

			if (!bateria) {
				throw new ORPCError("NOT_FOUND", {
					message: "Esa batería de contratos no existe",
				});
			}

			if (bateria.status !== "pendiente") {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Estos contratos ya se mandaron al hilo de la compra: para corregir uno, reemplazalo o anulalo.",
				});
			}

			// Los de la vista previa: los de esta compra que siguen vigentes. Uno
			// firmado no se toca —WeeTrust no deja borrarlo— y se dice.
			const vigentes = await db
				.select()
				.from(generatedLegalContracts)
				.where(
					and(
						eq(generatedLegalContracts.batchId, input.batchId),
						ne(generatedLegalContracts.status, "cancelled"),
						sql`${generatedLegalContracts.replacedByContractId} is null`,
						gte(generatedLegalContracts.generatedAt, bateria.acceptedAt),
					),
				);

			const quien = context.session?.user?.name ?? "alguien del CRM";
			const razon = `Se corrigió antes de mandarlo (descartado por ${quien})`;
			const firmados: string[] = [];
			let descartados = 0;

			for (const contrato of vigentes) {
				if (contrato.status === "signed") {
					firmados.push(contrato.contractName);
					continue;
				}

				// Igual que al anular: la fila primero, y sólo si nadie la tocó.
				const [marcado] = await db
					.update(generatedLegalContracts)
					.set({
						status: "cancelled",
						cancellationReason: razon,
						cancelledAt: new Date(),
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(generatedLegalContracts.id, contrato.id),
							eq(generatedLegalContracts.status, "pending"),
							sql`${generatedLegalContracts.replacedByContractId} is null`,
						),
					)
					.returning({ id: generatedLegalContracts.id });

				if (!marcado) continue;

				await borrarElViejoEnWeeTrust({
					contractId: contrato.id,
					status: contrato.status,
					weetrustDocumentId: contrato.weetrustDocumentId,
					razon,
					origen: "descartarVistaPrevia",
				});
				void espejarEstadoDeFirmaEnCartera(contrato.id);
				descartados += 1;
			}

			await recalcularEstadoDeLaBateria(input.batchId, context.userId);

			return { descartados, firmados };
		}),

	/**
	 * El "Listo" de jurídico: manda los contratos al hilo de la compra y la
	 * batería pasa a "Por firmar".
	 *
	 * Hasta acá jurídico estuvo armando: emitió, miró los PDF, reemplazó o subió
	 * alguno. Lo que la batería tiene en ese momento es lo que sale —los
	 * contratos adjuntos y los enlaces de cada persona— en el hilo del correo de
	 * "Compra de Cartera aceptada", donde antes lo contestaban a mano jurídico
	 * ("adjunto contratos") e inversiones ("envío links"). Después, lo que se
	 * agregue o reemplace va solo al mismo hilo.
	 *
	 * No la cierra: cerrada es cuando se firma todo.
	 */
	marcarBateriaLista: juridicoProcedure
		.input(z.object({ batchId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const [bateria] = await db
				.select({
					status: investorContractBatches.status,
					acceptedAt: investorContractBatches.acceptedAt,
				})
				.from(investorContractBatches)
				.where(eq(investorContractBatches.id, input.batchId))
				.limit(1);

			if (!bateria) {
				throw new ORPCError("NOT_FOUND", {
					message: "Esa batería de contratos no existe",
				});
			}

			if (bateria.status !== "pendiente") {
				throw new ORPCError("BAD_REQUEST", {
					message:
						bateria.status === "en_proceso"
							? "Esta batería ya se mandó. Lo que agregues o reemplaces sale solo al hilo."
							: bateria.status === "completada"
								? "Esta batería ya está cerrada: se firmó todo."
								: "Esta batería se descartó.",
				});
			}

			// Los de ESTA compra. Una batería puede venir de otra compra anterior
			// sobre los mismos créditos, y los contratos de aquélla ya salieron en
			// su propio hilo.
			const contratos = await db
				.select({ id: generatedLegalContracts.id })
				.from(generatedLegalContracts)
				.where(
					and(
						eq(generatedLegalContracts.batchId, input.batchId),
						ne(generatedLegalContracts.status, "cancelled"),
						gte(generatedLegalContracts.generatedAt, bateria.acceptedAt),
					),
				)
				.orderBy(asc(generatedLegalContracts.generatedAt));

			if (contratos.length === 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Todavía no hay contratos que mandar.",
				});
			}

			// Reclamar, mandar y, si el correo falla, devolver: todo con el candado
			// de la batería, el mismo del envío de lo que se agrega después. Así un
			// agregado no sale al hilo en medio de un "Listo" que termina fallando.
			const correo = await conCandadoDeBateria(input.batchId, async () => {
				// Se reclama el paso a "Por firmar" antes de mandar: dos clics a la vez
				// mandaban dos correos. El que no lo reclama, no manda.
				const ahora = new Date();
				const [reclamada] = await db
					.update(investorContractBatches)
					.set({
						status: "en_proceso",
						startedAt: ahora,
						startedBy: context.userId,
						updatedAt: ahora,
					})
					.where(
						and(
							eq(investorContractBatches.id, input.batchId),
							eq(investorContractBatches.status, "pendiente"),
						),
					)
					.returning({ id: investorContractBatches.id });

				if (!reclamada) {
					throw new ORPCError("CONFLICT", {
						message: "Otra persona le acaba de dar Listo a esta batería.",
					});
				}

				const correo = await mandarContratosAlHilo({
					batchId: input.batchId,
					contractIds: contratos.map((c) => c.id),
					motivo: { tipo: "listo" },
				}).catch((error: unknown) => ({
					enviado: false,
					enHilo: false,
					error: error instanceof Error ? error.message : "No se pudo mandar",
				}));

				if (!correo.enviado) {
					// Sin correo no hay Listo: vuelve a pendiente, para que se pueda
					// reintentar sin que nadie crea que los enlaces ya salieron.
					await db
						.update(investorContractBatches)
						.set({
							status: "pendiente",
							startedAt: null,
							startedBy: null,
							updatedAt: new Date(),
						})
						.where(
							and(
								eq(investorContractBatches.id, input.batchId),
								eq(investorContractBatches.status, "en_proceso"),
							),
						);
					throw new ORPCError("BAD_REQUEST", {
						message: `No se pudo mandar el correo (${correo.error ?? "sin detalle"}). La batería sigue pendiente: probá de nuevo.`,
					});
				}
				return correo;
			});

			// Puede que ya estén todos firmados (uno subido ya firmado, o gente
			// rápida): entonces se cierra de una vez.
			const estado = await recalcularEstadoDeLaBateria(
				input.batchId,
				context.userId,
			);
			await avisarAInversiones(input.batchId, {
				createdBy: context.userId,
				createdByRole: context.userRole,
			});

			return {
				enviado: true,
				enHilo: correo.enHilo,
				contratos: contratos.length,
				estado,
			};
		}),

	/**
	 * Los contratos de un inversionista, con sus firmantes.
	 *
	 * Lo mira inversiones en la ficha: de ahí salen el enlace de observador y el
	 * de cada persona. Por eso no es `juridicoProcedure`.
	 */
	listInvestorContracts: viewInvestorContractsProcedure
		.input(
			z.object({
				investorId: z.number().int().positive().optional(),
				batchId: z.string().uuid().optional(),
			}),
		)
		.handler(async ({ input }) => {
			if (!input.investorId && !input.batchId) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Hay que decir de qué inversionista o de qué batería.",
				});
			}

			const contratos = await db
				.select()
				.from(generatedLegalContracts)
				.where(
					and(
						...(input.investorId
							? [eq(generatedLegalContracts.investorId, input.investorId)]
							: []),
						...(input.batchId
							? [eq(generatedLegalContracts.batchId, input.batchId)]
							: []),
					),
				)
				.orderBy(desc(generatedLegalContracts.generatedAt));

			if (contratos.length === 0) return [];

			const firmantes = await db
				.select()
				.from(contractSignatories)
				.where(
					inArray(
						contractSignatories.contractId,
						contratos.map((c) => c.id),
					),
				)
				.orderBy(contractSignatories.position);

			// De qué compra salió cada contrato. La ficha los agrupa por ahí: un
			// inversionista que compra tres veces termina con los mismos contratos
			// repetidos, y sin la compra no se distingue cuál es de cuál.
			const bateriasIds = [
				...new Set(contratos.map((c) => c.batchId).filter(Boolean)),
			] as string[];
			const baterias =
				bateriasIds.length > 0
					? await db
							.select({
								id: investorContractBatches.id,
								acceptedAt: investorContractBatches.acceptedAt,
								montoTotal: investorContractBatches.montoTotal,
							})
							.from(investorContractBatches)
							.where(inArray(investorContractBatches.id, bateriasIds))
					: [];
			const bateriaPorId = new Map(baterias.map((b) => [b.id, b]));

			const porContrato = new Map<string, typeof firmantes>();
			for (const firmante of firmantes) {
				const lista = porContrato.get(firmante.contractId) ?? [];
				lista.push(firmante);
				porContrato.set(firmante.contractId, lista);
			}

			return Promise.all(
				contratos.map(async (contrato) => ({
					...contrato,
					firmantes: porContrato.get(contrato.id) ?? [],
					// El PDF para abrirlo desde la ficha. Lo guardado es la key de R2;
					// la URL se firma acá y vence en una hora, así que se arma en cada
					// consulta en vez de quedar pegada a la fila.
					//
					// Mientras se firma es el documento tal como se emitió; cuando
					// terminan de firmar, el firmado. `pdfFirmado` dice cuál es, para
					// que la ficha no prometa firmas que el archivo no tiene.
					pdfUrl: await urlDelPdf(contrato),
					pdfFirmado: Boolean(contrato.signedPdfLink),
					bateria: contrato.batchId
						? (bateriaPorId.get(contrato.batchId) ?? null)
						: null,
				})),
			);
		}),

	/**
	 * Le pregunta a WeeTrust cómo va la firma y lo baja a la base.
	 *
	 * Lo usa inversiones desde la ficha: los webhooks pueden no estar
	 * registrados, y sin esto la única forma de saber si alguien firmó era entrar
	 * a WeeTrust.
	 */
	getInvestorContractSigningStatus: viewInvestorContractsProcedure
		.input(z.object({ contractId: z.string().uuid() }))
		.handler(async ({ input }) => {
			const { documentID } = await contratoDeInversionista(input.contractId);

			let estado: EstadoDocumentoFirma;
			try {
				estado = await consultarEstadoFirma(documentID);
			} catch (error) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message:
						error instanceof Error
							? error.message
							: "No se pudo consultar el estado de firma",
				});
			}

			// Escribe el estado y, de paso, lo copia a cartera: es la única puerta.
			await sincronizarEstadoDeFirma(input.contractId, estado);
			return estado;
		}),

	/**
	 * Resuelve una verificación facial que no pasó: la repite, o la omite.
	 *
	 * Es la salida del documento que se queda abierto con todas las firmas
	 * puestas. Repetirla trabaja sobre el MISMO documento: no se emite otro ni se
	 * tocan las demás firmas, pero WeeTrust deshace la de esa persona y le da un
	 * enlace nuevo, así que vuelve a firmar e identificarse. Es bastante menos
	 * que regenerar, que era lo único que había: eso emite otro documento, tumba
	 * todas las firmas y deja un anulado. Omitirla cierra el contrato con la
	 * identidad sin verificar, y por eso queda marcado con quién lo decidió.
	 */
	retryInvestorContractBiometric: viewInvestorContractsProcedure
		.input(
			z.object({
				contractId: z.string().uuid(),
				accion: z.enum(["repetir", "omitir"]),
			}),
		)
		.handler(async ({ input, context }) => {
			// Las dos son de inversiones, que le da seguimiento a la firma. Jurídico
			// entrega los contratos, pero el seguimiento ya no es suyo.
			if (!PERMISSIONS.canResolveInvestorIdentity(context.userRole)) {
				throw new ORPCError("FORBIDDEN", {
					message:
						"La verificación de identidad la resuelve inversiones desde la ficha del inversionista",
				});
			}

			const { contrato, documentID } = await contratoDeInversionista(
				input.contractId,
			);

			if (contrato.status === "cancelled") {
				throw new ORPCError("BAD_REQUEST", {
					message: "Este contrato está anulado.",
				});
			}

			// El intento fallido se busca acá y no se recibe del navegador: el
			// `biometricLogID` cambia con cada intento, y uno viejo haría que
			// WeeTrust conteste que no encuentra nada.
			let estado: EstadoDocumentoFirma;
			try {
				estado = await consultarEstadoFirma(documentID);
			} catch (error) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message:
						error instanceof Error
							? error.message
							: "No se pudo consultar el estado de firma",
				});
			}

			const fallidas = estado.signatories.filter(
				(f) => f.biometric?.finished && !f.biometric.valid && f.biometric.logID,
			);

			if (fallidas.length === 0) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						estado.status === "COMPLETED"
							? "Este documento ya cerró: no hay ninguna verificación pendiente."
							: "Este documento no tiene ninguna verificación de identidad fallida.",
				});
			}

			for (const firmante of fallidas) {
				await reintentarBiometria({
					documentID,
					biometricLogID: firmante.biometric?.logID as string,
					action:
						input.accion === "omitir" ? "biometricSkipped" : "biometricRetry",
				});
			}

			// Omitir cierra el documento: queda dicho en la fila quién lo decidió,
			// porque ese contrato vale con una identidad que nadie verificó.
			if (input.accion === "omitir") {
				await db
					.update(generatedLegalContracts)
					.set({
						apiResponse: conMarcaDeBiometriaOmitida(
							(contrato.apiResponse as object | null) ?? {},
							{
								por: context.session.user.name || context.session.user.email,
								cuando: new Date().toISOString(),
								firmantes: fallidas.map((f) => f.name),
							},
						),
						updatedAt: new Date(),
					})
					.where(eq(generatedLegalContracts.id, input.contractId));
			}

			// Y se baja el estado nuevo: después de omitir, el documento suele
			// quedar cerrado, y con eso se guardan el PDF firmado y la batería.
			let despues: EstadoDocumentoFirma | null = null;
			try {
				despues = await consultarEstadoFirma(documentID);
				await sincronizarEstadoDeFirma(input.contractId, despues);
				if (input.accion === "repetir") {
					await devolverAFirmar(input.contractId, despues);
				}
			} catch (error) {
				// La acción en WeeTrust ya se hizo; el estado se vuelve a consultar
				// solo desde la ficha.
				console.warn(
					"[retryInvestorContractBiometric] no se pudo releer el estado:",
					error,
				);
			}

			return {
				success: true,
				accion: input.accion,
				firmantes: fallidas.map((f) => f.name),
				status: despues?.status ?? estado.status,
			};
		}),

	/**
	 * Reenvía la invitación de firma de WeeTrust.
	 *
	 * Para el caso de siempre: al inversionista se le perdió el correo. No
	 * cambia el documento ni los enlaces, así que quien ya firmó sigue firmado.
	 */
	resendInvestorContractSigningEmails: viewInvestorContractsProcedure
		.input(z.object({ contractId: z.string().uuid() }))
		.handler(async ({ input }) => {
			const { contrato, documentID } = await contratoDeInversionista(
				input.contractId,
			);

			if (contrato.status === "cancelled") {
				throw new ORPCError("BAD_REQUEST", {
					message: "Este contrato está anulado: sus enlaces ya no sirven.",
				});
			}

			try {
				await reenviarCorreoDeFirma(documentID);
			} catch (error) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						error instanceof Error
							? error.message
							: "No se pudo reenviar el correo de firma",
				});
			}

			return { success: true, message: "Invitación reenviada" };
		}),

	/**
	 * Emite el MISMO contrato con enlaces nuevos.
	 *
	 * Es la salida para los dos casos que pasan: el enlace venció, o la persona
	 * falló la verificación de identidad y necesita volver a entrar. WeeTrust no
	 * sabe renovar los enlaces de un documento con todos firmados, así que se
	 * emite un documento nuevo con el mismo PDF y el anterior queda anulado
	 * apuntando al que lo reemplaza.
	 *
	 * La fila vieja NO se borra: es el registro de quién había firmado qué.
	 */
	refreshInvestorContractSigningLinks: viewInvestorContractsProcedure
		.input(
			z.object({
				contractId: z.string().uuid(),
				motivo: z.enum(MOTIVOS_DE_ANULACION_KEYS),
			}),
		)
		.handler(async ({ input, context }) => {
			// Ver los contratos lo puede hacer cualquiera de inversiones; regenerar
			// no: emite otro documento y deja muertos los enlaces que el
			// inversionista ya tenía.
			if (!PERMISSIONS.canRegenerateInvestorContractLinks(context.userRole)) {
				throw new ORPCError("FORBIDDEN", {
					message:
						"Sólo la gerencia de inversiones o jurídico pueden regenerar los enlaces",
				});
			}

			const { contrato } = await contratoDeInversionista(input.contractId);

			if (contrato.status === "cancelled") {
				throw new ORPCError("BAD_REQUEST", {
					message: "Este contrato está anulado: no se puede regenerar.",
				});
			}

			// La key de R2 del PDF. Hay contratos que guardaron en `pdfLink` una URL
			// firmada (la que se muestra, que vence) en vez de la key: con una URL
			// entera como key, R2 no encuentra nada.
			const respuesta = contrato.apiResponse as { r2Key?: unknown } | null;
			const r2KeyDelPdf =
				contrato.pdfLink && !/^https?:\/\//i.test(contrato.pdfLink)
					? contrato.pdfLink
					: typeof respuesta?.r2Key === "string"
						? respuesta.r2Key
						: null;

			if (!r2KeyDelPdf) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Este contrato no tiene el PDF guardado, así que no se puede reemitir. Hay que volver a emitirlo desde jurídico.",
				});
			}

			// Los mismos firmantes que tenía, con su rol: el documento es el que es
			// y tiene que salir con la misma gente, aunque después alguien haya
			// editado un contacto.
			const firmantes = await db
				.select()
				.from(contractSignatories)
				.where(eq(contractSignatories.contractId, input.contractId))
				.orderBy(contractSignatories.position);

			if (firmantes.length === 0) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Este contrato no tiene firmantes guardados: hay que emitirlo de nuevo desde jurídico.",
				});
			}

			const guardados = firmantes.map((f) => ({
				role: f.role as SignerRole,
				email: f.email,
				name: f.name,
			}));

			// El titular de un contrato de inversión es el inversionista. Sale de
			// los firmantes guardados y no de la batería porque un contrato puede
			// reemitirse cuando su batería ya se cerró.
			const nombreDelInversionista = guardados.find(
				(f) => f.role === "TITULAR",
			)?.name;

			// En modo prueba se redirige igual que al generar: un contrato emitido
			// con correos reales le mandaría la invitación al inversionista.
			let signers = guardados;
			if (isTestModeEnabled()) {
				const faltan = correosDePruebaFaltantes(guardados);
				if (faltan.length > 0) {
					throw new ORPCError("BAD_REQUEST", {
						message: `TEST_MESSAGE=true pero falta configurar ${faltan.join(" y ")}: los enlaces saldrían a los correos reales.`,
					});
				}
				signers = aplicarCorreosDePrueba(guardados);
				const repetido = correoRepetido(signers);
				if (repetido) {
					throw new ORPCError("BAD_REQUEST", {
						message: `TEST_MESSAGE=true: el correo de prueba ${repetido} quedaría para dos firmantes.`,
					});
				}
			}

			const resultado = await reemitirContratoEnWeeTrust({
				r2Key: r2KeyDelPdf,
				contractType: contrato.contractType,
				filenamePrefix: contrato.contractName,
				// Igual que al emitirlo: el documento reemitido tiene que llamarse
				// como el primero, y no "Contrato de Participación - Contrato de
				// Participación", que es a lo que lleva usar el nombre del archivo.
				documentName: nombreDelInversionista,
				signers,
				observers: CONTRATOS_OBSERVADORES,
			});

			const falla = motivoDeFalla(resultado);
			if (falla) {
				throw new ORPCError("BAD_REQUEST", { message: falla });
			}

			const ahora = new Date();
			const motivo = etiquetaDeMotivo(input.motivo);

			// El reemitido va en una fila NUEVA y se guarda antes de tocar el viejo:
			// si el guardado fallara con el viejo ya borrado, el CRM apuntaría a un
			// documento inexistente. Si falla, se borra el nuevo en WeeTrust para
			// que un reintento no deje dos vivos.
			let nuevoId: string;
			try {
				nuevoId = await db.transaction(async (tx) => {
					// Dos regeneraciones a la vez emitían dos documentos y dejaban los
					// dos vigentes. Se bloquea la fila y se vuelve a mirar: si otra ya
					// lo anuló, ésta pierde y el catch borra el documento que acaba de
					// emitir.
					const [original] = await tx
						.select({
							status: generatedLegalContracts.status,
							reemplazadoPor: generatedLegalContracts.replacedByContractId,
						})
						.from(generatedLegalContracts)
						.where(eq(generatedLegalContracts.id, input.contractId))
						.for("update")
						.limit(1);

					if (
						!original ||
						original.status === "cancelled" ||
						original.reemplazadoPor
					) {
						throw new ORPCError("CONFLICT", {
							message:
								"Otra persona acaba de regenerar este contrato. Recargá para ver el nuevo.",
						});
					}

					const [nuevo] = await tx
						.insert(generatedLegalContracts)
						.values({
							investorId: contrato.investorId,
							batchId: contrato.batchId,
							contractType: contrato.contractType,
							contractName: contrato.contractName,
							templateId: contrato.templateId,
							apiResponse: resultado,
							pdfLink: r2KeyDelPdf,
							signingProvider: resultado.signingProvider ?? "weetrust",
							signatureMode: contrato.signatureMode,
							generatedBy: context.userId,
							generatedAt: ahora,
							...linksPorRol(resultado.signatories, resultado.signing_links),
							weetrustDocumentId: resultado.documentID ?? null,
							observerUrl: resultado.observerUrl ?? null,
							status: "pending",
							lastRegenerationReason: motivo,
							lastRegeneratedAt: ahora,
							signingStatusCheckedAt: ahora,
							updatedAt: ahora,
						})
						.returning({ id: generatedLegalContracts.id });

					if (!nuevo) {
						throw new ORPCError("INTERNAL_SERVER_ERROR", {
							message: "No se pudo guardar el contrato reemitido",
						});
					}

					// Los firmantes en la misma transacción: sin ellos el contrato nuevo
					// no se puede sincronizar ni volver a regenerar.
					const filas = filasDeFirmantes(nuevo.id, resultado.signatories);
					if (filas.length === 0) {
						throw new ORPCError("INTERNAL_SERVER_ERROR", {
							message:
								"WeeTrust no devolvió los firmantes del documento reemitido.",
						});
					}
					await tx.insert(contractSignatories).values(filas);

					await tx
						.update(generatedLegalContracts)
						.set({
							status: "cancelled",
							cancellationReason: `Regenerado: ${motivo}`,
							cancelledAt: ahora,
							replacedByContractId: nuevo.id,
							updatedAt: ahora,
						})
						.where(eq(generatedLegalContracts.id, input.contractId));

					return nuevo.id;
				});
			} catch (error) {
				if (resultado.documentID) {
					await borrarDocumentoDeWeeTrust(resultado.documentID).catch((e) =>
						console.error(
							`[refreshInvestorContractSigningLinks] no se pudo borrar el reemitido ${resultado.documentID}:`,
							e,
						),
					);
				}
				throw error;
			}

			// Recién ahora el documento viejo: su fila ya quedó anulada.
			await borrarElViejoEnWeeTrust({
				contractId: input.contractId,
				status: contrato.status,
				weetrustDocumentId: contrato.weetrustDocumentId,
				razon: `Regenerado: ${motivo}`,
				origen: "refreshInvestorContractSigningLinks",
			});

			// Y que la papelería diga que ese quedó anulado, para que nadie siga
			// pasando sus enlaces.
			void espejarEstadoDeFirmaEnCartera(input.contractId);

			// Si era un firmado de una batería ya completada, el reemitido la
			// vuelve trabajo pendiente: que vuelva a la lista de jurídico ya, no
			// cuando alguien consulte el estado del nuevo.
			if (contrato.batchId) {
				await recalcularEstadoDeLaBateria(contrato.batchId, context.userId);
			}

			return {
				success: true,
				message:
					"Documento reemitido con enlaces nuevos; el anterior queda anulado",
				contractId: nuevoId,
				enlaces: resultado.signing_links?.length ?? 0,
			};
		}),

	/** Cuántas baterías esperan, para el contador de la pantalla de jurídico. */
	countOpenInvestorContractBatches: juridicoProcedure.handler(async () => {
		const [fila] = await db
			.select({ total: sql<number>`count(*)::int` })
			.from(investorContractBatches)
			.where(inArray(investorContractBatches.status, [...ABIERTAS]));

		return { total: fila?.total ?? 0 };
	}),
};
