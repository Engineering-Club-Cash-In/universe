/**
 * Motor de coincidencias del buró interno.
 *
 * Compara a las personas de una solicitud (titular, codeudores, referencias)
 * contra el catálogo de personas marcadas y dice qué reglas se cumplen. No
 * toca la base: recibe los candidatos, los registros y la configuración de
 * reglas ya leída de `buro_interno_reglas`.
 *
 * La lógica de cada regla vive aquí; la tabla solo decide si está encendida,
 * con qué severidad y con qué parámetros. Agregar una regla nueva es sumar
 * una definición a `DEFINICIONES_REGLAS` y su fila en la migración.
 */

import type {
	BuroInternoRegla,
	BuroInternoSeveridad,
} from "../db/schema/buro-interno";

export type OrigenCandidato = "titular" | "codeudor" | "referencia";

export const ORIGENES_CANDIDATO: readonly OrigenCandidato[] = [
	"titular",
	"codeudor",
	"referencia",
];

export type CandidatoBuroInterno = {
	origen: OrigenCandidato;
	/** Texto para mostrar: "Titular", "Codeudor: Ana Pérez" */
	etiqueta: string;
	nombres?: string | null;
	apellidos?: string | null;
	/** Cuando el nombre viene en un solo campo (codeudores, referencias) */
	nombreCompleto?: string | null;
	/** Solo el titular: el lead del CRM de la solicitud */
	leadId?: string | null;
	dpi?: string | null;
	nit?: string | null;
	telefonos?: (string | null | undefined)[];
	direccion?: string | null;
};

export type RegistroParaMatch = {
	id: string;
	/** Lead del CRM desde el que se registró, si se eligió uno */
	leadId: string | null;
	nombres: string;
	apellidos: string;
	dpi: string | null;
	nit: string | null;
	telefono: string | null;
	direccion: string | null;
};

export type ReglaDisparada = {
	clave: string;
	nombre: string;
	severidad: BuroInternoSeveridad;
	detalle: string;
};

export type CoincidenciaBuroInterno = {
	registroId: string;
	origen: OrigenCandidato;
	etiqueta: string;
	/** La más alta entre las reglas disparadas */
	severidad: BuroInternoSeveridad;
	reglas: ReglaDisparada[];
};

// ============================================================================
// Parámetros de las reglas
// ============================================================================

export type TipoParametro = "porcentaje" | "entero" | "origenes" | "lista";

export type DescriptorParametro = {
	clave: string;
	tipo: TipoParametro;
	etiqueta: string;
	ayuda?: string;
	min?: number;
	max?: number;
};

type ParametrosLeidos = {
	aplicaA: OrigenCandidato[];
	umbral: number;
	umbralDireccion: number;
	minPalabras: number;
	apellidosIgnorados: Set<string>;
};

const PARAM_APLICA_A: DescriptorParametro = {
	clave: "aplica_a",
	tipo: "origenes",
	etiqueta: "Se evalúa en",
	ayuda: "A quiénes de la solicitud se les aplica la regla",
};

const PARAM_MIN_PALABRAS: DescriptorParametro = {
	clave: "min_palabras",
	tipo: "entero",
	etiqueta: "Mínimo de palabras en el nombre",
	ayuda: 'Nombres más cortos (p. ej. solo "Juan Pérez") no se comparan',
	min: 2,
	max: 6,
};

// ============================================================================
// Normalización
// ============================================================================

/** Mayúsculas, sin tildes ni signos, espacios colapsados */
export function normalizarTexto(valor: string | null | undefined): string {
	return (valor ?? "")
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, " ")
		.trim();
}

function normalizarNombre(valor: string | null | undefined): string {
	return normalizarTexto(valor)
		.replace(/[0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** DPI/CUI: solo dígitos; se descarta si no tiene los 13 */
export function normalizarDpiMatch(
	valor: string | null | undefined,
): string | null {
	const digitos = (valor ?? "").replace(/\D/g, "");
	return digitos.length === 13 ? digitos : null;
}

/** NIT sin guiones; "CF" (consumidor final) no identifica a nadie */
export function normalizarNitMatch(
	valor: string | null | undefined,
): string | null {
	const limpio = (valor ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
	if (limpio.length < 3 || limpio === "CF") return null;
	return limpio;
}

/** Últimos 8 dígitos: el número local de Guatemala, con o sin +502 */
export function normalizarTelefonoMatch(
	valor: string | null | undefined,
): string | null {
	const digitos = (valor ?? "").replace(/\D/g, "");
	return digitos.length >= 8 ? digitos.slice(-8) : null;
}

/** Partículas que forman parte del apellido: "DE LEON", "DE LA CRUZ" */
const PARTICULAS = new Set([
	"DE",
	"DEL",
	"LA",
	"LAS",
	"LOS",
	"SAN",
	"SANTA",
	"DA",
	"DI",
	"VAN",
	"VON",
]);
/** Partículas que no cambian el apellido al compararlo: "DE PEREZ" ≈ "PEREZ" */
const PARTICULAS_DESCARTABLES = new Set(["DE", "DEL", "LA", "LAS", "LOS"]);

/** Une las partículas con la palabra siguiente: "DE LA CRUZ" queda en un solo apellido */
export function separarApellidos(valor: string | null | undefined): string[] {
	const palabras = normalizarNombre(valor)
		.split(" ")
		.filter((p) => p && p !== "Y");
	const resultado: string[] = [];
	let prefijo: string[] = [];

	for (const palabra of palabras) {
		if (PARTICULAS.has(palabra)) {
			prefijo.push(palabra);
			continue;
		}
		resultado.push([...prefijo, palabra].join(" "));
		prefijo = [];
	}

	if (prefijo.length > 0) {
		if (resultado.length > 0) {
			resultado[resultado.length - 1] += ` ${prefijo.join(" ")}`;
		} else {
			resultado.push(prefijo.join(" "));
		}
	}

	return resultado;
}

/** Forma comparable del apellido: sin "DE"/"DE LA" al inicio */
export function nucleoApellido(apellido: string): string {
	const palabras = apellido.split(" ");
	while (palabras.length > 1 && PARTICULAS_DESCARTABLES.has(palabras[0])) {
		palabras.shift();
	}
	return palabras.join(" ");
}

/**
 * Propuesta para prellenar el formulario cuando solo se tiene el nombre en un
 * campo (clientes de cartera). Mismo criterio que `partirNombreCompleto`, pero
 * conservando cómo viene escrito; el usuario la corrige si no cuadra.
 */
export function sugerirNombresApellidos(nombreCompleto: string): {
	nombres: string;
	apellidos: string;
} {
	const partes: string[] = [];
	let prefijo: string[] = [];

	for (const palabra of nombreCompleto.trim().split(/\s+/).filter(Boolean)) {
		if (PARTICULAS.has(normalizarTexto(palabra))) {
			prefijo.push(palabra);
			continue;
		}
		partes.push([...prefijo, palabra].join(" "));
		prefijo = [];
	}
	if (prefijo.length > 0) partes.push(prefijo.join(" "));

	const corte =
		partes.length >= 3
			? partes.length - 2
			: partes.length === 2
				? 1
				: partes.length;
	return {
		nombres: partes.slice(0, corte).join(" "),
		apellidos: partes.slice(corte).join(" "),
	};
}

type PersonaNormalizada = {
	leadId: string | null;
	dpi: string | null;
	nit: string | null;
	telefonos: string[];
	nombres: string[];
	apellidos: string[];
	/** Núcleos de apellido, en orden */
	nucleos: string[];
	nombreCompleto: string;
	palabrasOrdenadas: string;
	cantidadPalabras: number;
	direccion: string | null;
};

/**
 * Sin nombres y apellidos separados se asume el orden guatemalteco: con tres
 * palabras o más, las dos últimas son apellidos; con dos, la última.
 */
function partirNombreCompleto(nombreCompleto: string): {
	nombres: string[];
	apellidos: string[];
} {
	const partes = separarApellidos(nombreCompleto);
	if (partes.length >= 3) {
		return { nombres: partes.slice(0, -2), apellidos: partes.slice(-2) };
	}
	if (partes.length === 2) {
		return { nombres: partes.slice(0, 1), apellidos: partes.slice(1) };
	}
	return { nombres: partes, apellidos: [] };
}

function normalizarPersona(persona: {
	nombres?: string | null;
	apellidos?: string | null;
	nombreCompleto?: string | null;
	leadId?: string | null;
	dpi?: string | null;
	nit?: string | null;
	telefonos?: (string | null | undefined)[];
	direccion?: string | null;
}): PersonaNormalizada {
	// Un campo etiquetado se respeta aunque venga solo (la consulta manual
	// permite cargar únicamente apellidos): partirlo lo convertiría en
	// nombre + apellido. El partido heurístico queda para `nombreCompleto`.
	const nombresExplicitos = normalizarNombre(persona.nombres);
	const apellidosExplicitos = separarApellidos(persona.apellidos);
	const { nombres, apellidos } =
		nombresExplicitos || apellidosExplicitos.length > 0
			? {
					nombres: nombresExplicitos ? nombresExplicitos.split(" ") : [],
					apellidos: apellidosExplicitos,
				}
			: partirNombreCompleto(persona.nombreCompleto ?? "");

	const palabras = [...nombres, ...apellidos]
		.join(" ")
		.split(" ")
		.filter(Boolean);
	const direccion = normalizarTexto(persona.direccion);

	return {
		leadId: persona.leadId ?? null,
		dpi: normalizarDpiMatch(persona.dpi),
		nit: normalizarNitMatch(persona.nit),
		telefonos: [
			...new Set(
				(persona.telefonos ?? [])
					.map(normalizarTelefonoMatch)
					.filter((t): t is string => t !== null),
			),
		],
		nombres,
		apellidos,
		nucleos: apellidos.map(nucleoApellido).filter((a) => a.length >= 2),
		nombreCompleto: palabras.join(" "),
		palabrasOrdenadas: [...palabras].sort().join(" "),
		cantidadPalabras: palabras.length,
		direccion: direccion.length > 0 ? direccion : null,
	};
}

// ============================================================================
// Similitud
// ============================================================================

function distanciaLevenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;

	let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
	let actual = new Array<number>(b.length + 1);

	for (let i = 1; i <= a.length; i++) {
		actual[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const costo = a[i - 1] === b[j - 1] ? 0 : 1;
			actual[j] = Math.min(
				anterior[j] + 1,
				actual[j - 1] + 1,
				anterior[j - 1] + costo,
			);
		}
		[anterior, actual] = [actual, anterior];
	}

	return anterior[b.length];
}

/** 1 = idénticos, 0 = nada en común */
export function similitud(a: string, b: string): number {
	if (!a || !b) return 0;
	const largo = Math.max(a.length, b.length);
	return 1 - distanciaLevenshtein(a, b) / largo;
}

// ============================================================================
// Definición de reglas
// ============================================================================

/**
 * - identidad: dice que es la misma persona. Si alguna se cumple, las de
 *   parecido y familia se callan (no es "posible hermano", es él).
 * - contacto: comparte un dato de contacto; puede ser él o alguien de su casa.
 */
type TipoRegla = "identidad" | "contacto" | "parecido" | "familia";

type DefinicionRegla = {
	clave: string;
	nombre: string;
	descripcion: string;
	tipo: TipoRegla;
	activaPorDefecto: boolean;
	severidadPorDefecto: BuroInternoSeveridad;
	parametrosPorDefecto: Record<string, unknown>;
	parametros: DescriptorParametro[];
	/** Devuelve el detalle si la regla se cumple, o null */
	evaluar: (
		candidato: PersonaNormalizada,
		registro: PersonaNormalizada,
		parametros: ParametrosLeidos,
	) => string | null;
};

/** Apellidos tan comunes que compartir uno solo no dice nada */
const APELLIDOS_COMUNES = [
	"LOPEZ",
	"GARCIA",
	"PEREZ",
	"HERNANDEZ",
	"GONZALEZ",
	"RODRIGUEZ",
	"MARTINEZ",
	"MORALES",
	"RAMIREZ",
	"CASTILLO",
	"JUAREZ",
	"MENDEZ",
	"RAMOS",
	"CRUZ",
	"REYES",
	"ORTIZ",
	"SANCHEZ",
	"GOMEZ",
	"DIAZ",
	"FLORES",
	"MEJIA",
	"VASQUEZ",
	"ESTRADA",
	"AGUILAR",
	"CHAVEZ",
	"ALVARADO",
	"GUZMAN",
	"MENDOZA",
];

function apellidosEnComun(
	candidato: PersonaNormalizada,
	registro: PersonaNormalizada,
	ignorados: Set<string>,
): string[] {
	const delRegistro = new Set(registro.nucleos);
	return [
		...new Set(
			candidato.nucleos.filter((a) => delRegistro.has(a) && !ignorados.has(a)),
		),
	];
}

function porcentaje(valor: number): string {
	return `${Math.round(valor * 100)}%`;
}

export const DEFINICIONES_REGLAS: DefinicionRegla[] = [
	{
		clave: "lead_igual",
		nombre: "Mismo lead del CRM",
		descripcion:
			"La solicitud es del mismo lead que se registró en el buró, aunque después le hayan cambiado el teléfono, el DPI o el nombre.",
		tipo: "identidad",
		activaPorDefecto: true,
		severidadPorDefecto: "alta",
		// Solo el titular tiene lead: codeudores y referencias no se comparan
		parametrosPorDefecto: { aplica_a: ["titular"] },
		parametros: [],
		evaluar: (c, r) =>
			c.leadId && r.leadId && c.leadId === r.leadId
				? "Es el lead registrado en el buró"
				: null,
	},
	{
		clave: "dpi_igual",
		nombre: "Mismo DPI",
		descripcion:
			"El DPI es el de una persona del buró interno: es la misma persona.",
		tipo: "identidad",
		activaPorDefecto: true,
		severidadPorDefecto: "alta",
		parametrosPorDefecto: { aplica_a: ["titular", "codeudor"] },
		parametros: [PARAM_APLICA_A],
		evaluar: (c, r) =>
			c.dpi && r.dpi && c.dpi === r.dpi ? `DPI ${c.dpi}` : null,
	},
	{
		clave: "nit_igual",
		nombre: "Mismo NIT",
		descripcion:
			'El NIT es el de una persona del buró interno. "CF" no cuenta.',
		tipo: "identidad",
		activaPorDefecto: true,
		severidadPorDefecto: "alta",
		parametrosPorDefecto: { aplica_a: ["titular", "codeudor"] },
		parametros: [PARAM_APLICA_A],
		evaluar: (c, r) =>
			c.nit && r.nit && c.nit === r.nit ? `NIT ${c.nit}` : null,
	},
	{
		clave: "nombre_completo_igual",
		nombre: "Mismo nombre completo",
		descripcion:
			"Nombres y apellidos iguales (sin importar tildes, mayúsculas ni el orden).",
		tipo: "identidad",
		activaPorDefecto: true,
		severidadPorDefecto: "alta",
		parametrosPorDefecto: {
			aplica_a: ["titular", "codeudor", "referencia"],
			min_palabras: 3,
		},
		parametros: [PARAM_APLICA_A, PARAM_MIN_PALABRAS],
		evaluar: (c, r, p) =>
			c.cantidadPalabras >= p.minPalabras &&
			r.cantidadPalabras >= p.minPalabras &&
			c.palabrasOrdenadas === r.palabrasOrdenadas
				? c.nombreCompleto
				: null,
	},
	{
		clave: "telefono_igual",
		nombre: "Mismo teléfono",
		descripcion:
			"Comparte número de teléfono: es la misma persona o alguien de su círculo cercano.",
		tipo: "contacto",
		activaPorDefecto: true,
		severidadPorDefecto: "alta",
		parametrosPorDefecto: { aplica_a: ["titular", "codeudor", "referencia"] },
		parametros: [PARAM_APLICA_A],
		evaluar: (c, r) => {
			const telefono = c.telefonos.find((t) => r.telefonos.includes(t));
			return telefono ? `Teléfono ${telefono}` : null;
		},
	},
	{
		clave: "nombre_similar",
		nombre: "Nombre muy parecido",
		descripcion:
			"El nombre completo se parece mucho aunque no sea igual (errores de dedo, un nombre de más).",
		tipo: "parecido",
		activaPorDefecto: true,
		severidadPorDefecto: "media",
		parametrosPorDefecto: {
			aplica_a: ["titular", "codeudor", "referencia"],
			umbral: 0.88,
			min_palabras: 3,
		},
		parametros: [
			PARAM_APLICA_A,
			{
				clave: "umbral",
				tipo: "porcentaje",
				etiqueta: "Parecido mínimo",
				ayuda: "Más alto = menos alertas, pero se escapan más",
				min: 0.6,
				max: 0.99,
			},
			PARAM_MIN_PALABRAS,
		],
		evaluar: (c, r, p) => {
			if (
				c.cantidadPalabras < p.minPalabras ||
				r.cantidadPalabras < p.minPalabras
			) {
				return null;
			}
			const parecido = Math.max(
				similitud(c.nombreCompleto, r.nombreCompleto),
				similitud(c.palabrasOrdenadas, r.palabrasOrdenadas),
			);
			return parecido >= p.umbral && parecido < 1
				? `${c.nombreCompleto} (${porcentaje(parecido)} parecido)`
				: null;
		},
	},
	{
		clave: "mismos_apellidos",
		nombre: "Mismos dos apellidos",
		descripcion:
			"Primer y segundo apellido iguales y en el mismo orden: posible hermano o hermana.",
		tipo: "familia",
		activaPorDefecto: true,
		severidadPorDefecto: "media",
		parametrosPorDefecto: { aplica_a: ["titular", "codeudor"] },
		parametros: [PARAM_APLICA_A],
		evaluar: (c, r) =>
			c.nucleos.length >= 2 &&
			r.nucleos.length >= 2 &&
			c.nucleos[0] === r.nucleos[0] &&
			c.nucleos[1] === r.nucleos[1]
				? `Apellidos ${c.apellidos.slice(0, 2).join(" ")}`
				: null,
	},
	{
		clave: "apellido_y_direccion",
		nombre: "Apellido y dirección en común",
		descripcion:
			"Comparte al menos un apellido y la dirección se parece: posible familiar que vive en la misma casa.",
		tipo: "familia",
		activaPorDefecto: true,
		severidadPorDefecto: "media",
		parametrosPorDefecto: {
			aplica_a: ["titular", "codeudor"],
			umbral_direccion: 0.8,
		},
		parametros: [
			PARAM_APLICA_A,
			{
				clave: "umbral_direccion",
				tipo: "porcentaje",
				etiqueta: "Parecido mínimo de la dirección",
				min: 0.5,
				max: 0.99,
			},
		],
		evaluar: (c, r, p) => {
			if (!c.direccion || !r.direccion) return null;
			if (c.direccion.length < 10 || r.direccion.length < 10) return null;
			const [apellido] = apellidosEnComun(c, r, new Set());
			if (!apellido) return null;
			const parecido = similitud(c.direccion, r.direccion);
			return parecido >= p.umbralDireccion
				? `Apellido ${apellido}, dirección ${porcentaje(parecido)} parecida`
				: null;
		},
	},
	{
		clave: "apellido_en_comun",
		nombre: "Un apellido en común",
		descripcion:
			"Comparte al menos un apellido poco común: posible padre, madre, hijo o cónyuge. Genera muchas alertas; conviene dejarla apagada o con severidad baja.",
		tipo: "familia",
		activaPorDefecto: false,
		severidadPorDefecto: "baja",
		parametrosPorDefecto: {
			aplica_a: ["titular", "codeudor"],
			apellidos_ignorados: APELLIDOS_COMUNES,
		},
		parametros: [
			PARAM_APLICA_A,
			{
				clave: "apellidos_ignorados",
				tipo: "lista",
				etiqueta: "Apellidos que no cuentan",
				ayuda: "Apellidos tan comunes que compartirlos no dice nada",
			},
		],
		evaluar: (c, r, p) => {
			const comunes = apellidosEnComun(c, r, p.apellidosIgnorados);
			return comunes.length > 0 ? `Apellido ${comunes.join(", ")}` : null;
		},
	},
];

const DEFINICION_POR_CLAVE = new Map(
	DEFINICIONES_REGLAS.map((d) => [d.clave, d]),
);

// ============================================================================
// Configuración efectiva
// ============================================================================

export type ReglaEfectiva = {
	clave: string;
	nombre: string;
	descripcion: string;
	activa: boolean;
	severidad: BuroInternoSeveridad;
	parametros: Record<string, unknown>;
	descriptoresParametros: DescriptorParametro[];
	orden: number;
	updatedBy: string | null;
	updatedAt: Date | null;
};

/** Combina las definiciones de código con lo guardado en la tabla (la tabla manda) */
export function resolverReglas(
	filas: Pick<
		BuroInternoRegla,
		| "clave"
		| "activa"
		| "severidad"
		| "parametros"
		| "orden"
		| "updatedBy"
		| "updatedAt"
	>[],
): ReglaEfectiva[] {
	const porClave = new Map(filas.map((f) => [f.clave, f]));

	return DEFINICIONES_REGLAS.map((definicion, indice) => {
		const fila = porClave.get(definicion.clave);
		return {
			clave: definicion.clave,
			nombre: definicion.nombre,
			descripcion: definicion.descripcion,
			activa: fila?.activa ?? definicion.activaPorDefecto,
			severidad: fila?.severidad ?? definicion.severidadPorDefecto,
			parametros: {
				...definicion.parametrosPorDefecto,
				...(fila?.parametros ?? {}),
			},
			descriptoresParametros: definicion.parametros,
			orden: fila?.orden ?? indice,
			updatedBy: fila?.updatedBy ?? null,
			updatedAt: fila?.updatedAt ?? null,
		};
	}).sort((a, b) => a.orden - b.orden);
}

function numeroEntre(
	valor: unknown,
	porDefecto: number,
	min: number,
	max: number,
): number {
	return typeof valor === "number" && Number.isFinite(valor)
		? Math.min(max, Math.max(min, valor))
		: porDefecto;
}

function leerParametros(parametros: Record<string, unknown>): ParametrosLeidos {
	const aplicaA = Array.isArray(parametros.aplica_a)
		? parametros.aplica_a.filter((o): o is OrigenCandidato =>
				ORIGENES_CANDIDATO.includes(o as OrigenCandidato),
			)
		: [...ORIGENES_CANDIDATO];
	const ignorados = Array.isArray(parametros.apellidos_ignorados)
		? parametros.apellidos_ignorados
				.filter((a): a is string => typeof a === "string")
				.map((a) => nucleoApellido(normalizarNombre(a)))
				.filter(Boolean)
		: [];

	return {
		aplicaA,
		umbral: numeroEntre(parametros.umbral, 0.88, 0, 1),
		umbralDireccion: numeroEntre(parametros.umbral_direccion, 0.8, 0, 1),
		minPalabras: Math.round(numeroEntre(parametros.min_palabras, 3, 1, 10)),
		apellidosIgnorados: new Set(ignorados),
	};
}

/**
 * Valida los parámetros que llegan del front antes de guardarlos: solo las
 * claves que la regla declara y dentro de sus rangos.
 */
export function validarParametrosRegla(
	clave: string,
	parametros: Record<string, unknown>,
):
	| { ok: true; parametros: Record<string, unknown> }
	| { ok: false; error: string } {
	const definicion = DEFINICION_POR_CLAVE.get(clave);
	if (!definicion) return { ok: false, error: `Regla desconocida: ${clave}` };

	const limpios: Record<string, unknown> = {};

	for (const descriptor of definicion.parametros) {
		const valor = parametros[descriptor.clave];
		if (valor === undefined) continue;

		switch (descriptor.tipo) {
			case "porcentaje":
			case "entero": {
				const esEntero = descriptor.tipo === "entero";
				if (
					typeof valor !== "number" ||
					!Number.isFinite(valor) ||
					(esEntero && !Number.isInteger(valor)) ||
					(descriptor.min !== undefined && valor < descriptor.min) ||
					(descriptor.max !== undefined && valor > descriptor.max)
				) {
					return {
						ok: false,
						error: `${descriptor.etiqueta}: debe estar entre ${descriptor.min} y ${descriptor.max}`,
					};
				}
				limpios[descriptor.clave] = valor;
				break;
			}
			case "origenes": {
				if (
					!Array.isArray(valor) ||
					valor.length === 0 ||
					!valor.every((o) => ORIGENES_CANDIDATO.includes(o))
				) {
					return {
						ok: false,
						error: `${descriptor.etiqueta}: elegí al menos una opción válida`,
					};
				}
				limpios[descriptor.clave] = [...new Set(valor)];
				break;
			}
			case "lista": {
				if (
					!Array.isArray(valor) ||
					valor.length > 500 ||
					!valor.every((v) => typeof v === "string")
				) {
					return { ok: false, error: `${descriptor.etiqueta}: lista inválida` };
				}
				limpios[descriptor.clave] = [
					...new Set(
						valor.map((v: string) => normalizarNombre(v)).filter(Boolean),
					),
				];
				break;
			}
		}
	}

	return { ok: true, parametros: limpios };
}

// ============================================================================
// Evaluación
// ============================================================================

const PESO_SEVERIDAD: Record<BuroInternoSeveridad, number> = {
	alta: 3,
	media: 2,
	baja: 1,
};

export function severidadMaxima(
	severidades: BuroInternoSeveridad[],
): BuroInternoSeveridad {
	return severidades.reduce<BuroInternoSeveridad>(
		(max, s) => (PESO_SEVERIDAD[s] > PESO_SEVERIDAD[max] ? s : max),
		"baja",
	);
}

/**
 * Solo la severidad alta frena la aprobación del análisis: es cuando el motor
 * dice que es la misma persona (mismo lead, DPI, NIT, nombre completo o
 * teléfono). Las de familia y parecido avisan, pero no frenan.
 */
export const SEVERIDAD_QUE_BLOQUEA: BuroInternoSeveridad = "alta";

/**
 * Registros que frenan la aprobación: una coincidencia alta por cada persona
 * que todavía no tenga autorización para esta oportunidad. Una persona con
 * varias coincidencias (titular y referencia, por ejemplo) cuenta una vez.
 */
export function registrosQueBloquean<
	T extends { registroId: string; severidad: BuroInternoSeveridad },
>(coincidencias: T[], autorizados: ReadonlySet<string> = new Set()): T[] {
	const vistos = new Set<string>();
	return coincidencias.filter((c) => {
		if (c.severidad !== SEVERIDAD_QUE_BLOQUEA) return false;
		if (autorizados.has(c.registroId) || vistos.has(c.registroId)) return false;
		vistos.add(c.registroId);
		return true;
	});
}

export function evaluarCoincidencias(
	candidatos: CandidatoBuroInterno[],
	registros: RegistroParaMatch[],
	reglas: ReglaEfectiva[],
): CoincidenciaBuroInterno[] {
	const activas = reglas
		.filter((r) => r.activa && DEFINICION_POR_CLAVE.has(r.clave))
		.map((r) => ({
			regla: r,
			definicion: DEFINICION_POR_CLAVE.get(r.clave) as DefinicionRegla,
			parametros: leerParametros(r.parametros),
		}));

	if (activas.length === 0) return [];

	const registrosNormalizados = registros.map((r) => ({
		id: r.id,
		persona: normalizarPersona({
			nombres: r.nombres,
			apellidos: r.apellidos,
			leadId: r.leadId,
			dpi: r.dpi,
			nit: r.nit,
			telefonos: [r.telefono],
			direccion: r.direccion,
		}),
	}));

	const coincidencias: CoincidenciaBuroInterno[] = [];

	for (const candidato of candidatos) {
		const persona = normalizarPersona(candidato);
		const aplicables = activas.filter((a) =>
			a.parametros.aplicaA.includes(candidato.origen),
		);
		if (aplicables.length === 0) continue;

		for (const registro of registrosNormalizados) {
			const disparadas: (ReglaDisparada & { tipo: TipoRegla })[] = [];

			for (const { regla, definicion, parametros } of aplicables) {
				const detalle = definicion.evaluar(
					persona,
					registro.persona,
					parametros,
				);
				if (detalle) {
					disparadas.push({
						clave: regla.clave,
						nombre: regla.nombre,
						severidad: regla.severidad,
						detalle,
						tipo: definicion.tipo,
					});
				}
			}

			const esLaMismaPersona = disparadas.some((d) => d.tipo === "identidad");
			const reglasFinales = disparadas
				.filter(
					(d) =>
						!esLaMismaPersona ||
						(d.tipo !== "parecido" && d.tipo !== "familia"),
				)
				// "Un apellido en común" sobra si ya coinciden los dos
				.filter(
					(d, _, todas) =>
						d.clave !== "apellido_en_comun" ||
						!todas.some((o) => o.clave === "mismos_apellidos"),
				)
				.map(({ tipo: _tipo, ...resto }) => resto);

			if (reglasFinales.length === 0) continue;

			coincidencias.push({
				registroId: registro.id,
				origen: candidato.origen,
				etiqueta: candidato.etiqueta,
				severidad: severidadMaxima(reglasFinales.map((r) => r.severidad)),
				reglas: reglasFinales,
			});
		}
	}

	return coincidencias.sort(
		(a, b) =>
			PESO_SEVERIDAD[b.severidad] - PESO_SEVERIDAD[a.severidad] ||
			b.reglas.length - a.reglas.length,
	);
}
