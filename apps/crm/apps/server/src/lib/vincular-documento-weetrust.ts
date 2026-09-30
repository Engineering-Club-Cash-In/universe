import { ORPCError } from "@orpc/server";
import { and, eq, ilike, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
	contractSignatories,
	generatedLegalContracts,
} from "../db/schema/legal-contracts";
import {
	borrarDocumentoDeWeeTrust,
	type ContractSigner,
	consultarEstadoFirma,
	type EstadoDocumentoFirma,
	renovarEnlacesEnElMismoDocumento,
	type SignerRole,
} from "../services/legal-docs-api";
import {
	documentIdDesdeLosEnlaces,
	type FirmanteEnviado,
	filasDeFirmantes,
	linksPorRol,
	salioPorDocumenso,
} from "./contract-signatories";
import { sincronizarEstadoDeFirma } from "./contrato-estado-firma";
import {
	conMarcaDeVinculado,
	documentIdDeWeeTrust,
	ROL_EN_PALABRAS,
} from "./contrato-falta-vincular";

/**
 * Vincular con un contrato del CRM un documento que alguien armó a mano en
 * WeeTrust (ver `contrato-falta-vincular.ts` para el porqué).
 *
 * Lo comparten ventas e inversiones: cada una sabe quiénes tienen que firmar su
 * contrato y con qué candado se escribe; acá está lo que es igual para las dos
 * —leer el documento, emparejar a los firmantes y dejar la fila vinculada.
 */

/** Alguien que tiene que firmar el contrato, según el CRM. */
export type FirmanteEsperado = Pick<ContractSigner, "role" | "email" | "name">;

/** Lo que se encontró al mirar el documento en WeeTrust. */
export interface RevisionDelDocumento {
	documentID: string;
	/** `PENDING`, `COMPLETED`… tal como lo dice WeeTrust. */
	estado: string;
	/** Los firmantes del documento, ya con el rol que les toca en el contrato. */
	firmantes: Array<{
		role: SignerRole;
		nombre: string;
		correo: string;
		firmo: boolean;
	}>;
	/** Quienes el CRM esperaba y el documento no trae. */
	faltan: Array<{ role: SignerRole; nombre: string; correo: string }>;
	/** Correos del documento que no son de nadie de este contrato. */
	desconocidos: string[];
	/** Por qué NO se puede vincular. Null = se puede. */
	problema: string | null;
}

/**
 * Un firmante del documento, ya con su rol en el contrato y con lo que WeeTrust
 * dice de él al momento de leerlo: si firmó y cuándo vence su enlace.
 */
export type FirmanteDelDocumento = FirmanteEnviado & {
	firmo: boolean;
	/** Epoch en milisegundos, o null si el enlace no vence. */
	expiry: number | null;
};

/** Un firmante esperado, con lo que hay que pedirle en WeeTrust. */
export interface FirmanteDeLaGuia {
	role: SignerRole;
	nombre: string;
	correo: string;
	/** Qué verificación de identidad ponerle al agregarlo en WeeTrust. */
	verificacion: string;
}

/**
 * Arma la guía para quien va a subir el documento a WeeTrust: a quiénes agregar
 * como firmantes, con qué correo —tiene que ser ESE, porque por el correo se
 * empareja después— y qué verificación de identidad pedirle a cada uno.
 *
 * Lo último no se puede comprobar al vincular (WeeTrust no dice qué se pidió),
 * así que se deja dicho acá, que es donde la persona lo está configurando. A
 * los representantes nunca se les pide nada.
 */
export function guiaParaVincular(
	esperados: FirmanteEsperado[],
	verificacionDelCliente: string,
): FirmanteDeLaGuia[] {
	return esperados.map((e) => ({
		role: e.role,
		nombre: e.name,
		correo: e.email,
		verificacion:
			e.role === "REP_LEGAL" || e.role === "REP_LEGAL_RDBE"
				? "Ninguna"
				: verificacionDelCliente,
	}));
}

const normalizar = (correo: string) => correo.trim().toLowerCase();

/**
 * Compara el documento de WeeTrust con quienes tienen que firmar el contrato.
 *
 * Los firmantes se emparejan por correo, que es la llave de WeeTrust. Tres
 * cosas impiden vincular:
 *
 * - que el documento siga en borrador (no se mandó a firmar: no tiene enlaces);
 * - que lo firme alguien que no es de este contrato (es el documento de otra
 *   operación, o un correo mal escrito: ese enlace no le llegaría a nadie que
 *   el CRM conozca);
 * - que no esté el titular, que es la firma que hace al contrato.
 *
 * Que falte otro (un codeudor, el representante) se informa pero no lo impide:
 * un documento hecho por fuera puede no llevarlos, y quien vincula lo ve antes
 * de confirmar.
 */
export function revisarDocumento(
	esperados: FirmanteEsperado[],
	estado: EstadoDocumentoFirma,
): RevisionDelDocumento & { enviados: FirmanteDelDocumento[] } {
	const porCorreo = new Map(esperados.map((e) => [normalizar(e.email), e]));

	const enviados: FirmanteDelDocumento[] = [];
	const firmantes: RevisionDelDocumento["firmantes"] = [];
	const desconocidos: string[] = [];
	const vistos = new Set<string>();

	for (const firmante of estado.signatories) {
		const correo = normalizar(firmante.emailID);
		const esperado = porCorreo.get(correo);
		if (!esperado) {
			desconocidos.push(firmante.emailID);
			continue;
		}
		if (vistos.has(correo)) continue;
		vistos.add(correo);
		enviados.push({
			role: esperado.role,
			// El correo y el nombre del CRM, no los de WeeTrust: con ésos se busca
			// después a quién le toca cada enlace.
			email: esperado.email,
			name: esperado.name,
			signatoryID: firmante.signatoryID || undefined,
			signingUrl: firmante.signingUrl ?? undefined,
			firmo: firmante.isSigned,
			expiry: firmante.expiry ?? null,
		});
		firmantes.push({
			role: esperado.role,
			nombre: esperado.name,
			correo: esperado.email,
			firmo: firmante.isSigned,
		});
	}

	const faltan = esperados
		.filter((e) => !vistos.has(normalizar(e.email)))
		.map((e) => ({ role: e.role, nombre: e.name, correo: e.email }));

	const titular = esperados.find((e) => e.role === "TITULAR");

	let problema: string | null = null;
	if (estado.status === "DRAFT") {
		problema =
			"El documento todavía es un borrador en WeeTrust: falta mandarlo a firmar. Mandalo y volvé a pegar el enlace.";
	} else if (estado.signatories.length === 0) {
		problema = "El documento no tiene firmantes en WeeTrust.";
	} else if (desconocidos.length > 0) {
		problema = `El documento lo firma alguien que no es de este contrato: ${desconocidos.join(", ")}. Revisá que sea el documento correcto y que los correos sean los de la lista.`;
	} else if (titular && !vistos.has(normalizar(titular.email))) {
		problema = `En el documento no está ${titular.name} (${titular.email}), que firma como ${(ROL_EN_PALABRAS.TITULAR ?? "titular").toLowerCase()}.`;
	}

	return {
		documentID: estado.documentID,
		estado: estado.status,
		firmantes,
		faltan,
		desconocidos,
		problema,
		enviados,
	};
}

/**
 * Lee en WeeTrust el documento que pegó la persona y lo revisa.
 *
 * Corta con un mensaje para quien lo pegó si el enlace no se reconoce o si
 * WeeTrust no encuentra el documento. Lo demás vuelve en `problema`.
 */
export async function leerDocumentoParaVincular(
	pegado: string,
	esperados: FirmanteEsperado[],
): Promise<{
	revision: RevisionDelDocumento & { enviados: FirmanteDelDocumento[] };
	estado: EstadoDocumentoFirma;
	observadoEn: Date;
}> {
	const documentID = documentIdDeWeeTrust(pegado);
	if (!documentID) {
		throw new ORPCError("BAD_REQUEST", {
			message:
				"No reconozco ese enlace. Pegá el enlace de firma de cualquiera de los firmantes (empieza con https://app.weetrust.mx/signatory/…) o el ID del documento.",
		});
	}

	const observadoEn = new Date();
	let estado: EstadoDocumentoFirma;
	try {
		estado = await consultarEstadoFirma(documentID);
	} catch (error) {
		console.error(
			`[vincular] no se pudo leer el documento ${documentID}:`,
			error,
		);
		throw new ORPCError("BAD_REQUEST", {
			message:
				"No encontré ese documento en WeeTrust. Revisá que el enlace esté completo y que el documento no se haya borrado.",
		});
	}

	return { revision: revisarDocumento(esperados, estado), estado, observadoEn };
}

type Transaccion = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Deja la fila del contrato vinculada al documento. Se llama dentro de la
 * transacción de quien vincula, con su candado ya tomado.
 *
 * Sirve para los dos casos: el contrato que no salió a firma (no tiene
 * documento) y el que sí salió y se le cambia por otro. En el segundo devuelve
 * el documento que tenía, para que quien llama lo borre en WeeTrust DESPUÉS de
 * confirmar la transacción: borrarlo antes y que el guardado falle dejaría al
 * contrato sin ninguno de los dos.
 *
 * Vuelve a mirar la fila, bloqueada: mientras WeeTrust contestaba, otra persona
 * pudo vincularla, reemplazarla, anularla, o el contrato pudo terminar de
 * firmarse. Y el documento no puede ser ya el de otro contrato.
 *
 * Esa última revisión va con un candado por documento: dos personas que pegan
 * el mismo documento en dos contratos a la vez bloquean cada una su fila, y sin
 * él ninguna veía el cambio sin confirmar de la otra —no hay índice único en
 * `weetrust_document_id`—. Con el candado, la segunda espera y lo encuentra.
 */
export async function vincularEnLaFila(
	tx: Transaccion,
	params: {
		contractId: string;
		revision: RevisionDelDocumento & { enviados: FirmanteDelDocumento[] };
		observerUrl: string | null;
		por: string;
		/** Cuándo se leyó el documento en WeeTrust. */
		observadoEn: Date;
	},
): Promise<{ documentoAnterior: string | null }> {
	const { contractId, revision } = params;

	await tx.execute(
		sql`select pg_advisory_xact_lock(hashtext(${`weetrust-documento:${revision.documentID}`}::text))`,
	);

	const [fila] = await tx
		.select({
			status: generatedLegalContracts.status,
			reemplazadoPor: generatedLegalContracts.replacedByContractId,
			signatureMode: generatedLegalContracts.signatureMode,
			weetrustDocumentId: generatedLegalContracts.weetrustDocumentId,
			signingProvider: generatedLegalContracts.signingProvider,
			clientSigningLink: generatedLegalContracts.clientSigningLink,
			representativeSigningLink:
				generatedLegalContracts.representativeSigningLink,
			additionalSigningLinks: generatedLegalContracts.additionalSigningLinks,
			apiResponse: generatedLegalContracts.apiResponse,
		})
		.from(generatedLegalContracts)
		.where(eq(generatedLegalContracts.id, contractId))
		.for("update")
		.limit(1);

	if (!fila || fila.status !== "pending" || fila.reemplazadoPor) {
		throw new ORPCError("CONFLICT", {
			message:
				"Este contrato ya no está pendiente de firma: se firmó, se reemplazó o se anuló. Recargá para verlo.",
		});
	}

	const motivo = motivoPorElQueNoSeVincula(fila);
	if (motivo) throw new ORPCError("BAD_REQUEST", { message: motivo });

	// Los contratos de antes no guardaron el id: viaja en sus enlaces.
	const documentoAnterior =
		fila.weetrustDocumentId ?? documentIdDesdeLosEnlaces(fila);
	if (documentoAnterior === revision.documentID) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Ese ya es el documento de este contrato.",
		});
	}

	if (await documentoDeOtroContrato(tx, revision.documentID, contractId)) {
		throw new ORPCError("CONFLICT", {
			message:
				"Ese documento de WeeTrust ya es el de otro contrato del CRM. Revisá que sea el enlace correcto.",
		});
	}

	const ahora = new Date();
	await tx
		.update(generatedLegalContracts)
		.set({
			weetrustDocumentId: revision.documentID,
			signingProvider: "weetrust",
			observerUrl: params.observerUrl,
			...linksPorRol(
				revision.enviados,
				revision.enviados.map((f) => f.signingUrl ?? ""),
			),
			apiResponse: conMarcaDeVinculado(fila.apiResponse, {
				por: params.por,
				cuando: ahora.toISOString(),
				...(documentoAnterior ? { documentoAnterior } : {}),
			}),
			// Cambiar de documento deja muertos los enlaces que ya se habían
			// mandado: cuenta como una renovación.
			...(documentoAnterior ? { lastRegeneratedAt: ahora } : {}),
			updatedAt: ahora,
		})
		.where(eq(generatedLegalContracts.id, contractId));

	// Los firmantes son los del documento nuevo: los del anterior —con sus
	// enlaces y lo que hubieran firmado allá— se van con él.
	await tx
		.delete(contractSignatories)
		.where(eq(contractSignatories.contractId, contractId));

	// Con lo que dijo WeeTrust al leerlo: quién ya firmó y cuándo vence cada
	// enlace. Sin esto nacían todos pendientes y sin vencimiento, y la
	// sincronización de después no los corregía: su foto es de antes de que
	// existieran las filas, y no pisa filas más nuevas que ella. Con
	// `updatedAt` en el momento de la lectura, esa misma foto sí las alcanza.
	const porCorreo = new Map(
		revision.enviados.map((f) => [f.email.toLowerCase(), f]),
	);
	await tx.insert(contractSignatories).values(
		filasDeFirmantes(contractId, revision.enviados).map((fila) => {
			const leido = porCorreo.get(fila.email.toLowerCase());
			return {
				...fila,
				status: leido?.firmo ? ("signed" as const) : ("pending" as const),
				signedAt: leido?.firmo ? params.observadoEn : null,
				signingUrlExpiry: leido?.expiry ? new Date(leido.expiry) : null,
				updatedAt: params.observadoEn,
			};
		}),
	);

	return { documentoAnterior };
}

/**
 * Si el documento ya es el de otro contrato del CRM.
 *
 * No alcanza con `weetrust_document_id`: los contratos de antes no lo
 * guardaron, y en prod son la mayoría de los pendientes. Su documento viaja en
 * los enlaces —`/signatory/{documento}/…` y `/observer/{documento}/…`—, en las
 * columnas del contrato o en sus firmantes. Si se aceptara, dos filas
 * apuntarían al mismo documento: el estado de firma se lo llevaría la nueva, y
 * cambiarlo o anularlo le dejaría muertos al otro contrato los enlaces que ya
 * tiene la gente.
 *
 * El id ya viene validado (24 caracteres hexadecimales), así que no hay nada
 * que escapar en el `like`.
 */
async function documentoDeOtroContrato(
	tx: Transaccion,
	documentID: string,
	contractId: string,
): Promise<boolean> {
	const deFirma = `%/signatory/${documentID}/%`;
	const deObservador = `%/observer/${documentID}/%`;

	const [enElContrato] = await tx
		.select({ id: generatedLegalContracts.id })
		.from(generatedLegalContracts)
		.where(
			and(
				ne(generatedLegalContracts.id, contractId),
				or(
					eq(generatedLegalContracts.weetrustDocumentId, documentID),
					ilike(generatedLegalContracts.clientSigningLink, deFirma),
					ilike(generatedLegalContracts.representativeSigningLink, deFirma),
					sql`array_to_string(${generatedLegalContracts.additionalSigningLinks}, ' ') ilike ${deFirma}`,
					ilike(generatedLegalContracts.observerUrl, deObservador),
				),
			),
		)
		.limit(1);
	if (enElContrato) return true;

	// Consulta aparte y no un EXISTS correlacionado: Drizzle deja la columna de
	// afuera sin calificar y el predicado da siempre verdadero.
	const [enSusFirmantes] = await tx
		.select({ id: contractSignatories.id })
		.from(contractSignatories)
		.where(
			and(
				ne(contractSignatories.contractId, contractId),
				ilike(contractSignatories.signingUrl, deFirma),
			),
		)
		.limit(1);
	return Boolean(enSusFirmantes);
}

/**
 * Por qué a un contrato no se le puede vincular un documento de WeeTrust, o
 * null si se puede.
 */
export function motivoPorElQueNoSeVincula(contrato: {
	signatureMode: string | null;
	signingProvider: string | null;
	clientSigningLink: string | null;
	representativeSigningLink: string | null;
	additionalSigningLinks: string[] | null;
}): string | null {
	if (contrato.signatureMode === "fisica") {
		return "Este contrato se firma en papel: no lleva documento en WeeTrust.";
	}
	// Un documento de Documenso no se puede borrar desde acá: quedaría vivo al
	// lado del nuevo, con enlaces que todavía firman.
	if (salioPorDocumenso(contrato)) {
		return "Este contrato salió por Documenso: no se le puede cambiar el documento. Reemplazalo desde jurídico.";
	}
	return null;
}

/**
 * Lo que queda por hacer con la vinculación ya confirmada, fuera del candado de
 * la fila: bajar a la base quién ya firmó en el documento nuevo, y borrar en
 * WeeTrust el que tenía.
 *
 * Ninguna de las dos deshace la vinculación si falla. El estado se vuelve a
 * leer con "Actualizar estado" o con el próximo aviso de WeeTrust; el documento
 * viejo que no se pudo borrar se devuelve como aviso, porque sus enlaces siguen
 * firmando y alguien tiene que borrarlo a mano.
 */
export async function terminarDeVincular(params: {
	contractId: string;
	estado: EstadoDocumentoFirma;
	observadoEn: Date;
	documentoAnterior: string | null;
}): Promise<{ aviso: string | null }> {
	try {
		await sincronizarEstadoDeFirma(params.contractId, params.estado, {
			observadoEn: params.observadoEn,
		});
	} catch (error) {
		console.error(
			`[vincular] contrato ${params.contractId}: no se pudo bajar el estado de firma:`,
			error,
		);
	}

	if (!params.documentoAnterior) return { aviso: null };

	try {
		await borrarDocumentoDeWeeTrust(params.documentoAnterior);
		return { aviso: null };
	} catch (error) {
		console.error(
			`[vincular] contrato ${params.contractId}: no se pudo borrar el documento anterior ${params.documentoAnterior}:`,
			error,
		);
		return {
			aviso:
				"El documento anterior no se pudo borrar en WeeTrust: sus enlaces siguen sirviendo. Borralo a mano allá.",
		};
	}
}

/**
 * Renueva los enlaces de un contrato vinculado, sobre su mismo documento.
 *
 * Un contrato emitido por el CRM se renueva reemitiéndolo: documento nuevo, con
 * las firmas ubicadas otra vez por el layout. Uno armado a mano en WeeTrust no
 * puede pasar por ahí —sus firmas no están donde el layout las busca—, así que
 * se le piden a WeeTrust direcciones nuevas para quien todavía no firmó. Los
 * que ya firmaron no se tocan.
 *
 * Devuelve cuántos enlaces quedaron vigentes.
 */
export async function renovarEnlacesDelVinculado(
	contractId: string,
	documentID: string,
): Promise<number> {
	const observadoEn = new Date();
	const estado = await renovarEnlacesEnElMismoDocumento(documentID);
	await sincronizarEstadoDeFirma(contractId, estado, { observadoEn });

	// Las columnas de enlaces de siempre, al día con los firmantes.
	const firmantes = await db
		.select()
		.from(contractSignatories)
		.where(eq(contractSignatories.contractId, contractId))
		.orderBy(contractSignatories.position);
	const enviados: FirmanteEnviado[] = firmantes.map((f) => ({
		role: f.role as SignerRole,
		email: f.email,
		name: f.name,
		signingUrl: f.signingUrl ?? undefined,
	}));

	await db
		.update(generatedLegalContracts)
		.set({
			...linksPorRol(
				enviados,
				enviados.map((f) => f.signingUrl ?? ""),
			),
			lastRegeneratedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(generatedLegalContracts.id, contractId),
				eq(generatedLegalContracts.weetrustDocumentId, documentID),
			),
		);

	return estado.signatories.filter((f) => !f.isSigned && f.signingUrl).length;
}
