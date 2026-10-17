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
	const nits = (nit ?? "").split("/").map((parte) => parte.trim());

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
	/(?:detect(?:a|an|o|aron|ado|ada|ados|adas)|encuentr(?:a|an)|encontr(?:o|aron|ado|ada|ados|adas)|identific(?:a|an|o|aron|ado|ada|ados|adas)|confirm(?:a|an|o|aron|ado|ada|ados|adas)|comprueb(?:a|an)|comprob(?:o|aron|ado|ada|ados|adas)|evidenci(?:a|an|o|aron|ado|ada|ados|adas)|observ(?:a|an|o|aron|ado|ada|ados|adas)|registr(?:a|an|o|aron|ado|ada|ados|adas)|report(?:a|an|o|aron|ado|ada|ados|adas)|present(?:a|o|an|aron|ado|ada|ados|adas)|cuenta\s+con|comet(?:e|en|io|ieron|ido)|adeud(?:a|an|aba|aban|o)|pose(?:e|en|ia|ian)|mantien(?:e|en)|manten(?:ia|ian)|tiene|existe(?:n)?|existia(?:n)?|existio|existieron|debe|deben|debia|debian|hay|hubo)/;
const VERBO_ESTADO_NEGADO = new RegExp(
	`(?:es|era|eran|son|fue|fueron|esta|estaba|estaban|estuvo|tiene|tenia|tenian|tuvo|habia|habian|existia|existian|presentaba|presentaban|registraba|registraban|reportaba|reportaban|cuenta\\s+con|contaba\\s+con|(?:ha|han|habia|habian)\\s+(?:sido|habido|tenido|cometido|detectado|encontrado|identificado|confirmado|comprobado|evidenciado|observado|registrado|reportado|presentado)|${VERBO_DETECCION_NEGADO.source})`,
);
// Acepta un artículo y un sujeto antes del término: "no se detectó el fraude", "no era un cliente moroso".
const PREFIJO_NEGACION_DIRECTA = new RegExp(
	`(?:^|\\s)(?:ningun[ao]?|sin(?:\\s+ningun[ao]?|\\s+(?:haber\\s+)?comet(?:er|ido)|\\s+haber\\s+(?:tenido|sido|estado|presentado|registrado|reportado|mostrado|existido|habido|detectado|identificado|confirmado|comprobado|evidenciado|observado|encontrado|caido\\s+en|incurrido\\s+en)|\\s+(?:ser|estar|tener|presentar|registrar|reportar|mostrar|caer\\s+en|incurrir\\s+en))?|libre\\s+de|ausencia\\s+de|(?:se\\s+)?descart(?:o|aron|ado|ada|ados|adas)|(?:nunca|jamas|tampoco)(?:(?:\\s+se)?\\s+${VERBO_ESTADO_NEGADO.source})?|no(?:(?:\\s+se)?\\s+${VERBO_ESTADO_NEGADO.source})?(?:\\s+ningun[ao]?)?)(?:\\s+(?:el|la|los|las|un|una|unos|unas))?(?:\\s+(?:cliente|clienta|clientes|deudor|deudora|deudores|titular|titulares|persona|personas))?\\s+$`,
);
// "No estuvo en mora", "no incurrió en mora", "nunca cayó en mora".
// También "sin (haber) incurrido / caído / entrado en mora".
const VERBO_ESTADO_EN =
	/(?:esta|estan|estuvo|estuvieron|estaba|estaban|encuentra|encuentran|encontraba|encontraban|encontro|encontraron|incurr(?:e|en|io|ieron|ido)|cae|caen|cay(?:o|eron)|caido|entr(?:a|an|o|aron|ado)|(?:ha|han|habia|habian)\s+(?:estado|caido|incurrido|entrado))/;
const PREFIJO_NEGACION_COORDINADA = new RegExp(
	`(?:^|\\s)(?:sin|libre\\s+de|(?:se\\s+)?descart(?:o|aron|ado|ada|ados|adas)|(?:nunca|jamas|tampoco)(?:(?:\\s+se)?\\s+${VERBO_ESTADO_NEGADO.source})?|no(?:\\s+${VERBO_ESTADO_NEGADO.source})?)(?:\\s+[a-z0-9]+){0,5}\\s+ni(?:(?:\\s+se)?\\s+(?:${VERBO_ESTADO_NEGADO.source}|${VERBO_ESTADO_EN.source}\\s+en))?(?:\\s+(?:el|la|los|las|un|una|unos|unas))?\\s+$`,
);
const TERMINO_EVIDENCIA_NEGADA =
	/(?:evidencias?|indicios?|senal(?:es)?|pruebas?|hallazgos?|reportes?|antecedentes?|historial(?:es)?|registros?|riesgos?|casos?|tipos?|situacion(?:es)?|eventos?|incidentes?|episodios?)/;
const CALIFICADOR_EVIDENCIA_NEGADA =
	/(?:algun[ao]s?|concret[oa]s?|clar[oa]s?|suficientes?|confirmad[oa]s?|negativ[oa]s?|desfavorables?|adversos?|adversas?|previos?|previas?)/;
const PREFIJO_NEGACION_INDIRECTA = new RegExp(
	`(?:^|\\s)(?:ningun[ao]?\\s+${TERMINO_EVIDENCIA_NEGADA.source}|sin(?:\\s+ningun[ao]?)?\\s+${TERMINO_EVIDENCIA_NEGADA.source}|(?:no|nunca|jamas|tampoco)(?:\\s+se)?\\s+${VERBO_ESTADO_NEGADO.source}\\s+(?:ningun[ao]?\\s+)?${TERMINO_EVIDENCIA_NEGADA.source})(?:\\s+(?:ni|y|o)\\s+(?:ningun[ao]?\\s+)?${TERMINO_EVIDENCIA_NEGADA.source}){0,2}(?:\\s+${CALIFICADOR_EVIDENCIA_NEGADA.source}){0,2}(?:\\s+de)?\\s+$`,
);
const PREFIJO_CONTEXTO_NO_RIESGO =
	/(?:^|\s)(?:sin\s+problemas?\s+de|no\s+(?:se\s+le\s+cobro|aplica)|descuentos?\s+de|(?:se\s+)?condono(?:\s+la)?|cancelo\s+pagando(?:\s+la)?|(?:(?:fue|era|es|ha\s+sido)\s+)?victimas?\s+(?:del|de(?:\s+(?:un|una|el|la))?))\s+$/;
const PREFIJO_PROBLEMAS_NEGADOS =
	/(?:^|\s)(?:(?:no|nunca|jamas|tampoco)\s+(?:tiene|tenia|tuvo|presenta|presentaba|presento|hay|habia|hubo|existen?|existia(?:n)?|registra|registraba|reporta|reportaba|tienen|tenian|tuvieron|presentan|presentaban|presentaron|registran|registraban|reportan|reportaban|(?:ha|han|habia|habian)\s+(?:tenido|presentado|habido))\s+(?:ningun[ao]?\s+)?|ningun[ao]?\s+)problemas?\s+de\s+$/;
const PREFIJO_DEUDA_NEGADA =
	/(?:^|\s)(?:sin|(?:no|nunca|jamas|tampoco)(?:\s+(?:se\s+)?(?:tiene|tenia|tuvo|hay|habia|hubo|existe(?:n)?|existia(?:n)?|presenta|presentaba|presento|cuenta\s+con|contaba\s+con|posee|poseia|adeuda|adeudaba|debe|debia|registra|registraba|reporta|reportaba|mantiene|mantenia|tienen|tenian|tuvieron|presentan|presentaban|presentaron|cuentan\s+con|contaban\s+con|poseen|poseian|adeudan|adeudaban|deben|debian|registran|registraban|reportan|reportaban|mantienen|mantenian))?)(?:\s+ningun[ao]?)?\s+(?:cuotas?|deudas?|atrasos?|incumplimientos?|saldos?|montos?|pagos?)\s+(?:en|de)\s+$/;
const PREFIJO_ESTADO_EN_NEGADO = new RegExp(
	`(?:^|\\s)(?:(?:no|nunca|jamas|tampoco)(?:\\s+se)?\\s+${VERBO_ESTADO_EN.source}|sin\\s+(?:haber\\s+)?(?:estar|estado|caer|caido|incurrir|incurrido|entrar|entrado))\\s+en\\s+$`,
);
// "0 cuotas en mora", "cero cuotas atrasadas", "ninguna cuota en mora":
// una cantidad cero informa que no hubo atraso.
const PREFIJO_CANTIDAD_CERO =
	/(?:^|\s)(?:0|cero|ningun[ao]?)(?:\s+(?:cuotas?|pagos?|meses|dias)\s+(?:en|de))?\s+$/;
// "No se pudo comprobar el fraude", "no fue posible confirmar la mora":
// una verificación que no se logró no afirma el riesgo.
const PREFIJO_VERIFICACION_FALLIDA =
	/(?:^|\s)no(?:\s+se)?\s+(?:pudo|pudieron|puede|pueden|logro|lograron|fue\s+posible|ha\s+sido\s+posible)\s+(?:comprobar|confirmar|detectar|identificar|evidenciar|verificar|demostrar|acreditar)(?:\s+(?:el|la|los|las|un|una|unos|unas|ningun[ao]?))?\s+$/;
// "No está reportado como moroso", "no figura como moroso", "no fue declarado
// incobrable": una clasificación negada no afirma el riesgo.
const PREFIJO_CLASIFICACION_NEGADA =
	/(?:^|\s)(?:no|nunca|jamas|tampoco)(?:\s+se)?(?:\s+(?:esta|estaba|estan|fue|fueron|ha\s+sido|han\s+sido|era|es))?\s+(?:reportad[oa]s?|declarad[oa]s?|registrad[oa]s?|clasificad[oa]s?|calificad[oa]s?|considerad[oa]s?|catalogad[oa]s?|marcad[oa]s?|figura|figuraba|figuran|aparece|aparecia|aparecen)(?:\s+como)?\s+$/;
// Negación pospuesta: "fraude no detectado", "mora no comprobada". "No aplica"
// solo cuenta al final del texto, para no negar "mora, no aplica descuento".
// También "fraude sin evidencia", "mora sin pruebas".
const SUFIJO_NEGACION = new RegExp(
	`^\\s+(?:(?:(?:fue|ha\\s+sido)\\s+)?(?:descartad[oa]s?|condonad[oa]s?)|no\\s+(?:(?:fue|fueron|ha\\s+sido|se)\\s+)?(?:confirmad[oa]s?|detectad[oa]s?|comprobad[oa]s?|identificad[oa]s?|registrad[oa]s?|reportad[oa]s?|evidenciad[oa]s?)|no\\s+(?:existe|existio|hubo)|(?:aun\\s+|todavia\\s+)?sin\\s+(?:(?:confirmar|comprobar|detectar|verificar|acreditar|demostrar|evidenciar)|(?:ningun[ao]?\\s+)?${TERMINO_EVIDENCIA_NEGADA.source})|no\\s+aplica(?=\\s*$))(?=\\s|$)`,
);

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
		PREFIJO_CANTIDAD_CERO.test(prefijo) ||
		PREFIJO_VERIFICACION_FALLIDA.test(prefijo) ||
		PREFIJO_CLASIFICACION_NEGADA.test(prefijo) ||
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
			/(?:^|\s)(?:(?:vehiculos?|carros?|camion(?:es)?|unidad(?:es)?|motos?|motocicletas?)\s+(?:(?:fue|fueron|ha\s+sido|han\s+sido)\s+)?(?:recuperad[oa]s?|reposeid[oa]s?|recogid[oa]s?|recolectad[oa]s?)|se\s+(?:recuper|recogi|recolect)(?:o|aron|a|an)\s+(?:(?:el|la|los|las)\s+)?(?:vehiculos?|carros?|camion(?:es)?|unidad(?:es)?|motos?|motocicletas?)|recuperacion(?:es)?\s+de\s+(?:(?:el|la|los|las)\s+)?(?:vehiculos?|carros?|camion(?:es)?|unidad(?:es)?|motos?|motocicletas?)|recuperacion\s+y\s+venta|venta\s+por\s+recuperacion|(?:se\s+realiza|se\s+realizo|se\s+hizo|realizo)\s+(?:la\s+)?recoleccion(?:\s+de\s+(?:(?:los|las|el|la|del)\s+)?(?:vehiculos?|carros?|camion(?:es)?|unidad(?:es)?|motos?|motocicletas?)|(?!\s+de\s))|reposeid[oa]s?|reposesion(?:es)?)(?=\s|$)/g,
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
			/(?:^|\s)(?:malas?\s+pagas?|mal(?:os?|as?)?\s+pagador(?:es|as?)?|impagos?|incumplimientos?(?:\s+de\s+pago)?|moras?|moros[oa]s?|morosidad(?:es)?|cuotas?\s+(?:atrasadas?|vencidas?)|pagos?\s+(?:atrasados?|vencidos?)|atrasos?\s+de\s+pago)(?=\s|$)/g,
		) ||
		contieneAfirmacion(
			normalizado,
			/(?:^|\s)(?:faltas?\s+de\s+pago|dej(?:o|aron)\s+de\s+pagar|no\s+pag(?:o|aron)|no\s+(?:pudo|pudieron|puede|pueden|podia|podian)\s+(?:seguir\s+)?pag(?:ar|ando)|no\s+(?:tiene|tenia|tenian|tuvo|cuenta|contaba|contaban)\s+(?:con\s+)?(?:el\s+)?dinero\s+para\s+(?:realizar\s+)?(?:los\s+|el\s+)?pag(?:ar|os?)|sin\s+capacidad\s+de\s+pago|no\s+(?:quiere|quiso|quisieron|quieren)\s+pagar)(?=\s|$)/g,
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
