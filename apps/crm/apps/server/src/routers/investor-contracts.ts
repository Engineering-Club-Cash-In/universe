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
import { esContratoDeInversion } from "../lib/contratos-inversiones";
import { CONTRATOS_OBSERVADORES } from "../lib/contratos-rep-legal";
import { firmantesDeContratoDeInversion } from "../lib/firmantes-inversionista";
import { juridicoProcedure, viewInvestorContractsProcedure } from "../lib/orpc";
import {
	borrarDocumentoDeWeeTrust,
	type DocumentResult,
	generateContractsBatch,
	motivoDeFalla,
} from "../services/legal-docs-api";

/**
 * Las baterías de contratos de inversionistas: el trabajo que le abre a
 * jurídico cada compra de cartera aceptada.
 *
 * La fila la crea cartera (`routes/cartera-compra-aceptada.ts`). Acá se lee y se
 * mueve de estado; los contratos en sí cuelgan de ella y viven en
 * `generated_legal_contracts`.
 */

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
 * La batería, siempre que todavía se pueda trabajar.
 *
 * Una completada o descartada no recibe contratos nuevos: sería agregarle
 * papelería a un trabajo que alguien ya dio por terminado, y nadie volvería a
 * mirarla.
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

	if (bateria.status === "completada" || bateria.status === "descartada") {
		throw new ORPCError("BAD_REQUEST", {
			message: `La batería está ${bateria.status}: no admite contratos nuevos.`,
		});
	}

	return bateria;
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

			const emitidos: Array<{ id: string; contractType: string }> = [];
			const fallados: Array<{ contractType: string; error: string }> = [];

			for (let i = 0; i < input.contracts.length; i++) {
				const pedido = input.contracts[i];
				const resultado = respuesta.results?.[i];

				if (!resultado) {
					fallados.push({
						contractType: pedido.contractType,
						error: "El generador no devolvió resultado para este contrato",
					});
					continue;
				}

				const falla = motivoDeFalla(resultado);
				if (falla) {
					fallados.push({ contractType: pedido.contractType, error: falla });
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
					fallados.push({
						contractType: pedido.contractType,
						error:
							error instanceof Error
								? error.message
								: "No se pudo guardar el contrato",
					});
				}
			}

			// La batería pasa a "en proceso" en cuanto salió el primer contrato: es
			// lo que dice que alguien ya la está trabajando.
			if (emitidos.length > 0 && bateria.status === "pendiente") {
				await db
					.update(investorContractBatches)
					.set({
						status: "en_proceso",
						startedAt: new Date(),
						startedBy: context.userId,
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(investorContractBatches.id, input.batchId),
							eq(investorContractBatches.status, "pendiente"),
						),
					);
			}

			return {
				success: fallados.length === 0,
				emitidos,
				fallados,
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

			return contratos.map((contrato) => ({
				...contrato,
				firmantes: porContrato.get(contrato.id) ?? [],
			}));
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
