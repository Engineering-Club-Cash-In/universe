import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { investorContractBatches } from "../db/schema/investor-contracts";
import {
	contractSignatories,
	generatedLegalContracts,
} from "../db/schema/legal-contracts";
import { filasDeFirmantes, linksPorRol } from "../lib/contract-signatories";
import { getSignatureMode } from "../lib/contract-signature-mode";
import {
	sincronizarEstadoDeFirma,
	tieneFirmas,
} from "../lib/contrato-estado-firma";
import {
	etiquetaDeMotivo,
	MOTIVOS_DE_ANULACION_KEYS,
} from "../lib/contratos-anulacion";
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
import { espejarContratoEnCartera } from "../lib/espejo-contratos-inversionista";
import { firmantesDeContratoDeInversion } from "../lib/firmantes-inversionista";
import { isTestModeEnabled } from "../lib/messaging-test-mode";
import { juridicoProcedure, viewInvestorContractsProcedure } from "../lib/orpc";
import { PERMISSIONS } from "../lib/roles";
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
	type SignerRole,
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
 * Hay contratos que guardaron en `pdfLink` una URL firmada (la que se muestra,
 * que vence) en vez de la key: con una URL entera como key, R2 no encuentra
 * nada. Para esos se recupera la key de la respuesta del generador.
 */
async function urlDelPdf(contrato: {
	pdfLink: string | null;
	apiResponse: unknown;
}): Promise<string | null> {
	const respuesta = contrato.apiResponse as { r2Key?: unknown } | null;
	const key =
		contrato.pdfLink && !/^https?:\/\//i.test(contrato.pdfLink)
			? contrato.pdfLink
			: typeof respuesta?.r2Key === "string"
				? respuesta.r2Key
				: null;

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
 * Una completada sí admite más: se completa sola al emitir el primero, y
 * después puede faltar uno. La descartada no: alguien dijo que esa compra no
 * llevaba papelería, y emitirle contratos sería desdecirlo por la espalda.
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

	return bateria;
}

/**
 * El contrato, siempre que sea de un inversionista y tenga documento en WeeTrust.
 *
 * Se corta acá y no más adelante para no dejar que un contrato de ventas entre
 * por las acciones de inversiones: los permisos son de otra gente.
 */
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

		const [otroVigente] = await tx
			.select({ id: generatedLegalContracts.id })
			.from(generatedLegalContracts)
			.where(
				and(
					eq(generatedLegalContracts.batchId, params.batchId),
					eq(generatedLegalContracts.contractType, params.contractType),
					ne(generatedLegalContracts.status, "cancelled"),
				),
			)
			.limit(1);
		if (otroVigente) {
			throw new Error(
				"Otro pedido emitió este mismo contrato mientras se generaba",
			);
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
				apiResponse: resultado,
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

		return guardado.id;
	});
}

const ESTADOS = [
	"pendiente",
	"en_proceso",
	"completada",
	"descartada",
] as const;

/** Estados en los que la batería todavía es trabajo por hacer. */
const ABIERTAS = ["pendiente", "en_proceso"] as const;

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
				// Las más viejas primero: son las que llevan más tiempo esperando.
				.orderBy(investorContractBatches.acceptedAt)
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
			const [actualizada] = await db
				.update(investorContractBatches)
				.set({
					status: "en_proceso",
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
	 * Cierra la batería: completada cuando la papelería quedó hecha, descartada
	 * cuando no había que hacerla.
	 *
	 * Descartar exige motivo escrito. Una batería que desaparece sin explicación
	 * no se distingue de una que se olvidó.
	 */
	closeInvestorContractBatch: juridicoProcedure
		.input(
			z.object({
				batchId: z.string().uuid(),
				resultado: z.enum(["completada", "descartada"]),
				motivo: z.string().trim().min(3).optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			if (input.resultado === "descartada" && !input.motivo) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Hay que decir por qué se descarta la batería.",
				});
			}

			const ahora = new Date();
			const [actualizada] = await db
				.update(investorContractBatches)
				.set(
					input.resultado === "completada"
						? {
								status: "completada",
								completedAt: ahora,
								completedBy: context.session.user.id,
								updatedAt: ahora,
							}
						: {
								status: "descartada",
								discardedAt: ahora,
								discardedBy: context.session.user.id,
								discardReason: input.motivo,
								updatedAt: ahora,
							},
				)
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

			// Un contrato vigente por tipo y por batería: con dos, el inversionista
			// recibe dos enlaces del mismo contrato y firma el que no es.
			const yaVigentes = await db
				.select({ contractType: generatedLegalContracts.contractType })
				.from(generatedLegalContracts)
				.where(
					and(
						eq(generatedLegalContracts.batchId, input.batchId),
						ne(generatedLegalContracts.status, "cancelled"),
						inArray(generatedLegalContracts.contractType, tipos),
					),
				);
			if (yaVigentes.length > 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Esta batería ya tiene emitidos: ${yaVigentes.map((c) => c.contractType).join(", ")}.`,
				});
			}

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
				signatories?: unknown[];
				error?: string;
			}> = [];
			const emitidos: Array<{ id: string; contractType: string }> = [];

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
					const id = await guardarContratoDeInversion({
						batchId: input.batchId,
						investorId: bateria.investorId,
						contractType: pedido.contractType,
						contractName: pedido.contractName,
						resultado,
						userId: context.userId,
					});
					emitidos.push({ id, contractType: pedido.contractType });
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

					// Copiarlo a cartera es lo que lo hace visible en la ficha del
					// inversionista. Va best-effort y sin bloquear: el contrato ya
					// existe acá y en WeeTrust, y el espejo se reintenta solo en la
					// próxima firma o consulta de estado.
					void espejarContratoEnCartera(id, context.userId);
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

			// La batería se cierra sola en cuanto salió el primer contrato: el
			// trabajo que abrió la compra ya se hizo, y dejarla pendiente obligaba a
			// acordarse de marcarla. Sale de la lista de jurídico, no de la ficha
			// del inversionista.
			//
			// Cerrada no significa cerrada con llave: se le pueden emitir más
			// contratos después (lo único que no se repite es el mismo tipo), y por
			// eso se guarda también cuándo empezó.
			if (emitidos.length > 0) {
				const ahora = new Date();
				await db
					.update(investorContractBatches)
					.set({
						status: "completada",
						startedAt: bateria.startedAt ?? ahora,
						startedBy: bateria.startedBy ?? context.userId,
						completedAt: ahora,
						completedBy: context.userId,
						updatedAt: ahora,
					})
					.where(eq(investorContractBatches.id, input.batchId));
			}

			const successCount = results.filter((r) => r.success).length;

			return {
				success: successCount === results.length,
				totalRequested: input.contracts.length,
				successCount,
				failCount: results.length - successCount,
				results,
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
					// Es el documento tal como se emitió. El firmado, cuando todos
					// firman, se copia aparte a la papelería del inversionista.
					pdfUrl: await urlDelPdf(contrato),
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

			// Recién ahora el documento viejo. Su fila ya quedó anulada y se
			// conserva siempre: lo que diga WeeTrust antes de borrar es una foto, y
			// alguien puede firmar entre esa consulta y el borrado.
			if (contrato.status !== "signed" && contrato.weetrustDocumentId) {
				const conFirmasParciales = await tieneFirmas(
					input.contractId,
					contrato.weetrustDocumentId,
				);
				let detalle: string;
				try {
					await borrarDocumentoDeWeeTrust(contrato.weetrustDocumentId);
					detalle = conFirmasParciales
						? "tenía firmas parciales; el documento se borró en WeeTrust"
						: "el documento se borró en WeeTrust";
				} catch (error) {
					console.error(
						`[refreshInvestorContractSigningLinks] no se pudo borrar ${contrato.weetrustDocumentId}:`,
						error,
					);
					detalle = "no se pudo borrar en WeeTrust: hay que borrarlo a mano";
				}
				await db
					.update(generatedLegalContracts)
					.set({ cancellationReason: `Regenerado: ${motivo} (${detalle})` })
					.where(eq(generatedLegalContracts.id, input.contractId));
			}

			// El espejo de cartera tiene que apuntar al documento nuevo: si no, la
			// ficha del inversionista seguiría mostrando enlaces muertos.
			void espejarContratoEnCartera(nuevoId, context.userId);

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
