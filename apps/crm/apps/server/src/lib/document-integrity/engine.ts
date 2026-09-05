import { IDENTITY_MATCH_THRESHOLD, nameSimilarity } from "../name-similarity";
import {
	ESTADO_CUENTA_AI_SIGNAL_META,
	getIssuerFingerprint,
} from "./kinds/estado-cuenta";
import {
	classifyProducer,
	inspectPdf,
	type PdfForensicsResult,
} from "./pdf-forensics";
import { applyRuleset, makeSignal } from "./ruleset";
import type {
	DocumentIntegrityAiResult,
	Signal,
	ValidationOutcome,
} from "./types";

export interface IntegrityDuplicateContext {
	shaInSameOpportunity?: boolean;
	shaInOtherOpportunity?: boolean;
	identifierInOtherLead?: boolean;
}

export interface IntegrityEngineResult extends ValidationOutcome {
	technicalFingerprint: Record<string, unknown>;
	forensics: PdfForensicsResult;
}

function datesDisagree(left: Date | null, right: Date | null): boolean {
	return (
		!!left && !!right && Math.abs(left.getTime() - right.getTime()) > 60_000
	);
}

function metadataSignals(
	forensics: PdfForensicsResult,
	periodEnd: string | null,
): Signal[] {
	if (forensics.bytes.isEncrypted) return [];
	const signals: Signal[] = [];
	const metadata = forensics.metadata;
	const xmp = forensics.xmp;
	const producer =
		metadata?.producer ??
		xmp?.producer ??
		metadata?.creator ??
		xmp?.creatorTool;

	switch (classifyProducer(producer)) {
		case "editor":
			signals.push(
				makeSignal("productor_es_editor", 7, "alta", "estructura", {
					evidence: { producer: producer ?? "" },
				}),
			);
			break;
		case "navegador_ofimatica":
			signals.push(
				makeSignal(
					"productor_es_navegador_o_ofimatica",
					4,
					"media",
					"estructura",
					{ evidence: { producer: producer ?? "" } },
				),
			);
			break;
	}

	if (xmp && xmp.savedActions > 1) {
		signals.push(
			makeSignal("xmp_historial_de_ediciones", 7, "alta", "estructura", {
				evidence: { savedActions: xmp.savedActions },
			}),
		);
	}

	const creationDate = metadata?.creationDate ?? xmp?.createDate ?? null;
	const modificationDate =
		metadata?.modificationDate ?? xmp?.modifyDate ?? null;
	if (!creationDate)
		signals.push(
			makeSignal("sin_metadata_de_creacion", 1, "baja", "estructura"),
		);
	if (
		creationDate &&
		modificationDate &&
		modificationDate.getTime() - creationDate.getTime() > 60_000
	) {
		signals.push(
			makeSignal("moddate_posterior_a_creationdate", 3, "media", "estructura", {
				evidence: {
					creationDate: creationDate.toISOString(),
					modificationDate: modificationDate.toISOString(),
				},
			}),
		);
	}
	if (periodEnd && creationDate) {
		const creationDay = creationDate.toISOString().slice(0, 10);
		if (creationDay < periodEnd) {
			signals.push(
				makeSignal("creacion_anterior_al_cierre_del_periodo", 0, "baja", "ia", {
					evidence: { creationDate: creationDate.toISOString(), periodEnd },
				}),
			);
		}
	}
	if (
		xmp &&
		((metadata?.producer &&
			xmp.producer &&
			metadata.producer !== xmp.producer) ||
			datesDisagree(metadata?.creationDate ?? null, xmp.createDate) ||
			datesDisagree(metadata?.modificationDate ?? null, xmp.modifyDate))
	) {
		signals.push(
			makeSignal("xmp_contradice_info_dict", 6, "alta", "estructura"),
		);
	}
	return signals;
}

function structureSignals(forensics: PdfForensicsResult): Signal[] {
	const signals: Signal[] = [];
	const { bytes } = forensics;
	if (!bytes.isLinearized && !bytes.isSigned) {
		if (bytes.prevCount >= 2) {
			signals.push(
				makeSignal("actualizaciones_incrementales", 4, "media", "bytes", {
					evidence: { prevCount: bytes.prevCount },
				}),
			);
		} else if (bytes.prevCount === 1) {
			signals.push(
				makeSignal("una_actualizacion_incremental", 2, "baja", "bytes", {
					evidence: { prevCount: 1 },
				}),
			);
		}
	}
	if (forensics.protectedPdf)
		signals.push(makeSignal("pdf_protegido_no_abre", 0, "alta", "estructura"));

	const textPages = forensics.pages.filter((page) => page.hasText).length;
	const rasterPages = forensics.pages.filter(
		(page) => page.hasImage && !page.hasText,
	).length;
	if (textPages > 0 && rasterPages > 0) {
		signals.push(
			makeSignal("paginas_mixtas_texto_e_imagen", 7, "alta", "contenido", {
				evidence: { textPages, rasterPages },
			}),
		);
	} else if (
		forensics.pages.length > 0 &&
		rasterPages === forensics.pages.length
	) {
		signals.push(
			makeSignal("todas_las_paginas_rasterizadas", 4, "media", "contenido", {
				evidence: { pages: rasterPages },
			}),
		);
	}
	// Los generadores bancarios pueden incrustar un subset distinto de la misma
	// fuente por página. Se conserva el dato en la huella técnica, pero por sí
	// solo no demuestra una alteración y no debe afectar el veredicto.
	if (forensics.fonts?.nonEmbedded.length) {
		signals.push(
			makeSignal("fuente_no_embebida", 3, "media", "estructura", {
				evidence: { fonts: forensics.fonts.nonEmbedded.join(", ") },
			}),
		);
	}
	if (forensics.fonts?.type3.length) {
		signals.push(
			makeSignal("fuente_type3", 2, "baja", "estructura", {
				evidence: { fonts: forensics.fonts.type3.join(", ") },
			}),
		);
	}
	return signals;
}

function identitySignal(
	holder: string | null,
	candidates: string[],
): Signal | null {
	if (!holder || candidates.length === 0) return null;
	const best = candidates
		.map((candidate) => ({
			candidate,
			score: nameSimilarity(holder, candidate),
		}))
		.sort((a, b) => b.score - a.score)[0];
	if (best.score < 50) {
		return makeSignal("titular_no_coincide_fuerte", 6, "alta", "identidad", {
			evidence: {
				detected: holder,
				bestMatch: best.candidate,
				score: best.score,
			},
		});
	}
	if (best.score < IDENTITY_MATCH_THRESHOLD) {
		return makeSignal("titular_no_coincide_parcial", 3, "media", "identidad", {
			evidence: {
				detected: holder,
				bestMatch: best.candidate,
				score: best.score,
			},
		});
	}
	return makeSignal("identidad_comparada", 0, "baja", "identidad", {
		evidence: {
			detected: holder,
			bestMatch: best.candidate,
			score: best.score,
		},
	});
}

function aiSignals(llm: DocumentIntegrityAiResult): Signal[] {
	return llm.observaciones_forenses.map((observation) => {
		const meta =
			ESTADO_CUENTA_AI_SIGNAL_META[
				observation.codigo as keyof typeof ESTADO_CUENTA_AI_SIGNAL_META
			] ?? ESTADO_CUENTA_AI_SIGNAL_META.otro;
		return {
			code: observation.codigo,
			label: meta.label,
			severity: meta.severity,
			weight: meta.weight,
			source: "ia" as const,
			description: observation.descripcion,
			page: observation.pagina,
			confidence: observation.confianza,
		};
	});
}

export async function runDocumentIntegrityEngine(params: {
	buffer: Buffer;
	llm: DocumentIntegrityAiResult | null;
	registeredNames: string[];
	duplicates?: IntegrityDuplicateContext;
	pipelineError?: string | null;
}): Promise<IntegrityEngineResult> {
	const forensics = await inspectPdf(params.buffer);
	const llm = params.llm;
	const periodEnd = llm?.periodo?.fin ?? null;
	const signals = [
		...structureSignals(forensics),
		...metadataSignals(forensics, periodEnd),
	];
	if (forensics.degradedToL0 || forensics.budgetExceeded) {
		signals.push(
			makeSignal("inspeccion_tecnica_incompleta", 0, "alta", "estructura", {
				evidence: {
					degradedToL0: forensics.degradedToL0,
					budgetExceeded: forensics.budgetExceeded,
				},
			}),
		);
	}

	const fingerprintProfile = getIssuerFingerprint(llm?.emisor_normalizado);
	if (fingerprintProfile) {
		const encryptionMatches =
			fingerprintProfile.encrypted === undefined ||
			fingerprintProfile.encrypted === forensics.bytes.isEncrypted;
		const producer = forensics.metadata?.producer ?? "";
		const producerMatches =
			!fingerprintProfile.producerPatterns?.length ||
			fingerprintProfile.producerPatterns.some((pattern) =>
				pattern.test(producer),
			);
		if (encryptionMatches && producerMatches) {
			signals.push(
				makeSignal("huella_coincide_con_emisor", -2, "baja", "emisor"),
			);
			if (fingerprintProfile.encrypted)
				signals.push(
					makeSignal("encrypt_de_emisor_intacto", -2, "baja", "emisor"),
				);
		} else {
			signals.push(
				makeSignal("huella_no_coincide_con_emisor", 3, "media", "emisor"),
			);
			if (fingerprintProfile.encrypted && !forensics.bytes.isEncrypted) {
				signals.push(
					makeSignal("encrypt_ausente_pero_esperado", 3, "media", "emisor"),
				);
			}
		}
	}

	const identity = identitySignal(
		llm?.titular_detectado ?? null,
		params.registeredNames,
	);
	if (identity) signals.push(identity);

	if (params.duplicates?.shaInOtherOpportunity) {
		signals.push(
			makeSignal("sha256_duplicado_otro_expediente", 0, "baja", "duplicado"),
		);
	} else if (params.duplicates?.shaInSameOpportunity) {
		signals.push(
			makeSignal("sha256_duplicado_mismo_expediente", 0, "baja", "duplicado"),
		);
	}
	if (params.duplicates?.identifierInOtherLead) {
		signals.push(
			makeSignal("identificador_duplicado_otro_lead", 6, "alta", "duplicado"),
		);
	}
	if (llm) signals.push(...aiSignals(llm));
	else signals.push(makeSignal("ia_no_disponible", 0, "alta", "ia"));

	const outcome = applyRuleset({
		signals,
		llm,
		invalidPdfHeader: !forensics.bytes.hasPdfHeader,
		corruptPdf:
			!!forensics.parseError &&
			!forensics.bytes.hasXref &&
			forensics.bytes.eofCount === 0,
		pipelineError: params.pipelineError,
	});

	return {
		...outcome,
		technicalFingerprint: {
			sha256: forensics.bytes.sha256,
			eofCount: forensics.bytes.eofCount,
			startxrefCount: forensics.bytes.startxrefCount,
			prevCount: forensics.bytes.prevCount,
			encrypted: forensics.bytes.isEncrypted,
			linearized: forensics.bytes.isLinearized,
			signed: forensics.bytes.isSigned,
			pageCount: forensics.pageCount,
			producer: forensics.bytes.isEncrypted
				? null
				: (forensics.metadata?.producer ?? null),
			fonts: forensics.fonts?.names ?? [],
			pageContent: forensics.pages,
			degradedToL0: forensics.degradedToL0,
			budgetExceeded: forensics.budgetExceeded,
		},
		forensics,
	};
}
