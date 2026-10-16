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
import { ganaComoCasoVigente } from "./caso-vigente";

/** Tope de créditos que se devuelven a la ficha. */
export const LIMITE_CREDITOS_RELACIONADOS = 20;

/**
 * Tope de candidatos a los que se les revisa el acceso en cartera: los de
 * teléfono van primero y nunca se filtran, así que alcanza para llenar la card
 * sin consultar cartera por cientos de homónimos.
 */
export const LIMITE_CANDIDATOS_ACCESO = 100;

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

	// Primero los seguros (por teléfono), después los posibles homónimos. Sin
	// tope acá: el tope de la card va DESPUÉS del filtro de acceso
	// (`buscarCreditosRelacionados`), si no un homónimo que el usuario sí
	// puede abrir podía quedar cortado detrás de otros que no.
	return [...creditos.values()].sort(
		(a, b) =>
			Number(a.soloPorNombre) - Number(b.soloPorNombre) ||
			a.numeroSifco.localeCompare(b.numeroSifco),
	);
}

/** Lo que de verdad es cada crédito: de quién es y qué vehículo financia. */
export type CreditoCanonico = {
	opportunityId: string;
	/** won/migrate cuenta como crédito; otro estado no se muestra. */
	status: string | null;
	/** Titular: el lead de la oportunidad; si no tiene, el del cliente del contrato. */
	leadId: string | null;
	/** El del contrato manda; sin contrato, el de la oportunidad. */
	vehicleId: string | null;
};

type CasoParaCanonico = {
	numeroCreditoSifco: string | null;
	activo: boolean | null;
	updatedAt: Date | null;
	/** Del contrato del caso (vía `clients`); null sin contrato. */
	contratoOpportunityId: string | null;
	contratoLeadId: string | null;
	contratoVehicleId: string | null;
	tieneContrato: boolean;
};

type OportunidadParaCanonico = {
	id: string;
	sifco: string | null;
	status: string | null;
	leadId: string | null;
	vehicleId: string | null;
};

/**
 * Resuelve cada SIFCO con las mismas reglas que la ficha, en un solo lugar:
 *
 * - Caso vigente del SIFCO (`caso-vigente.ts`): el activo y, a igualdad, el
 *   más reciente. Un caso inactivo no impone su contrato.
 * - Oportunidad (`resolverContextoCaso`): la del cliente del contrato de ese
 *   caso; sin contrato, la won/migrate más reciente del SIFCO (las
 *   `oportunidades` llegan ya en ese orden).
 * - Titular: el lead de la oportunidad o, con contrato, el del cliente.
 * - Vehículo (`cargarSeguro`): el del contrato; sin contrato, el de la
 *   oportunidad.
 *
 * Un SIFCO repetido en oportunidades viejas de otro lead queda resuelto a la
 * vigente: una coincidencia con la fila obsoleta no expone el crédito.
 */
export function resolverCreditosCanonicos(params: {
	casos: CasoParaCanonico[];
	oportunidades: OportunidadParaCanonico[];
}): Map<string, CreditoCanonico> {
	const vigentes = new Map<string, CasoParaCanonico>();
	for (const caso of params.casos) {
		const sifco = caso.numeroCreditoSifco;
		if (sifco && ganaComoCasoVigente(caso, vigentes.get(sifco))) {
			vigentes.set(sifco, caso);
		}
	}
	const porId = new Map(params.oportunidades.map((o) => [o.id, o]));
	const primeraPorSifco = new Map<string, OportunidadParaCanonico>();
	for (const o of params.oportunidades) {
		if (o.sifco && !primeraPorSifco.has(o.sifco))
			primeraPorSifco.set(o.sifco, o);
	}

	const sifcos = new Set([...vigentes.keys(), ...primeraPorSifco.keys()]);
	const creditos = new Map<string, CreditoCanonico>();
	for (const sifco of sifcos) {
		const caso = vigentes.get(sifco);
		const delContrato = caso?.contratoOpportunityId
			? porId.get(caso.contratoOpportunityId)
			: undefined;
		const opp = delContrato ?? primeraPorSifco.get(sifco);
		if (!opp) continue;
		creditos.set(sifco, {
			opportunityId: opp.id,
			status: opp.status,
			leadId: delContrato
				? (opp.leadId ?? caso?.contratoLeadId ?? null)
				: opp.leadId,
			vehicleId: caso?.tieneContrato
				? (caso.contratoVehicleId ?? opp.vehicleId)
				: opp.vehicleId,
		});
	}
	return creditos;
}

/**
 * Lo que llega a la card. Un nombre igual puede ser un homónimo: no alcanza
 * para mostrarle a alguien un crédito que no puede abrir, así que solo pasa si
 * ya tiene acceso. El tope va DESPUÉS de ese filtro, para no cortar un
 * homónimo abrible detrás de otros que no lo son.
 */
export function filtrarPorAccesoYTopar<
	T extends { soloPorNombre: boolean; puedeAbrir: boolean },
>(creditos: T[]): T[] {
	return creditos
		.filter((c) => !c.soloPorNombre || c.puedeAbrir)
		.slice(0, LIMITE_CREDITOS_RELACIONADOS);
}
