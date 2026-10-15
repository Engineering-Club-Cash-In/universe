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
import { type AnyPgColumn, alias } from "drizzle-orm/pg-core";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	type BuroInternoCategoria,
	type BuroInternoOrigen,
	type BuroInternoPersona,
	type BuroInternoSeveridad,
	buroInternoAutorizaciones,
	buroInternoEventos,
	buroInternoFuentesCartera,
	buroInternoPersonas,
	buroInternoReglas,
} from "../db/schema/buro-interno";
import { carteraBackReferences } from "../db/schema/cartera-back";
import {
	coDebtors,
	leads,
	opportunities,
	referenciasLead,
} from "../db/schema/crm";
import { renapInfo } from "../db/schema/renap";
import {
	agregarObjetivoPersonaGuardada,
	cambioFuenteCartera,
	cambioPersonaAutomatica,
	candidatosIdentidadCoincidentesConFuente,
	crearColaSerial,
	decidirPersistenciaAutomatica,
	esFichaAutomaticaReconciliable,
	esFichaManual,
	esFichaManualActiva,
	evaluarConHuellaEstable,
	fuentesCoincidentesPorUsuario,
	indexarRelacionesLeadPorSifco,
	personaGuardadaFiguraEnCliente,
	usuariosParaSincronizacionAutomatica,
} from "../lib/buro-interno-automatico";
import {
	categoriaRiesgoPrioritaria,
	evidenciaRiesgoCredito,
	idsFuentesObsoletas,
	planificarVigenciaPersonaAutomatica,
	type RiesgoCartera,
	resumirFuentesRiesgo,
	separarIdentidadesClienteCartera,
	type IdentidadClienteCartera,
} from "../lib/buro-interno-cartera";
import {
	type CandidatoBuroInterno,
	type CoincidenciaBuroInterno,
	evaluarCoincidencias,
	normalizarDpiMatch,
	normalizarNitMatch,
	type OrigenCandidato,
	type RegistroParaMatch,
	type ReglaEfectiva,
	registrosQueBloquean,
	resolverReglas,
	sugerirNombresApellidos,
	validarParametrosRegla,
} from "../lib/buro-interno-match";
import { isUniqueViolation } from "../lib/db-errors";
import { eqDpi } from "../lib/dpi-lookup";
import type { CreditoBuroInterno } from "../types/cartera-back";
import { carteraBackClient } from "./cartera-back-client";
import {
	isCarteraBackEnabled,
	isCarteraBackPaymentsEnabled,
} from "./cartera-back-integration";

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

type Ejecutor = Pick<typeof db, "delete" | "insert">;

async function registrarEvento(
	ejecutor: Ejecutor,
	evento: {
		accion: string;
		actor: ActorBuroInterno | null;
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
		realizadoPor: evento.actor?.id ?? null,
		realizadoPorRol: evento.actor?.rol ?? "system",
	});
}

async function invalidarAutorizacionesPorCambioAutomatico(
	ejecutor: Ejecutor,
	personaId: string,
	motivos: string[],
): Promise<void> {
	const eliminadas = await ejecutor
		.delete(buroInternoAutorizaciones)
		.where(eq(buroInternoAutorizaciones.personaId, personaId))
		.returning({ opportunityId: buroInternoAutorizaciones.opportunityId });
	if (eliminadas.length === 0) return;
	await registrarEvento(ejecutor, {
		accion: "invalidacion_autorizaciones_automaticas_cartera",
		actor: null,
		personaId,
		detalle: {
			motivos: [...new Set(motivos)],
			oportunidadesId: eliminadas.map(({ opportunityId }) => opportunityId),
		},
	});
}

/**
 * Candado de Postgres que serializa las escrituras del buró con la aprobación
 * del análisis. Sin él, la huella de `huellaEvaluacionSql` es solo una foto:
 * en READ COMMITTED un alta que se confirma mientras corre el UPDATE de
 * aprobación no la invalida. Lo toman las dos puntas, así que una espera a la
 * otra y la huella siempre se evalúa contra un catálogo quieto.
 *
 * Es por transacción: se libera solo al terminar, sin nada que desbloquear a
 * mano. El orden es siempre candado → escritura, así que no hay abrazos.
 */
export async function tomarCandadoBuroInterno(
	ejecutor: Pick<typeof db, "execute">,
): Promise<void> {
	await ejecutor.execute(
		sql`SELECT pg_advisory_xact_lock(hashtext('buro_interno'))`,
	);
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

/** Patrón `%texto%` para ILIKE, con los comodines del usuario escapados */
function patronContiene(valor: string): string {
	return `%${valor.replace(/[%_\\]/g, "\\$&")}%`;
}

/**
 * Los SIFCO no son solo números: los créditos que nacen en el CRM llevan
 * `CRM-<uuid>` (ver `close-opportunity.ts`). Una sola palabra sin espacios
 * puede ser uno de esos, así que se busca también como SIFCO.
 */
function puedeSerSifco(termino: string): boolean {
	return !/\s/.test(termino);
}

function sinTildesSql(expresion: SQL): SQL {
	return sql`translate(lower(${expresion}), 'áéíóúüñ', 'aeiouun')`;
}

/**
 * Nombre comparable: minúsculas, sin tildes ni espacios. Es la misma
 * expresión del índice único por SIFCO (`buro_interno_personas_sifco_nombre_activo_uq`),
 * así que el chequeo previo y la base coinciden en qué es un duplicado.
 */
function nombreComparableSql(
	nombres: AnyPgColumn | string,
	apellidos: AnyPgColumn | string,
): SQL {
	return sql`regexp_replace(${sinTildesSql(sql`${nombres} || ${apellidos}`)}, '\\s', '', 'g')`;
}

/**
 * NIT comparable: sin guiones ni espacios y en mayúsculas. Es la misma
 * normalización de `normalizarNitMatch` y la del índice
 * `buro_interno_personas_nit_activo_uq`.
 */
function nitComparableSql(nit: AnyPgColumn | SQL): SQL {
	return sql`upper(regexp_replace(${nit}, '[^0-9A-Za-z]', '', 'g'))`;
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
		if (puedeSerSifco(busqueda)) {
			alternativas.push(
				sql`coalesce(${buroInternoPersonas.numeroCreditoSifco}, '') ILIKE ${patronContiene(busqueda)}`,
			);
		}
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
	const personaIds = items.map((fila) => fila.persona.id);
	const fuentes =
		personaIds.length > 0
			? await db
					.select({
						id: buroInternoFuentesCartera.id,
						personaId: buroInternoFuentesCartera.personaId,
						numeroCreditoSifco: buroInternoFuentesCartera.numeroCreditoSifco,
						estadoCredito: buroInternoFuentesCartera.estadoCredito,
						categoria: buroInternoFuentesCartera.categoria,
						motivo: buroInternoFuentesCartera.motivo,
						observadoAt: buroInternoFuentesCartera.observadoAt,
					})
					.from(buroInternoFuentesCartera)
					.where(inArray(buroInternoFuentesCartera.personaId, personaIds))
					.orderBy(desc(buroInternoFuentesCartera.observadoAt))
			: [];
	const fuentesPorPersona = new Map<string, typeof fuentes>();
	for (const fuente of fuentes) {
		const lista = fuentesPorPersona.get(fuente.personaId) ?? [];
		lista.push(fuente);
		fuentesPorPersona.set(fuente.personaId, lista);
	}

	return {
		total,
		items: items.map((fila) => ({
			...fila.persona,
			creadoPorNombre: fila.creadoPorNombre,
			desactivadoPorNombre: fila.desactivadoPorNombre,
			fuentesCartera: fuentesPorPersona.get(fila.persona.id) ?? [],
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

	// Leads con alguna oportunidad cuyo SIFCO contiene el patrón, ya sea en la
	// oportunidad o en el enlace con cartera
	const leadsConSifco = (patron: string) => sql`l.id IN (
		SELECT o.lead_id FROM public.opportunities o
		LEFT JOIN public.cartera_back_references c ON c.opportunity_id = o.id
		WHERE o.numero_sifco ILIKE ${patron} OR c.numero_credito_sifco ILIKE ${patron}
	)`;

	let condicion: SQL;
	if (esNumero) {
		const patron = `%${digitos}%`;
		condicion = sql`(
			${leadsConSifco(patron)}
			OR regexp_replace(coalesce(l.dpi, ''), '\\D', '', 'g') LIKE ${patron}
			OR regexp_replace(coalesce(l.phone, ''), '\\D', '', 'g') LIKE ${patron}
		)`;
	} else {
		const palabras = paraLike(limpio)
			.split(/\s+/)
			.filter((p) => p.length >= 2);
		if (palabras.length === 0) return [];
		const porNombre = sql.join(
			palabras.map(
				(p) =>
					sql`${sinTildesSql(sql`concat_ws(' ', l.first_name, l.middle_name, l.last_name, l.second_last_name)`)} LIKE ${`%${p}%`}`,
			),
			sql` AND `,
		);
		// "CRM-550e8400-..." no es un nombre: también se prueba como SIFCO
		condicion = puedeSerSifco(limpio)
			? sql`((${porNombre}) OR ${leadsConSifco(patronContiene(limpio))})`
			: porNombre;
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
					OR (
						${nitComparableSql(sql`l.nit`)} NOT IN ('', 'CF')
						AND length(${nitComparableSql(sql`l.nit`)}) >= 3
						AND ${nitComparableSql(sql`b.nit`)} = ${nitComparableSql(sql`l.nit`)}
					)
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
				const nitCartera = normalizarNitMatch(credito.usuario.nit);
				const [yaRegistrado] = await db
					.select({ id: buroInternoPersonas.id })
					.from(buroInternoPersonas)
					.where(
						and(
							eq(buroInternoPersonas.activo, true),
							or(
								and(
									eq(
										buroInternoPersonas.numeroCreditoSifco,
										credito.credito.numero_credito_sifco,
									),
									sql`${nombreComparableSql(buroInternoPersonas.nombres, buroInternoPersonas.apellidos)} = ${nombreComparableSql(nombre, "")}`,
								),
								// El mismo cliente registrado desde otro de sus créditos
								nitCartera
									? sql`${nitComparableSql(buroInternoPersonas.nit)} = ${nitCartera}`
									: undefined,
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

/**
 * Misma persona activa dos veces: por DPI, por lead, por NIT o por SIFCO +
 * nombre. Los clientes que vienen de cartera no traen lead ni DPI: a ellos los
 * identifica el NIT (el mismo cliente registrado desde dos créditos distintos)
 * o el SIFCO + nombre cuando no hay NIT útil. "CF" no identifica a nadie.
 */
async function asegurarSinDuplicado(
	datos: {
		dpi: string | null;
		leadId: string | null;
		nit: string | null;
		numeroCreditoSifco: string | null;
		nombres: string;
		apellidos: string;
	},
	excluirId?: string,
) {
	const coincide: SQL[] = [];
	if (datos.dpi) coincide.push(eq(buroInternoPersonas.dpi, datos.dpi));
	if (datos.leadId) coincide.push(eq(buroInternoPersonas.leadId, datos.leadId));
	const nit = normalizarNitMatch(datos.nit);
	if (nit)
		coincide.push(sql`${nitComparableSql(buroInternoPersonas.nit)} = ${nit}`);
	if (datos.numeroCreditoSifco) {
		coincide.push(
			and(
				eq(buroInternoPersonas.numeroCreditoSifco, datos.numeroCreditoSifco),
				sql`${nombreComparableSql(buroInternoPersonas.nombres, buroInternoPersonas.apellidos)} = ${nombreComparableSql(datos.nombres, datos.apellidos)}`,
			) as SQL,
		);
	}
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
			await tomarCandadoBuroInterno(tx);

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
	if (actual.origen === "automatico_cartera") {
		throw new BuroInternoValidacionError(
			"Los registros automáticos de Cartera no se editan manualmente. Podés retirarlo con una justificación y crear una ficha manual si corresponde.",
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
			await tomarCandadoBuroInterno(tx);

			// `activo` va en el mismo UPDATE: si alguien lo retiró después de la
			// lectura de arriba, no se toca la fila ni se anota una edición
			// posterior a su baja
			const [persona] = await tx
				.update(buroInternoPersonas)
				.set({ ...cambios, updatedAt: new Date() })
				.where(
					and(
						eq(buroInternoPersonas.id, id),
						eq(buroInternoPersonas.activo, true),
					),
				)
				.returning();

			if (!persona) {
				throw new BuroInternoValidacionError(
					"Un registro retirado del buró interno no se puede editar",
				);
			}

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
		await tomarCandadoBuroInterno(tx);

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
		await tomarCandadoBuroInterno(tx);

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
		origen: BuroInternoOrigen;
		creadoPorNombre: string | null;
		createdAt: Date;
		fuentesCartera: Array<{
			id: string;
			numeroCreditoSifco: string;
			estadoCredito: string;
			categoria: BuroInternoCategoria;
			motivo: string;
		}>;
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
	const fuentes =
		registros.length > 0
			? await db
					.select({
						id: buroInternoFuentesCartera.id,
						personaId: buroInternoFuentesCartera.personaId,
						numeroCreditoSifco: buroInternoFuentesCartera.numeroCreditoSifco,
						estadoCredito: buroInternoFuentesCartera.estadoCredito,
						categoria: buroInternoFuentesCartera.categoria,
						motivo: buroInternoFuentesCartera.motivo,
					})
					.from(buroInternoFuentesCartera)
					.where(
						inArray(
							buroInternoFuentesCartera.personaId,
							registros.map(({ persona }) => persona.id),
						),
					)
			: [];
	const fuentesPorPersona = new Map<string, typeof fuentes>();
	for (const fuente of fuentes) {
		const lista = fuentesPorPersona.get(fuente.personaId) ?? [];
		lista.push(fuente);
		fuentesPorPersona.set(fuente.personaId, lista);
	}

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
					origen: persona.origen,
					creadoPorNombre,
					createdAt: persona.createdAt,
					fuentesCartera: fuentesPorPersona.get(persona.id) ?? [],
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
	const candidatos: CandidatoBuroInterno[] = [
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
	];
	if (isCarteraBackEnabled()) {
		await registrarCoincidenciasCartera(candidatos);
	}
	const coincidencias = await evaluar(candidatos);

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

let cargaCreditosCarteraEnCurso: Promise<CreditoBuroInterno[]> | null = null;

async function cargarCreditosCarteraSinCompartir(): Promise<
	CreditoBuroInterno[]
> {
	const respuesta = await carteraBackClient.obtenerCreditosBuroInterno();
	const idsVistos = new Set<number>();
	let ultimoCreditoId = 0;
	for (const credito of respuesta.data) {
		const id = credito.creditos?.credito_id;
		if (
			!Number.isSafeInteger(id) ||
			id <= ultimoCreditoId ||
			idsVistos.has(id)
		) {
			throw new Error(
				"Cartera devolvió IDs de crédito repetidos o fuera de orden al consultar el buró.",
			);
		}
		if (
			!Number.isSafeInteger(credito.usuarios?.usuario_id) ||
			credito.creditos.usuario_id !== credito.usuarios.usuario_id
		) {
			throw new Error(
				"Cartera devolvió una relación inválida entre crédito y cliente al consultar el buró.",
			);
		}
		idsVistos.add(id);
		ultimoCreditoId = id;
	}
	return respuesta.data;
}

/** Comparte únicamente cargas simultáneas; no conserva resultados para aprobaciones futuras. */
async function cargarCreditosCarteraCompletos(): Promise<CreditoBuroInterno[]> {
	if (cargaCreditosCarteraEnCurso) return cargaCreditosCarteraEnCurso;
	const carga = cargarCreditosCarteraSinCompartir();
	cargaCreditosCarteraEnCurso = carga;
	try {
		return await carga;
	} finally {
		if (cargaCreditosCarteraEnCurso === carga) {
			cargaCreditosCarteraEnCurso = null;
		}
	}
}

// Las evaluaciones del mismo proceso esperan turno antes de abrir la
// transacción, para no retener conexiones mientras otra descarga Cartera.
const enColaSincronizacionCartera = crearColaSerial();

function registrarCoincidenciasCartera(candidatos: CandidatoBuroInterno[]) {
	return enColaSincronizacionCartera(() =>
		registrarCoincidenciasCarteraSinCola(candidatos),
	);
}

/**
 * Añade al catálogo únicamente clientes elegibles que coinciden con alguien
 * de la solicitud. Se usa el matcher actual y una clave estable de usuario
 * Cartera para que consultas repetidas no dupliquen personas.
 */
async function registrarCoincidenciasCarteraSinCola(
	candidatos: CandidatoBuroInterno[],
) {
	await db.transaction(async (tx) => {
		await tomarCandadoBuroInterno(tx);
	const creditos = await cargarCreditosCarteraCompletos();
	type LeadCartera = {
		id: string;
		nombres: string;
		apellidos: string;
		dpi: string | null;
		nit: string | null;
		telefono: string | null;
		direccion: string | null;
	};
	type GrupoCartera = {
		usuario: CreditoBuroInterno["usuarios"];
		creditos: CreditoBuroInterno[];
		riesgos: RiesgoCartera[];
		leads: LeadCartera[];
	};
	type ObjetivoIdentidad = {
		lead: LeadCartera | null;
		identidad: IdentidadClienteCartera | null;
		candidatos: CandidatoBuroInterno[];
		personaAutomatica: BuroInternoPersona | null;
	};
	const grupos = new Map<number, GrupoCartera>();
	for (const credito of creditos) {
		const usuarioId = credito.usuarios?.usuario_id;
		if (!Number.isInteger(usuarioId))
			throw new Error("Cartera devolvió un cliente sin identificador válido");
		const riesgos = evidenciaRiesgoCredito(credito);
		if (riesgos.length === 0) continue;
		const grupo = grupos.get(usuarioId) ?? {
			usuario: credito.usuarios,
			creditos: [],
			riesgos: [],
			leads: [],
		};
		grupo.creditos.push(credito);
		grupo.riesgos.push(
			...riesgos.map((riesgo) => ({
				...riesgo,
				texto: `${credito.creditos.numero_credito_sifco}: ${riesgo.texto}`,
			})),
		);
		grupos.set(usuarioId, grupo);
	}
	const sifcosParaEnriquecer = [
		...new Set(
			[...grupos.values()].flatMap((grupo) =>
				grupo.creditos.map((credito) => credito.creditos.numero_credito_sifco),
			),
		),
	];
	if (sifcosParaEnriquecer.length > 0) {
		const leadsRelacionados = await tx
			.select({
				sifcoDirecto: opportunities.numeroSifco,
				sifcoReferencia: carteraBackReferences.numeroCreditoSifco,
				id: leads.id,
				firstName: leads.firstName,
				middleName: leads.middleName,
				lastName: leads.lastName,
				secondLastName: leads.secondLastName,
				dpi: leads.dpi,
				nit: leads.nit,
				telefono: leads.phone,
				direccion: leads.direccion,
			})
			.from(opportunities)
			.leftJoin(
				carteraBackReferences,
				eq(opportunities.id, carteraBackReferences.opportunityId),
			)
			.innerJoin(
				leads,
				eq(leads.id, opportunities.leadId),
			)
			.where(
				or(
					inArray(opportunities.numeroSifco, sifcosParaEnriquecer),
					inArray(
						carteraBackReferences.numeroCreditoSifco,
						sifcosParaEnriquecer,
					),
				),
			);
		const porSifco = indexarRelacionesLeadPorSifco(
			leadsRelacionados,
			sifcosParaEnriquecer,
		);
		for (const grupo of grupos.values()) {
			for (const credito of grupo.creditos) {
				for (const relacionado of porSifco.get(
					credito.creditos.numero_credito_sifco,
				) ?? []) {
					if (grupo.leads.some((lead) => lead.id === relacionado.id)) continue;
					grupo.leads.push({
						id: relacionado.id,
						nombres: [relacionado.firstName, relacionado.middleName]
							.filter(Boolean)
							.join(" "),
						apellidos: [relacionado.lastName, relacionado.secondLastName]
							.filter(Boolean)
							.join(" "),
						dpi: relacionado.dpi,
						nit: relacionado.nit,
						telefono: relacionado.telefono,
						direccion: relacionado.direccion,
					});
				}
			}
		}
	}

	const reglas = candidatos.length > 0 ? await cargarReglas() : [];
	const fuentes: RegistroParaMatch[] = [];
	const origenFuente = new Map<
		string,
		{
			usuarioId: number;
			lead: LeadCartera | null;
			identidad: IdentidadClienteCartera | null;
		}
	>();
	const porId = new Map<number, GrupoCartera>();
	for (const [usuarioId, grupo] of grupos) {
		const agregarFuente = (
			id: string,
			lead: LeadCartera | null,
			identidad: IdentidadClienteCartera | null,
		) => {
			const nombreBase = identidad?.nombreCompleto ?? grupo.usuario.nombre;
			const { nombres, apellidos } = sugerirNombresApellidos(nombreBase);
			fuentes.push({
				id,
				leadId: lead?.id ?? null,
				nombres: lead?.nombres || nombres,
				apellidos: lead?.apellidos || apellidos,
				dpi: lead?.dpi ?? null,
				nit:
					textoOpcional(lead?.nit) ??
					textoOpcional(identidad?.nit) ??
					(lead ? textoOpcional(grupo.usuario.nit) : null),
				telefono: lead?.telefono ?? null,
				direccion: lead?.direccion ?? grupo.usuario.direccion ?? null,
			});
			origenFuente.set(id, { usuarioId, lead, identidad });
		};
		for (const [indice, identidad] of separarIdentidadesClienteCartera(
			grupo.usuario.nombre,
			grupo.usuario.nit,
		).entries()) {
			agregarFuente(`cartera-user-${usuarioId}-base-${indice}`, null, identidad);
		}
		for (const lead of grupo.leads) {
			agregarFuente(`cartera-user-${usuarioId}-lead-${lead.id}`, lead, null);
		}
		porId.set(usuarioId, grupo);
	}
	const coincidencias = evaluarCoincidencias(candidatos, fuentes, reglas);
	const fuentesPorUsuario = fuentesCoincidentesPorUsuario({
		coincidencias,
		usuarioPorFuente: new Map(
			[...origenFuente].map(([fuenteId, origen]) => [
				fuenteId,
				origen.usuarioId,
			]),
		),
	});
	const usuariosCoincidentes = new Set(fuentesPorUsuario.keys());
	const objetivosPorUsuario = new Map<number, ObjetivoIdentidad[]>();
	for (const [usuarioId, fuenteIds] of fuentesPorUsuario) {
		objetivosPorUsuario.set(
			usuarioId,
			fuenteIds.flatMap((fuenteId) => {
				const origen = origenFuente.get(fuenteId);
				if (!origen) return [];
				return [{
					lead: origen.lead,
					identidad: origen.identidad,
					candidatos: candidatosIdentidadCoincidentesConFuente({
						candidatos,
						coincidencias,
						fuenteId,
					}),
					personaAutomatica: null,
				}];
			}),
		);
	}
		const fuentesAutomaticas = await tx
			.select({
				persona: buroInternoPersonas,
				carteraUsuarioId: buroInternoFuentesCartera.carteraUsuarioId,
			})
			.from(buroInternoFuentesCartera)
			.innerJoin(
				buroInternoPersonas,
				eq(buroInternoPersonas.id, buroInternoFuentesCartera.personaId),
			)
			.where(eq(buroInternoPersonas.origen, "automatico_cartera"));
		const personasAutomaticas = new Map<
			string,
			{
				persona: BuroInternoPersona;
				usuarios: Set<number>;
			}
		>();
		for (const fuente of fuentesAutomaticas) {
			const estado = personasAutomaticas.get(fuente.persona.id) ?? {
				persona: fuente.persona,
				usuarios: new Set<number>(),
			};
			estado.usuarios.add(fuente.carteraUsuarioId);
			personasAutomaticas.set(fuente.persona.id, estado);
		}
		const personasAutomaticasCoincidentes = new Set(
			evaluarCoincidencias(
				candidatos,
				[...personasAutomaticas.values()]
					.map(({ persona }) => persona)
					.filter(esFichaAutomaticaReconciliable),
				reglas,
			).map((coincidencia) => coincidencia.registroId),
		);
		for (const [personaId, estado] of personasAutomaticas) {
			if (!personasAutomaticasCoincidentes.has(personaId)) continue;
			if (!esFichaAutomaticaReconciliable(estado.persona)) continue;
			const planVigencia = planificarVigenciaPersonaAutomatica(
				estado.usuarios,
				grupos.keys(),
			);
			if (!planVigencia.desactivar) {
				if (planVigencia.usuariosSinRiesgo.length > 0) {
					await tx
						.delete(buroInternoFuentesCartera)
						.where(
							and(
								eq(buroInternoFuentesCartera.personaId, personaId),
								inArray(
									buroInternoFuentesCartera.carteraUsuarioId,
									planVigencia.usuariosSinRiesgo,
								),
							),
						);
					await registrarEvento(tx, {
						accion: "retiro_fuentes_automaticas_cartera",
						actor: null,
						personaId,
						detalle: {
							usuariosCarteraId: planVigencia.usuariosSinRiesgo,
						},
					});
					await invalidarAutorizacionesPorCambioAutomatico(tx, personaId, [
						"retiro_fuentes",
					]);
				}
				continue;
			}
			if (!estado.persona.activo) continue;
			const ahora = new Date();
			await tx
				.update(buroInternoPersonas)
				.set({
					activo: false,
					desactivadoAt: ahora,
					motivoDesactivacion:
						"La evidencia de riesgo ya no está vigente en Cartera.",
					updatedAt: ahora,
				})
				.where(eq(buroInternoPersonas.id, personaId));
			await registrarEvento(tx, {
				accion: "retiro_automatico_cartera",
				actor: null,
				personaId,
				detalle: { usuariosCarteraId: [...estado.usuarios] },
			});
			await invalidarAutorizacionesPorCambioAutomatico(tx, personaId, [
				"retiro_automatico",
			]);
		}
		// La consulta en línea solo reconcilia personas relacionadas con el
		// candidato. El mantenimiento global queda fuera del candado interactivo.
		const usuariosASincronizar = usuariosParaSincronizacionAutomatica({
			usuariosCoincidentes,
			personasCoincidentes: personasAutomaticasCoincidentes,
			usuariosPorPersona: new Map(
				[...personasAutomaticas].map(([personaId, estado]) => [
					personaId,
					estado.usuarios,
				]),
			),
			usuariosConRiesgo: grupos.keys(),
		});
		if (usuariosASincronizar.length === 0) return;
		const retirosPorIdentidad: Array<{ personaId: string; usuarioId: number }> = [];
		for (const personaId of personasAutomaticasCoincidentes) {
			const estado = personasAutomaticas.get(personaId);
			if (!estado) continue;
			for (const usuarioId of estado.usuarios) {
				if (!grupos.has(usuarioId)) continue;
				const grupoActual = grupos.get(usuarioId);
				const identidadesActuales = grupoActual
					? separarIdentidadesClienteCartera(
							grupoActual.usuario.nombre,
							grupoActual.usuario.nit,
						)
					: [];
				// Un cliente con una sola identidad y sin leads no se confunde con otra
				// persona: su ficha sigue siendo suya aunque Cartera corrija el nombre.
				if (
					grupoActual &&
					!(
						identidadesActuales.length <= 1 && grupoActual.leads.length === 0
					) &&
					!personaGuardadaFiguraEnCliente(estado.persona, {
						nombresCompletos: [
							...identidadesActuales.map((identidad) => identidad.nombreCompleto),
							...grupoActual.leads.map((lead) => `${lead.nombres} ${lead.apellidos}`),
						],
						leadIds: grupoActual.leads.map((lead) => lead.id),
						dpis: grupoActual.leads.map((lead) => lead.dpi),
						nits: [
							...identidadesActuales.map((identidad) => identidad.nit),
							...grupoActual.leads.map((lead) => lead.nit),
						],
					})
				) {
					retirosPorIdentidad.push({ personaId, usuarioId });
					continue;
				}
				const objetivos = objetivosPorUsuario.get(usuarioId) ?? [];
				const coincidenciasPersona = evaluarCoincidencias(
					candidatos,
					[estado.persona],
					reglas,
				);
				objetivosPorUsuario.set(usuarioId, agregarObjetivoPersonaGuardada(objetivos, {
					lead: null,
					identidad: null,
					candidatos: candidatosIdentidadCoincidentesConFuente({
						candidatos,
						coincidencias: coincidenciasPersona,
						fuenteId: estado.persona.id,
					}),
					personaAutomatica: estado.persona,
				}));
			}
		}
		// Identidades que el cliente de Cartera ya no lista: se retiran sus
		// fuentes de ese usuario y, si la ficha queda sin evidencia, se retira.
		for (const { personaId, usuarioId } of retirosPorIdentidad) {
			await tx
				.delete(buroInternoFuentesCartera)
				.where(
					and(
						eq(buroInternoFuentesCartera.personaId, personaId),
						eq(buroInternoFuentesCartera.carteraUsuarioId, usuarioId),
					),
				);
			await registrarEvento(tx, {
				accion: "retiro_fuentes_automaticas_cartera",
				actor: null,
				personaId,
				detalle: {
					usuariosCarteraId: [usuarioId],
					motivo: "identidad_no_figura_en_cartera",
				},
			});
			await invalidarAutorizacionesPorCambioAutomatico(tx, personaId, [
				"retiro_fuentes",
			]);
			const fuentesRestantes = await tx
				.select({
					numeroCreditoSifco: buroInternoFuentesCartera.numeroCreditoSifco,
					categoria: buroInternoFuentesCartera.categoria,
					motivo: buroInternoFuentesCartera.motivo,
				})
				.from(buroInternoFuentesCartera)
				.where(eq(buroInternoFuentesCartera.personaId, personaId));
			const ahora = new Date();
			if (fuentesRestantes.length === 0) {
				const [retirada] = await tx
					.update(buroInternoPersonas)
					.set({
						activo: false,
						desactivadoAt: ahora,
						motivoDesactivacion:
							"La identidad ya no figura en el cliente de Cartera.",
						updatedAt: ahora,
					})
					.where(
						and(
							eq(buroInternoPersonas.id, personaId),
							eq(buroInternoPersonas.activo, true),
						),
					)
					.returning({ id: buroInternoPersonas.id });
				if (retirada) {
					await registrarEvento(tx, {
						accion: "retiro_automatico_cartera",
						actor: null,
						personaId,
						detalle: { usuariosCarteraId: [usuarioId] },
					});
					await invalidarAutorizacionesPorCambioAutomatico(tx, personaId, [
						"retiro_automatico",
					]);
				}
				continue;
			}
			const resumen = resumirFuentesRiesgo(fuentesRestantes);
			await tx
				.update(buroInternoPersonas)
				.set({ ...resumen, updatedAt: ahora })
				.where(
					and(
						eq(buroInternoPersonas.id, personaId),
						or(
							sql`${buroInternoPersonas.categoria} <> ${resumen.categoria}`,
							sql`${buroInternoPersonas.motivo} <> ${resumen.motivo}`,
						),
					),
				);
		}
		const personasProcesadas = new Set<string>();
		const personasProcesadasPorUsuario = new Set<string>();
		for (const usuarioId of usuariosASincronizar) {
			const grupo = porId.get(usuarioId);
			if (!grupo) continue;
			for (const objetivo of objetivosPorUsuario.get(usuarioId) ?? []) {
			const identidadBase = objetivo.identidad;
			const nombreBase = identidadBase?.nombreCompleto ?? grupo.usuario.nombre;
			const { nombres, apellidos } = sugerirNombresApellidos(nombreBase);
			const sifcos = [
				...new Set(grupo.creditos.map((c) => c.creditos.numero_credito_sifco)),
			].sort();
			const resumenGrupo = resumirFuentesRiesgo(
				grupo.creditos.map((credito) => {
					const riesgos = evidenciaRiesgoCredito(credito);
					return {
						numeroCreditoSifco: credito.creditos.numero_credito_sifco,
						categoria: categoriaRiesgoPrioritaria(
							riesgos.map((riesgo) => riesgo.categoria),
						),
						motivo: riesgos.map((riesgo) => riesgo.texto).join("; "),
					};
				}),
			);
			const { categoria, motivo } = resumenGrupo;
			const nombresFuente =
				objetivo.personaAutomatica?.nombres ??
				(objetivo.lead?.nombres || nombres || grupo.usuario.nombre);
			const apellidosFuente =
				objetivo.personaAutomatica?.apellidos ??
				(objetivo.lead?.apellidos || apellidos);
			const nitFuente =
				textoOpcional(objetivo.personaAutomatica?.nit) ??
				textoOpcional(objetivo.lead?.nit) ??
				textoOpcional(identidadBase?.nit) ??
				(!grupo.usuario.nombre.includes("/") && !objetivo.personaAutomatica
					? textoOpcional(grupo.usuario.nit)
					: null);

			// Con una sola identidad y sin leads, las fuentes del mismo usuario
			// bastan para reconocer la ficha aunque Cartera corrija el nombre;
			// así se conserva un retiro manual de Cobros.
			const identidadUnicaCartera =
				separarIdentidadesClienteCartera(grupo.usuario.nombre, grupo.usuario.nit)
					.length <= 1 && grupo.leads.length === 0;

			const condicionIdentidad = or(
				objetivo.personaAutomatica?.id
					? eq(buroInternoPersonas.id, objetivo.personaAutomatica.id)
					: undefined,
				objetivo.lead?.id
					? eq(buroInternoPersonas.leadId, objetivo.lead.id)
					: undefined,
				objetivo.lead?.dpi
					? eq(
							buroInternoPersonas.dpi,
							normalizarDpiMatch(objetivo.lead.dpi) ?? "",
						)
					: undefined,
				nitFuente && normalizarNitMatch(nitFuente)
					? sql`${nitComparableSql(buroInternoPersonas.nit)} = ${normalizarNitMatch(nitFuente)}`
					: undefined,
				...grupo.creditos.map((credito) =>
					and(
						eq(
							buroInternoPersonas.numeroCreditoSifco,
							credito.creditos.numero_credito_sifco,
						),
						sql`${nombreComparableSql(buroInternoPersonas.nombres, buroInternoPersonas.apellidos)} = ${nombreComparableSql(nombresFuente, apellidosFuente)}`,
					),
				),
				// La ficha guardada puede seguir apuntando a un SIFCO que ya no está
				// en riesgo; se reconoce por sus fuentes del mismo usuario de Cartera
				// y, si el cliente tiene varias identidades o leads, también por nombre.
				and(
					sql`exists (select 1 from ${buroInternoFuentesCartera} where ${buroInternoFuentesCartera.personaId} = ${buroInternoPersonas.id} and ${buroInternoFuentesCartera.carteraUsuarioId} = ${usuarioId})`,
					identidadUnicaCartera
						? undefined
						: sql`${nombreComparableSql(buroInternoPersonas.nombres, buroInternoPersonas.apellidos)} = ${nombreComparableSql(nombresFuente, apellidosFuente)}`,
				),
			);
			const condicionesCandidato = objetivo.candidatos.flatMap((candidato) => {
				const nombreCandidato = candidato.nombres?.trim()
					? {
							nombres: candidato.nombres,
							apellidos: candidato.apellidos ?? "",
						}
					: sugerirNombresApellidos(candidato.nombreCompleto ?? "");
				return [
					candidato.leadId
						? eq(buroInternoPersonas.leadId, candidato.leadId)
						: undefined,
					normalizarDpiMatch(candidato.dpi)
						? eq(
								buroInternoPersonas.dpi,
								normalizarDpiMatch(candidato.dpi) ?? "",
							)
						: undefined,
					normalizarNitMatch(candidato.nit)
						? sql`${nitComparableSql(buroInternoPersonas.nit)} = ${normalizarNitMatch(candidato.nit)}`
						: undefined,
					nombreCandidato.nombres || nombreCandidato.apellidos
						? sql`${nombreComparableSql(buroInternoPersonas.nombres, buroInternoPersonas.apellidos)} = ${nombreComparableSql(nombreCandidato.nombres, nombreCandidato.apellidos)}`
						: undefined,
				];
			});
			const condicionFichaManual = or(
				condicionIdentidad,
				...condicionesCandidato,
			);
			// Un usuario de Cartera puede representar varias personas separadas por
			// `/`. La ficha existente se busca por la identidad actual, no por el
			// usuario de Cartera completo, para no sobrescribir otra persona.
			let personaExistente =
				(
					await tx
						.select({ persona: buroInternoPersonas })
						.from(buroInternoPersonas)
						.where(
							and(
								eq(buroInternoPersonas.origen, "automatico_cartera"),
								condicionIdentidad,
							),
						)
						.orderBy(
							desc(buroInternoPersonas.activo),
							desc(buroInternoPersonas.createdAt),
						)
						.limit(1)
				)[0]?.persona ?? null;
			if (personaExistente?.desactivadoPor) continue;
			const clavePersonaUsuario = personaExistente
				? `${personaExistente.id}:${usuarioId}`
				: null;
			if (
				clavePersonaUsuario &&
				personasProcesadasPorUsuario.has(clavePersonaUsuario)
			) {
				continue;
			}
			const fichaManual = (
				await tx
					.select({ persona: buroInternoPersonas })
					.from(buroInternoPersonas)
					.where(
						and(
							eq(buroInternoPersonas.origen, "manual"),
							condicionFichaManual,
						),
					)
					.orderBy(desc(buroInternoPersonas.createdAt))
					.limit(1)
			)[0]?.persona ?? null;
			if (esFichaManual(fichaManual)) continue;

			const buscarDuplicadoActivo = async () =>
				(
					await tx
						.select({ persona: buroInternoPersonas })
						.from(buroInternoPersonas)
						.where(
							and(
								eq(buroInternoPersonas.activo, true),
								condicionIdentidad,
							),
						)
						.orderBy(
							sql`CASE WHEN ${buroInternoPersonas.origen} = 'manual' THEN 0 ELSE 1 END`,
							desc(buroInternoPersonas.createdAt),
						)
						.limit(1)
				)[0]?.persona ?? null;

			// La precedencia manual se comprueba también al reactivar y ante una
			// identidad compartida por varios usuarios de Cartera.
			let duplicadoActivo = await buscarDuplicadoActivo();
			if (esFichaManualActiva(duplicadoActivo)) continue;
			let vinculadaAExistente = false;
			if (
				duplicadoActivo?.origen === "automatico_cartera" &&
				duplicadoActivo.id !== personaExistente?.id &&
				(!personaExistente || !personaExistente.activo)
			) {
				personaExistente = duplicadoActivo;
				vinculadaAExistente = true;
			}
			let decisionPersistencia = decidirPersistenciaAutomatica({
				automatica: personaExistente,
			});

			if (decisionPersistencia === "crear") {
				const [personaInsertada] = await tx
					.insert(buroInternoPersonas)
					.values({
						leadId: objetivo.lead?.id ?? null,
						origen: "automatico_cartera",
						numeroCreditoSifco: sifcos[0] ?? null,
						nombres: nombresFuente,
						apellidos: apellidosFuente,
						dpi: objetivo.lead?.dpi
							? normalizarDpiMatch(objetivo.lead.dpi)
							: null,
						nit: nitFuente,
						telefono: objetivo.lead?.telefono ?? null,
						direccion:
							objetivo.lead?.direccion ?? grupo.usuario.direccion ?? null,
						categoria,
						motivo,
						creadoPor: null,
					})
					.onConflictDoNothing()
					.returning();
				personaExistente = personaInsertada ?? null;
				if (!personaExistente) {
					duplicadoActivo = await buscarDuplicadoActivo();
					if (esFichaManualActiva(duplicadoActivo)) continue;
					if (duplicadoActivo?.origen !== "automatico_cartera") {
						throw new Error(
							"No se pudo resolver el registro duplicado del buró automático.",
						);
					}
					personaExistente = duplicadoActivo;
					decisionPersistencia = "actualizar";
					vinculadaAExistente = true;
				} else {
					await registrarEvento(tx, {
						accion: "alta_automatica_cartera",
						actor: null,
						personaId: personaExistente.id,
						detalle: {
							usuarioCarteraId: usuarioId,
							sifcos,
							categoria,
							evidencia: grupo.riesgos,
						},
					});
				}
			}
			if (!personaExistente) continue;
			const cambiosEvidencia = new Set<string>();
			const compartePersona =
				Boolean(objetivo.personaAutomatica) ||
				personasProcesadas.has(personaExistente.id) ||
				[
					...(personasAutomaticas.get(personaExistente.id)?.usuarios ?? []),
				].some((id) => id !== usuarioId);
			const ahora = new Date();
			const datosDeseados = {
				activo: true,
				leadId: compartePersona
					? personaExistente.leadId
					: (objetivo.lead?.id ?? null),
				numeroCreditoSifco: compartePersona
					? personaExistente.numeroCreditoSifco
					: (sifcos[0] ?? null),
				nombres: compartePersona ? personaExistente.nombres : nombresFuente,
				apellidos: compartePersona
					? personaExistente.apellidos
					: apellidosFuente,
				dpi: compartePersona
					? personaExistente.dpi
					: objetivo.lead?.dpi
						? normalizarDpiMatch(objetivo.lead.dpi)
						: null,
				nit: compartePersona ? personaExistente.nit : nitFuente,
				telefono: compartePersona
					? personaExistente.telefono
					: (objetivo.lead?.telefono ?? null),
				direccion: compartePersona
					? personaExistente.direccion
					: (objetivo.lead?.direccion ?? grupo.usuario.direccion ?? null),
				categoria: compartePersona ? personaExistente.categoria : categoria,
				motivo: compartePersona ? personaExistente.motivo : motivo,
				desactivadoPor: null,
				desactivadoAt: null,
				motivoDesactivacion: null,
			};
			const cambioAutomatico = cambioPersonaAutomatica(
				personaExistente,
				datosDeseados,
			);
			if (cambioAutomatico) {
				const [actualizada] = await tx
					.update(buroInternoPersonas)
					.set({ ...datosDeseados, updatedAt: ahora })
					.where(eq(buroInternoPersonas.id, personaExistente.id))
					.returning();
				if (actualizada) personaExistente = actualizada;
			}
			if (decisionPersistencia === "reactivar") {
				cambiosEvidencia.add("reactivacion");
				await registrarEvento(tx, {
					accion: "reactivacion_automatica_cartera",
					actor: null,
					personaId: personaExistente.id,
					detalle: {
						usuarioCarteraId: usuarioId,
						sifcos,
						categoria,
						evidencia: grupo.riesgos,
					},
				});
			}

			// Una ficha reactivada o vinculada en esta misma pasada puede conservar
			// fuentes de otros usuarios de Cartera que ya perdieron el riesgo. Se
			// purgan antes de resumir, para no arrastrar evidencia retirada.
			const usuariosSinRiesgoEnPersona = planificarVigenciaPersonaAutomatica(
				(
					await tx
						.selectDistinct({
							carteraUsuarioId: buroInternoFuentesCartera.carteraUsuarioId,
						})
						.from(buroInternoFuentesCartera)
						.where(eq(buroInternoFuentesCartera.personaId, personaExistente.id))
				).map((fuente) => fuente.carteraUsuarioId),
				grupos.keys(),
			).usuariosSinRiesgo;
			if (usuariosSinRiesgoEnPersona.length > 0) {
				cambiosEvidencia.add("retiro_fuentes");
				await tx
					.delete(buroInternoFuentesCartera)
					.where(
						and(
							eq(buroInternoFuentesCartera.personaId, personaExistente.id),
							inArray(
								buroInternoFuentesCartera.carteraUsuarioId,
								usuariosSinRiesgoEnPersona,
							),
						),
					);
				await registrarEvento(tx, {
					accion: "retiro_fuentes_automaticas_cartera",
					actor: null,
					personaId: personaExistente.id,
					detalle: { usuariosCarteraId: usuariosSinRiesgoEnPersona },
				});
			}

			const idsCreditosVigentes = grupo.creditos.map(
				(credito) => credito.creditos.credito_id,
			);
			const fuentesActuales = await tx
				.select({
					id: buroInternoFuentesCartera.id,
					personaId: buroInternoFuentesCartera.personaId,
					creditoId: buroInternoFuentesCartera.carteraCreditoId,
					numeroCreditoSifco: buroInternoFuentesCartera.numeroCreditoSifco,
					estadoCredito: buroInternoFuentesCartera.estadoCredito,
					categoria: buroInternoFuentesCartera.categoria,
					motivo: buroInternoFuentesCartera.motivo,
					evidencia: buroInternoFuentesCartera.evidencia,
				})
				.from(buroInternoFuentesCartera)
				.where(
					and(
						eq(buroInternoFuentesCartera.carteraUsuarioId, usuarioId),
						eq(buroInternoFuentesCartera.personaId, personaExistente.id),
					),
				);
			const fuenteActualPorCredito = new Map(
				fuentesActuales.map((fuente) => [fuente.creditoId, fuente]),
			);
			const fuentesObsoletas = idsFuentesObsoletas(
				fuentesActuales.map((fuente) => fuente.creditoId),
				idsCreditosVigentes,
			);
			if (fuentesObsoletas.length > 0) {
				cambiosEvidencia.add("retiro_fuentes");
				await tx
					.delete(buroInternoFuentesCartera)
					.where(
						and(
							eq(buroInternoFuentesCartera.carteraUsuarioId, usuarioId),
						eq(buroInternoFuentesCartera.personaId, personaExistente.id),
							inArray(
								buroInternoFuentesCartera.carteraCreditoId,
								fuentesObsoletas,
							),
						),
					);
				await registrarEvento(tx, {
					accion: "retiro_fuentes_automaticas_cartera",
					actor: null,
					personaId: personaExistente.id,
					detalle: {
						usuarioCarteraId: usuarioId,
						creditosCarteraId: fuentesObsoletas,
					},
				});
			}

			for (const credito of grupo.creditos) {
				const riesgosCredito = evidenciaRiesgoCredito(credito);
				const categoriaCredito = categoriaRiesgoPrioritaria(
					riesgosCredito.map((riesgo) => riesgo.categoria),
				);
				const sifco = credito.creditos.numero_credito_sifco;
				const datosDeseadosFuente = {
					personaId: personaExistente.id,
					numeroCreditoSifco: sifco,
					estadoCredito: credito.creditos.statusCredit,
					categoria: categoriaCredito,
					motivo: riesgosCredito.map((riesgo) => riesgo.texto).join("; "),
					evidencia: {
						riesgos: riesgosCredito,
						cuotasAtrasadasAlCancelar:
							credito.cancelaciones[0]?.cuotas_atrasadas ?? null,
					},
				};
				const fuenteExistente = fuenteActualPorCredito.get(
					credito.creditos.credito_id,
				);
				if (!fuenteExistente) {
					cambiosEvidencia.add("nueva_fuente");
					await tx.insert(buroInternoFuentesCartera).values({
						...datosDeseadosFuente,
						carteraUsuarioId: usuarioId,
						carteraCreditoId: credito.creditos.credito_id,
						observadoAt: ahora,
						updatedAt: ahora,
					});
				} else if (cambioFuenteCartera(fuenteExistente, datosDeseadosFuente)) {
					cambiosEvidencia.add("actualizacion_fuente");
					await tx
						.update(buroInternoFuentesCartera)
						.set({
							...datosDeseadosFuente,
							observadoAt: ahora,
							updatedAt: ahora,
						})
						.where(eq(buroInternoFuentesCartera.id, fuenteExistente.id));
				}
			}
			const fuentesVigentesPersona = await tx
				.select({
					numeroCreditoSifco: buroInternoFuentesCartera.numeroCreditoSifco,
					categoria: buroInternoFuentesCartera.categoria,
					motivo: buroInternoFuentesCartera.motivo,
				})
				.from(buroInternoFuentesCartera)
				.where(eq(buroInternoFuentesCartera.personaId, personaExistente.id));
			const resumenPersona = resumirFuentesRiesgo(fuentesVigentesPersona);
			const cambioResumen =
				personaExistente.categoria !== resumenPersona.categoria ||
				personaExistente.motivo !== resumenPersona.motivo;
			if (cambioResumen) {
				cambiosEvidencia.add("actualizacion_resumen");
				const [actualizada] = await tx
					.update(buroInternoPersonas)
					.set({ ...resumenPersona, updatedAt: ahora })
					.where(eq(buroInternoPersonas.id, personaExistente.id))
					.returning();
				if (actualizada) personaExistente = actualizada;
			}
			if (cambiosEvidencia.size > 0) {
				await invalidarAutorizacionesPorCambioAutomatico(
					tx,
					personaExistente.id,
					[...cambiosEvidencia],
				);
			}
			if (
				decisionPersistencia !== "reactivar" &&
				(cambioAutomatico || cambioResumen)
			) {
				await registrarEvento(tx, {
					accion: "actualizacion_automatica_cartera",
					actor: null,
					personaId: personaExistente.id,
					detalle: {
						usuarioCarteraId: usuarioId,
						sifcos,
						categoria: resumenPersona.categoria,
						evidencia: grupo.riesgos,
					},
				});
			}
			if (vinculadaAExistente) {
				await registrarEvento(tx, {
					accion: "vinculo_automatico_cartera",
					actor: null,
					personaId: personaExistente.id,
					detalle: { usuarioCarteraId: usuarioId, sifcos },
				});
			}
			const estadoMemoria = personasAutomaticas.get(personaExistente.id) ?? {
				persona: personaExistente,
				usuarios: new Set<number>(),
			};
			estadoMemoria.persona = personaExistente;
			estadoMemoria.usuarios.add(usuarioId);
			personasAutomaticas.set(personaExistente.id, estadoMemoria);
			personasProcesadas.add(personaExistente.id);
			personasProcesadasPorUsuario.add(`${personaExistente.id}:${usuarioId}`);
			}
		}
	});
}

/**
 * Evalúa a todos los de la solicitud: el titular (con los nombres de RENAP si
 * ya se sincronizaron, que vienen bien separados), los codeudores y las
 * referencias personales del lead.
 */
export async function evaluarOportunidad(
	opportunityId: string,
	opciones: { sincronizarCartera?: boolean } = {},
) {
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
			leadId: fila.leadId,
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

	const identidad: IdentidadEvaluada = {
		leadId: fila.leadId,
		dpi: normalizarDpiMatch(fila.dpi),
	};

	if ((opciones.sincronizarCartera ?? true) && isCarteraBackEnabled()) {
		await registrarCoincidenciasCartera(candidatos);
	}

	const [coincidencias, autorizaciones] = await Promise.all([
		evaluar(candidatos),
		cargarAutorizaciones(opportunityId, identidad),
	]);

	const bloqueantes = registrosQueBloquean(
		coincidencias,
		new Set(autorizaciones.map((a) => a.personaId)),
	);

	return {
		evaluadoEn: new Date(),
		evaluados,
		identidad,
		coincidencias,
		autorizaciones,
		bloqueantes: bloqueantes.map((c) => ({
			registroId: c.registroId,
			nombreCompleto: c.registro.nombreCompleto,
			etiqueta: c.etiqueta,
		})),
		bloqueaAprobacion: bloqueantes.length > 0,
	};
}

/** A quién se evaluó: si esto cambia, las autorizaciones anteriores no valen */
type IdentidadEvaluada = { leadId: string | null; dpi: string | null };

/**
 * Autorizaciones vigentes para esta oportunidad. Solo cuentan las que se
 * dieron sobre la misma identidad: cambiarle el lead a la oportunidad, o
 * cambiarle el DPI al lead, las deja sin efecto.
 */
async function cargarAutorizaciones(
	opportunityId: string,
	identidad: IdentidadEvaluada,
) {
	return db
		.select({
			personaId: buroInternoAutorizaciones.personaId,
			motivo: buroInternoAutorizaciones.motivo,
			autorizadoPorNombre: user.name,
			createdAt: buroInternoAutorizaciones.createdAt,
		})
		.from(buroInternoAutorizaciones)
		.leftJoin(user, eq(user.id, buroInternoAutorizaciones.autorizadoPor))
		.where(
			and(
				eq(buroInternoAutorizaciones.opportunityId, opportunityId),
				sql`${buroInternoAutorizaciones.leadId} IS NOT DISTINCT FROM ${identidad.leadId}::uuid`,
				sql`${buroInternoAutorizaciones.dpi} IS NOT DISTINCT FROM ${identidad.dpi}::text`,
			),
		)
		.orderBy(desc(buroInternoAutorizaciones.createdAt));
}

/**
 * Foto de todo lo que entra en una evaluación: el catálogo activo, sus fuentes
 * de Cartera, las reglas de coincidencia y la gente de la solicitud (lead, sus
 * datos de RENAP, codeudores y referencias).
 *
 * El gate de aprobación compara esta misma expresión dentro del UPDATE que
 * aprueba: si algo de eso cambió entre la revisión y la escritura —cobros
 * registró a alguien, supervisión encendió una regla, ventas agregó un
 * codeudor— la huella no coincide, no se afecta ninguna fila y la aprobación
 * falla en vez de pasar sin haber evaluado lo nuevo.
 */
export function huellaEvaluacionSql(
	opportunityIdExpr: SQL,
	leadIdExpr: SQL,
): SQL {
	const foto = (tabla: string, filtro?: SQL) =>
		sql`(SELECT count(*)::text || ':' || coalesce(max(updated_at)::text, '')
			FROM ${sql.raw(tabla)}${filtro ? sql` WHERE ${filtro}` : sql``})`;
	// Las fuentes automáticas pueden actualizarse con relojes distintos y una
	// huella basada en count + max(updated_at) puede no detectar todos los
	// cambios. El contenido completo, ordenado por id, produce una versión
	// determinística para el gate de aprobación.
	const fotoFuentesCartera = sql`(SELECT coalesce(md5(string_agg(
			concat_ws('|',
				id::text,
				persona_id::text,
				cartera_usuario_id::text,
				cartera_credito_id::text,
				numero_credito_sifco,
				estado_credito,
				categoria,
				motivo,
				evidencia::text,
				observado_at::text,
				created_at::text,
				updated_at::text
			), '~' ORDER BY id)), '')
		FROM public.buro_interno_fuentes_cartera)`;

	// `renapinfo` no tiene timestamps y el titular se arma con esos nombres
	// cuando ya está sincronizado, así que se versiona con un hash de ellos
	const fotoRenap = sql`(SELECT coalesce(md5(string_agg(
			concat_ws('|', r.first_name, r.second_name, r.third_name, r.first_last_name, r.second_last_name),
			'~' ORDER BY r.dpi)), '')
		FROM public.renapinfo r
		WHERE regexp_replace(r.dpi, '\s', '', 'g') = (
			SELECT regexp_replace(coalesce(l.dpi, ''), '\s', '', 'g')
			FROM public.leads l WHERE l.id = ${leadIdExpr}
		))`;

	return sql`concat_ws('|',
		${foto("public.buro_interno_personas", sql`activo`)},
		${fotoFuentesCartera},
		${foto("public.buro_interno_reglas")},
		${foto("public.co_debtors", sql`opportunity_id = ${opportunityIdExpr}`)},
		${foto("public.referencias_lead", sql`lead_id = ${leadIdExpr}`)},
		${foto("public.leads", sql`id = ${leadIdExpr}`)},
		${fotoRenap}
	)`;
}

export async function huellaEvaluacion(opportunityId: string): Promise<string> {
	const { rows } = await db.execute<{ huella: string }>(sql`
		SELECT ${huellaEvaluacionSql(sql`o.id`, sql`o.lead_id`)} AS huella
		FROM public.opportunities o
		WHERE o.id = ${opportunityId}
	`);
	return rows[0]?.huella ?? "";
}

/**
 * El analista levanta el bloqueo con una justificación. Vale solo para las
 * personas que están frenando hoy esta oportunidad: si mañana cobros registra
 * a otra que también coincide, vuelve a frenar.
 */
export async function autorizarOportunidad(
	opportunityId: string,
	motivo: string,
	actor: ActorBuroInterno,
) {
	const evaluacionInicial = await evaluarOportunidad(opportunityId);

	if (evaluacionInicial.bloqueantes.length === 0) {
		throw new BuroInternoValidacionError(
			"No hay coincidencias del buró interno frenando esta oportunidad",
		);
	}

	let evaluacionAutorizada = evaluacionInicial;
	await db.transaction(async (tx) => {
		await tomarCandadoBuroInterno(tx);
		// La sincronización automática usa el mismo candado. Se vuelve a leer el
		// catálogo después de adquirirlo para no autorizar evidencia que cambió
		// entre la evaluación inicial y la escritura de la autorización.
		evaluacionAutorizada = await evaluarOportunidad(opportunityId, {
			sincronizarCartera: false,
		});
		if (evaluacionAutorizada.bloqueantes.length === 0) {
			throw new BuroInternoValidacionError(
				"Las coincidencias del buró interno cambiaron antes de autorizar; vuelva a revisar la oportunidad",
			);
		}
		for (const bloqueante of evaluacionAutorizada.bloqueantes) {
			// Si ya hay una fila para esta persona pero de otra identidad (le
			// cambiaron el lead o el DPI), se reemplaza: esa autorización vieja
			// ya no aplica y sin esto el analista no podría dar la nueva.
			// Cuando la fila existente es de la MISMA identidad no se escribe
			// nada, así dos analistas a la vez no anotan dos autorizaciones.
			const [guardada] = await tx
				.insert(buroInternoAutorizaciones)
				.values({
					opportunityId,
					personaId: bloqueante.registroId,
					leadId: evaluacionAutorizada.identidad.leadId,
					dpi: evaluacionAutorizada.identidad.dpi,
					motivo: motivo.trim(),
					autorizadoPor: actor.id,
				})
				.onConflictDoUpdate({
					target: [
						buroInternoAutorizaciones.opportunityId,
						buroInternoAutorizaciones.personaId,
					],
					set: {
						leadId: evaluacionAutorizada.identidad.leadId,
						dpi: evaluacionAutorizada.identidad.dpi,
						motivo: motivo.trim(),
						autorizadoPor: actor.id,
						createdAt: new Date(),
					},
					setWhere: sql`${buroInternoAutorizaciones.leadId} IS DISTINCT FROM excluded.lead_id
						OR ${buroInternoAutorizaciones.dpi} IS DISTINCT FROM excluded.dpi`,
				})
				.returning({ id: buroInternoAutorizaciones.id });

			if (!guardada) continue;

			await registrarEvento(tx, {
				accion: "autorizacion_analisis",
				actor,
				personaId: bloqueante.registroId,
				detalle: { opportunityId, motivo: motivo.trim() },
			});
		}
	});

	return evaluarOportunidad(opportunityId, { sincronizarCartera: false });
}

/**
 * Para el gate de aprobación del análisis. Una oportunidad sin lead no tiene a
 * quién comparar, así que no frena.
 */
export async function bloqueoBuroInterno(
	opportunityId: string,
): Promise<{ bloquea: boolean; nombres: string[]; huella: string }> {
	// La primera huella sigue tomándose antes de evaluar para detectar cambios
	// concurrentes. La evaluación puede sincronizar legítimamente el catálogo
	// automático; si eso cambia la foto, se repite sobre la nueva huella. Una
	// sincronización idéntica no mueve `updated_at`, por lo que la segunda pasada
	// queda estable y la aprobación no se bloquea a sí misma.
	const huellaInicial = await huellaEvaluacion(opportunityId);

	try {
		const { evaluacion, huella } = await evaluarConHuellaEstable({
			huellaInicial,
			obtenerHuella: () => huellaEvaluacion(opportunityId),
			evaluar: () => evaluarOportunidad(opportunityId),
		});
		return {
			bloquea: evaluacion.bloqueaAprobacion,
			nombres: evaluacion.bloqueantes.map((b) => b.nombreCompleto),
			huella,
		};
	} catch (error) {
		if (error instanceof OportunidadSinLeadError) {
			return { bloquea: false, nombres: [], huella: huellaInicial };
		}
		throw error;
	}
}
