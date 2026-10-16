/**
 * Ficha 360 · «Créditos relacionados»: otros créditos donde aparece alguien
 * del caso (titular, codeudor o una referencia).
 *
 * Aquí vive solo la parte pura —normalizar, armar las semillas y consolidar
 * las filas por SIFCO— para poder probarla sin BD. Las consultas están en
 * `services/creditos-relacionados-cobros.ts`.
 *
 * Se busca por teléfono (titular, codeudores y referencias) y por nombre
 * completo exacto (titular y codeudores). No por DPI: así lo pidió negocio.
 * Una coincidencia SOLO por nombre puede ser un homónimo y se marca como tal.
 */

import { extraerTelefonos } from "./bot-cobros/telefonos";

/** Tope de créditos que se devuelven a la ficha. */
export const LIMITE_CREDITOS_RELACIONADOS = 20;

/** Nombres con menos palabras no se buscan: «Juan» solo trae medio país. */
const PALABRAS_MINIMAS_NOMBRE = 2;

export type OrigenSemilla = "titular" | "codeudor" | "referencia";

export type SemillaTelefono = {
	telefono: string;
	origen: OrigenSemilla;
	persona: string;
};

export type SemillaNombre = {
	/** Ya normalizado con `normalizarNombre`. */
	nombre: string;
	origen: Exclude<OrigenSemilla, "referencia">;
	persona: string;
};

export type Semillas = {
	telefonos: SemillaTelefono[];
	nombres: SemillaNombre[];
};

/**
 * Minúsculas, sin tildes y con un solo espacio entre palabras. Descompone a
 * NFD y quita los diacríticos: así da igual si la tilde viene pegada a la
 * letra («é») o como carácter aparte («e» + U+0301), que también hay en el
 * CRM. Es la misma normalización que el SQL (`sqlNombreNormalizado` en el
 * servicio): si una cambia, la otra también.
 */
export function normalizarNombre(nombre: string | null | undefined): string {
	if (!nombre) return "";
	return nombre
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** Para mostrar: el CRM trae nombres con espacios dobles o en los bordes. */
export function limpiarNombre(nombre: string | null | undefined): string {
	return (nombre ?? "").replace(/\s+/g, " ").trim();
}

export function armarSemillas(params: {
	titular: { nombre: string | null; telefonos: (string | null)[] };
	codeudores: { nombre: string; telefonos: (string | null)[] }[];
	referencias: { nombre: string; telefonos: string[] }[];
}): Semillas {
	const telefonos: SemillaTelefono[] = [];
	const vistos = new Set<string>();
	const agregarTelefonos = (
		campos: (string | null)[],
		origen: OrigenSemilla,
		persona: string,
	) => {
		for (const campo of campos) {
			for (const telefono of extraerTelefonos(campo)) {
				// El primero que lo trae se queda con el número: titular antes que
				// codeudor antes que referencia.
				if (vistos.has(telefono)) continue;
				vistos.add(telefono);
				telefonos.push({ telefono, origen, persona });
			}
		}
	};

	const nombreTitular = limpiarNombre(params.titular.nombre) || "Titular";
	agregarTelefonos(params.titular.telefonos, "titular", nombreTitular);
	for (const c of params.codeudores) {
		agregarTelefonos(c.telefonos, "codeudor", limpiarNombre(c.nombre));
	}
	for (const r of params.referencias) {
		agregarTelefonos(r.telefonos, "referencia", limpiarNombre(r.nombre));
	}

	const nombres: SemillaNombre[] = [];
	const agregarNombre = (
		nombre: string | null,
		origen: SemillaNombre["origen"],
	) => {
		const normalizado = normalizarNombre(nombre);
		if (normalizado.split(" ").length < PALABRAS_MINIMAS_NOMBRE) return;
		if (nombres.some((n) => n.nombre === normalizado)) return;
		nombres.push({
			nombre: normalizado,
			origen,
			persona: limpiarNombre(nombre),
		});
	};
	agregarNombre(params.titular.nombre, "titular");
	for (const c of params.codeudores) agregarNombre(c.nombre, "codeudor");

	return { telefonos, nombres };
}

/** Una fila de la consulta: una persona que aparece en otro crédito. */
export type FilaPersonaEnCredito = {
	numeroSifco: string;
	/** Qué papel tiene esa persona en el OTRO crédito. */
	rol: "titular" | "codeudor";
	personaNombre: string;
	personaTelefono: string | null;
	titularNombre: string;
	vehiculo: {
		marca: string;
		modelo: string;
		anio: number | null;
		placa: string | null;
	} | null;
};

export type MotivoRelacion = {
	tipo: "telefono" | "nombre";
	/** Quién del caso actual hizo la coincidencia. */
	origen: OrigenSemilla;
	persona: string;
};

export type PersonaRelacionada = {
	/** Quién es en el caso que se está viendo (la semilla que coincidió). */
	nombre: string;
	/** Su papel en el caso que se está viendo. */
	rolAqui: OrigenSemilla;
	/**
	 * Cómo figura en el crédito relacionado. Con match por teléfono puede ser
	 * otro nombre (una referencia «María» con el número del deudor «Juan»).
	 */
	nombreAlla: string;
	/** Su papel en el crédito relacionado. */
	rolAlla: "titular" | "codeudor";
};

/** Si una persona coincide por varias vías, manda el papel más fuerte. */
const PRIORIDAD_ORIGEN: Record<OrigenSemilla, number> = {
	titular: 0,
	codeudor: 1,
	referencia: 2,
};

export type CreditoRelacionadoBase = {
	numeroSifco: string;
	titularNombre: string;
	vehiculo: FilaPersonaEnCredito["vehiculo"];
	/** Personas del caso que aparecen en este crédito. */
	personas: PersonaRelacionada[];
	motivos: MotivoRelacion[];
	/** Solo coincide el nombre: puede ser un homónimo. */
	soloPorNombre: boolean;
};

/**
 * Agrupa por SIFCO, decide en JS el match exacto de teléfono (el SQL solo
 * filtra grueso) y deja fuera el crédito del propio caso.
 */
export function consolidarCreditosRelacionados(params: {
	filas: FilaPersonaEnCredito[];
	semillas: Semillas;
	sifcoActual: string | null;
}): CreditoRelacionadoBase[] {
	const porTelefono = new Map(
		params.semillas.telefonos.map((s) => [s.telefono, s]),
	);
	const porNombre = new Map(params.semillas.nombres.map((s) => [s.nombre, s]));
	const actual = params.sifcoActual?.trim() ?? null;
	const creditos = new Map<string, CreditoRelacionadoBase>();

	for (const fila of params.filas) {
		const sifco = fila.numeroSifco.trim();
		if (!sifco || sifco === actual) continue;

		const motivos: MotivoRelacion[] = [];
		for (const telefono of extraerTelefonos(fila.personaTelefono)) {
			const semilla = porTelefono.get(telefono);
			if (semilla) {
				motivos.push({
					tipo: "telefono",
					origen: semilla.origen,
					persona: semilla.persona,
				});
			}
		}
		const semillaNombre = porNombre.get(normalizarNombre(fila.personaNombre));
		if (semillaNombre) {
			motivos.push({
				tipo: "nombre",
				origen: semillaNombre.origen,
				persona: semillaNombre.persona,
			});
		}
		// El SQL trae por LIKE: un número que solo contiene los 8 dígitos dentro
		// de otro más largo no es coincidencia.
		if (motivos.length === 0) continue;

		let credito = creditos.get(sifco);
		if (!credito) {
			credito = {
				numeroSifco: sifco,
				titularNombre: fila.titularNombre,
				vehiculo: fila.vehiculo,
				personas: [],
				motivos: [],
				soloPorNombre: true,
			};
			creditos.set(sifco, credito);
		}
		// Quién es aquí: la semilla que hizo la coincidencia; si fueron varias
		// (teléfono del titular y nombre del codeudor), la más fuerte. Nombre y
		// papel salen de la MISMA semilla: nunca el nombre de allá con el papel
		// de aquí.
		const principal = [...motivos].sort(
			(a, b) => PRIORIDAD_ORIGEN[a.origen] - PRIORIDAD_ORIGEN[b.origen],
		)[0];
		const nombreAlla = normalizarNombre(fila.personaNombre);
		const existente = credito.personas.find(
			(p) =>
				p.rolAlla === fila.rol && normalizarNombre(p.nombreAlla) === nombreAlla,
		);
		if (!existente) {
			credito.personas.push({
				nombre: principal.persona,
				rolAqui: principal.origen,
				nombreAlla: fila.personaNombre,
				rolAlla: fila.rol,
			});
		} else if (
			PRIORIDAD_ORIGEN[principal.origen] < PRIORIDAD_ORIGEN[existente.rolAqui]
		) {
			existente.nombre = principal.persona;
			existente.rolAqui = principal.origen;
		}
		for (const m of motivos) {
			const repetido = credito.motivos.some(
				(x) =>
					x.tipo === m.tipo && x.origen === m.origen && x.persona === m.persona,
			);
			if (!repetido) credito.motivos.push(m);
		}
		credito.soloPorNombre = credito.motivos.every((m) => m.tipo === "nombre");
	}

	// Primero los seguros (por teléfono), después los posibles homónimos.
	return [...creditos.values()]
		.sort(
			(a, b) =>
				Number(a.soloPorNombre) - Number(b.soloPorNombre) ||
				a.numeroSifco.localeCompare(b.numeroSifco),
		)
		.slice(0, LIMITE_CREDITOS_RELACIONADOS);
}
