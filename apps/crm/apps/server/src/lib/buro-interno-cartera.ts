import type { BuroInternoCategoria } from "../db/schema/buro-interno";
import type {
	CreditoBuroInterno,
	RespuestaCreditosBuroInterno,
} from "../types/cartera-back";

export type RiesgoCartera = {
	categoria: BuroInternoCategoria;
	texto: string;
};

export type IdentidadClienteCartera = {
	nombreCompleto: string;
	nit: string | null;
};

/**
 * Los datos históricos de Cartera pueden agrupar varias personas separadas por
 * `/`. Cada nombre se vuelve una identidad de match y solo recibe el NIT de la
 * misma posición; un NIT único no se replica hacia las demás personas.
 */
export function separarIdentidadesClienteCartera(
	nombre: string,
	nit: string | null,
): IdentidadClienteCartera[] {
	const nombres = nombre
		.split("/")
		.map((parte) => parte.trim())
		.filter(Boolean);
	const nits = (nit ?? "")
		.split("/")
		.map((parte) => parte.trim());

	return nombres.map((nombreCompleto, indice) => ({
		nombreCompleto,
		nit: nits[indice] || null,
	}));
}

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
	`(?:es|fue|esta|estuvo|tiene|tuvo|cuenta\\s+con|ha\\s+(?:habido|tenido|detectado|encontrado|identificado|confirmado|comprobado|evidenciado|observado|registrado|reportado|presentado)|${VERBO_DETECCION_NEGADO.source})`,
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
	/(?:^|\s)(?:sin\s+problemas?\s+de|no\s+(?:se\s+le\s+cobro|aplica)|descuentos?\s+de|(?:se\s+)?condono(?:\s+la)?|cancelo\s+pagando(?:\s+la)?|(?:(?:fue|era|es|ha\s+sido)\s+)?victimas?\s+(?:del|de(?:\s+(?:un|una|el|la))?))\s+$/;
const PREFIJO_PROBLEMAS_NEGADOS =
	/(?:^|\s)no\s+(?:tiene|presenta|presento|hay|hubo|existen?)\s+problemas?\s+de\s+$/;
const PREFIJO_DEUDA_NEGADA =
	/(?:^|\s)(?:sin|no(?:\s+(?:se\s+)?(?:tiene|hay|existe(?:n)?|presenta|presento|cuenta\s+con))?)\s+(?:cuotas?|deudas?|atrasos?|incumplimientos?)\s+(?:en|de)\s+$/;
const PREFIJO_ESTADO_EN_NEGADO =
	/(?:^|\s)(?:no(?:\s+(?:se\s+)?)?(?:esta|estan|estuvo|estuvieron|estaba|estaban)|nunca\s+(?:esta|estan|estuvo|estuvieron|estaba|estaban))\s+en\s+$/;
const SUFIJO_NEGACION =
	/^\s+(?:(?:fue|ha\s+sido)\s+)?(?:descartad[oa]s?|no\s+confirmad[oa]s?|condonad[oa]s?)(?=\s|$)/;

function estaNegada(texto: string, inicio: number, fin: number): boolean {
	const prefijo = texto.slice(0, inicio);
	return (
		PREFIJO_NEGACION_DIRECTA.test(prefijo) ||
		PREFIJO_NEGACION_COORDINADA.test(prefijo) ||
		PREFIJO_NEGACION_INDIRECTA.test(prefijo) ||
		PREFIJO_CONTEXTO_NO_RIESGO.test(prefijo) ||
		PREFIJO_PROBLEMAS_NEGADOS.test(prefijo) ||
		PREFIJO_DEUDA_NEGADA.test(prefijo) ||
		PREFIJO_ESTADO_EN_NEGADO.test(prefijo) ||
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
			/(?:^|\s)(?:(?:vehiculos?|carros?)\s+(?:(?:fue|fueron|ha\s+sido|han\s+sido)\s+)?(?:recuperad[oa]s?|reposeid[oa]s?)|se\s+recuper(?:o|aron|a|an)\s+(?:(?:el|la|los|las)\s+)?(?:vehiculos?|carros?)|recuperacion(?:es)?\s+de\s+(?:vehiculos?|carros?)|reposeid[oa]s?|reposesion(?:es)?)(?=\s|$)/g,
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
			/(?:^|\s)(?:malas?\s+pagas?|mal(?:os?|as?)\s+pagadores?|impagos?|incumplimientos?(?:\s+de\s+pago)?|moras?|moros[oa]s?|morosidad(?:es)?|cuotas?\s+atrasadas?|atrasos?\s+de\s+pago)(?=\s|$)/g,
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
		const detalles = credito.incobrables
			.flatMap(({ motivo, observaciones }) => [motivo, observaciones])
			.filter((detalle): detalle is string => Boolean(detalle?.trim()));
		for (const detalle of detalles) {
			agregarRiesgo(
				clasificarMotivoExplicito(detalle) ?? {
					categoria: "incobrable",
					texto: detalle.trim(),
				},
			);
		}
	}
	const motivosHistoricos = [
		...credito.cancelaciones.flatMap(({ motivo, observaciones }) => [
			motivo,
			observaciones,
		]),
		...credito.incobrables.flatMap(({ motivo, observaciones }) => [
			motivo,
			observaciones,
		]),
		...credito.caidos.flatMap(({ motivo, observaciones }) => [
			motivo,
			observaciones,
		]),
	];
	for (const motivo of motivosHistoricos) {
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
export function validarRespuestaCreditosBuroInterno(
	value: unknown,
): asserts value is RespuestaCreditosBuroInterno {
	if (!esObjeto(value) || !Array.isArray(value.data)) {
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
			!Array.isArray(item.cancelaciones) ||
			!item.cancelaciones.every((detalle) =>
				esDetalleRiesgoValido(detalle, true),
			) ||
			!Array.isArray(item.incobrables) ||
			!item.incobrables.every((detalle) => esDetalleRiesgoValido(detalle)) ||
			!Array.isArray(item.caidos) ||
			!item.caidos.every((detalle) => esDetalleRiesgoValido(detalle))
		) {
			throw new Error(
				"Cartera devolvió un crédito inválido para el buró interno.",
			);
		}
	}
}
