import type { BuroInternoCategoria } from "../db/schema/buro-interno";
import type {
	CreditoBuroInterno,
	PaginaCreditosBuroInterno,
} from "../types/cartera-back";

export type RiesgoCartera = {
	categoria: BuroInternoCategoria;
	texto: string;
};

const PRIORIDAD_CATEGORIA: Record<BuroInternoCategoria, number> = {
	fraude: 0,
	vehiculo_recuperado: 1,
	incobrable: 2,
	mala_paga: 3,
	otro: 4,
};

export function categoriaRiesgoPrioritaria(
	categorias: Iterable<BuroInternoCategoria>,
): BuroInternoCategoria {
	return (
		[...categorias].sort(
			(a, b) => PRIORIDAD_CATEGORIA[a] - PRIORIDAD_CATEGORIA[b],
		)[0] ?? "otro"
	);
}

export function resumirFuentesRiesgo(
	fuentes: Iterable<{
		numeroCreditoSifco: string;
		categoria: BuroInternoCategoria;
		motivo: string;
	}>,
): { categoria: BuroInternoCategoria; motivo: string } {
	const ordenadas = [...fuentes].sort(
		(a, b) =>
			a.numeroCreditoSifco.localeCompare(b.numeroCreditoSifco) ||
			a.motivo.localeCompare(b.motivo),
	);
	const evidencias = [
		...new Set(
			ordenadas
				.filter((fuente) => fuente.motivo.trim().length > 0)
				.map(
					(fuente) => `${fuente.numeroCreditoSifco}: ${fuente.motivo.trim()}`,
				),
		),
	];
	return {
		categoria: categoriaRiesgoPrioritaria(
			ordenadas.map((fuente) => fuente.categoria),
		),
		motivo: `Registro automático desde Cartera. Evidencia: ${evidencias.join("; ")}`,
	};
}

/** Normaliza tildes, signos y espacios para evaluar frases completas. */
export function normalizarMotivoRiesgo(texto: string): string {
	return texto
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

const VERBO_DETECCION_NEGADO =
	/(?:detect(?:a|an|o|aron|ado|ada|ados|adas)|encuentr(?:a|an)|encontr(?:o|aron|ado|ada|ados|adas)|identific(?:a|an|o|aron|ado|ada|ados|adas)|confirm(?:a|an|o|aron|ado|ada|ados|adas)|comprueb(?:a|an)|comprob(?:o|aron|ado|ada|ados|adas)|evidenci(?:a|an|o|aron|ado|ada|ados|adas)|observ(?:a|an|o|aron|ado|ada|ados|adas)|registr(?:a|an|o|aron|ado|ada|ados|adas)|report(?:a|an|o|aron|ado|ada|ados|adas)|present(?:a|o|an|aron|ado|ada|ados|adas)|cuenta\s+con|tiene|existe(?:n)?|hay|hubo)/;
const VERBO_ESTADO_NEGADO = new RegExp(
	`(?:es|fue|esta|estuvo|tiene|tuvo|cuenta\\s+con|${VERBO_DETECCION_NEGADO.source})`,
);
const PREFIJO_NEGACION_DIRECTA = new RegExp(
	`(?:^|\\s)(?:sin(?:\\s+ningun[ao])?|libre\\s+de|(?:se\\s+)?descart(?:o|aron|ado|ada|ados|adas)|nunca(?:\\s+${VERBO_ESTADO_NEGADO.source})?|no(?:(?:\\s+se)?\\s+${VERBO_ESTADO_NEGADO.source})?(?:\\s+ningun[ao])?)\\s+$`,
);
const PREFIJO_NEGACION_COORDINADA = new RegExp(
	`(?:^|\\s)(?:sin|libre\\s+de|(?:se\\s+)?descart(?:o|aron|ado|ada|ados|adas)|nunca(?:\\s+${VERBO_ESTADO_NEGADO.source})?|no(?:\\s+${VERBO_ESTADO_NEGADO.source})?)(?:\\s+[a-z0-9]+){0,5}\\s+ni\\s+$`,
);
const TERMINO_EVIDENCIA_NEGADA =
	/(?:evidencias?|indicios?|senales?|pruebas?|hallazgos?|reportes?|antecedentes?)/;
const CALIFICADOR_EVIDENCIA_NEGADA =
	/(?:algun[ao]s?|concret[oa]s?|clar[oa]s?|suficientes?|confirmad[oa]s?)/;
const PREFIJO_NEGACION_INDIRECTA = new RegExp(
	`(?:^|\\s)(?:sin(?:\\s+ningun[ao])?\\s+${TERMINO_EVIDENCIA_NEGADA.source}|no(?:\\s+se)?\\s+${VERBO_DETECCION_NEGADO.source}\\s+(?:ningun[ao]\\s+)?${TERMINO_EVIDENCIA_NEGADA.source})(?:\\s+${CALIFICADOR_EVIDENCIA_NEGADA.source}){0,2}(?:\\s+de)?\\s+$`,
);
const PREFIJO_CONTEXTO_NO_RIESGO =
	/(?:^|\s)(?:sin\s+problemas?\s+de|no\s+(?:se\s+le\s+cobro|aplica)|descuentos?\s+de|(?:se\s+)?condono(?:\s+la)?|cancelo\s+pagando(?:\s+la)?|victimas?\s+de)\s+$/;
const SUFIJO_NEGACION =
	/^\s+(?:(?:fue|ha\s+sido)\s+)?(?:descartad[oa]s?|no\s+confirmad[oa]s?|condonad[oa]s?)(?=\s|$)/;

function estaNegada(texto: string, inicio: number, fin: number): boolean {
	const prefijo = texto.slice(0, inicio);
	return (
		PREFIJO_NEGACION_DIRECTA.test(prefijo) ||
		PREFIJO_NEGACION_COORDINADA.test(prefijo) ||
		PREFIJO_NEGACION_INDIRECTA.test(prefijo) ||
		PREFIJO_CONTEXTO_NO_RIESGO.test(prefijo) ||
		SUFIJO_NEGACION.test(texto.slice(fin))
	);
}

function contieneAfirmacion(texto: string, expresion: RegExp): boolean {
	for (const coincidencia of texto.matchAll(expresion)) {
		const inicio =
			(coincidencia.index ?? 0) + (coincidencia[0]?.startsWith(" ") ? 1 : 0);
		const fin = (coincidencia.index ?? 0) + (coincidencia[0]?.length ?? 0);
		if (!estaNegada(texto, inicio, fin)) return true;
	}
	return false;
}

/** Solo reconoce evidencia explícita y afirmativa; no infiere riesgo por texto parcial. */
export function clasificarMotivoExplicito(texto: string): RiesgoCartera | null {
	const limpio = texto.trim().replace(/\s+/g, " ");
	if (!limpio) return null;
	const normalizado = normalizarMotivoRiesgo(limpio);

	if (
		contieneAfirmacion(
			normalizado,
			/(?:^|\s)(?:fraudes?|estafas?|documentos?\s+falsos?|identidad(?:es)?\s+falsas?)(?=\s|$)/g,
		)
	) {
		return { categoria: "fraude", texto: limpio };
	}
	if (
		contieneAfirmacion(
			normalizado,
			/(?:^|\s)(?:(?:vehiculos?|carros?)\s+(?:recuperad[oa]s?|reposeid[oa]s?)|recuperacion(?:es)?\s+de\s+(?:vehiculos?|carros?)|reposeid[oa]s?|reposesion(?:es)?)(?=\s|$)/g,
		)
	) {
		return { categoria: "vehiculo_recuperado", texto: limpio };
	}
	if (contieneAfirmacion(normalizado, /(?:^|\s)incobrables?(?=\s|$)/g)) {
		return { categoria: "incobrable", texto: limpio };
	}
	if (
		contieneAfirmacion(
			normalizado,
			/(?:^|\s)(?:malas?\s+pagas?|mal(?:os?|as?)\s+pagadores?|impagos?|incumplimientos?(?:\s+de\s+pago)?|moras?|moros[oa]s?|morosidad(?:es)?)(?=\s|$)/g,
		) ||
		contieneAfirmacion(
			normalizado,
			/(?:^|\s)(?:faltas?\s+de\s+pago|dej(?:o|aron)\s+de\s+pagar|no\s+pag(?:o|aron))(?=\s|$)/g,
		)
	) {
		return { categoria: "mala_paga", texto: limpio };
	}
	return null;
}

export function evidenciaRiesgoCredito(
	credito: CreditoBuroInterno,
): RiesgoCartera[] {
	const { statusCredit } = credito.creditos;
	const riesgos: RiesgoCartera[] = [];
	const agregarRiesgo = (riesgo: RiesgoCartera) => {
		const clave = normalizarMotivoRiesgo(riesgo.texto);
		const indiceExistente = riesgos.findIndex(
			(actual) => normalizarMotivoRiesgo(actual.texto) === clave,
		);
		if (indiceExistente === -1) {
			riesgos.push(riesgo);
			return;
		}
		if (
			PRIORIDAD_CATEGORIA[riesgo.categoria] <
			PRIORIDAD_CATEGORIA[riesgos[indiceExistente].categoria]
		) {
			riesgos[indiceExistente] = riesgo;
		}
	};
	if (statusCredit === "MOROSO") {
		agregarRiesgo({
			categoria: "mala_paga",
			texto: "Crédito con estado MOROSO vigente",
		});
	}
	if (statusCredit === "INCOBRABLE") {
		agregarRiesgo({
			categoria: "incobrable",
			texto: "Crédito con estado INCOBRABLE",
		});
		const detalles = [
			credito.incobrable?.motivo,
			credito.incobrable?.observaciones,
		].filter((detalle): detalle is string => Boolean(detalle?.trim()));
		for (const detalle of detalles) {
			agregarRiesgo(
				clasificarMotivoExplicito(detalle) ?? {
					categoria: "incobrable",
					texto: detalle.trim(),
				},
			);
		}
	}
	const cancelacion = credito.cancelacion;
	for (const motivo of [
		cancelacion?.motivo,
		cancelacion?.observaciones,
		credito.incobrable?.motivo,
		credito.incobrable?.observaciones,
		credito.caido?.motivo,
		credito.caido?.observaciones,
	]) {
		const riesgo = motivo ? clasificarMotivoExplicito(motivo) : null;
		if (riesgo) agregarRiesgo(riesgo);
	}
	return riesgos;
}

export function idsFuentesObsoletas(
	actuales: Iterable<number>,
	vigentes: Iterable<number>,
): number[] {
	const vigentesSet = new Set(vigentes);
	return [...new Set(actuales)].filter((id) => !vigentesSet.has(id));
}

export function planificarVigenciaPersonaAutomatica(
	usuariosRelacionados: Iterable<number>,
	usuariosConRiesgo: Iterable<number>,
): { desactivar: boolean; usuariosSinRiesgo: number[] } {
	const riesgo = new Set(usuariosConRiesgo);
	const relacionados = [...new Set(usuariosRelacionados)];
	const usuariosSinRiesgo = relacionados.filter((id) => !riesgo.has(id));
	return {
		desactivar:
			relacionados.length > 0 &&
			usuariosSinRiesgo.length === relacionados.length,
		usuariosSinRiesgo,
	};
}

function esObjeto(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function esTextoONulo(value: unknown): value is string | null {
	return typeof value === "string" || value === null;
}

const ESTADOS_CREDITO = new Set([
	"ACTIVO",
	"CANCELADO",
	"INCOBRABLE",
	"PENDIENTE_CANCELACION",
	"MOROSO",
	"EN_CONVENIO",
	"CAIDO",
]);

function esDetalleRiesgoValido(
	value: unknown,
	conCuotasAtrasadas = false,
): boolean {
	if (value === null) return true;
	if (
		!esObjeto(value) ||
		typeof value.motivo !== "string" ||
		!esTextoONulo(value.observaciones)
	) {
		return false;
	}
	return (
		!conCuotasAtrasadas ||
		(Number.isSafeInteger(value.cuotas_atrasadas) &&
			Number(value.cuotas_atrasadas) >= 0)
	);
}

/** Lanza dentro del circuit breaker si Cartera responde 200 con contrato inválido. */
export function validarPaginaCreditosBuroInterno(
	value: unknown,
): asserts value is PaginaCreditosBuroInterno {
	if (
		!esObjeto(value) ||
		!Array.isArray(value.data) ||
		typeof value.hasMore !== "boolean" ||
		!(typeof value.nextCursor === "string" || value.nextCursor === null) ||
		!Number.isSafeInteger(value.snapshotMaxCreditoId) ||
		Number(value.snapshotMaxCreditoId) < 0
	) {
		throw new Error(
			"Cartera devolvió una página inválida para el buró interno.",
		);
	}
	for (const item of value.data) {
		if (
			!esObjeto(item) ||
			!esObjeto(item.creditos) ||
			!esObjeto(item.usuarios)
		) {
			throw new Error(
				"Cartera devolvió un crédito inválido para el buró interno.",
			);
		}
		if (
			!Number.isSafeInteger(item.creditos.credito_id) ||
			!Number.isSafeInteger(item.creditos.usuario_id) ||
			typeof item.creditos.numero_credito_sifco !== "string" ||
			!ESTADOS_CREDITO.has(String(item.creditos.statusCredit)) ||
			!Number.isSafeInteger(item.usuarios.usuario_id) ||
			typeof item.usuarios.nombre !== "string" ||
			!esTextoONulo(item.usuarios.nit) ||
			!esTextoONulo(item.usuarios.direccion) ||
			!esDetalleRiesgoValido(item.cancelacion, true) ||
			!esDetalleRiesgoValido(item.incobrable) ||
			!esDetalleRiesgoValido(item.caido)
		) {
			throw new Error(
				"Cartera devolvió un crédito inválido para el buró interno.",
			);
		}
	}
}
