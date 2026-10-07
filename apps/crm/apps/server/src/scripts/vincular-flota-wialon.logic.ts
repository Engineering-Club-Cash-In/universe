/**
 * Lógica pura del diagnóstico de vínculos vehículo ↔ unidad de Wialon
 * (ver vincular-flota-wialon.ts). Sin BD ni red: recibe el catálogo de
 * Wialon y los vehículos del CRM y decide, por cada vehículo, qué unidad le
 * corresponde y con qué evidencia.
 *
 * Evidencia que se cruza:
 * - Placa: núcleo (3 dígitos + 3 letras) de la placa del CRM contra el nombre
 *   de la unidad y contra su campo `registration_plate`.
 * - VIN: VIN del CRM contra cualquier VIN de 17 caracteres dentro del nombre
 *   de la unidad (~330 unidades se nombran por VIN) y contra su campo `vin`.
 *
 * Criterio conservador, igual que la ficha: solo se propone un vínculo cuando
 * la evidencia apunta a EXACTAMENTE una unidad y esa unidad no la reclama otro
 * vehículo. Lo demás se reporta con su motivo, y las coincidencias parciales
 * (VIN incompleto, placa con una letra distinta) van como sugerencia para
 * revisión manual, nunca como vínculo.
 */

import {
	extraerNucleoDeNombreUnidad,
	extraerNucleoPlaca,
} from "../services/wialon/wialon-client";

/**
 * Normaliza un VIN: mayúsculas, sin separadores, y O→0, I→1, Q→0 (los VIN no
 * usan esas letras, así que solo aparecen por error de tipeo). Devuelve null si
 * no quedan exactamente 17 caracteres o si no hay al menos un dígito y una
 * letra: "00000000000000000" o un texto de relleno no son un VIN, y tomarlos
 * como tal podría vincular un vehículo con una unidad cualquiera.
 */
export function normalizarVin(valor: string | null | undefined): string | null {
	const crudo = (valor ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
	// Se mira ANTES de corregir O/I/Q: "SINVIN…" no debe pasar por tener 1.
	if (crudo.length !== 17 || !/\d/.test(crudo) || !/[A-Z]/.test(crudo)) {
		return null;
	}
	return crudo
		.replace(/O/g, "0")
		.replace(/[IQ]/g, (c) => (c === "I" ? "1" : "0"));
}

/**
 * Tokens alfanuméricos del nombre de una unidad que tienen forma de VIN (17
 * caracteres con al menos un dígito y una letra), ya normalizados. Los de 16 o
 * 18 caracteres se devuelven aparte: casi siempre son un VIN mal tipeado y
 * solo sirven para sugerir.
 */
export function extraerVinsDeNombreUnidad(nombre: string): {
	completos: string[];
	incompletos: string[];
} {
	const completos: string[] = [];
	const incompletos: string[] = [];
	for (const token of nombre.toUpperCase().match(/[A-Z0-9]+/g) ?? []) {
		if (!/\d/.test(token) || !/[A-Z]/.test(token)) continue;
		if (token.length === 17) {
			const vin = normalizarVin(token);
			if (vin) completos.push(vin);
		} else if (token.length >= 15 && token.length <= 18) {
			incompletos.push(
				token
					.replace(/O/g, "0")
					.replace(/[IQ]/g, (c) => (c === "I" ? "1" : "0")),
			);
		}
	}
	return { completos, incompletos };
}

/**
 * Campos del vehículo de una unidad (`pflds`, flag 0x800000) aplanados a
 * nombre → valor: { "1": { n: "vin", v: "..." } } → { vin: "..." }.
 */
export function aplanarCamposUnidad(
	pflds: Record<string, unknown> | undefined,
): Record<string, string> {
	const campos: Record<string, string> = {};
	for (const campo of Object.values(pflds ?? {})) {
		const c = campo as { n?: unknown; v?: unknown };
		if (typeof c?.n === "string" && c.v != null) campos[c.n] = String(c.v);
	}
	return campos;
}

/** Alias usado en los tests. */
export const vinsEnNombre = extraerVinsDeNombreUnidad;

export interface UnidadWialon {
	id: number;
	nm: string;
	/** Campos del vehículo en Wialon (`pflds`), ya aplanados a nombre → valor. */
	campos: Record<string, string>;
}

export interface VehiculoCrm {
	id: string;
	placa: string | null;
	vin: string | null;
	wialonUnitId: number | null;
	vinculadoPor: string | null;
	conCredito: boolean;
	/**
	 * Créditos del vehículo (SIFCO de su oportunidad y de su contrato) con el
	 * estado que tienen hoy en cartera. `estado` null = el SIFCO no existe en
	 * cartera. Solo se usa para desempatar vehículos duplicados.
	 */
	creditos?: CreditoVehiculo[];
}

export interface CreditoVehiculo {
	sifco: string;
	estado: string | null;
	/** ISO; null si no se conoce. */
	fechaCreacion: string | null;
}

/** Estados de cartera en los que el crédito sigue vivo (se cobra o se gestiona). */
export const ESTADOS_CREDITO_VIGENTES = new Set([
	"ACTIVO",
	"MOROSO",
	"EN_RECUPERACION",
	"EN_CONVENIO",
	"PENDIENTE_CANCELACION",
]);

export type Metodo =
	| "placa+vin"
	| "placa"
	| "vin"
	| "placa_registration"
	| "vin_campo";

export type EstadoVehiculo =
	// Ya tenía unidad guardada
	| "vinculado_confirmado" // la evidencia apunta a la misma unidad
	| "vinculado_sin_evidencia" // ni placa ni VIN la respaldan (p. ej. fijado a mano)
	| "vinculado_contradice" // la evidencia apunta a OTRA unidad
	| "vinculado_unidad_inexistente" // la unidad guardada ya no está en el catálogo
	// Sin unidad guardada
	| "propuesto" // se vincularía
	| "conflicto_placa_vin" // placa y VIN apuntan a unidades distintas
	| "ambiguo" // la evidencia apunta a varias unidades
	| "unidad_ya_asignada" // la unidad está guardada en otro vehículo
	| "unidad_disputada" // varios vehículos sin vínculo reclaman la misma unidad
	| "duplicado_descartado" // la reclamaba, pero otro vehículo (el duplicado vigente) se queda con ella
	| "sin_coincidencia"
	| "sin_placa_ni_vin";

export interface ResultadoVehiculo {
	vehiculo: VehiculoCrm;
	estado: EstadoVehiculo;
	metodo: Metodo | null;
	unidad: UnidadWialon | null;
	/** Unidades en juego (ambiguo / conflicto / disputa) o sugeridas. */
	otras: UnidadWialon[];
	sugerencia: string | null;
	detalle: string;
	/**
	 * Propuesto por desempate de vehículos duplicados que conviene que una
	 * persona confirme antes de aplicar (ninguno tenía crédito vigente).
	 */
	confirmar?: boolean;
}

export type EstadoUnidad =
	| "vinculada" // guardada en un vehículo
	| "propuesta" // se vincularía con este diagnóstico
	| "en_revision" // aparece en un ambiguo / conflicto / disputa
	| "sin_vehiculo";

export interface ResultadoUnidad {
	unidad: UnidadWialon;
	estado: EstadoUnidad;
	nucleoPlaca: string | null;
	vin: string | null;
	vehiculos: string[];
	detalle: string;
}

function nucleoTexto(n: { digitos: string; letras: string } | null) {
	return n ? n.digitos + n.letras : null;
}

/** Todo lo que se puede leer de una unidad para cruzar. */
export function evidenciaUnidad(u: UnidadWialon) {
	const nucleoNombre = nucleoTexto(extraerNucleoDeNombreUnidad(u.nm));
	const nucleoRegistro = nucleoTexto(
		extraerNucleoPlaca(u.campos.registration_plate ?? null),
	);
	const { completos, incompletos } = extraerVinsDeNombreUnidad(u.nm);
	const vinCampo = normalizarVin(u.campos.vin ?? null);
	return {
		nucleoNombre,
		nucleoRegistro,
		vinsNombre: completos,
		vinCampo,
		incompletos,
	};
}

/** Índices del catálogo: núcleo de placa → unidades y VIN → unidades. */
export function indexarCatalogo(unidades: UnidadWialon[]) {
	const porNucleoNombre = new Map<string, Set<number>>();
	const porNucleoRegistro = new Map<string, Set<number>>();
	const porVinNombre = new Map<string, Set<number>>();
	const porVinCampo = new Map<string, Set<number>>();
	const incompletos: { unidadId: number; token: string }[] = [];
	const agregar = (
		m: Map<string, Set<number>>,
		k: string | null,
		id: number,
	) => {
		if (!k) return;
		const s = m.get(k) ?? new Set<number>();
		s.add(id);
		m.set(k, s);
	};
	for (const u of unidades) {
		const e = evidenciaUnidad(u);
		agregar(porNucleoNombre, e.nucleoNombre, u.id);
		agregar(porNucleoRegistro, e.nucleoRegistro, u.id);
		for (const v of e.vinsNombre) agregar(porVinNombre, v, u.id);
		agregar(porVinCampo, e.vinCampo, u.id);
		for (const t of e.incompletos)
			incompletos.push({ unidadId: u.id, token: t });
	}
	return {
		porNucleoNombre,
		porNucleoRegistro,
		porVinNombre,
		porVinCampo,
		incompletos,
	};
}

type Indice = ReturnType<typeof indexarCatalogo>;

function union(...sets: (Set<number> | undefined)[]): Set<number> {
	const r = new Set<number>();
	for (const s of sets) for (const x of s ?? []) r.add(x);
	return r;
}

/**
 * Unidades que respalda cada tipo de evidencia para un vehículo, y el método
 * que mejor describe la coincidencia final.
 */
export function evidenciaVehiculo(v: VehiculoCrm, idx: Indice) {
	const nucleo = nucleoTexto(extraerNucleoPlaca(v.placa));
	// Hay vehículos con el VIN cargado en el campo de placa (carros nuevos que
	// aún no tenían placa): si la placa tiene forma de VIN, se usa como VIN.
	const vin = normalizarVin(v.vin) ?? normalizarVin(v.placa);
	// Serie (últimos 6: el número de serie del VIN) para sugerir cuando el VIN del CRM está incompleto
	// (15-16 caracteres) y no alcanza para un cruce exacto.
	const vinCrudo = (v.vin ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
	const serie =
		vin?.slice(-6) ??
		(vinCrudo.length >= 15 && /\d/.test(vinCrudo) && /[A-Z]/.test(vinCrudo)
			? vinCrudo
					.replace(/O/g, "0")
					.replace(/[IQ]/g, (c) => (c === "I" ? "1" : "0"))
					.slice(-6)
			: null);
	const porPlacaNombre = nucleo ? idx.porNucleoNombre.get(nucleo) : undefined;
	const porPlacaRegistro = nucleo
		? idx.porNucleoRegistro.get(nucleo)
		: undefined;
	const porVinNombre = vin ? idx.porVinNombre.get(vin) : undefined;
	const porVinCampo = vin ? idx.porVinCampo.get(vin) : undefined;
	return {
		nucleo,
		vin,
		serie,
		porPlaca: union(porPlacaNombre, porPlacaRegistro),
		porVin: union(porVinNombre, porVinCampo),
		soloRegistro: !porPlacaNombre?.size && Boolean(porPlacaRegistro?.size),
		soloVinCampo: !porVinNombre?.size && Boolean(porVinCampo?.size),
	};
}

/**
 * Decide la unidad de un vehículo a partir de su evidencia, sin mirar a los
 * demás vehículos (las disputas se resuelven después, en conjunto).
 */
export function decidirPorEvidencia(
	ev: ReturnType<typeof evidenciaVehiculo>,
):
	| { tipo: "unica"; unidadId: number; metodo: Metodo }
	| { tipo: "conflicto"; placa: number[]; vin: number[] }
	| { tipo: "ambiguo"; unidades: number[] }
	| { tipo: "nada" } {
	const placa = [...ev.porPlaca];
	const vin = [...ev.porVin];

	if (placa.length && vin.length) {
		const ambas = placa.filter((id) => ev.porVin.has(id));
		if (ambas.length === 1) {
			return { tipo: "unica", unidadId: ambas[0], metodo: "placa+vin" };
		}
		if (ambas.length > 1) return { tipo: "ambiguo", unidades: ambas };
		// Apuntan a unidades distintas: el VIN es más específico, pero si la
		// placa también es única no hay forma de saber cuál está mal escrita.
		return { tipo: "conflicto", placa, vin };
	}
	if (vin.length === 1) {
		return {
			tipo: "unica",
			unidadId: vin[0],
			metodo: ev.soloVinCampo ? "vin_campo" : "vin",
		};
	}
	if (placa.length === 1) {
		return {
			tipo: "unica",
			unidadId: placa[0],
			metodo: ev.soloRegistro ? "placa_registration" : "placa",
		};
	}
	if (vin.length > 1) return { tipo: "ambiguo", unidades: vin };
	if (placa.length > 1) return { tipo: "ambiguo", unidades: placa };
	return { tipo: "nada" };
}

/**
 * Sugerencias para un vehículo sin coincidencia exacta. Nunca se vinculan:
 * solo orientan a quien revise el CSV.
 * - VIN parcial: los últimos 6 caracteres del VIN (número de serie) aparecen
 *   al final de un VIN de unidad, completo o incompleto, en una sola unidad.
 * - Placa parecida: mismos 3 dígitos y una sola letra distinta, o mismas letras
 *   y un solo dígito distinto, en una sola unidad.
 */
export function sugerir(
	ev: ReturnType<typeof evidenciaVehiculo>,
	unidades: UnidadWialon[],
	idx: Indice,
	// Unidades que ya tienen dueño (guardadas o con coincidencia exacta de otro
	// vehículo): sugerirlas solo confundiría.
	excluir: Set<number> = new Set(),
): { unidadId: number; motivo: string } | null {
	if (ev.serie) {
		const serie = ev.serie;
		const ids = new Set<number>();
		// Con VIN completo en ambos lados, la serie sola no basta (otro VIN
		// puede terminar igual): se exige además que difieran en máximo 2
		// caracteres, que es lo que deja un error de tipeo.
		const parecido = (vinUnidad: string) =>
			!ev.vin || [...vinUnidad].filter((c, i) => c !== ev.vin?.[i]).length <= 2;
		for (const [vin, s] of [...idx.porVinNombre, ...idx.porVinCampo]) {
			if (vin.endsWith(serie) && parecido(vin)) for (const id of s) ids.add(id);
		}
		for (const { unidadId, token } of idx.incompletos) {
			if (token.endsWith(serie)) ids.add(unidadId);
		}
		for (const id of excluir) ids.delete(id);
		if (ids.size === 1) {
			return { unidadId: [...ids][0], motivo: `VIN parcial (serie ${serie})` };
		}
	}
	if (ev.nucleo) {
		const d = ev.nucleo.slice(0, 3);
		const l = ev.nucleo.slice(3);
		const difiere = (a: string, b: string) =>
			[...a].filter((c, i) => c !== b[i]).length;
		const ids = new Set<number>();
		for (const u of unidades) {
			const n = nucleoTexto(extraerNucleoDeNombreUnidad(u.nm));
			if (!n || n === ev.nucleo || excluir.has(u.id)) continue;
			const ud = n.slice(0, 3);
			const ul = n.slice(3);
			if (
				(ud === d && difiere(ul, l) === 1) ||
				(ul === l && difiere(ud, d) === 1)
			) {
				ids.add(u.id);
			}
		}
		if (ids.size === 1) {
			return {
				unidadId: [...ids][0],
				motivo: "Placa con un carácter distinto",
			};
		}
	}
	return null;
}

const esVigente = (c: CreditoVehiculo) =>
	c.estado != null && ESTADOS_CREDITO_VIGENTES.has(c.estado);

/**
 * Qué tan nuevo es un crédito, para comparar. Un crédito originado en el CRM
 * ("CRM-…") siempre es más nuevo que uno migrado de SIFCO: la fecha de
 * creación de los migrados es la de la migración, no la del préstamo. Entre
 * dos del mismo origen decide la fecha; sin fecha cuenta como el más viejo.
 */
function antiguedad(c: CreditoVehiculo): number {
	const fecha = c.fechaCreacion ? Date.parse(c.fechaCreacion) || 0 : 0;
	return (c.sifco.startsWith("CRM-") ? 1e15 : 0) + fecha;
}

/** Prefijo de la placa ("P", "C", "M"…) dentro del nombre de una unidad. */
function prefijoEnNombre(nombre: string): string | null {
	return (
		nombre
			.toUpperCase()
			.match(
				/(?:^|[^A-Z0-9])([A-Z]{1,2})\s*-?\s*\d{3}[\s-]*[A-Z]{3}(?![A-Z0-9])/,
			)?.[1] ?? null
	);
}

/** Prefijo de una placa del CRM, sin el 0 de más ("P0-720GVH" → "P"). */
function prefijoPlaca(placa: string | null): string | null {
	return (
		(placa ?? "")
			.toUpperCase()
			.match(/^\s*([A-Z]{1,2}?)0?\s*-?\s*\d{3}/)?.[1] || null
	);
}

/**
 * Elige, entre vehículos que reclaman la misma unidad, cuál se queda con ella:
 * 1. El único con crédito vigente en cartera.
 * 2. Si varios tienen crédito vigente y son EXACTAMENTE los mismos créditos
 *    vigentes (vehículo duplicado con el mismo SIFCO), el que tiene el prefijo
 *    de placa de la unidad ("C-558CBP" → el vehículo con placa C-…). Compartir
 *    un crédito viejo ya cancelado no cuenta, y si uno tiene además un
 *    refinanciamiento vigente que el otro no, tampoco: decide el más nuevo.
 * 3. Si ninguno tiene crédito vigente: el único con crédito, o el del crédito
 *    más reciente. Se marca para confirmar.
 * Un vehículo sin crédito nunca le gana a uno con crédito. Lo que quede
 * empatado no tiene ganador y lo decide una persona.
 */
export function resolverDisputa(
	grupo: ResultadoVehiculo[],
	nombreUnidad: string,
): { ganador: ResultadoVehiculo | null; motivo: string; confirmar: boolean } {
	const creditos = (r: ResultadoVehiculo) => r.vehiculo.creditos ?? [];
	const porPrefijo = (candidatos: ResultadoVehiculo[]) => {
		const prefijo = prefijoEnNombre(nombreUnidad);
		if (!prefijo) return [];
		return candidatos.filter((r) => prefijoPlaca(r.vehiculo.placa) === prefijo);
	};
	// ¿Es el mismo crédito en todos? Exige el MISMO conjunto de créditos (solo
	// los que pasan `cuenta`): si uno además tiene un refinanciamiento que el
	// otro no, no es el mismo crédito y decide el más nuevo, no el prefijo.
	const mismoCredito = (
		candidatos: ResultadoVehiculo[],
		cuenta: (c: CreditoVehiculo) => boolean = () => true,
	) => {
		const [primero, ...resto] = candidatos.map(
			(r) =>
				new Set(
					creditos(r)
						.filter(cuenta)
						.map((c) => c.sifco),
				),
		);
		return (
			primero !== undefined &&
			primero.size > 0 &&
			resto.every(
				(s) => s.size === primero.size && [...primero].every((x) => s.has(x)),
			)
		);
	};

	const vigentes = grupo.filter((r) => creditos(r).some(esVigente));
	if (vigentes.length === 1) {
		const c = creditos(vigentes[0]).find(esVigente);
		return {
			ganador: vigentes[0],
			motivo: `único con crédito vigente (${c?.sifco} ${c?.estado})`,
			confirmar: false,
		};
	}
	if (vigentes.length > 1) {
		if (!mismoCredito(vigentes, esVigente)) {
			// Refinanciamiento sin cerrar el crédito anterior: se queda el
			// vehículo del crédito vigente más nuevo.
			const masNuevo = (r: ResultadoVehiculo) =>
				Math.max(...creditos(r).filter(esVigente).map(antiguedad));
			const [primero, segundo] = [...vigentes].sort(
				(a, b) => masNuevo(b) - masNuevo(a),
			);
			if (masNuevo(primero) > masNuevo(segundo)) {
				const c = creditos(primero)
					.filter(esVigente)
					.sort((a, b) => antiguedad(b) - antiguedad(a))[0];
				return {
					ganador: primero,
					motivo: `varios créditos vigentes distintos; el más nuevo (${c?.sifco} ${c?.estado})`,
					confirmar: false,
				};
			}
			return {
				ganador: null,
				motivo:
					"Varios vehículos con créditos vigentes distintos y no se sabe cuál es el más nuevo",
				confirmar: false,
			};
		}
		const conPrefijo = porPrefijo(vigentes);
		return conPrefijo.length === 1
			? {
					ganador: conPrefijo[0],
					motivo:
						"mismo crédito vigente en ambos; coincide el prefijo de la placa con la unidad",
					confirmar: false,
				}
			: {
					ganador: null,
					motivo:
						"Mismo crédito en varios vehículos y el prefijo de la placa no desempata",
					confirmar: false,
				};
	}

	const conCredito = grupo.filter((r) => creditos(r).length > 0);
	if (conCredito.length === 0) {
		return {
			ganador: null,
			motivo: grupo.some((r) => r.vehiculo.conCredito)
				? "Sin estado de cartera para desempatar"
				: "Ningún vehículo tiene crédito",
			confirmar: false,
		};
	}
	if (conCredito.length === 1) {
		return {
			ganador: conCredito[0],
			motivo: "único con crédito (ninguno vigente)",
			confirmar: true,
		};
	}
	if (mismoCredito(conCredito)) {
		const conPrefijo = porPrefijo(conCredito);
		return conPrefijo.length === 1
			? {
					ganador: conPrefijo[0],
					motivo: "mismo crédito (no vigente); coincide el prefijo de la placa",
					confirmar: true,
				}
			: {
					ganador: null,
					motivo: "Mismo crédito no vigente en varios vehículos",
					confirmar: false,
				};
	}
	// Misma regla que entre vigentes: un CRM- es más nuevo que un migrado.
	const fecha = (r: ResultadoVehiculo) =>
		Math.max(...creditos(r).map(antiguedad));
	const ordenados = [...conCredito].sort((a, b) => fecha(b) - fecha(a));
	if (fecha(ordenados[0]) > 0 && fecha(ordenados[0]) > fecha(ordenados[1])) {
		return {
			ganador: ordenados[0],
			motivo: "ninguno con crédito vigente; el del crédito más nuevo",
			confirmar: true,
		};
	}
	return {
		ganador: null,
		motivo: "Ningún crédito vigente y no se puede saber cuál es el más nuevo",
		confirmar: false,
	};
}

/**
 * Diagnóstico completo: un resultado por vehículo y uno por unidad.
 *
 * `vehiculos` tiene que ser la flota COMPLETA aunque solo interesen los que
 * tienen crédito: las unidades ya guardadas y los duplicados que reclaman una
 * unidad salen de todos los vehículos. Con `soloConCredito` el cruce es el
 * mismo y solo se filtra lo que se devuelve (y lo que se marca como propuesto
 * o en revisión en la vista por unidad).
 */
export function diagnosticar(
	unidades: UnidadWialon[],
	vehiculos: VehiculoCrm[],
	opciones: { soloConCredito?: boolean } = {},
): { vehiculos: ResultadoVehiculo[]; unidades: ResultadoUnidad[] } {
	const idx = indexarCatalogo(unidades);
	const unidadPorId = new Map(unidades.map((u) => [u.id, u]));
	const lista = (ids: Iterable<number>) =>
		[...ids].flatMap((id) => {
			const u = unidadPorId.get(id);
			return u ? [u] : [];
		});

	// Unidades ya guardadas en algún vehículo (aunque sea con evidencia dudosa):
	// nunca se proponen para otro.
	const asignadas = new Map<number, string[]>();
	for (const v of vehiculos) {
		if (v.wialonUnitId == null) continue;
		asignadas.set(v.wialonUnitId, [
			...(asignadas.get(v.wialonUnitId) ?? []),
			v.id,
		]);
	}

	const resultados: ResultadoVehiculo[] = [];
	const propuestas = new Map<number, ResultadoVehiculo[]>();
	const porSugerir: {
		r: ResultadoVehiculo;
		ev: ReturnType<typeof evidenciaVehiculo>;
	}[] = [];

	for (const v of vehiculos) {
		const ev = evidenciaVehiculo(v, idx);
		const decision = decidirPorEvidencia(ev);
		const base = {
			vehiculo: v,
			otras: [] as UnidadWialon[],
			sugerencia: null as string | null,
		};

		if (v.wialonUnitId != null) {
			const guardada = unidadPorId.get(v.wialonUnitId) ?? null;
			if (!guardada) {
				resultados.push({
					...base,
					estado: "vinculado_unidad_inexistente",
					metodo: null,
					unidad: null,
					detalle: `Unidad guardada ${v.wialonUnitId} no está en el catálogo (${v.vinculadoPor ?? "?"})`,
				});
			} else if (
				decision.tipo === "unica" &&
				decision.unidadId === v.wialonUnitId
			) {
				resultados.push({
					...base,
					estado: "vinculado_confirmado",
					metodo: decision.metodo,
					unidad: guardada,
					detalle: `Guardado por ${v.vinculadoPor ?? "?"}`,
				});
			} else if (decision.tipo === "unica") {
				resultados.push({
					...base,
					estado: "vinculado_contradice",
					metodo: decision.metodo,
					unidad: guardada,
					otras: lista([decision.unidadId]),
					detalle: `Guardado por ${v.vinculadoPor ?? "?"}; la evidencia apunta a otra unidad`,
				});
			} else {
				resultados.push({
					...base,
					estado: "vinculado_sin_evidencia",
					metodo: null,
					unidad: guardada,
					detalle: `Guardado por ${v.vinculadoPor ?? "?"}; ni placa ni VIN lo respaldan de forma única`,
				});
			}
			continue;
		}

		if (!ev.nucleo && !ev.vin && !ev.serie) {
			resultados.push({
				...base,
				estado: "sin_placa_ni_vin",
				metodo: null,
				unidad: null,
				detalle: `Placa "${v.placa ?? ""}" y VIN "${v.vin ?? ""}" sin formato válido`,
			});
			continue;
		}

		if (decision.tipo === "nada") {
			// La sugerencia se calcula al final, cuando ya se sabe qué unidades
			// quedaron tomadas por coincidencias exactas de otros vehículos.
			const r: ResultadoVehiculo = {
				...base,
				estado: "sin_coincidencia",
				metodo: null,
				unidad: null,
				detalle: "Ninguna unidad tiene esa placa ni ese VIN",
			};
			resultados.push(r);
			porSugerir.push({ r, ev });
			continue;
		}
		if (decision.tipo === "conflicto") {
			resultados.push({
				...base,
				estado: "conflicto_placa_vin",
				metodo: null,
				unidad: null,
				otras: lista([...decision.placa, ...decision.vin]),
				detalle: `Placa → ${decision.placa.join("/")}; VIN → ${decision.vin.join("/")}`,
			});
			continue;
		}
		if (decision.tipo === "ambiguo") {
			resultados.push({
				...base,
				estado: "ambiguo",
				metodo: null,
				unidad: null,
				otras: lista(decision.unidades),
				detalle: `${decision.unidades.length} unidades coinciden`,
			});
			continue;
		}

		const unidad = unidadPorId.get(decision.unidadId) ?? null;
		const duenos = asignadas.get(decision.unidadId);
		if (duenos?.length) {
			resultados.push({
				...base,
				estado: "unidad_ya_asignada",
				metodo: decision.metodo,
				unidad,
				detalle: `Guardada en vehículo(s) ${duenos.join(", ")}`,
			});
			continue;
		}
		const r: ResultadoVehiculo = {
			...base,
			estado: "propuesto",
			metodo: decision.metodo,
			unidad,
			detalle: "",
		};
		resultados.push(r);
		propuestas.set(decision.unidadId, [
			...(propuestas.get(decision.unidadId) ?? []),
			r,
		]);
	}

	// Varios vehículos sin vínculo apuntan a la misma unidad: casi siempre es el
	// mismo carro registrado dos veces en el CRM (migrado de SIFCO y vuelto a
	// crear al refinanciarlo o revenderlo tras recuperarlo). Se queda con la
	// unidad el que tenga el crédito vigente (ver resolverDisputa); los demás
	// quedan como duplicados descartados. Sin ganador claro, decide una persona.
	for (const [unitId, grupo] of propuestas) {
		if (grupo.length < 2) continue;
		const unidad = unidadPorId.get(unitId);
		const decision = resolverDisputa(grupo, unidad?.nm ?? "");
		const ids = grupo.map((g) => g.vehiculo.id).join(", ");
		for (const r of grupo) {
			if (!decision.ganador) {
				r.estado = "unidad_disputada";
				r.detalle = `${decision.motivo}. Vehículos que la reclaman: ${ids}`;
			} else if (r === decision.ganador) {
				r.estado = "propuesto";
				r.confirmar = decision.confirmar;
				r.sugerencia = decision.confirmar
					? `Desempate de duplicado (confirmar): ${decision.motivo}`
					: `Desempate de duplicado: ${decision.motivo}`;
				r.detalle = `Otros vehículos con la misma unidad: ${grupo
					.filter((g) => g !== r)
					.map((g) => g.vehiculo.id)
					.join(", ")}`;
			} else {
				r.estado = "duplicado_descartado";
				r.detalle = `Duplicado de ${decision.ganador.vehiculo.id} (${decision.motivo})`;
			}
		}
	}

	const tomadas = new Set<number>([...asignadas.keys(), ...propuestas.keys()]);
	for (const { r, ev } of porSugerir) {
		const s = sugerir(ev, unidades, idx, tomadas);
		if (!s) continue;
		r.otras = lista([s.unidadId]);
		r.sugerencia = s.motivo;
	}

	// Vista por unidad.
	const vehiculosPorUnidad = new Map<
		number,
		{ ids: string[]; estado: EstadoUnidad }
	>();
	const marcar = (id: number, vehiculoId: string, estado: EstadoUnidad) => {
		const prev = vehiculosPorUnidad.get(id);
		const prioridad: EstadoUnidad[] = [
			"vinculada",
			"propuesta",
			"en_revision",
			"sin_vehiculo",
		];
		const elegido =
			prev && prioridad.indexOf(prev.estado) < prioridad.indexOf(estado)
				? prev.estado
				: estado;
		vehiculosPorUnidad.set(id, {
			ids: [...new Set([...(prev?.ids ?? []), vehiculoId])],
			estado: elegido,
		});
	};
	const reportados = opciones.soloConCredito
		? resultados.filter((r) => r.vehiculo.conCredito)
		: resultados;
	const reportado = new Set(reportados);
	for (const r of resultados) {
		// Una unidad guardada está ocupada sea quien sea el dueño.
		if (r.vehiculo.wialonUnitId != null && r.unidad)
			marcar(r.unidad.id, r.vehiculo.id, "vinculada");
		if (!reportado.has(r)) continue;
		if (r.estado === "propuesto" && r.unidad)
			marcar(r.unidad.id, r.vehiculo.id, "propuesta");
		if (
			["ambiguo", "conflicto_placa_vin", "unidad_disputada"].includes(r.estado)
		) {
			for (const u of r.unidad ? [r.unidad, ...r.otras] : r.otras)
				marcar(u.id, r.vehiculo.id, "en_revision");
		}
	}
	const resultadosUnidad: ResultadoUnidad[] = unidades.map((u) => {
		const e = evidenciaUnidad(u);
		const info = vehiculosPorUnidad.get(u.id);
		const vin = e.vinsNombre[0] ?? e.vinCampo;
		const nucleo = e.nucleoNombre ?? e.nucleoRegistro;
		let detalle = "";
		if (!info) {
			detalle =
				!nucleo && !vin
					? "Nombre sin placa ni VIN reconocible"
					: "Ningún vehículo del CRM tiene esa placa ni ese VIN";
		}
		return {
			unidad: u,
			estado: info?.estado ?? "sin_vehiculo",
			nucleoPlaca: nucleo,
			vin,
			vehiculos: info?.ids ?? [],
			detalle,
		};
	});

	return { vehiculos: reportados, unidades: resultadosUnidad };
}

/** Escapa una celda CSV. */
export function celdaCsv(valor: unknown): string {
	const s = valor == null ? "" : String(valor);
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
