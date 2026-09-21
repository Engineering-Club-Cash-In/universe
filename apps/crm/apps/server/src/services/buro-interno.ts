import {
	and,
	asc,
	count,
	desc,
	eq,
	inArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	type BuroInternoCategoria,
	type BuroInternoPersona,
	type BuroInternoSeveridad,
	buroInternoEventos,
	buroInternoPersonas,
	buroInternoReglas,
} from "../db/schema/buro-interno";
import {
	coDebtors,
	leads,
	opportunities,
	referenciasLead,
} from "../db/schema/crm";
import { renapInfo } from "../db/schema/renap";
import {
	type CandidatoBuroInterno,
	type CoincidenciaBuroInterno,
	evaluarCoincidencias,
	normalizarDpiMatch,
	type OrigenCandidato,
	type RegistroParaMatch,
	type ReglaEfectiva,
	resolverReglas,
	sugerirNombresApellidos,
	validarParametrosRegla,
} from "../lib/buro-interno-match";
import { isUniqueViolation } from "../lib/db-errors";
import { eqDpi } from "../lib/dpi-lookup";
import { carteraBackClient } from "./cartera-back-client";
import { isCarteraBackPaymentsEnabled } from "./cartera-back-integration";

export class BuroInternoNoEncontradoError extends Error {
	constructor(mensaje = "El registro del buró interno no existe") {
		super(mensaje);
		this.name = "BuroInternoNoEncontradoError";
	}
}

export class BuroInternoDuplicadoError extends Error {
	constructor(mensaje: string) {
		super(mensaje);
		this.name = "BuroInternoDuplicadoError";
	}
}

export class BuroInternoValidacionError extends Error {
	constructor(mensaje: string) {
		super(mensaje);
		this.name = "BuroInternoValidacionError";
	}
}

export type ActorBuroInterno = { id: string; rol: string | null };

type Ejecutor = Pick<typeof db, "insert">;

async function registrarEvento(
	ejecutor: Ejecutor,
	evento: {
		accion: string;
		actor: ActorBuroInterno;
		personaId?: string | null;
		reglaClave?: string | null;
		detalle?: Record<string, unknown> | null;
	},
) {
	await ejecutor.insert(buroInternoEventos).values({
		accion: evento.accion,
		personaId: evento.personaId ?? null,
		reglaClave: evento.reglaClave ?? null,
		detalle: evento.detalle ?? null,
		realizadoPor: evento.actor.id,
		realizadoPorRol: evento.actor.rol,
	});
}

/** "" y espacios cuentan como vacío */
function textoOpcional(valor: string | null | undefined): string | null {
	const limpio = valor?.trim();
	return limpio ? limpio : null;
}

/** Para comparar en SQL contra `translate(lower(...))`: minúsculas y sin tildes */
function paraLike(valor: string): string {
	return valor
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[%_\\]/g, "\\$&");
}

function sinTildesSql(expresion: SQL): SQL {
	return sql`translate(lower(${expresion}), 'áéíóúüñ', 'aeiouun')`;
}

// ============================================================================
// Catálogo
// ============================================================================

const creador = alias(user, "buro_creador");
const desactivador = alias(user, "buro_desactivador");

export type EstadoFiltro = "activos" | "inactivos" | "todos";

export async function listarPersonas(parametros: {
	busqueda?: string | null;
	estado: EstadoFiltro;
	limit: number;
	offset: number;
}) {
	const condiciones: SQL[] = [];

	if (parametros.estado === "activos") {
		condiciones.push(eq(buroInternoPersonas.activo, true));
	} else if (parametros.estado === "inactivos") {
		condiciones.push(eq(buroInternoPersonas.activo, false));
	}

	const busqueda = parametros.busqueda?.trim();
	if (busqueda) {
		const digitos = busqueda.replace(/\D/g, "");
		const palabras = paraLike(busqueda).split(/\s+/).filter(Boolean);
		const porNombre = sql.join(
			palabras.map(
				(p) =>
					sql`${sinTildesSql(sql`${buroInternoPersonas.nombres} || ' ' || ${buroInternoPersonas.apellidos}`)} LIKE ${`%${p}%`}`,
			),
			sql` AND `,
		);
		const alternativas: SQL[] = [sql`(${porNombre})`];
		if (digitos.length >= 4) {
			alternativas.push(
				sql`regexp_replace(coalesce(${buroInternoPersonas.dpi}, ''), '\\D', '', 'g') LIKE ${`%${digitos}%`}`,
				sql`coalesce(${buroInternoPersonas.numeroCreditoSifco}, '') LIKE ${`%${digitos}%`}`,
				sql`regexp_replace(coalesce(${buroInternoPersonas.telefono}, ''), '\\D', '', 'g') LIKE ${`%${digitos}%`}`,
			);
		}
		condiciones.push(or(...alternativas) as SQL);
	}

	const where = condiciones.length > 0 ? and(...condiciones) : undefined;

	const [items, [{ total }]] = await Promise.all([
		db
			.select({
				persona: buroInternoPersonas,
				creadoPorNombre: creador.name,
				desactivadoPorNombre: desactivador.name,
			})
			.from(buroInternoPersonas)
			.leftJoin(creador, eq(creador.id, buroInternoPersonas.creadoPor))
			.leftJoin(
				desactivador,
				eq(desactivador.id, buroInternoPersonas.desactivadoPor),
			)
			.where(where)
			.orderBy(
				desc(buroInternoPersonas.activo),
				desc(buroInternoPersonas.createdAt),
			)
			.limit(parametros.limit)
			.offset(parametros.offset),
		db.select({ total: count() }).from(buroInternoPersonas).where(where),
	]);

	return {
		total,
		items: items.map((fila) => ({
			...fila.persona,
			creadoPorNombre: fila.creadoPorNombre,
			desactivadoPorNombre: fila.desactivadoPorNombre,
		})),
	};
}

export type CandidatoRegistro = {
	origen: "crm" | "cartera";
	leadId: string | null;
	nombres: string;
	apellidos: string;
	dpi: string | null;
	nit: string | null;
	telefono: string | null;
	direccion: string | null;
	numerosSifco: string[];
	yaRegistrado: boolean;
};

/**
 * Busca a quién registrar: leads del CRM por número SIFCO, DPI, teléfono o
 * nombre. Si el número SIFCO no está enlazado a ningún lead (créditos viejos
 * migrados de SIFCO) se consulta el crédito en cartera-back.
 */
export async function buscarCandidatos(
	termino: string,
): Promise<CandidatoRegistro[]> {
	const limpio = termino.trim();
	if (limpio.length < 3) return [];

	const esNumero = /^[\d\s-]+$/.test(limpio);
	const digitos = limpio.replace(/\D/g, "");

	let condicion: SQL;
	if (esNumero) {
		const patron = `%${digitos}%`;
		condicion = sql`(
			l.id IN (
				SELECT o.lead_id FROM public.opportunities o
				LEFT JOIN public.cartera_back_references c ON c.opportunity_id = o.id
				WHERE o.numero_sifco LIKE ${patron} OR c.numero_credito_sifco LIKE ${patron}
			)
			OR regexp_replace(coalesce(l.dpi, ''), '\\D', '', 'g') LIKE ${patron}
			OR regexp_replace(coalesce(l.phone, ''), '\\D', '', 'g') LIKE ${patron}
		)`;
	} else {
		const palabras = paraLike(limpio)
			.split(/\s+/)
			.filter((p) => p.length >= 2);
		if (palabras.length === 0) return [];
		condicion = sql.join(
			palabras.map(
				(p) =>
					sql`${sinTildesSql(sql`concat_ws(' ', l.first_name, l.middle_name, l.last_name, l.second_last_name)`)} LIKE ${`%${p}%`}`,
			),
			sql` AND `,
		);
	}

	const resultado = await db.execute<{
		id: string;
		first_name: string;
		middle_name: string | null;
		last_name: string;
		second_last_name: string | null;
		dpi: string | null;
		nit: string | null;
		phone: string | null;
		direccion: string | null;
		sifcos: string[] | null;
		ya_registrado: boolean;
	}>(sql`
		SELECT
			l.id, l.first_name, l.middle_name, l.last_name, l.second_last_name,
			l.dpi, l.nit, l.phone, l.direccion,
			ARRAY(
				SELECT DISTINCT s.numero FROM (
					SELECT o.numero_sifco AS numero FROM public.opportunities o WHERE o.lead_id = l.id
					UNION
					SELECT c.numero_credito_sifco FROM public.cartera_back_references c
					JOIN public.opportunities o2 ON o2.id = c.opportunity_id
					WHERE o2.lead_id = l.id
				) s
				WHERE s.numero IS NOT NULL
			) AS sifcos,
			EXISTS (
				SELECT 1 FROM public.buro_interno_personas b
				WHERE b.activo AND (
					b.lead_id = l.id
					OR (l.dpi IS NOT NULL AND b.dpi = regexp_replace(l.dpi, '\\s', '', 'g'))
				)
			) AS ya_registrado
		FROM public.leads l
		WHERE ${condicion}
		ORDER BY l.updated_at DESC
		LIMIT 20
	`);

	const candidatos: CandidatoRegistro[] = resultado.rows.map((fila) => ({
		origen: "crm",
		leadId: fila.id,
		nombres: [fila.first_name, fila.middle_name]
			.filter(Boolean)
			.join(" ")
			.trim(),
		apellidos: [fila.last_name, fila.second_last_name]
			.filter(Boolean)
			.join(" ")
			.trim(),
		dpi: fila.dpi,
		nit: fila.nit,
		telefono: fila.phone,
		direccion: fila.direccion,
		numerosSifco: fila.sifcos ?? [],
		yaRegistrado: fila.ya_registrado,
	}));

	// Solo si el CRM no conoce el número: así un DPI encontrado no dispara la
	// consulta a cartera como si fuera un SIFCO
	if (
		esNumero &&
		digitos.length >= 10 &&
		candidatos.length === 0 &&
		isCarteraBackPaymentsEnabled()
	) {
		try {
			const credito = await carteraBackClient.getCredito(digitos);
			const nombre = credito.usuario?.nombre?.trim();
			if (nombre) {
				const [yaRegistrado] = await db
					.select({ id: buroInternoPersonas.id })
					.from(buroInternoPersonas)
					.where(
						and(
							eq(buroInternoPersonas.activo, true),
							eq(
								buroInternoPersonas.numeroCreditoSifco,
								credito.credito.numero_credito_sifco,
							),
						),
					)
					.limit(1);

				candidatos.unshift({
					origen: "cartera",
					leadId: null,
					...sugerirNombresApellidos(nombre),
					dpi: null,
					nit: credito.usuario.nit,
					telefono: null,
					direccion: null,
					numerosSifco: [credito.credito.numero_credito_sifco],
					yaRegistrado: Boolean(yaRegistrado),
				});
			}
		} catch (error) {
			// Un SIFCO que no existe en cartera no es un error para el buscador
			console.warn(
				`[buro-interno] SIFCO ${digitos} no encontrado en cartera-back:`,
				error instanceof Error ? error.message : error,
			);
		}
	}

	return candidatos;
}

export type DatosPersona = {
	leadId?: string | null;
	numeroCreditoSifco?: string | null;
	nombres: string;
	apellidos: string;
	dpi?: string | null;
	nit?: string | null;
	telefono?: string | null;
	direccion?: string | null;
	categoria: BuroInternoCategoria;
	motivo: string;
};

function limpiarDatos(datos: DatosPersona) {
	const dpiIngresado = textoOpcional(datos.dpi);
	const dpi = dpiIngresado ? normalizarDpiMatch(dpiIngresado) : null;
	if (dpiIngresado && !dpi) {
		throw new BuroInternoValidacionError("El DPI debe tener 13 dígitos");
	}

	return {
		leadId: datos.leadId ?? null,
		numeroCreditoSifco: textoOpcional(datos.numeroCreditoSifco),
		nombres: datos.nombres.trim(),
		apellidos: datos.apellidos.trim(),
		dpi,
		nit: textoOpcional(datos.nit),
		telefono: textoOpcional(datos.telefono),
		direccion: textoOpcional(datos.direccion),
		categoria: datos.categoria,
		motivo: datos.motivo.trim(),
	};
}

async function asegurarSinDuplicado(
	datos: { dpi: string | null; leadId: string | null },
	excluirId?: string,
) {
	const coincide: SQL[] = [];
	if (datos.dpi) coincide.push(eq(buroInternoPersonas.dpi, datos.dpi));
	if (datos.leadId) coincide.push(eq(buroInternoPersonas.leadId, datos.leadId));
	if (coincide.length === 0) return;

	const [existente] = await db
		.select({
			id: buroInternoPersonas.id,
			nombres: buroInternoPersonas.nombres,
			apellidos: buroInternoPersonas.apellidos,
		})
		.from(buroInternoPersonas)
		.where(
			and(
				eq(buroInternoPersonas.activo, true),
				or(...coincide),
				excluirId ? sql`${buroInternoPersonas.id} <> ${excluirId}` : undefined,
			),
		)
		.limit(1);

	if (existente) {
		throw new BuroInternoDuplicadoError(
			`${existente.nombres} ${existente.apellidos} ya está activo en el buró interno`,
		);
	}
}

function traducirDuplicado(error: unknown): never {
	if (isUniqueViolation(error)) {
		throw new BuroInternoDuplicadoError(
			"Esta persona ya está activa en el buró interno",
		);
	}
	throw error;
}

export async function crearPersona(
	datos: DatosPersona,
	actor: ActorBuroInterno,
): Promise<BuroInternoPersona> {
	const limpios = limpiarDatos(datos);

	if (limpios.leadId) {
		const [lead] = await db
			.select({ id: leads.id })
			.from(leads)
			.where(eq(leads.id, limpios.leadId))
			.limit(1);
		if (!lead)
			throw new BuroInternoValidacionError("El lead seleccionado no existe");
	}

	await asegurarSinDuplicado(limpios);

	try {
		return await db.transaction(async (tx) => {
			const [persona] = await tx
				.insert(buroInternoPersonas)
				.values({ ...limpios, creadoPor: actor.id })
				.returning();

			await registrarEvento(tx, {
				accion: "alta",
				actor,
				personaId: persona.id,
				detalle: { datos: limpios },
			});

			return persona;
		});
	} catch (error) {
		traducirDuplicado(error);
	}
}

export async function actualizarPersona(
	id: string,
	datos: DatosPersona,
	actor: ActorBuroInterno,
): Promise<BuroInternoPersona> {
	const [actual] = await db
		.select()
		.from(buroInternoPersonas)
		.where(eq(buroInternoPersonas.id, id))
		.limit(1);

	if (!actual) throw new BuroInternoNoEncontradoError();
	if (!actual.activo) {
		throw new BuroInternoValidacionError(
			"Un registro retirado del buró interno no se puede editar",
		);
	}

	// El enlace al lead no se cambia al editar: se conserva el original
	const limpios = { ...limpiarDatos(datos), leadId: actual.leadId };
	await asegurarSinDuplicado(limpios, id);

	const cambios = Object.fromEntries(
		Object.entries(limpios).filter(
			([campo, valor]) => actual[campo as keyof typeof limpios] !== valor,
		),
	);
	if (Object.keys(cambios).length === 0) return actual;

	const antes = Object.fromEntries(
		Object.keys(cambios).map((campo) => [
			campo,
			actual[campo as keyof typeof limpios],
		]),
	);

	try {
		return await db.transaction(async (tx) => {
			const [persona] = await tx
				.update(buroInternoPersonas)
				.set({ ...cambios, updatedAt: new Date() })
				.where(eq(buroInternoPersonas.id, id))
				.returning();

			await registrarEvento(tx, {
				accion: "edicion",
				actor,
				personaId: id,
				detalle: { antes, despues: cambios },
			});

			return persona;
		});
	} catch (error) {
		traducirDuplicado(error);
	}
}

export async function desactivarPersona(
	id: string,
	motivo: string,
	actor: ActorBuroInterno,
): Promise<BuroInternoPersona> {
	return db.transaction(async (tx) => {
		const [persona] = await tx
			.update(buroInternoPersonas)
			.set({
				activo: false,
				desactivadoPor: actor.id,
				desactivadoAt: new Date(),
				motivoDesactivacion: motivo.trim(),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(buroInternoPersonas.id, id),
					eq(buroInternoPersonas.activo, true),
				),
			)
			.returning();

		if (!persona) {
			throw new BuroInternoNoEncontradoError(
				"El registro no existe o ya había sido retirado del buró interno",
			);
		}

		await registrarEvento(tx, {
			accion: "baja",
			actor,
			personaId: id,
			detalle: { motivo: motivo.trim() },
		});

		return persona;
	});
}

export async function obtenerHistorial(personaId: string) {
	return db
		.select({
			id: buroInternoEventos.id,
			accion: buroInternoEventos.accion,
			detalle: buroInternoEventos.detalle,
			realizadoPorNombre: user.name,
			realizadoPorRol: buroInternoEventos.realizadoPorRol,
			createdAt: buroInternoEventos.createdAt,
		})
		.from(buroInternoEventos)
		.leftJoin(user, eq(user.id, buroInternoEventos.realizadoPor))
		.where(eq(buroInternoEventos.personaId, personaId))
		.orderBy(desc(buroInternoEventos.createdAt));
}

// ============================================================================
// Reglas
// ============================================================================

async function cargarReglas(): Promise<ReglaEfectiva[]> {
	const filas = await db.select().from(buroInternoReglas);
	return resolverReglas(filas);
}

export async function obtenerReglas() {
	const reglas = await cargarReglas();
	const editores = reglas
		.map((r) => r.updatedBy)
		.filter((id): id is string => Boolean(id));

	const nombres = editores.length
		? await db
				.select({ id: user.id, name: user.name })
				.from(user)
				.where(inArray(user.id, [...new Set(editores)]))
		: [];
	const nombrePorId = new Map(nombres.map((u) => [u.id, u.name]));

	return reglas.map((regla) => ({
		...regla,
		updatedByNombre: regla.updatedBy
			? (nombrePorId.get(regla.updatedBy) ?? null)
			: null,
	}));
}

export async function actualizarRegla(
	clave: string,
	cambios: {
		activa: boolean;
		severidad: BuroInternoSeveridad;
		parametros: Record<string, unknown>;
	},
	actor: ActorBuroInterno,
) {
	const validacion = validarParametrosRegla(clave, cambios.parametros);
	if (!validacion.ok) throw new BuroInternoValidacionError(validacion.error);

	const anterior = (await cargarReglas()).find((r) => r.clave === clave);
	if (!anterior)
		throw new BuroInternoValidacionError(`Regla desconocida: ${clave}`);

	const parametros = { ...anterior.parametros, ...validacion.parametros };

	await db.transaction(async (tx) => {
		await tx
			.insert(buroInternoReglas)
			.values({
				clave,
				activa: cambios.activa,
				severidad: cambios.severidad,
				parametros,
				orden: anterior.orden,
				updatedBy: actor.id,
			})
			.onConflictDoUpdate({
				target: buroInternoReglas.clave,
				set: {
					activa: cambios.activa,
					severidad: cambios.severidad,
					parametros,
					updatedBy: actor.id,
					updatedAt: new Date(),
				},
			});

		await registrarEvento(tx, {
			accion: "regla_actualizada",
			actor,
			reglaClave: clave,
			detalle: {
				antes: {
					activa: anterior.activa,
					severidad: anterior.severidad,
					parametros: anterior.parametros,
				},
				despues: {
					activa: cambios.activa,
					severidad: cambios.severidad,
					parametros,
				},
			},
		});
	});

	return (await obtenerReglas()).find((r) => r.clave === clave);
}

// ============================================================================
// Evaluación
// ============================================================================

export type CoincidenciaConRegistro = CoincidenciaBuroInterno & {
	registro: {
		id: string;
		nombreCompleto: string;
		dpi: string | null;
		numeroCreditoSifco: string | null;
		categoria: BuroInternoCategoria;
		motivo: string;
		creadoPorNombre: string | null;
		createdAt: Date;
	};
};

async function evaluar(
	candidatos: CandidatoBuroInterno[],
): Promise<CoincidenciaConRegistro[]> {
	if (candidatos.length === 0) return [];

	const [reglas, registros] = await Promise.all([
		cargarReglas(),
		db
			.select({ persona: buroInternoPersonas, creadoPorNombre: user.name })
			.from(buroInternoPersonas)
			.leftJoin(user, eq(user.id, buroInternoPersonas.creadoPor))
			.where(eq(buroInternoPersonas.activo, true)),
	]);

	const paraMatch: RegistroParaMatch[] = registros.map(
		({ persona }) => persona,
	);
	const porId = new Map(registros.map((r) => [r.persona.id, r]));

	return evaluarCoincidencias(candidatos, paraMatch, reglas).flatMap(
		(coincidencia) => {
			const fila = porId.get(coincidencia.registroId);
			if (!fila) return [];
			const { persona, creadoPorNombre } = fila;
			return {
				...coincidencia,
				registro: {
					id: persona.id,
					nombreCompleto: `${persona.nombres} ${persona.apellidos}`.trim(),
					dpi: persona.dpi,
					numeroCreditoSifco: persona.numeroCreditoSifco,
					categoria: persona.categoria,
					motivo: persona.motivo,
					creadoPorNombre,
					createdAt: persona.createdAt,
				},
			};
		},
	);
}

/** Consulta manual desde el portal; queda en la bitácora quién buscó a quién */
export async function consultarPersona(
	consulta: {
		nombres?: string | null;
		apellidos?: string | null;
		dpi?: string | null;
		nit?: string | null;
		telefono?: string | null;
		direccion?: string | null;
	},
	actor: ActorBuroInterno,
) {
	const coincidencias = await evaluar([
		{
			origen: "titular",
			etiqueta: "Consulta",
			nombres: consulta.nombres,
			apellidos: consulta.apellidos,
			dpi: consulta.dpi,
			nit: consulta.nit,
			telefonos: [consulta.telefono],
			direccion: consulta.direccion,
		},
	]);

	await registrarEvento(db, {
		accion: "consulta",
		actor,
		detalle: {
			consulta,
			coincidencias: coincidencias.map((c) => ({
				registroId: c.registroId,
				reglas: c.reglas.map((r) => r.clave),
			})),
		},
	});

	return coincidencias;
}

export class OportunidadSinLeadError extends Error {
	constructor() {
		super("La oportunidad no existe o no tiene lead");
		this.name = "OportunidadSinLeadError";
	}
}

/**
 * Evalúa a todos los de la solicitud: el titular (con los nombres de RENAP si
 * ya se sincronizaron, que vienen bien separados), los codeudores y las
 * referencias personales del lead.
 */
export async function evaluarOportunidad(opportunityId: string) {
	const [fila] = await db
		.select({
			leadId: leads.id,
			firstName: leads.firstName,
			middleName: leads.middleName,
			lastName: leads.lastName,
			secondLastName: leads.secondLastName,
			dpi: leads.dpi,
			nit: leads.nit,
			phone: leads.phone,
			direccion: leads.direccion,
		})
		.from(opportunities)
		.innerJoin(leads, eq(leads.id, opportunities.leadId))
		.where(eq(opportunities.id, opportunityId))
		.limit(1);

	if (!fila) throw new OportunidadSinLeadError();

	const [renap, codeudores, referencias] = await Promise.all([
		fila.dpi
			? db
					.select({
						firstName: renapInfo.firstName,
						secondName: renapInfo.secondName,
						thirdName: renapInfo.thirdName,
						firstLastName: renapInfo.firstLastName,
						secondLastName: renapInfo.secondLastName,
					})
					.from(renapInfo)
					.where(eqDpi(renapInfo.dpi, fila.dpi))
					.limit(1)
					.then((filas) => filas[0] ?? null)
			: Promise.resolve(null),
		db
			.select({
				fullName: coDebtors.fullName,
				dpi: coDebtors.dpi,
				phone: coDebtors.phone,
			})
			.from(coDebtors)
			.where(eq(coDebtors.opportunityId, opportunityId)),
		db
			.select({
				nombre: referenciasLead.nombre,
				telefono: referenciasLead.telefono,
			})
			.from(referenciasLead)
			.where(eq(referenciasLead.leadId, fila.leadId))
			.orderBy(asc(referenciasLead.createdAt)),
	]);

	const nombresTitular = renap
		? {
				nombres: [renap.firstName, renap.secondName, renap.thirdName]
					.filter(Boolean)
					.join(" "),
				apellidos: [renap.firstLastName, renap.secondLastName]
					.filter(Boolean)
					.join(" "),
			}
		: {
				nombres: [fila.firstName, fila.middleName].filter(Boolean).join(" "),
				apellidos: [fila.lastName, fila.secondLastName]
					.filter(Boolean)
					.join(" "),
			};

	const candidatos: CandidatoBuroInterno[] = [
		{
			origen: "titular",
			etiqueta: "Titular",
			...nombresTitular,
			dpi: fila.dpi,
			nit: fila.nit,
			telefonos: [fila.phone],
			direccion: fila.direccion,
		},
		...codeudores.map<CandidatoBuroInterno>((c) => ({
			origen: "codeudor",
			etiqueta: `Codeudor: ${c.fullName}`,
			nombreCompleto: c.fullName,
			dpi: c.dpi,
			telefonos: [c.phone],
		})),
		...referencias.map<CandidatoBuroInterno>((r) => ({
			origen: "referencia",
			etiqueta: `Referencia: ${r.nombre}`,
			nombreCompleto: r.nombre,
			telefonos: [r.telefono],
		})),
	];

	const evaluados: Record<OrigenCandidato, number> = {
		titular: 1,
		codeudor: codeudores.length,
		referencia: referencias.length,
	};

	return {
		evaluadoEn: new Date(),
		evaluados,
		coincidencias: await evaluar(candidatos),
	};
}
