/**
 * Router para generación de contratos legales desde el CRM
 * Integra con legal-docs-blueprints API y API de documentos legales
 */
import { ORPCError } from "@orpc/server";
import {
	and,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	ne,
	sql,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { coDebtors, leads, opportunities, salesStages } from "../db/schema/crm";
import {
	contractGenerationSnapshots,
	contractSignatories,
	generatedLegalContracts,
} from "../db/schema/legal-contracts";
import { quotations } from "../db/schema/quotations";
import { vehicles } from "../db/schema/vehicles";
import {
	LEGACY_VENDOR_GENDER_REQUIRED_MESSAGE,
	resolveLegacyContractGender,
} from "../lib/contract-generation-gender";
import {
	alguienFirmo,
	type FirmanteEnviado,
	filasDeFirmantes,
	linksPorRol,
} from "../lib/contract-signatories";
import {
	esFirmaFisica,
	getSignatureMode,
} from "../lib/contract-signature-mode";
import { estadoEnWeeTrust } from "../lib/contrato-estado-firma";
import {
	ETAPAS_POR_ACCION,
	etiquetaDeMotivo,
	MOTIVOS_DE_ANULACION_KEYS,
} from "../lib/contratos-anulacion";
import { conCandadoDeFirma } from "../lib/contratos-candado";
import {
	aplicarCorreosDePrueba,
	correoRepetido,
	correosDePruebaFaltantes,
} from "../lib/contratos-correos-prueba";
import { descarteValido, firmarDescarte } from "../lib/contratos-descarte";
import {
	CONTRATOS_OBSERVADORES,
	REP_LEGAL_EMAIL,
	REP_LEGAL_NOMBRE,
} from "../lib/contratos-rep-legal";
import { esContratoVentaMapeado } from "../lib/contratos-venta";
import { eqDpi } from "../lib/dpi-lookup";
import { isTestModeEnabled } from "../lib/messaging-test-mode";
import { juridicoProcedure } from "../lib/orpc";
import { getFileUrlWithBucketInKey } from "../lib/storage";
import {
	enrichLeadFromRenap,
	mapOpportunityToContractData,
	transformToApiFormat,
	validateOpportunityForContracts,
} from "../services/contract-data-mapper";
import {
	borrarDocumentoDeWeeTrust,
	type ContractSigner,
	getDocumentsByDpi,
	getDocumentTypes,
	motivoDeFalla,
	subirContratoParaFirma,
} from "../services/legal-docs-api";

// URL de la API de generación de contratos (legal-docs-blueprints)
const LEGAL_DOCS_API_URL =
	process.env.LEGAL_DOCS_API_URL ||
	"https://legal-docs-blueprints.s4.devteamatcci.site";

/**
 * Quiénes firman un contrato, completando lo que manda el front con lo que sólo
 * conoce el servidor.
 *
 * El representante legal se agrega siempre que la firma sea electrónica: el
 * generador sabe qué contratos lo llevan (lo dice el layout de cada template) y
 * descarta al firmante que no corresponde, así que mandarlo de más no lo mete
 * donde no va.
 *
 * Los contratos que se firman en papel no llevan firmantes: el entregable es el
 * PDF, y mandar correos de gente que no va a recibir ningún link sólo ensucia.
 */
/**
 * El nombre del titular, para el nombre del documento en WeeTrust. Va el real y
 * no el de prueba: en modo prueba sólo se redirigen los correos.
 */
function nombreDelTitular(
	signers: ContractSigner[] | undefined,
): string | undefined {
	return signers?.find((s) => s.role === "TITULAR")?.name;
}

function firmantesDelContrato(
	contractType: string,
	signersDelFront: ContractSigner[] | undefined,
	legado?: {
		emails?: string[];
		data?: {
			nombreCompleto?: unknown;
			deudoresAdicionales?: { nombreCompleto?: string }[];
		};
	},
): ContractSigner[] | undefined {
	if (esFirmaFisica(contractType)) return undefined;

	// Los snapshots viejos sólo guardaron `emails`. Se convierten acá, igual que
	// lo hacía el generador (titular y después cofirmantes), para que pasen por
	// lo mismo que los nuevos: rep legal del servidor y correos de prueba. Si se
	// le mandaban crudos al generador, en modo prueba salían con los correos
	// reales del cliente.
	const signers: ContractSigner[] | undefined = signersDelFront?.length
		? signersDelFront
		: legado?.emails?.map((email, i) => {
				const nombre =
					i === 0
						? legado.data?.nombreCompleto
						: legado.data?.deudoresAdicionales?.[i - 1]?.nombreCompleto;
				return {
					role: i === 0 ? ("TITULAR" as const) : ("COFIRMANTE" as const),
					email,
					name: typeof nombre === "string" && nombre ? nombre : email,
				};
			});

	if (!signers || signers.length === 0) return signers;

	// Dos deudores con el mismo correo terminan siendo uno solo en WeeTrust: la
	// misma persona firmaría por los dos. Se corta antes de mandar nada.
	const correosDeudores = signers
		.filter((s) => s.role !== "REP_LEGAL")
		.map((s) => s.email.trim().toLowerCase());
	if (new Set(correosDeudores).size !== correosDeudores.length) {
		throw new ORPCError("BAD_REQUEST", {
			message:
				"El cliente y los codeudores no pueden compartir correo: cada uno firma con el suyo.",
		});
	}

	// El representante legal lo pone siempre el servidor. Si viniera del
	// navegador, cualquiera podría mandar su propio correo con ese rol y
	// quedarse con el link de firma de la entidad.
	//
	// Y sólo en los contratos de venta con layout auditado: el generador descarta
	// al rep legal donde no lleva línea, pero en los que no tienen layout
	// (inversiones, sociedad, cartas poder) reparte a todos por orden de llegada
	// y le daría una firma que el documento no tiene.
	const conRepLegal: ContractSigner[] = [
		...signers.filter((s) => s.role !== "REP_LEGAL"),
		...(esContratoVentaMapeado(contractType)
			? [
					{
						role: "REP_LEGAL" as const,
						email: REP_LEGAL_EMAIL,
						name: REP_LEGAL_NOMBRE,
					},
				]
			: []),
	];

	// Mismo criterio que usa el envío de WhatsApp para saber a quién le toca cada
	// enlace. Si no coincidieran, los links quedarían guardados con un correo y se
	// buscarían con otro, y nadie recibiría el suyo. Ya pasó.
	if (!isTestModeEnabled()) {
		// Los deudores ya se revisaron entre sí; lo que falta es el representante
		// legal. Un cliente cargado con ese correo (alguien de la casa, un dato
		// copiado) se fundiría con él en WeeTrust, que junta a los firmantes por
		// correo, y una de las dos firmas desaparecería del documento.
		const repetido = correoRepetido(conRepLegal);
		if (repetido) {
			throw new ORPCError("BAD_REQUEST", {
				message: `El correo ${repetido} es el del representante legal: el cliente y los codeudores tienen que firmar con uno propio.`,
			});
		}
		return conRepLegal;
	}

	// En modo prueba se corta si algún firmante externo se quedaría con su
	// correo real: es preferible un error a mandarle el contrato al cliente.
	const faltan = correosDePruebaFaltantes(conRepLegal);
	if (faltan.length > 0) {
		throw new ORPCError("BAD_REQUEST", {
			message: `TEST_MESSAGE=true pero falta configurar ${faltan.join(" y ")}: los enlaces de firma saldrían a los correos reales del cliente.`,
		});
	}
	const conPrueba = aplicarCorreosDePrueba(conRepLegal);
	const repetido = correoRepetido(conPrueba);
	if (repetido) {
		throw new ORPCError("BAD_REQUEST", {
			message: `TEST_MESSAGE=true: el correo de prueba ${repetido} quedaría para dos firmantes. Revisá CONTRATOS_TEST_EMAIL_TITULAR, CONTRATOS_TEST_EMAIL_COFIRMANTES y CONTRATOS_REP_LEGAL_EMAIL.`,
		});
	}
	return conPrueba;
}

/**
 * Guarda quién firma un contrato, con su rol y su link.
 *
 * Es best-effort a propósito: el contrato y su PDF ya quedaron guardados, y
 * perderlos porque falló el detalle de los firmantes sería peor que quedarse
 * con las columnas viejas de links. El error queda en el log.
 */
async function guardarFirmantes(
	contractId: string,
	signatories: FirmanteEnviado[] | undefined,
	contractType: string,
): Promise<boolean> {
	const filas = filasDeFirmantes(contractId, signatories);
	// Sin firmantes sólo está bien si se firma en papel. Uno electrónico que
	// llega sin ellos (respuesta del camino viejo, con sólo `signing_links`) no
	// se puede mandar ni regenerar: cuenta como guardado fallido.
	if (filas.length === 0) return esFirmaFisica(contractType);

	try {
		await db.insert(contractSignatories).values(filas);
		return true;
	} catch (error) {
		console.error(
			`[guardarFirmantes] contrato ${contractId}: no se pudieron guardar los firmantes`,
			error,
		);
		return false;
	}
}

/**
 * Saca los datos de firma de la respuesta cruda del generador.
 *
 * `linkContractsToOpportunity` recibe del front el `apiResponse` tal como se lo
 * devolvió el generador, sin tipar. Los contratos viejos no traen nada de esto.
 */
function firmaDelGenerador(apiResponse: unknown): {
	signatories?: FirmanteEnviado[];
	signingProvider?: string;
	documentID?: string;
	observerUrl?: string;
	r2Key?: string;
} {
	if (!apiResponse || typeof apiResponse !== "object") return {};
	const r = apiResponse as {
		signatories?: FirmanteEnviado[];
		signingProvider?: string;
		documentID?: string;
		observerUrl?: string;
		r2Key?: string;
	};
	return {
		signatories: Array.isArray(r.signatories) ? r.signatories : undefined,
		signingProvider:
			typeof r.signingProvider === "string" ? r.signingProvider : undefined,
		documentID: typeof r.documentID === "string" ? r.documentID : undefined,
		observerUrl: typeof r.observerUrl === "string" ? r.observerUrl : undefined,
		r2Key: typeof r.r2Key === "string" ? r.r2Key : undefined,
	};
}

/**
 * Quiénes firman los contratos de una oportunidad, según lo que hay en la base.
 *
 * El wizard arma esta lista en el navegador con los datos que ya tiene a mano;
 * para la subida manual se arma acá, porque lo único que manda jurídico es el
 * archivo y el tipo de contrato.
 *
 * Los cofirmantes sin correo se omiten: no hay a dónde mandarles el link, y
 * meterlos igual hace que WeeTrust rechace el envío entero.
 */
async function firmantesDeLaOportunidad(
	opportunityId: string,
): Promise<{ leadId: string; signers: ContractSigner[] }> {
	const [datos] = await db
		.select({ opportunity: opportunities, lead: leads })
		.from(opportunities)
		.innerJoin(leads, eq(opportunities.leadId, leads.id))
		.where(eq(opportunities.id, opportunityId))
		.limit(1);

	if (!datos) {
		throw new ORPCError("NOT_FOUND", { message: "Oportunidad no encontrada" });
	}

	const { lead } = datos;
	const nombreTitular = [
		lead.firstName,
		lead.middleName,
		lead.lastName,
		lead.secondLastName,
	]
		.filter(Boolean)
		.join(" ");

	const signers: ContractSigner[] = [];
	if (lead.email) {
		signers.push({
			role: "TITULAR",
			email: lead.email,
			name: nombreTitular || lead.email,
			...(lead.dpi ? { dpi: lead.dpi } : {}),
		});
	}

	// Orden estable: el reparto de correos de prueba es posicional, así que los
	// dos lados tienen que recorrer los codeudores en el mismo orden.
	const cofirmantes = await db
		.select()
		.from(coDebtors)
		.where(eq(coDebtors.opportunityId, opportunityId))
		.orderBy(coDebtors.createdAt);

	for (const cd of cofirmantes) {
		if (!cd.email) continue;
		signers.push({
			role: "COFIRMANTE",
			email: cd.email,
			name: cd.fullName || cd.email,
			...(cd.dpi ? { dpi: cd.dpi } : {}),
		});
	}

	return { leadId: lead.id, signers };
}

/**
 * Corta si la oportunidad ya pasó de la etapa de firma.
 *
 * Del 90% en adelante los contratos que están en análisis son los que son:
 * cambiarlos ahí sería mover el piso de una decisión ya tomada.
 */
async function exigirEtapaQuePermiteReemplazo(
	opportunityId: string,
): Promise<{ stageId: string | null; porcentaje: number }> {
	const [fila] = await db
		.select({
			stageId: opportunities.stageId,
			porcentaje: salesStages.closurePercentage,
		})
		.from(opportunities)
		.leftJoin(salesStages, eq(opportunities.stageId, salesStages.id))
		.where(eq(opportunities.id, opportunityId))
		.limit(1);

	const porcentaje = fila?.porcentaje ?? null;

	// Jurídico arma la papelería en 80% y la sigue trabajando en 85%, mientras
	// está en firma: rehacer la batería con otra fecha cuando venció es parte
	// de su operación. Del 90% en adelante ya no se toca.
	if (
		porcentaje === null ||
		!ETAPAS_POR_ACCION.reemplazar.includes(porcentaje as never)
	) {
		throw new ORPCError("BAD_REQUEST", {
			message: `La oportunidad está en ${porcentaje ?? "una etapa desconocida"}%: jurídico sólo puede generar, subir o reemplazar contratos en ${ETAPAS_POR_ACCION.reemplazar.join("% u ")}%. Para cambiarlo, hay que devolverla a esa etapa.`,
		});
	}
	// Con qué etapa se aprobó, y las dos cosas de la MISMA lectura. La etapa
	// (`stageId`) es contra la que después se revalida al retirar los
	// anteriores; el porcentaje se le devuelve al front para decidir si ofrecer
	// el reenvío. Si salieran de dos lecturas, una aprobación en el medio
	// instalaba en 85% y contestaba 80%, y no se ofrecía reenviar.
	return { stageId: fila?.stageId ?? null, porcentaje };
}

/**
 * Deja sin efecto el contrato que se está reemplazando.
 *
 * Si estuvo en WeeTrust, la fila se conserva SIEMPRE, anulada y con el motivo.
 * Saber si alguien firmó es una foto: el cliente puede firmar entre esa
 * consulta y el borrado, y borrar la fila por esa foto perdía el único
 * registro de esa firma (el documento allá ya no existe para volver a leerlo).
 * En la ficha los anulados van aparte, así que no ensucian la lista.
 *
 * - **Nadie lo firmó, o firmas parciales**: se borra en WeeTrust. Dejarlo vivo
 *   allá significa que alguien todavía puede entrar por el link viejo y firmar
 *   un documento que ya descartamos.
 * - **No se pudo borrar allá** (WeeTrust falló): el motivo lo avisa. Sigue vivo
 *   con sus links hasta que alguien lo borre a mano.
 * - **Ya lo firmaron todos**: WeeTrust NO permite borrarlo (queda en su
 *   blockchain y su API no tiene endpoint para anular).
 *
 * Sólo se borra la fila de uno que nunca tuvo documento en WeeTrust y que
 * nadie firmó (ahí no hay nada allá que pueda cambiar mientras tanto), o la de
 * un duplicado de otra fila con el mismo documento, que sigue vivo.
 */
export async function anularContratoReemplazado(
	contractId: string,
	opportunityId: string | null,
	motivo: string,
): Promise<{ contractId: string; conservado: boolean } | null> {
	const [viejo] = await db
		.select()
		.from(generatedLegalContracts)
		.where(
			and(
				eq(generatedLegalContracts.id, contractId),
				// Los contratos cargados a mano pueden no tener oportunidad.
				opportunityId === null
					? isNull(generatedLegalContracts.opportunityId)
					: eq(generatedLegalContracts.opportunityId, opportunityId),
			),
		)
		.limit(1);

	if (!viejo) return null;

	// El mismo documento de WeeTrust en otra fila: ésta es un duplicado (un
	// reintento que volvió a enlazar el mismo resultado). Borrarlo allá dejaría
	// sin enlaces a la otra, que lo sigue usando; sólo se quita esta fila. El
	// documento sigue vivo, así que nada de lo firmado se pierde.
	if (viejo.weetrustDocumentId) {
		const [otra] = await db
			.select({ id: generatedLegalContracts.id })
			.from(generatedLegalContracts)
			.where(
				and(
					eq(
						generatedLegalContracts.weetrustDocumentId,
						viejo.weetrustDocumentId,
					),
					ne(generatedLegalContracts.id, contractId),
				),
			)
			.limit(1);
		if (otra) {
			await db
				.delete(generatedLegalContracts)
				.where(eq(generatedLegalContracts.id, contractId));
			return { contractId, conservado: false };
		}
	}

	// Completo: WeeTrust no deja borrarlo. Con firmas parciales sí se puede, y
	// se borra igual (si no, los que faltan seguirían pudiendo firmar un
	// documento reemplazado). Si hubo firmas sólo cambia lo que dice el motivo.
	//
	// Quién lo dice importa: el estado local "firmado" lo pone también la
	// confirmación a mano, que no consulta a WeeTrust. Si se le creyera, un
	// contrato confirmado así —pero pendiente allá— se anularía sin borrarlo y
	// sus enlaces seguirían firmando. Así que se pregunta, y si WeeTrust no
	// contesta se intenta borrar igual: fallar es barato, dejarlo vivo no.
	const estadoAlla = viejo.weetrustDocumentId
		? await estadoEnWeeTrust(viejo.weetrustDocumentId)
		: null;
	const completo = estadoAlla?.completo ?? false;
	const conFirmas = viejo.weetrustDocumentId
		? (estadoAlla?.conFirmas ?? true)
		: await alguienFirmo(contractId);
	let borradoAlla = !viejo.weetrustDocumentId;

	if (!completo && viejo.weetrustDocumentId) {
		try {
			await borrarDocumentoDeWeeTrust(viejo.weetrustDocumentId);
			borradoAlla = true;
		} catch (error) {
			// Que no se pueda borrar allá no frena el reemplazo: el documento nuevo
			// ya está enviado y es el bueno. Pero la fila NO se borra: es lo único
			// que dice cuál es el documento viejo, que sigue vivo con sus links.
			console.error(
				`[anularContratoReemplazado] no se pudo borrar ${viejo.weetrustDocumentId} en WeeTrust:`,
				error,
			);
		}
	}

	if (viejo.weetrustDocumentId || conFirmas) {
		await db
			.update(generatedLegalContracts)
			.set({
				status: "cancelled",
				cancellationReason: !borradoAlla
					? `${etiquetaDeMotivo(motivo)} (no se pudo borrar en WeeTrust: hay que borrarlo a mano)`
					: completo || !viejo.weetrustDocumentId
						? etiquetaDeMotivo(motivo)
						: conFirmas
							? `${etiquetaDeMotivo(motivo)} (tenía firmas parciales; el documento se borró en WeeTrust)`
							: `${etiquetaDeMotivo(motivo)} (el documento se borró en WeeTrust)`,
				cancelledAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(generatedLegalContracts.id, contractId));

		return { contractId, conservado: true };
	}

	await db
		.delete(generatedLegalContracts)
		.where(eq(generatedLegalContracts.id, contractId));

	return { contractId, conservado: false };
}

/**
 * Deja un solo contrato vigente por tipo en la oportunidad.
 *
 * Si jurídico genera otra vez un tipo que ya existía (otra fecha, un dato
 * corregido), el anterior queda sin efecto con las mismas reglas que al
 * reemplazar: se borra en WeeTrust si se puede y la fila queda anulada. Si
 * no, al pasar a 85% el WhatsApp mandaba los dos enlaces y el cliente podía
 * firmar el viejo.
 */
async function anularAnterioresDelMismoTipo(
	opportunityId: string,
	contractType: string,
	nuevoId: string,
	motivo = "Reemplazado por una generación nueva del mismo contrato",
): Promise<void> {
	const anteriores = await db
		.select({ id: generatedLegalContracts.id })
		.from(generatedLegalContracts)
		.where(
			and(
				eq(generatedLegalContracts.opportunityId, opportunityId),
				eq(generatedLegalContracts.contractType, contractType),
				ne(generatedLegalContracts.id, nuevoId),
				ne(generatedLegalContracts.status, "cancelled"),
			),
		);

	for (const anterior of anteriores) {
		const anulado = await anularContratoReemplazado(
			anterior.id,
			opportunityId,
			motivo,
		);
		if (anulado?.conservado) {
			await db
				.update(generatedLegalContracts)
				.set({ replacedByContractId: nuevoId })
				.where(eq(generatedLegalContracts.id, anterior.id));
		}
	}
}

/**
 * Retira los contratos anteriores del mismo tipo, pero sólo si el nuevo sigue
 * siendo el que corresponde. Lo usan generar y regenerar desde jurídico.
 *
 * - Toma el mismo candado por oportunidad + tipo que la subida manual: dos
 *   pedidos a la vez ya no se borran mutuamente el contrato nuevo.
 * - Bloquea la oportunidad y verifica que siga en la etapa en la que empezó el
 *   pedido. Si mientras se generaba alguien la aprobó (y mandó el WhatsApp con
 *   los enlaces de entonces), no se instala el nuevo: se deshace y el anterior
 *   sigue vigente. `NO KEY UPDATE` para no trabarse con los borrados de
 *   contratos, que sólo piden `KEY SHARE` sobre la oportunidad.
 *
 * Devuelve si el nuevo quedó como vigente. Quien la llama ya tiene el candado
 * de la oportunidad (pedirlo de nuevo se trabaría): retirar el anterior lo
 * borra en WeeTrust, y un WhatsApp mandando sus enlaces en paralelo le
 * dejaría al cliente links muertos.
 */
async function retirarConCandadoTomado(params: {
	opportunityId: string;
	contractType: string;
	nuevoId: string;
	etapaInicial: string | null;
	motivo?: string;
}): Promise<boolean> {
	const { opportunityId, contractType, nuevoId, etapaInicial, motivo } = params;

	const resultado = await db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext(${`contrato:${opportunityId}:${contractType}`}::text))`,
		);

		const [oportunidad] = await tx
			.select({
				stageId: opportunities.stageId,
				porcentaje: salesStages.closurePercentage,
			})
			.from(opportunities)
			.leftJoin(salesStages, eq(opportunities.stageId, salesStages.id))
			.where(eq(opportunities.id, opportunityId))
			.for("no key update", { of: opportunities });
		// Además de no haber cambiado, tiene que ser la de jurídico (80%): una
		// oportunidad que ya estaba en 85% cuando empezó el pedido también
		// pasaría el "no cambió", y sus enlaces ya salieron por WhatsApp.
		if (
			!oportunidad ||
			oportunidad.stageId !== etapaInicial ||
			!ETAPAS_POR_ACCION.reemplazar.includes(oportunidad.porcentaje as never)
		) {
			return "cambio-de-etapa" as const;
		}

		// Otro pedido simultáneo pudo haberlo retirado ya: ése ganó.
		const [nuevo] = await tx
			.select({
				status: generatedLegalContracts.status,
				reemplazadoPor: generatedLegalContracts.replacedByContractId,
			})
			.from(generatedLegalContracts)
			.where(eq(generatedLegalContracts.id, nuevoId));
		if (!nuevo || nuevo.status === "cancelled" || nuevo.reemplazadoPor) {
			return "perdio" as const;
		}

		await anularAnterioresDelMismoTipo(
			opportunityId,
			contractType,
			nuevoId,
			motivo,
		);
		return "vigente" as const;
	});

	if (resultado === "cambio-de-etapa") {
		await anularContratoReemplazado(
			nuevoId,
			opportunityId,
			"La oportunidad cambió de etapa mientras se generaba",
		);
	}
	return resultado === "vigente";
}

/**
 * Deshace un contrato recién guardado cuyos firmantes no se pudieron guardar:
 * sin ellos no se puede mandar por WhatsApp, sincronizar ni regenerar. Se
 * borra en WeeTrust y la fila queda anulada, con las reglas de anular.
 * Siempre devuelve `false` (no quedó vigente), para usarlo directo como
 * resultado. Quien la llama ya tiene el candado de la oportunidad.
 */
async function deshacerConCandadoTomado(
	contractId: string,
	opportunityId: string,
): Promise<false> {
	await anularContratoReemplazado(
		contractId,
		opportunityId,
		"No se pudieron guardar los firmantes",
	).catch((error) =>
		console.error(
			`[deshacerContratoSinFirmantes] no se pudo deshacer ${contractId}:`,
			error,
		),
	);
	return false;
}

/**
 * Las reglas de "qué se puede subir" para una oportunidad y un tipo.
 *
 * Se piden dos veces: antes de tomar el candado, para cortar sin esperar, y de
 * nuevo ya con el candado, antes de tocar WeeTrust. Dos subidas del mismo tipo
 * a la vez pasaban las dos la primera revisión; la segunda esperaba, subía
 * igual (con sus invitaciones) y recién al guardar se enteraba de que había
 * perdido, así que su documento se borraba y el cliente quedaba con enlaces
 * muertos.
 */
async function exigirQueSePuedaSubir(input: {
	opportunityId: string;
	contractType: string;
	replaceContractId?: string;
}): Promise<void> {
	// Subir un tipo que ya está vigente es reemplazarlo, y eso tiene sus
	// reglas: sólo en 80% y con motivo. Sin elegir "Reemplazar" se corta
	// antes de mandar nada, en vez de anular el anterior por la espalda.
	if (!input.replaceContractId) {
		const [vigente] = await db
			.select({ id: generatedLegalContracts.id })
			.from(generatedLegalContracts)
			.where(
				and(
					eq(generatedLegalContracts.opportunityId, input.opportunityId),
					eq(generatedLegalContracts.contractType, input.contractType),
					ne(generatedLegalContracts.status, "cancelled"),
				),
			)
			.limit(1);
		if (vigente) {
			throw new ORPCError("BAD_REQUEST", {
				message:
					'Ya hay un contrato de este tipo en la oportunidad. Usá "Reemplazar" en ese contrato.',
			});
		}
	}

	// Un anulado ya fue reemplazado: reemplazarlo otra vez dejaría dos
	// documentos activos para el mismo contrato.
	if (input.replaceContractId) {
		const [aReemplazar] = await db
			.select({
				status: generatedLegalContracts.status,
				contractType: generatedLegalContracts.contractType,
			})
			.from(generatedLegalContracts)
			.where(
				and(
					eq(generatedLegalContracts.id, input.replaceContractId),
					eq(generatedLegalContracts.opportunityId, input.opportunityId),
				),
			)
			.limit(1);
		if (!aReemplazar) {
			throw new ORPCError("NOT_FOUND", {
				message: "El contrato a reemplazar no existe en esta oportunidad",
			});
		}
		if (aReemplazar.status === "cancelled") {
			throw new ORPCError("BAD_REQUEST", {
				message: "Ese contrato ya está anulado: no se puede reemplazar.",
			});
		}
		// Reemplazar es cambiar el documento de ESE contrato. Con otro tipo
		// se anulaba uno y quedaba otro duplicado del tipo subido.
		if (aReemplazar.contractType !== input.contractType) {
			throw new ORPCError("BAD_REQUEST", {
				message:
					"El contrato a reemplazar es de otro tipo. Elegí el mismo tipo de contrato.",
			});
		}
	}
}

/** Firmante tal como lo manda el front. */
const signerSchema = z.object({
	role: z.enum(["TITULAR", "COFIRMANTE", "REP_LEGAL", "VENDEDOR"]),
	email: z.string().email(),
	name: z.string().min(1),
	dpi: z.string().optional(),
	phone: z.string().optional(),
});

export const contractGenerationRouter = {
	/**
	 * Obtiene los tipos de contratos disponibles desde la API
	 */
	getContractTypes: juridicoProcedure.handler(async () => {
		try {
			const response = await getDocumentTypes();
			if (!response.success) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Error al obtener tipos de documentos",
				});
			}
			return {
				success: true,
				total: response.total,
				data: response.data,
			};
		} catch (error) {
			console.error("[getContractTypes] Error:", error);
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message:
					error instanceof Error
						? error.message
						: "Error al obtener tipos de documentos",
			});
		}
	}),

	/**
	 * Obtiene documentos y campos por DPI y tipos seleccionados
	 */
	getDocumentsByDpi: juridicoProcedure
		.input(
			z.object({
				dpi: z.string().length(13),
				documentNames: z.array(z.string()).min(1),
				opportunityId: z.string().uuid().optional(),
			}),
		)
		.handler(async ({ input }) => {
			try {
				// Género del CRM como fallback: RENAP a veces no tiene al cliente
				// aunque el DPI sea correcto, y sin género no se puede elegir plantilla.
				// Se resuelve por la oportunidad y no por el DPI porque hay DPI
				// duplicados entre leads (154 grupos según la migración 0028) y un
				// lead viejo puede traer el género vacío o distinto al del dueño de
				// esta oportunidad, que es el que firma.
				const [leadDeLaOportunidad] = input.opportunityId
					? await db
							.select({ gender: leads.gender })
							.from(opportunities)
							.innerJoin(leads, eq(opportunities.leadId, leads.id))
							.where(eq(opportunities.id, input.opportunityId))
							.limit(1)
					: [];

				// Solo si ese lead no tiene género se busca por DPI: los duplicados
				// son la misma persona, así que sirve cualquiera que sí lo tenga.
				// eqDpi y no eq porque los DPI viejos quedaron guardados con
				// espacios ("1648 57656 0101") y el front manda el DPI normalizado.
				const [leadPorDpi] = leadDeLaOportunidad?.gender
					? []
					: await db
							.select({ gender: leads.gender })
							.from(leads)
							.where(and(eqDpi(leads.dpi, input.dpi), isNotNull(leads.gender)))
							.limit(1);

				const gender = leadDeLaOportunidad?.gender ?? leadPorDpi?.gender;
				const generoFallback =
					gender === "female"
						? ("mujer" as const)
						: gender === "male"
							? ("hombre" as const)
							: undefined;

				const response = await getDocumentsByDpi(
					input.dpi,
					input.documentNames,
					generoFallback,
				);
				if (!response.success) {
					throw new ORPCError("BAD_REQUEST", {
						message: response.message || "Error al obtener documentos",
					});
				}
				if (response.renapUnavailable) {
					console.warn(
						`[getDocumentsByDpi] RENAP sin datos para ${input.dpi} (${response.renapError}); se usan los datos del CRM`,
					);
				}
				return {
					success: true,
					renapData: response.renapData,
					documents: response.documents,
					fields: response.campos,
					renapUnavailable: response.renapUnavailable ?? false,
				};
			} catch (error) {
				console.error("[getDocumentsByDpi] Error:", error);
				if (error instanceof ORPCError) throw error;
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message:
						error instanceof Error
							? error.message
							: "Error al obtener documentos por DPI",
				});
			}
		}),

	/**
	 * Obtiene los datos de una oportunidad mapeados para preview de contrato
	 */
	getContractPreviewData: juridicoProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				contractDate: z.date().optional(),
			}),
		)
		.handler(async ({ input }) => {
			const contractData = await mapOpportunityToContractData(
				input.opportunityId,
				input.contractDate,
			);

			if (!contractData) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			return contractData;
		}),

	/**
	 * Valida si una oportunidad tiene todos los datos necesarios para generar contratos
	 */
	validateForContractGeneration: juridicoProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			const validation = await validateOpportunityForContracts(
				input.opportunityId,
			);
			return validation;
		}),

	/**
	 * Intenta enriquecer los datos del lead desde RENAP
	 */
	enrichLeadFromRenap: juridicoProcedure
		.meta({ audit: { entity: "lead", action: "enrich_renap" } })
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			// Obtener el leadId de la oportunidad
			const [opportunity] = await db
				.select({ leadId: opportunities.leadId })
				.from(opportunities)
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunity?.leadId) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada o sin lead asociado",
				});
			}

			const result = await enrichLeadFromRenap(opportunity.leadId);
			return result;
		}),

	/**
	 * Genera contratos para una oportunidad
	 */
	generateContracts: juridicoProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				contractTypes: z.array(z.string()).min(1),
				contractDate: z.object({
					day: z.string(),
					month: z.string(),
					year: z.string(),
				}),
				vendorGender: z.enum(["male", "female"]).optional(),
				beneficiarios: z
					.array(
						z.object({
							cuenta: z.string(),
							monto: z.string(),
						}),
					)
					.optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// 1. Validar que la oportunidad esté en la etapa correcta (80%)
			const [opportunityData] = await db
				.select({
					opportunity: opportunities,
					stage: salesStages,
					lead: leads,
					vehicle: vehicles,
				})
				.from(opportunities)
				.innerJoin(salesStages, eq(opportunities.stageId, salesStages.id))
				.innerJoin(leads, eq(opportunities.leadId, leads.id))
				.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!opportunityData) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}

			if (opportunityData.stage.closurePercentage !== 80) {
				throw new ORPCError("BAD_REQUEST", {
					message: `La oportunidad debe estar en la etapa del 80% para generar contratos. Actualmente está en ${opportunityData.stage.closurePercentage}%`,
				});
			}

			// 2. Validar datos completos
			const validation = await validateOpportunityForContracts(
				input.opportunityId,
			);
			if (!validation.isValid) {
				const allMissing = [
					...validation.missingVehicleFields,
					...validation.missingLeadFields,
					...validation.missingCreditFields,
				];
				throw new ORPCError("BAD_REQUEST", {
					message: `Faltan datos para generar contratos: ${allMissing.join(", ")}`,
				});
			}

			if (
				input.contractTypes.includes("declaracion_jurada") &&
				!input.vendorGender
			) {
				throw new ORPCError("BAD_REQUEST", {
					message: LEGACY_VENDOR_GENDER_REQUIRED_MESSAGE,
				});
			}

			// 3. Construir fecha del contrato
			const contractDate = new Date(
				Number.parseInt(input.contractDate.year),
				getMonthNumber(input.contractDate.month) - 1,
				Number.parseInt(input.contractDate.day),
			);

			// 4. Obtener datos mapeados
			const contractData = await mapOpportunityToContractData(
				input.opportunityId,
				contractDate,
			);

			if (!contractData) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Error al mapear datos de la oportunidad",
				});
			}

			if (
				input.contractTypes.includes("autorizacion_desembolso") &&
				(contractData.desembolso?.omitidosPorMoneda ?? 0) > 0
			) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"No se puede generar la carta de desembolso: hay cheques en una moneda distinta de GTQ",
				});
			}

			// 5. Agregar beneficiarios si se proporcionaron
			if (input.beneficiarios && input.beneficiarios.length > 0) {
				const { numberToWordsQuetzales } = await import(
					"../lib/contract-utils"
				);
				contractData.beneficiarios = input.beneficiarios.map((b) => ({
					cuenta: b.cuenta,
					monto: b.monto,
					montoEnLetras: numberToWordsQuetzales(Number.parseFloat(b.monto)),
				}));
			}

			// 6. Generar cada tipo de contrato solicitado
			const results: Array<{
				contractType: string;
				contractName: string;
				success: boolean;
				contractId?: string;
				signingLinks?: string[];
				error?: string;
			}> = [];

			for (const contractType of input.contractTypes) {
				try {
					// El nombre del contrato viene del tipo (ya es el enum de la API)
					const contractName = `Contrato ${contractType}`;

					// Llamar a la API de legal-docs-blueprints
					const apiResult = await callLegalDocsApi(
						contractType,
						contractData,
						input.vendorGender,
					);

					if (apiResult.success) {
						// Guardar el contrato en la base de datos
						const [newContract] = await db
							.insert(generatedLegalContracts)
							.values({
								leadId: opportunityData.lead.id,
								opportunityId: input.opportunityId,
								contractType,
								contractName,
								...linksPorRol(apiResult.signatories, apiResult.signingLinks),
								signingProvider: apiResult.signingProvider ?? null,
								weetrustDocumentId: apiResult.documentID ?? null,
								observerUrl: apiResult.observerUrl ?? null,
								signatureMode: getSignatureMode(contractType),
								templateId: apiResult.templateId,
								apiResponse: apiResult.rawResponse,
								pdfLink: apiResult.pdfUrl || null,
								status: "pending",
								generatedBy: context.userId,
								generatedAt: new Date(),
							})
							.returning();

						if (newContract) {
							await guardarFirmantes(
								newContract.id,
								apiResult.signatories,
								contractType,
							);
						}

						results.push({
							contractType,
							contractName,
							success: true,
							contractId: newContract.id,
							signingLinks: apiResult.signingLinks,
						});
					} else {
						results.push({
							contractType,
							contractName,
							success: false,
							error: apiResult.error || "Error desconocido",
						});
					}
				} catch (error) {
					results.push({
						contractType,
						contractName: `Contrato ${contractType}`,
						success: false,
						error: error instanceof Error ? error.message : "Error desconocido",
					});
				}
			}

			// 7. Retornar resultados
			const successCount = results.filter((r) => r.success).length;
			const failCount = results.filter((r) => !r.success).length;

			return {
				success: failCount === 0,
				totalRequested: input.contractTypes.length,
				successCount,
				failCount,
				results,
				message:
					failCount === 0
						? `Se generaron ${successCount} contrato(s) exitosamente`
						: `Se generaron ${successCount} contrato(s), ${failCount} fallaron`,
			};
		}),

	/**
	 * Obtiene el estado de contratos generados para una oportunidad
	 */
	getGeneratedContracts: juridicoProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			const contracts = await db
				.select()
				.from(generatedLegalContracts)
				.where(eq(generatedLegalContracts.opportunityId, input.opportunityId))
				.orderBy(generatedLegalContracts.generatedAt);

			return contracts;
		}),

	/**
	 * Genera contratos directamente con datos del formulario
	 * NO enlaza los contratos a la oportunidad, solo los genera
	 */
	generateContractsDirect: juridicoProcedure
		.input(
			z.object({
				/**
				 * La oportunidad para la que se generan. Es opcional porque el camino
				 * viejo no la mandaba, pero con ella se valida la etapa y se toma el
				 * candado ANTES de crear nada en WeeTrust: si no, los documentos ya
				 * salían con sus invitaciones y recién al enlazarlos se descubría que
				 * la oportunidad había cambiado, y había que borrarlos.
				 */
				opportunityId: z.string().uuid().optional(),
				contracts: z.array(
					z.object({
						contractType: z.string(),
						data: z.record(z.string(), z.unknown()).and(
							z.object({
								deudoresAdicionales: z
									.array(
										z.object({
											nombreCompleto: z.string(),
											dpi: z.string(),
											dpiTexto: z.string(),
											edadTexto: z.string().optional(),
											estadoCivil: z.string().optional(),
											profesion: z.string().optional(),
											nacionalidad: z.string().optional(),
										}),
									)
									.optional(),
							}),
						),
						signers: z.array(signerSchema).optional(),
						// Camino viejo: se reparte por índice y con cofirmantes cruza los links.
						emails: z.array(z.string()).optional(),
						options: z.object({
							gender: z.enum(["male", "female"]),
							generatePdf: z.boolean().default(true),
							isPlural: z.boolean().optional(),
							filenamePrefix: z.string(),
						}),
					}),
				),
			}),
		)
		.handler(async ({ input }) => {
			const { generateContractsBatch } = await import(
				"../services/legal-docs-api"
			);

			try {
				// Derivar isPlural automáticamente desde deudoresAdicionales
				const contractsWithPlural = input.contracts.map((contract) => {
					const signers = firmantesDelContrato(
						contract.contractType,
						contract.signers,
						contract,
					);
					return {
						...contract,
						signers,
						// Ya van convertidos en `signers`.
						emails: undefined,
						observers: esFirmaFisica(contract.contractType)
							? undefined
							: CONTRATOS_OBSERVADORES,
						options: {
							...contract.options,
							isPlural: (contract.data.deudoresAdicionales?.length ?? 0) > 0,
							documentName: nombreDelTitular(signers),
						},
					};
				});

				// Generar con el candado de la oportunidad tomado y la etapa ya
				// revisada: WeeTrust manda las invitaciones apenas se crea cada
				// documento, y enterarse después (al enlazar) obligaba a borrarlos
				// dejando al cliente con correos muertos. La llamada al generador
				// tiene tope, así que el candado no se queda tomado si se cuelga.
				const apiResult = await conCandadoDeFirma(
					input.opportunityId ?? null,
					async () => {
						if (input.opportunityId) {
							await exigirEtapaQuePermiteReemplazo(input.opportunityId);
						}
						return generateContractsBatch({ contracts: contractsWithPlural });
					},
				);

				// Transformar resultados al formato esperado por el frontend
				const results: Array<{
					contractType: string;
					contractName: string;
					success: boolean;
					documentLink?: string;
					signingLinks?: string[];
					templateId?: number;
					apiResponse?: unknown;
					r2Key?: string;
					/** Firmantes con su rol, para etiquetar los links sin adivinar. */
					signatories?: FirmanteEnviado[];
					/**
					 * El documento en WeeTrust y el comprobante para descartarlo si
					 * nunca se enlaza (ver `descartarContratosSinEnlazar`).
					 */
					documentID?: string;
					descarte?: string;
					error?: string;
				}> = [];

				let successCount = 0;
				let failCount = 0;

				if (apiResult.results) {
					for (let i = 0; i < apiResult.results.length; i++) {
						const contractResult = apiResult.results[i];
						const originalContract = input.contracts[i];

						const falla = motivoDeFalla(contractResult);

						if (!falla) {
							successCount++;

							// NO guardamos en BD aquí, solo retornamos los datos
							results.push({
								contractType: originalContract.contractType,
								contractName:
									contractResult.nameDocument?.[0]?.label || "Contrato",
								success: true,
								documentLink: contractResult.r2Key
									? await getFileUrlWithBucketInKey(contractResult.r2Key)
									: contractResult.linkDocument,
								r2Key: contractResult.r2Key ?? undefined,
								signingLinks: contractResult.signing_links,
								signatories: contractResult.signatories,
								templateId: contractResult.templateId,
								apiResponse: contractResult,
								documentID: contractResult.documentID,
								descarte:
									contractResult.documentID && input.opportunityId
										? firmarDescarte(
												input.opportunityId,
												contractResult.documentID,
											)
										: undefined,
							});
						} else {
							failCount++;
							console.error(
								`[generateContractsDirect] ${originalContract.contractType}: ${falla}`,
							);
							results.push({
								contractType: originalContract.contractType,
								contractName:
									contractResult.nameDocument?.[0]?.label || "Contrato",
								success: false,
								error: falla,
							});
						}
					}
				}

				return {
					success: failCount === 0,
					totalRequested: input.contracts.length,
					successCount,
					failCount,
					results,
					message:
						failCount === 0
							? `Se generaron ${successCount} documento(s) exitosamente`
							: `Se generaron ${successCount} documento(s), ${failCount} fallaron`,
				};
			} catch (error) {
				console.error("[generateContractsDirect] Error:", error);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message:
						error instanceof Error
							? error.message
							: "Error al generar contratos",
				});
			}
		}),

	/**
	 * Enlaza contratos generados previamente a una oportunidad/lead
	 * Este endpoint guarda los contratos en la base de datos
	 */
	/**
	 * Borra en WeeTrust los documentos que el wizard generó y nunca se enlazaron.
	 *
	 * El wizard genera los contratos —y WeeTrust manda las invitaciones— antes de
	 * que jurídico apriete "Finalizar y Enlazar". Si en vez de enlazar vuelve a
	 * corregir o se va, esos documentos quedaban vivos sin fila en el CRM, al
	 * lado de los vigentes: en 85% el cliente, que ya está firmando, podía firmar
	 * uno que nadie sigue. El wizard llama a esto al volver a corregir y al irse
	 * sin enlazar.
	 *
	 * Sólo borra lo que cumple las dos cosas:
	 * - trae el comprobante de que lo generó el CRM para esta oportunidad (en la
	 *   misma cuenta de WeeTrust viven los de inversiones y los de la app de
	 *   jurídico, que tampoco tienen fila acá);
	 * - ninguna fila lo usa: uno que llegó a enlazarse es un contrato, no un
	 *   descarte.
	 *
	 * Con el candado de la oportunidad, como todo lo que borra en WeeTrust: si un
	 * enlace está en curso, se espera a que termine y recién ahí se mira.
	 */
	descartarContratosSinEnlazar: juridicoProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				documentos: z
					.array(
						z.object({
							documentID: z.string().min(1),
							descarte: z.string().min(1),
						}),
					)
					.max(50),
			}),
		)
		.handler(async ({ input }) => {
			const validos = input.documentos
				.filter((d) =>
					descarteValido(input.opportunityId, d.documentID, d.descarte),
				)
				.map((d) => d.documentID);
			if (validos.length === 0) return { descartados: 0, noBorrados: 0 };

			return conCandadoDeFirma(input.opportunityId, async () => {
				const enlazados = await db
					.select({ documentID: generatedLegalContracts.weetrustDocumentId })
					.from(generatedLegalContracts)
					.where(inArray(generatedLegalContracts.weetrustDocumentId, validos));
				const conFila = new Set(enlazados.map((e) => e.documentID));

				// Cuántos se borraron y cuántos no, para que jurídico lo vea: si uno
				// queda vivo en WeeTrust, el cliente todavía puede firmarlo.
				let descartados = 0;
				let noBorrados = 0;
				for (const documentID of validos) {
					if (conFila.has(documentID)) continue;
					try {
						await borrarDocumentoDeWeeTrust(documentID);
						descartados++;
					} catch (error) {
						// Uno que ya se firmó entero no se puede borrar, y otro que falla
						// no tiene por qué frenar al resto.
						noBorrados++;
						console.error(
							`[descartarContratosSinEnlazar] no se pudo borrar ${documentID}:`,
							error,
						);
					}
				}
				return { descartados, noBorrados };
			});
		}),

	linkContractsToOpportunity: juridicoProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				leadId: z.string().uuid(),
				contracts: z.array(
					z.object({
						contractType: z.string(),
						contractName: z.string(),
						documentLink: z.string().optional(),
						signingLinks: z.array(z.string()).optional(),
						templateId: z.number().optional(),
						apiResponse: z.unknown().optional(),
					}),
				),
				// Datos opcionales para guardar snapshot de regeneración
				contractDate: z.date().optional(),
				generationData: z
					.array(
						z.object({
							contractType: z.string(),
							data: z.record(z.string(), z.unknown()).and(
								z.object({
									deudoresAdicionales: z
										.array(
											z.object({
												nombreCompleto: z.string(),
												dpi: z.string(),
												dpiTexto: z.string(),
												edadTexto: z.string().optional(),
												estadoCivil: z.string().optional(),
												profesion: z.string().optional(),
												nacionalidad: z.string().optional(),
											}),
										)
										.optional(),
								}),
							),
							signers: z.array(signerSchema).optional(),
							// Camino viejo: se reparte por índice y con cofirmantes cruza los links.
							emails: z.array(z.string()).optional(),
							options: z.object({
								gender: z.enum(["male", "female"]),
								generatePdf: z.boolean(),
								isPlural: z.boolean().optional(),
								filenamePrefix: z.string(),
							}),
						}),
					)
					.optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				// Todo con el candado de la oportunidad, desde antes de guardar la
				// primera fila: si no, una aprobación que entrara entre el guardado y el
				// retiro de los anteriores contaba una fila a medio instalar, pasaba a
				// 85% y mandaba el WhatsApp con enlaces que este pedido después borraba.
				return await conCandadoDeFirma(input.opportunityId, async () => {
					const savedContracts: Array<{ id: string; contractType: string }> =
						[];
					const descartados: string[] = [];

					// Documentos que ya están enlazados: pasa cuando se reintenta un pedido
					// que sí se guardó (se perdió la respuesta, doble click). No se vuelven
					// a insertar ni, sobre todo, se borran: la fila que ya existe es la
					// que los usa, y un duplicado retiraba a la otra borrando el documento
					// que compartían.
					const idsDeDocumento = input.contracts
						.map((c) => firmaDelGenerador(c.apiResponse).documentID)
						.filter((id): id is string => !!id);
					const filasYaEnlazadas =
						idsDeDocumento.length === 0
							? []
							: await db
									.select({
										id: generatedLegalContracts.id,
										documentID: generatedLegalContracts.weetrustDocumentId,
										opportunityId: generatedLegalContracts.opportunityId,
										status: generatedLegalContracts.status,
										replacedByContractId:
											generatedLegalContracts.replacedByContractId,
									})
									.from(generatedLegalContracts)
									.where(
										inArray(
											generatedLegalContracts.weetrustDocumentId,
											idsDeDocumento,
										),
									);
					const yaEnlazados = new Map(
						filasYaEnlazadas.map((fila) => [fila.documentID, fila]),
					);

					// Enlazar es de jurídico y sólo en 80%. Si la oportunidad ya pasó (la
					// aprobaron entre generar y enlazar), los documentos recién generados
					// no se instalan: se borran en WeeTrust para que no queden vivos sin
					// registro, con las invitaciones mandadas. Los ya enlazados no: son
					// los vigentes.
					let etapa: Awaited<ReturnType<typeof exigirEtapaQuePermiteReemplazo>>;
					try {
						etapa = await exigirEtapaQuePermiteReemplazo(input.opportunityId);
					} catch (error) {
						for (const contract of input.contracts) {
							const { documentID } = firmaDelGenerador(contract.apiResponse);
							if (documentID && !yaEnlazados.has(documentID)) {
								await borrarDocumentoDeWeeTrust(documentID).catch((e) =>
									console.error(
										`[linkContractsToOpportunity] no se pudo borrar ${documentID}:`,
										e,
									),
								);
							}
						}
						throw error;
					}
					// La etapa contra la que se revalida al retirar los anteriores: la
					// misma lectura que se validó, así lo que se contesta y lo que se
					// instala no pueden diferir.
					const etapaInicial = etapa.stageId;
					const porcentajeEtapa = etapa.porcentaje;

					for (const contract of input.contracts) {
						// El front reenvía tal cual la respuesta del generador; de ahí salen
						// los roles y los identificadores de WeeTrust.
						const generado = firmaDelGenerador(contract.apiResponse);

						const previo = generado.documentID
							? yaEnlazados.get(generado.documentID)
							: undefined;
						if (previo) {
							// Ya quedó enlazado en un pedido anterior: se informa como tal si
							// sigue siendo el vigente de esta oportunidad, sin tocar nada.
							if (
								previo.opportunityId === input.opportunityId &&
								previo.status !== "cancelled" &&
								!previo.replacedByContractId
							) {
								savedContracts.push({
									id: previo.id,
									contractType: contract.contractType,
								});
							} else {
								descartados.push(contract.contractType);
							}
							continue;
						}

						const [saved] = await db
							.insert(generatedLegalContracts)
							.values({
								leadId: input.leadId,
								opportunityId: input.opportunityId,
								contractType: contract.contractType,
								contractName: contract.contractName,
								...linksPorRol(generado.signatories, contract.signingLinks),
								signingProvider: generado.signingProvider ?? null,
								weetrustDocumentId: generado.documentID ?? null,
								observerUrl: generado.observerUrl ?? null,
								signatureMode: getSignatureMode(contract.contractType),
								templateId: contract.templateId,
								apiResponse: contract.apiResponse,
								// La key de R2, no la URL firmada que se muestra (vence en una
								// hora): regenerar baja el PDF de R2 con esta key.
								pdfLink: generado.r2Key || contract.documentLink || null,
								status: "pending",
								generatedBy: context.userId,
								generatedAt: new Date(),
							})
							.returning({ id: generatedLegalContracts.id });

						if (saved) {
							// Sin firmantes guardados el nuevo no se puede mandar ni
							// regenerar: se deshace (se borra en WeeTrust y acá), el
							// anterior sigue vigente y se informa como descartado.
							const quedoVigente = (await guardarFirmantes(
								saved.id,
								generado.signatories,
								contract.contractType,
							))
								? await retirarConCandadoTomado({
										opportunityId: input.opportunityId,
										contractType: contract.contractType,
										nuevoId: saved.id,
										etapaInicial,
									})
								: await deshacerConCandadoTomado(saved.id, input.opportunityId);
							// Descartado (cambió la etapa o ganó otro pedido): esa fila ya no
							// existe o no es la vigente, no se informa como enlazada.
							if (quedoVigente) {
								savedContracts.push({
									id: saved.id,
									contractType: contract.contractType,
								});
							} else {
								descartados.push(contract.contractType);
							}
						}
					}

					// Guardar snapshot si se proporcionaron los datos de generación, y sólo
					// si quedó algún contrato: no tiene sentido para documentos descartados.
					if (
						input.generationData &&
						input.contractDate &&
						savedContracts.length > 0
					) {
						await db.insert(contractGenerationSnapshots).values({
							opportunityId: input.opportunityId,
							contractDate: input.contractDate,
							data: input.generationData,
							createdBy: context.userId,
						});
					}

					return {
						success: descartados.length === 0,
						linkedCount: savedContracts.length,
						contracts: savedContracts,
						descartados,
						// La etapa con la que se enlazó, no la que tenía la pantalla.
						porcentajeEtapa,
						message:
							descartados.length === 0
								? `Se enlazaron ${savedContracts.length} contrato(s) a la oportunidad exitosamente`
								: `Se enlazaron ${savedContracts.length} contrato(s). Se descartaron ${descartados.join(", ")}: la oportunidad cambió mientras se generaban. Recargá y volvé a intentarlo.`,
					};
				});
			} catch (error) {
				console.error("[linkContractsToOpportunity] Error:", error);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message:
						error instanceof Error
							? error.message
							: "Error al enlazar contratos a la oportunidad",
				});
			}
		}),

	/**
	 * Obtiene el último snapshot de generación para una oportunidad
	 */
	getGenerationSnapshot: juridicoProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			const [snapshot] = await db
				.select()
				.from(contractGenerationSnapshots)
				.where(
					eq(contractGenerationSnapshots.opportunityId, input.opportunityId),
				)
				.orderBy(desc(contractGenerationSnapshots.createdAt))
				.limit(1);

			return snapshot || null;
		}),

	/**
	 * Regenera contratos con una nueva fecha
	 * Borra los contratos del mismo tipo y genera nuevos
	 */
	regenerateContracts: juridicoProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				leadId: z.string().uuid(),
				contractTypes: z.array(z.string()).min(1),
				newDate: z.date(),
				// Data de generación (contracts del snapshot)
				generationData: z.array(
					z.object({
						contractType: z.string(),
						data: z.record(z.string(), z.unknown()).and(
							z.object({
								deudoresAdicionales: z
									.array(
										z.object({
											nombreCompleto: z.string(),
											dpi: z.string(),
											dpiTexto: z.string(),
											edadTexto: z.string().optional(),
											estadoCivil: z.string().optional(),
											profesion: z.string().optional(),
											nacionalidad: z.string().optional(),
										}),
									)
									.optional(),
							}),
						),
						signers: z.array(signerSchema).optional(),
						// Camino viejo: se reparte por índice y con cofirmantes cruza los links.
						emails: z.array(z.string()).optional(),
						options: z.object({
							gender: z.enum(["male", "female"]),
							generatePdf: z.boolean(),
							isPlural: z.boolean().optional(),
							filenamePrefix: z.string(),
						}),
					}),
				),
			}),
		)
		.handler(async ({ input, context }) => {
			const { generateContractsBatch } = await import(
				"../services/legal-docs-api"
			);

			try {
				// Regenerar es de jurídico, en 80% u 85%, igual que subir o reemplazar.
				// Se corta antes de generar nada; con el candado se vuelve a mirar.
				await exigirEtapaQuePermiteReemplazo(input.opportunityId);

				// 1. Filtrar solo los contratos de los tipos a regenerar
				const contractsToRegenerate = input.generationData.filter((c) =>
					input.contractTypes.includes(c.contractType),
				);

				if (contractsToRegenerate.length === 0) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"No hay contratos para regenerar con los tipos especificados",
					});
				}

				// 1.5 Obtener termMonths de la quotation más reciente asociada
				const [quotation] = await db
					.select({ termMonths: quotations.termMonths })
					.from(quotations)
					.where(eq(quotations.opportunityId, input.opportunityId))
					.orderBy(desc(quotations.createdAt))
					.limit(1);

				const termMonths = quotation?.termMonths || 60; // Default 60 meses si no hay quotation

				// 2. Actualizar la fecha en los datos de cada contrato
				const contractsWithNewDate = contractsToRegenerate.map((contract) => {
					const newData: Record<string, any> = { ...contract.data };

					// Datos de la nueva fecha
					const day = input.newDate.getDate();
					const monthIndex = input.newDate.getMonth();
					const year = input.newDate.getFullYear();
					const yearShort = year.toString().slice(-2); // "26" para 2026

					const monthNames = [
						"enero",
						"febrero",
						"marzo",
						"abril",
						"mayo",
						"junio",
						"julio",
						"agosto",
						"septiembre",
						"octubre",
						"noviembre",
						"diciembre",
					];
					const monthText = monthNames[monthIndex];

					// === LEER LA FECHA ORIGINAL ANTES DE PISAR NADA ===
					// Obligatorio hacerlo aquí: más abajo se sobreescriben mesTexto/ano
					// con la fecha nueva, y compararlos después siempre daba "no cambió".
					const mesContratoOriginal = monthNames.findIndex(
						(m) =>
							m === (newData.mesTexto as string | undefined)?.toLowerCase(),
					);
					const anioContratoOriginal = normalizarAnio(newData.ano);

					const diaVencOriginal = newData.diaVencimiento
						? Number.parseInt(String(newData.diaVencimiento), 10)
						: null;
					const mesVencOriginal = newData.mesVencimiento
						? Number.parseInt(String(newData.mesVencimiento), 10) - 1
						: null;
					const anioVencOriginal = normalizarAnio(newData.anoVencimiento);

					// === CALCULAR FECHA DE VENCIMIENTO ===
					// Regla de negocio: el día de pago es el pactado con el cliente y NO
					// cambia al regenerar. Lo único que se corre es el mes/año de
					// vencimiento, la misma cantidad de meses que se movió la fecha del
					// contrato, para que el plazo del crédito se respete.
					// Ej: contrato 29/jul con vencimiento 15/ago -> se regenera al 03/ago
					// (corrió 1 mes) -> el vencimiento pasa a 15/sep.
					let mesVenc: number;
					let anioVenc: number;
					let diaVenc: number;

					const puedeCorrerVencimiento =
						mesContratoOriginal !== -1 &&
						anioContratoOriginal !== null &&
						diaVencOriginal !== null &&
						mesVencOriginal !== null &&
						anioVencOriginal !== null;

					if (puedeCorrerVencimiento) {
						const mesesCorridos =
							year * 12 +
							monthIndex -
							(anioContratoOriginal * 12 + mesContratoOriginal);

						const fechaVenc = new Date(
							anioVencOriginal,
							mesVencOriginal + mesesCorridos,
							1,
						);
						mesVenc = fechaVenc.getMonth();
						anioVenc = fechaVenc.getFullYear();

						const diasEnMesVencOriginal = new Date(
							anioVencOriginal,
							mesVencOriginal + 1,
							0,
						).getDate();
						const diasEnMesVenc = new Date(anioVenc, mesVenc + 1, 0).getDate();

						// "último día" es una regla, no un número: se recalcula sobre el
						// mes destino (31 de agosto -> 30 de septiembre).
						const pagoUltimoDia =
							newData.diaPago === "último día" ||
							diaVencOriginal === diasEnMesVencOriginal;

						diaVenc = pagoUltimoDia
							? diasEnMesVenc
							: Math.min(diaVencOriginal, diasEnMesVenc);
					} else {
						// Sin fecha original utilizable en el snapshot: recalcular desde
						// cero con el plazo, igual que la generación original.
						const fechaVenc = new Date(year, monthIndex + termMonths + 1, 1);
						mesVenc = fechaVenc.getMonth();
						anioVenc = fechaVenc.getFullYear();

						const diasEnMesVenc = new Date(anioVenc, mesVenc + 1, 0).getDate();
						if (day <= 20) {
							diaVenc = 15;
							if ("diaPago" in newData) newData.diaPago = "día quince";
						} else {
							diaVenc = diasEnMesVenc;
							if ("diaPago" in newData) newData.diaPago = "último día";
						}
					}

					// Convertir día a texto
					const dayText = numberToSpanishText(day);
					// Convertir año corto a texto (ej: 26 -> "veintiséis")
					const yearText = numberToSpanishText(Number.parseInt(yearShort));
					// Año completo en texto (ej: 2026 -> "dos mil veintiséis")
					const fullYearText = numberToSpanishText(year);

					// Fecha completa en texto
					const fullDateText = `${dayText} de ${monthText} de ${fullYearText}`;

					// Actualizar campos de fecha del contrato
					if ("dia" in newData) newData.dia = day.toString();
					if ("ano" in newData) newData.ano = yearShort;
					if ("diaTexto" in newData) newData.diaTexto = dayText;
					if ("mesTexto" in newData) newData.mesTexto = monthText;
					if ("anoTexto" in newData) newData.anoTexto = yearText;
					if ("fechaInicioContrato" in newData)
						newData.fechaInicioContrato = fullDateText;

					// Actualizar campos de fecha de vencimiento
					const mesVencText = monthNames[mesVenc];
					const anioVencShort = anioVenc.toString().slice(-2);

					if ("diaVencimiento" in newData)
						newData.diaVencimiento = diaVenc.toString();
					if ("mesVencimiento" in newData)
						newData.mesVencimiento = String(mesVenc + 1).padStart(2, "0");
					if ("anoVencimiento" in newData)
						newData.anoVencimiento = anioVencShort;
					if ("diaTextoVencimiento" in newData)
						newData.diaTextoVencimiento = numberToSpanishText(diaVenc);
					if ("mesTextoVencimiento" in newData)
						newData.mesTextoVencimiento = mesVencText;
					if ("anoTextoVencimiento" in newData)
						newData.anoTextoVencimiento = numberToSpanishText(
							Number.parseInt(anioVencShort),
						);

					// Los snapshots viejos sólo guardaron `emails`: se convierten a
					// firmantes con rol para que pasen por el mismo camino.
					const signers = firmantesDelContrato(
						contract.contractType,
						contract.signers,
						{ emails: contract.emails, data: newData },
					);
					return {
						...contract,
						data: newData,
						signers,
						emails: undefined,
						observers: esFirmaFisica(contract.contractType)
							? undefined
							: CONTRATOS_OBSERVADORES,
						options: {
							...contract.options,
							isPlural: (newData.deudoresAdicionales?.length ?? 0) > 0,
							// Las fotos viejas guardaron el prefijo como `<nombre>_<tipo>`:
							// sin el nombre explícito, el tipo técnico se colaba en lo que
							// lee el cliente en WeeTrust.
							documentName: nombreDelTitular(signers),
						},
					};
				});

				// De acá al final, con el candado de la oportunidad tomado: generar,
				// guardar los nuevos y retirar los anteriores. Si se soltara en el
				// medio, un reenvío por WhatsApp entraría cuando los viejos todavía son
				// los vigentes, mandaría sus enlaces, y el retiro los mataría enseguida.
				// La etapa se revisa adentro, antes de crear nada en WeeTrust.
				return conCandadoDeFirma(input.opportunityId, async () => {
					// 3. Generar los nuevos contratos. La etapa se lee acá, ya con el
					// candado: si cambia mientras se generan, los nuevos no reemplazan a
					// los que ya salieron (ver retirarConCandadoTomado), y el porcentaje
					// que se contesta sale de esta misma lectura.
					const etapa = await exigirEtapaQuePermiteReemplazo(
						input.opportunityId,
					);
					const etapaInicial = etapa.stageId;
					const porcentajeEtapa = etapa.porcentaje;
					const apiResult = await generateContractsBatch({
						contracts: contractsWithNewDate,
					});

					if (!apiResult.results || apiResult.results.length === 0) {
						throw new ORPCError("INTERNAL_SERVER_ERROR", {
							message: "Error al generar los contratos",
						});
					}

					// 4. Procesar cada contrato: solo borrar e insertar si la generación fue exitosa
					const savedContracts: Array<{ id: string; contractType: string }> =
						[];
					const failedContracts: string[] = [];

					for (let i = 0; i < apiResult.results.length; i++) {
						const contractResult = apiResult.results[i];
						const originalContract = contractsWithNewDate[i];

						// Un contrato sin PDF no puede reemplazar al anterior: se perdería el
						// documento bueno a cambio de uno que no se puede abrir.
						if (!motivoDeFalla(contractResult)) {
							// Insertar el nuevo contrato. El anterior del mismo tipo se anula
							// recién después: borrarlo acá con un DELETE dejaba su documento
							// vivo en WeeTrust, con las invitaciones ya mandadas.
							const [saved] = await db
								.insert(generatedLegalContracts)
								.values({
									leadId: input.leadId,
									opportunityId: input.opportunityId,
									contractType: originalContract.contractType,
									contractName:
										contractResult.nameDocument?.[0]?.label || "Contrato",
									...linksPorRol(
										contractResult.signatories,
										contractResult.signing_links,
									),
									signingProvider: contractResult.signingProvider ?? null,
									weetrustDocumentId: contractResult.documentID ?? null,
									observerUrl: contractResult.observerUrl ?? null,
									signatureMode: getSignatureMode(
										originalContract.contractType,
									),
									templateId: contractResult.templateId,
									apiResponse: contractResult,
									pdfLink:
										contractResult.r2Key || contractResult.linkDocument || null,
									status: "pending",
									generatedBy: context.userId,
									generatedAt: new Date(),
								})
								.returning({ id: generatedLegalContracts.id });

							if (saved) {
								// Sin firmantes guardados se deshace el nuevo (ver arriba).
								const quedoVigente = (await guardarFirmantes(
									saved.id,
									contractResult.signatories,
									originalContract.contractType,
								))
									? await retirarConCandadoTomado({
											opportunityId: input.opportunityId,
											contractType: originalContract.contractType,
											nuevoId: saved.id,
											etapaInicial,
											motivo: "Regenerado desde jurídico",
										})
									: await deshacerConCandadoTomado(
											saved.id,
											input.opportunityId,
										);
								if (quedoVigente) {
									savedContracts.push({
										id: saved.id,
										contractType: originalContract.contractType,
									});
								} else {
									// Descartado: el anterior sigue vigente, como si hubiera fallado.
									failedContracts.push(originalContract.contractType);
								}
							}
						} else {
							// Registrar contratos que fallaron (no se borran)
							failedContracts.push(originalContract.contractType);
						}
					}

					// Construir mensaje de resultado
					let message = `Se regeneraron ${savedContracts.length} contrato(s) exitosamente`;
					if (failedContracts.length > 0) {
						message += `. Fallaron: ${failedContracts.join(", ")} (no fueron borrados)`;
					}

					return {
						success: savedContracts.length > 0,
						regeneratedCount: savedContracts.length,
						failedCount: failedContracts.length,
						contracts: savedContracts,
						failedContracts,
						message,
						// La etapa con la que se regeneró, no la que tenía la pantalla.
						porcentajeEtapa,
					};
				});
			} catch (error) {
				console.error("[regenerateContracts] Error:", error);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message:
						error instanceof Error
							? error.message
							: "Error al regenerar contratos",
				});
			}
		}),

	/**
	 * Sube un contrato que jurídico armó por fuera y lo manda a firmar.
	 *
	 * El tipo tiene que ser uno de los que tenemos mapeados: así el generador
	 * ubica las líneas de firma por el layout de ese tipo y reparte por rol
	 * igual que en el camino automático. Si el PDF no trae esas líneas no se
	 * manda nada a firmar; es preferible a colocar las firmas a ojo.
	 *
	 * Los firmantes salen de la oportunidad (titular + cofirmantes con correo) y
	 * el representante legal lo agrega el servidor, como en el wizard.
	 */
	uploadContractForSigning: juridicoProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				contractType: z.string().min(1),
				contractName: z.string().min(1).optional(),
				filename: z.string().min(1),
				/** PDF en base64, sin el prefijo `data:`. */
				pdfBase64: z.string().min(1),
				/**
				 * Contrato al que reemplaza. Se usa cuando jurídico corrige uno ya
				 * registrado: el nuevo ocupa su lugar y el viejo se borra.
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

			// Subir o reemplazar, sólo mientras la oportunidad está en 80%: es la
			// etapa de jurídico, y es lo que ya hace la pantalla al esconder los
			// botones. Se vuelve a mirar, bloqueada, antes de guardar.
			await exigirEtapaQuePermiteReemplazo(input.opportunityId);

			// Sólo los tipos con layout auditado: el generador ubica las líneas de
			// firma por ese layout, y sin él no hay forma de repartir por rol.
			if (!esContratoVentaMapeado(input.contractType)) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Ese tipo de contrato no está mapeado para firma por rol. Sólo se pueden subir los contratos de venta.",
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

			const { leadId, signers } = await firmantesDeLaOportunidad(
				input.opportunityId,
			);

			const firmantes = firmantesDelContrato(input.contractType, signers);

			// Hace falta el titular, no cualquier firmante: sin él, el primer
			// codeudor ocupa el bloque de deudores y termina firmando en la línea
			// del cliente.
			if (
				!esFirmaFisica(input.contractType) &&
				!firmantes?.some((f) => f.role === "TITULAR")
			) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"El cliente no tiene correo registrado. Cargalo antes de subir el contrato.",
				});
			}

			await exigirQueSePuedaSubir(input);

			// De acá al final, con el candado de la oportunidad tomado: incluye la
			// subida a WeeTrust. Dos subidas del mismo tipo a la vez mandaban las dos
			// invitaciones antes de que el candado por tipo (más adentro) decidiera
			// cuál gana, y el cliente se quedaba con el enlace del que se borró.
			// También espera a un envío por WhatsApp en curso, para no borrar el
			// documento viejo mientras salen sus enlaces.
			return conCandadoDeFirma(input.opportunityId, async () => {
				// Esperar el candado puede haber tardado (un envío por WhatsApp de la
				// aprobación, por ejemplo), y en esa espera la oportunidad pudo pasar
				// a 85%. Se vuelve a mirar ANTES de subir: WeeTrust manda las
				// invitaciones en el acto, y descubrirlo después dejaba al cliente con
				// correos de un documento que se borra enseguida.
				const { porcentaje: porcentajeEtapa } =
					await exigirEtapaQuePermiteReemplazo(input.opportunityId);
				// Y las reglas del tipo: otra subida pudo instalarse mientras se
				// esperaba el candado.
				await exigirQueSePuedaSubir(input);

				// En WeeTrust se ve quién firma y qué firma, no el nombre con el
				// que quedó guardado el archivo en la computadora de jurídico
				// ("escaneo_final_v2.pdf" no le dice nada al cliente).
				const titularQueSube = firmantes?.find((f) => f.role === "TITULAR");

				const resultado = await subirContratoParaFirma({
					contractType: input.contractType,
					pdfBase64: input.pdfBase64,
					filenamePrefix: input.filename.replace(/\.pdf$/i, ""),
					documentName: titularQueSube?.name,
					signers: firmantes,
					observers: esFirmaFisica(input.contractType)
						? undefined
						: CONTRATOS_OBSERVADORES,
				});

				const falla = motivoDeFalla(resultado);
				if (falla) {
					throw new ORPCError("BAD_REQUEST", { message: falla });
				}

				// Primero se guarda el nuevo y recién después se anula el viejo: si el
				// guardado fallara con el viejo ya borrado, la oportunidad se quedaba
				// sin ninguno de los dos y el documento nuevo sin registro.
				// Si no se puede guardar, el documento ya salió a WeeTrust con sus
				// invitaciones: se borra allá para que un reintento no deje dos vivos.
				const deshacerEnvio = async () => {
					if (!resultado.documentID) return;
					await borrarDocumentoDeWeeTrust(resultado.documentID).catch((error) =>
						console.error(
							`[uploadContractForSigning] no se pudo borrar ${resultado.documentID} tras fallar el guardado:`,
							error,
						),
					);
				};

				// Todo en una transacción: el contrato nuevo, sus firmantes y, si
				// reemplaza a otro, el "reclamo" de ese otro. Si dos personas
				// reemplazan el mismo contrato a la vez, la segunda espera el bloqueo,
				// ve que ya fue reclamado y pierde: se borra su documento en WeeTrust.
				// Los firmantes van adentro porque sin ellos el contrato no se puede
				// mandar por WhatsApp ni regenerar.
				let saved: { id: string } | undefined;
				try {
					saved = await db.transaction(async (tx) => {
						// Un candado por oportunidad + tipo, que dura lo que la
						// transacción. Dos subidas del mismo tipo a la vez pasaban las dos
						// el control de "ya hay uno vigente" (no hay fila que bloquear
						// todavía) y quedaban dos documentos activos. La segunda espera
						// acá y, al volver a mirar, ve el de la primera.
						await tx.execute(
							sql`select pg_advisory_xact_lock(hashtext(${`contrato:${input.opportunityId}:${input.contractType}`}::text))`,
						);
						const [otroVigente] = await tx
							.select({ id: generatedLegalContracts.id })
							.from(generatedLegalContracts)
							.where(
								and(
									eq(
										generatedLegalContracts.opportunityId,
										input.opportunityId,
									),
									eq(generatedLegalContracts.contractType, input.contractType),
									ne(generatedLegalContracts.status, "cancelled"),
									...(input.replaceContractId
										? [ne(generatedLegalContracts.id, input.replaceContractId)]
										: []),
								),
							)
							.limit(1);
						if (otroVigente) {
							throw new ORPCError("CONFLICT", {
								message:
									"Otra persona acaba de subir un contrato de este tipo. Recargá para verlo.",
							});
						}

						// La etapa se vuelve a mirar acá, con la oportunidad bloqueada, para
						// toda subida: mientras WeeTrust recibía el documento alguien pudo
						// pasarla a 85% (y mandar el WhatsApp sin este contrato) o cerrarla.
						const [etapa] = await tx
							.select({ porcentaje: salesStages.closurePercentage })
							.from(opportunities)
							.leftJoin(salesStages, eq(opportunities.stageId, salesStages.id))
							.where(eq(opportunities.id, input.opportunityId))
							.for("update", { of: opportunities });
						if (
							!etapa?.porcentaje ||
							!ETAPAS_POR_ACCION.reemplazar.includes(etapa.porcentaje as never)
						) {
							throw new ORPCError("CONFLICT", {
								message:
									"La oportunidad cambió de etapa mientras se subía el contrato. Ya no se puede subir.",
							});
						}

						if (input.replaceContractId) {
							const [original] = await tx
								.select({
									status: generatedLegalContracts.status,
									reemplazadoPor: generatedLegalContracts.replacedByContractId,
								})
								.from(generatedLegalContracts)
								.where(eq(generatedLegalContracts.id, input.replaceContractId))
								.for("update");
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

						const [nuevo] = await tx
							.insert(generatedLegalContracts)
							.values({
								leadId,
								opportunityId: input.opportunityId,
								contractType: input.contractType,
								contractName:
									input.contractName ||
									resultado.nameDocument?.[0]?.label ||
									"Contrato subido manualmente",
								...linksPorRol(resultado.signatories, resultado.signing_links),
								signingProvider: resultado.signingProvider ?? null,
								weetrustDocumentId: resultado.documentID ?? null,
								observerUrl: resultado.observerUrl ?? null,
								signatureMode: getSignatureMode(input.contractType),
								apiResponse: resultado,
								pdfLink: resultado.r2Key || resultado.linkDocument || null,
								status: "pending",
								generatedBy: context.userId,
								generatedAt: new Date(),
							})
							.returning({ id: generatedLegalContracts.id });
						if (!nuevo) return undefined;

						const filas = filasDeFirmantes(nuevo.id, resultado.signatories);
						if (filas.length > 0) {
							await tx.insert(contractSignatories).values(filas);
						}

						if (input.replaceContractId) {
							await tx
								.update(generatedLegalContracts)
								.set({ replacedByContractId: nuevo.id })
								.where(eq(generatedLegalContracts.id, input.replaceContractId));
						}

						return nuevo;
					});
				} catch (error) {
					await deshacerEnvio();
					throw error;
				}

				if (!saved) {
					await deshacerEnvio();
					throw new ORPCError("INTERNAL_SERVER_ERROR", {
						message:
							"El contrato no se pudo guardar en el CRM; se canceló el envío a firma. Probá de nuevo.",
					});
				}

				const anulado = input.replaceContractId
					? await anularContratoReemplazado(
							input.replaceContractId,
							input.opportunityId,
							input.motivo as string,
						)
					: null;

				// Deja el rastro: el anulado apunta al que lo reemplazó.
				if (anulado?.conservado) {
					await db
						.update(generatedLegalContracts)
						.set({ replacedByContractId: saved.id })
						.where(eq(generatedLegalContracts.id, anulado.contractId));
				}

				return {
					success: true,
					contractId: saved.id,
					contractType: input.contractType,
					// La etapa con la que se subió, no la que tenía la pantalla.
					porcentajeEtapa,
					// El contrato ya está enviado y guardado: que falle firmar la URL no
					// puede hacer que la pantalla diga "falló" e invite a subirlo de nuevo.
					documentLink: resultado.r2Key
						? await getFileUrlWithBucketInKey(resultado.r2Key).catch(
								(error) => {
									console.error(
										"[uploadContractForSigning] no se pudo firmar la URL del PDF:",
										error,
									);
									return null;
								},
							)
						: resultado.linkDocument,
					signingLinks: resultado.signing_links ?? [],
					message:
						getSignatureMode(input.contractType) === "fisica"
							? input.replaceContractId
								? "Contrato reemplazado. Se firma en papel."
								: "Contrato subido. Se firma en papel."
							: `Contrato ${input.replaceContractId ? "reemplazado" : "subido"} y enviado a firma (${resultado.signing_links?.length ?? 0} enlace(s))`,
				};
			});
		}),
};

/**
 * Normaliza un año que puede venir con 2 o 4 dígitos ("26" | "2026").
 * Los snapshots viejos guardaron el año del contrato como 19xx porque
 * `new Date(26, ...)` mapea los años 0-99 a 1900+, por eso se corrige el siglo.
 */
function normalizarAnio(valor: unknown): number | null {
	if (valor === null || valor === undefined || valor === "") return null;
	const anio =
		typeof valor === "number"
			? valor
			: Number.parseInt(String(valor).trim(), 10);
	if (!Number.isFinite(anio)) return null;
	if (anio < 100) return 2000 + anio;
	if (anio < 2000) return anio + 100; // 1926 -> 2026
	return anio;
}

/**
 * Convierte nombre del mes en español a número
 */
function getMonthNumber(monthName: string): number {
	const months: Record<string, number> = {
		enero: 1,
		febrero: 2,
		marzo: 3,
		abril: 4,
		mayo: 5,
		junio: 6,
		julio: 7,
		agosto: 8,
		septiembre: 9,
		octubre: 10,
		noviembre: 11,
		diciembre: 12,
	};
	return months[monthName.toLowerCase()] || 1;
}

/**
 * Convierte un número a texto en español
 */
function numberToSpanishText(num: number): string {
	const unidades = [
		"",
		"uno",
		"dos",
		"tres",
		"cuatro",
		"cinco",
		"seis",
		"siete",
		"ocho",
		"nueve",
		"diez",
		"once",
		"doce",
		"trece",
		"catorce",
		"quince",
		"dieciséis",
		"diecisiete",
		"dieciocho",
		"diecinueve",
		"veinte",
		"veintiuno",
		"veintidós",
		"veintitrés",
		"veinticuatro",
		"veinticinco",
		"veintiséis",
		"veintisiete",
		"veintiocho",
		"veintinueve",
	];

	const decenas = [
		"",
		"",
		"veinte",
		"treinta",
		"cuarenta",
		"cincuenta",
		"sesenta",
		"setenta",
		"ochenta",
		"noventa",
	];

	const centenas = [
		"",
		"ciento",
		"doscientos",
		"trescientos",
		"cuatrocientos",
		"quinientos",
		"seiscientos",
		"setecientos",
		"ochocientos",
		"novecientos",
	];

	if (num === 0) return "cero";
	if (num === 100) return "cien";
	if (num < 30) return unidades[num];

	if (num < 100) {
		const decena = Math.floor(num / 10);
		const unidad = num % 10;
		if (unidad === 0) return decenas[decena];
		return `${decenas[decena]} y ${unidades[unidad]}`;
	}

	if (num < 1000) {
		const centena = Math.floor(num / 100);
		const resto = num % 100;
		if (resto === 0) return num === 100 ? "cien" : centenas[centena];
		return `${centenas[centena]} ${numberToSpanishText(resto)}`;
	}

	if (num < 2000) {
		const resto = num % 1000;
		if (resto === 0) return "mil";
		return `mil ${numberToSpanishText(resto)}`;
	}

	if (num < 1000000) {
		const miles = Math.floor(num / 1000);
		const resto = num % 1000;
		const milesText = numberToSpanishText(miles);
		if (resto === 0) return `${milesText} mil`;
		return `${milesText} mil ${numberToSpanishText(resto)}`;
	}

	// Para años como 2026
	return num.toString();
}

/**
 * Interfaz para el resultado de la API de legal-docs
 */
interface LegalDocsApiResult {
	success: boolean;
	templateId?: number;
	signingLinks?: string[];
	/** Firmantes con su rol y su link, cuando el generador los reporta. */
	signatories?: FirmanteEnviado[];
	signingProvider?: string;
	documentID?: string;
	observerUrl?: string;
	pdfUrl?: string;
	rawResponse?: unknown;
	error?: string;
}

/**
 * Llama a la API de legal-docs-blueprints para generar un contrato
 */
async function callLegalDocsApi(
	contractType: string,
	data: Awaited<ReturnType<typeof mapOpportunityToContractData>>,
	vendorGender?: "male" | "female",
): Promise<LegalDocsApiResult> {
	try {
		if (!data) {
			return {
				success: false,
				error: "No hay datos para generar el contrato",
			};
		}

		// Mapear el tipo de contrato del CRM al tipo de legal-docs-blueprints
		// Valores tomados del enum ContractType en legal-docs-blueprints/types/contract.ts
		const contractTypeMap: Record<string, string> = {
			compraventa: "contrato_privado_uso_carro_usado",
			credito_prendario: "garantia_mobiliaria",
			pagare: "pagare_unico_libre_protesto",
			reconocimiento_deuda: "reconocimiento_deuda_feb_2025",
			contrato_gps: "carta_aceptacion_instalacion_gps",
			contrato_seguro: "cobertura_inrexsa",
			declaracion_jurada: "declaracion_vendedor",
			acta_entrega: "descargo_responsabilidades",
			carta_compromiso: "carta_carro_nuevo",
			autorizacion_desembolso: "carta_emision_cheques",
			// Tipos adicionales disponibles en el API:
			// carta_traspaso_vehiculo: "carta_traspaso_vehiculo_rdbe",
			// contrato_carro_nuevo: "contrato_privado_uso_carro_nuevo",
			// solicitud_compra_tercero: "solicitud_compra_vehiculo_tercero",
		};

		const apiContractType = contractTypeMap[contractType];
		if (!apiContractType) {
			return {
				success: false,
				error: `Tipo de contrato no soportado: ${contractType}`,
			};
		}

		// Transformar datos del CRM al formato plano que espera el API
		const flatData = transformToApiFormat(data, contractType);

		// Extraer email del cliente para los links de firma
		// En modo prueba, el mismo desvío que en la generación nueva: este camino
		// arma el correo por su cuenta y le llegaba la invitación al cliente real.
		const clientEmail = data.cliente?.email;
		let emails = clientEmail ? [clientEmail] : undefined;
		if (emails && isTestModeEnabled()) {
			const titular = [{ role: "TITULAR", email: emails[0] }];
			const faltan = correosDePruebaFaltantes(titular);
			if (faltan.length > 0) {
				return {
					success: false,
					error: `TEST_MESSAGE=true pero falta configurar ${faltan.join(" y ")}: el enlace saldría al correo real del cliente.`,
				};
			}
			emails = aplicarCorreosDePrueba(titular).map((p) => p.email);
		}

		// Determinar género para concordancia en documentos
		const gender = resolveLegacyContractGender({
			apiContractType,
			clientGender: data.cliente?.genero,
			vendorGender,
		});

		// Preparar payload para el endpoint /contracts/:type
		// El endpoint extrae emails y gender del body, el resto va a data
		const payload = {
			...flatData,
			emails,
			gender,
		};

		const endpoint = `/contracts/${apiContractType}`;
		console.log(`[LegalDocs] Llamando a ${LEGAL_DOCS_API_URL}${endpoint}`);
		console.log(
			`[LegalDocs] Payload keys: ${Object.keys(flatData).join(", ")}`,
		);

		const response = await fetch(`${LEGAL_DOCS_API_URL}${endpoint}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${process.env.LEGAL_DOCS_API_KEY || ""}`,
			},
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`[LegalDocs] Error response: ${errorText}`);
			return {
				success: false,
				error: `Error de la API: ${response.status} - ${errorText}`,
			};
		}

		const result = await response.json();

		return {
			success: true,
			templateId: result.templateId,
			signingLinks: result.signing_links || result.signingLinks || [],
			...firmaDelGenerador(result),
			pdfUrl: result.pdf_url || result.pdfUrl,
			rawResponse: result,
		};
	} catch (error) {
		console.error("[LegalDocs] Error llamando a la API:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : "Error de conexión",
		};
	}
}
