/**
 * Ficha 360 · «Créditos relacionados». Consultas y enriquecimiento con
 * cartera; la parte pura (semillas y consolidación) está en
 * `lib/creditos-relacionados.ts`.
 *
 * El permiso para ABRIR cada crédito es el mismo gate de la ficha
 * (`sifcosQueTrabaja`: dueño en cartera más las coberturas de hoy). Lo que no
 * puede abrir se muestra en un modal con un resumen mínimo, sin datos de
 * contacto de terceros.
 */

import {
	and,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { db } from "../db";
import { creditApplications } from "../db/schema/client-forms";
import { casosCobros, contratosFinanciamiento } from "../db/schema/cobros";
import { clients, coDebtors, leads, opportunities } from "../db/schema/crm";
import { vehicles } from "../db/schema/vehicles";
import {
	duenosEnCarteraPorSifco,
	sifcosQueTrabaja,
} from "../lib/acceso-caso-cobro";
import { ESTADOS_CON_CREDITO } from "../lib/bot-cobros/buscar-cliente";
import {
	armarSemillas,
	type CreditoCanonico,
	type CreditoRelacionadoBase,
	consolidarCreditosRelacionados,
	type FilaPersonaEnCredito,
	filtrarPorAccesoYTopar,
	LIMITE_CANDIDATOS_ACCESO,
	limpiarNombre,
	resolverCreditosCanonicos,
	type Semillas,
} from "../lib/creditos-relacionados";
import { cargarCodeudores } from "../lib/ficha-complementos";
import { fuentesDeReferencias } from "../lib/referencias-cobros";
import { carteraBackClient } from "./cartera-back-client";
import { isCarteraBackEnabled } from "./cartera-back-integration";
import type { ContextoCaso } from "./referencias-cobros-datos";

export type EstadoCarteraRelacionado = {
	bucket: number | null;
	prefijo: string | null;
	nombre: string | null;
	fueraFunnel: boolean;
};

export type CreditoRelacionado = CreditoRelacionadoBase & {
	/** Si el usuario puede abrir su Ficha 360; si no, el front abre el modal. */
	puedeAbrir: boolean;
	asesorNombre: string | null;
	/** null = cartera no respondió o no tiene el crédito. */
	estado: EstadoCarteraRelacionado | null;
};

/** Dígitos de una columna, para el filtro grueso por teléfono. */
function sqlDigitos(columna: unknown) {
	return sql`regexp_replace(coalesce(${columna}, ''), '[^0-9]', '', 'g')`;
}

/**
 * Misma normalización que `normalizarNombre`: minúsculas, NFD sin diacríticos
 * (tilde pegada o como carácter aparte) y un solo espacio.
 */
function sqlNombreNormalizado(expresion: SQL) {
	return sql`btrim(regexp_replace(regexp_replace(normalize(lower(${expresion}), NFD), '[\\u0300-\\u036f]', '', 'g'), '\\s+', ' ', 'g'))`;
}

/**
 * Todos los números del codeudor en un campo: el de `co_debtors` y los de su
 * solicitud, los mismos que usa `cargarCodeudores` para las semillas. Así la
 * búsqueda es simétrica: si A encuentra a B por el móvil de la solicitud del
 * codeudor, B también encuentra a A. Separados por coma para que
 * `extraerTelefonos` los parta en el match exacto.
 */
const telefonosCodeudorSql = sql<string>`concat_ws(',', ${coDebtors.phone}, ${creditApplications.telMovil}, ${creditApplications.telResidencia})`;

const nombreLeadSql = sql`concat_ws(' ', ${leads.firstName}, ${leads.middleName}, ${leads.lastName}, ${leads.secondLastName})`;

/** `col LIKE '%tel%' OR …`, o `false` si no hay teléfonos. */
function filtroTelefonos(columna: unknown, telefonos: string[]): SQL {
	if (telefonos.length === 0) return sql`false`;
	return sql.join(
		telefonos.map((t) => sql`${sqlDigitos(columna)} LIKE ${`%${t}%`}`),
		sql` OR `,
	);
}

function filtroNombres(expresion: SQL, nombres: string[]): SQL {
	if (nombres.length === 0) return sql`false`;
	return sql`${sqlNombreNormalizado(expresion)} IN (${sql.join(
		nombres.map((n) => sql`${n}`),
		sql`, `,
	)})`;
}

/**
 * Las semillas salen SOLO de datos que el rol cobros no puede editar: el lead
 * y los codeudores (los edita el CRM) y las referencias de la solicitud de
 * crédito (las llena el cliente con su token de ventas).
 *
 * Quedan fuera a propósito los teléfonos del caso (`casos_cobros`), las
 * referencias que agrega cobros (`referencias_lead`) y los teléfonos que
 * cobros les suma (`referencias_telefonos_cobros`): un asesor podría escribir
 * ahí el número de otro cliente y, con eso, ver el resumen de un crédito que
 * no es suyo.
 */
async function cargarSemillas(ctx: ContextoCaso): Promise<Semillas> {
	const [lead, codeudores, solicitudesTitular] = await Promise.all([
		ctx.leadId
			? db
					.select({ nombre: nombreLeadSql, phone: leads.phone })
					.from(leads)
					.where(eq(leads.id, ctx.leadId))
					.limit(1)
					.then((filas) => filas[0] ?? null)
			: Promise.resolve(null),
		cargarCodeudores(ctx),
		ctx.opportunityId
			? db
					.select({
						id: creditApplications.id,
						referenciasPersonales: creditApplications.referenciasPersonales,
						referenciasCrediticias: creditApplications.referenciasCrediticias,
						conyugeNombre: creditApplications.conyugeNombre,
						conyugeEmpresa: creditApplications.conyugeEmpresa,
						conyugeTelMovil: creditApplications.conyugeTelMovil,
						conyugeTelOficina: creditApplications.conyugeTelOficina,
						telEmergencia: creditApplications.telEmergencia,
						telMovil: creditApplications.telMovil,
					})
					.from(creditApplications)
					.where(
						and(
							eq(creditApplications.opportunityId, ctx.opportunityId),
							// Solo la del titular; NULL = anterior a la migración 0015.
							or(
								eq(creditApplications.personType, "lead"),
								isNull(creditApplications.personType),
							),
						),
					)
			: Promise.resolve([]),
	]);

	// Mismo armado de referencias que la pestaña Referencias, pero solo con
	// las fuentes de ventas.
	const referenciasVentas = fuentesDeReferencias({
		referenciasLead: [],
		solicitudesTitular,
		codeudores: [],
		telefonosAgregados: [],
		contactos: [],
	});

	return armarSemillas({
		titular: {
			nombre: (lead?.nombre as string | undefined) ?? null,
			// El del lead y el móvil de su solicitud (el mismo que usa
			// `consultaCelularSolicitudTitular`): hay titulares con un número
			// solo en la solicitud.
			telefonos: [
				lead?.phone ?? null,
				...solicitudesTitular.map((s) => s.telMovil),
			],
		},
		codeudores: (codeudores ?? []).map((c) => ({
			nombre: c.nombre,
			telefonos: [c.telefonoPrincipal, c.celularAlterno, c.telefonoCasa],
		})),
		referencias: referenciasVentas.map((r) => ({
			nombre: r.nombre,
			telefonos: r.telefonos.map((t) => t.telefono),
		})),
	});
}

/** Tope de filas por consulta (titulares / codeudores). */
const LIMITE_FILAS = 200;

/**
 * La fila coincide por teléfono. Se selecciona y se ordena por ella ANTES del
 * límite: un nombre común puede traer cientos de homónimos y, sin orden, el
 * límite podía dejar fuera un crédito que sí coincide por teléfono.
 */
function porTelefono(columna: unknown, telefonos: string[]) {
	return sql<boolean>`(${filtroTelefonos(columna, telefonos)})`.as(
		"por_telefono",
	);
}

type CreditoResuelto = CreditoCanonico & {
	titularNombre: string;
	vehiculo: FilaPersonaEnCredito["vehiculo"];
};

/**
 * Lo que de verdad es cada SIFCO (ver `resolverCreditosCanonicos`), más el
 * nombre del titular y el vehículo para mostrar. Todo por lote y solo para
 * los candidatos: no hay índice por SIFCO y una subconsulta correlacionada
 * costaba ~0.4 s por búsqueda.
 */
export async function resolverCreditos(
	sifcos: string[],
): Promise<Map<string, CreditoResuelto>> {
	const unicos = [...new Set(sifcos.filter(Boolean))];
	if (unicos.length === 0) return new Map();

	// Todos los casos del SIFCO, con o sin contrato: primero se elige el
	// vigente y recién después se mira su contrato.
	const casos = await db
		.select({
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			activo: casosCobros.activo,
			updatedAt: casosCobros.updatedAt,
			contratoId: casosCobros.contratoId,
			contratoOpportunityId: clients.opportunityId,
			contratoLeadId: clients.leadId,
			contratoVehicleId: contratosFinanciamiento.vehicleId,
		})
		.from(casosCobros)
		.leftJoin(
			contratosFinanciamiento,
			eq(contratosFinanciamiento.id, casosCobros.contratoId),
		)
		.leftJoin(clients, eq(clients.id, contratosFinanciamiento.clientId))
		.where(inArray(casosCobros.numeroCreditoSifco, unicos));

	const oppsDeContratos = casos
		.map((c) => c.contratoOpportunityId)
		.filter((id): id is string => Boolean(id));
	const oportunidades = await db
		.select({
			id: opportunities.id,
			sifco: opportunities.numeroSifco,
			status: opportunities.status,
			leadId: opportunities.leadId,
			vehicleId: opportunities.vehicleId,
		})
		.from(opportunities)
		.where(
			oppsDeContratos.length > 0
				? or(
						inArray(opportunities.numeroSifco, unicos),
						inArray(opportunities.id, oppsDeContratos),
					)
				: inArray(opportunities.numeroSifco, unicos),
		)
		// El orden que `resolverCreditosCanonicos` espera para el caso sin
		// contrato: won/migrate primero, la más reciente.
		.orderBy(
			sql`CASE WHEN ${opportunities.status} IN ('won', 'migrate') THEN 0 ELSE 1 END`,
			desc(opportunities.createdAt),
		);

	const canonicos = resolverCreditosCanonicos({
		casos: casos.map((c) => ({ ...c, tieneContrato: Boolean(c.contratoId) })),
		oportunidades,
	});

	const leadIds = [...canonicos.values()]
		.map((c) => c.leadId)
		.filter((id): id is string => Boolean(id));
	const vehicleIds = [...canonicos.values()]
		.map((c) => c.vehicleId)
		.filter((id): id is string => Boolean(id));
	const [titulares, vehiculos] = await Promise.all([
		leadIds.length > 0
			? db
					.select({ id: leads.id, nombre: nombreLeadSql })
					.from(leads)
					.where(inArray(leads.id, [...new Set(leadIds)]))
			: Promise.resolve([]),
		vehicleIds.length > 0
			? db
					.select({
						id: vehicles.id,
						marca: vehicles.make,
						modelo: vehicles.model,
						anio: vehicles.year,
						placa: vehicles.licensePlate,
					})
					.from(vehicles)
					.where(inArray(vehicles.id, [...new Set(vehicleIds)]))
			: Promise.resolve([]),
	]);
	const nombrePorLead = new Map(
		titulares.map((t) => [t.id, limpiarNombre(String(t.nombre ?? ""))]),
	);
	const vehiculoPorId = new Map(vehiculos.map((v) => [v.id, v]));

	const resueltos = new Map<string, CreditoResuelto>();
	for (const [sifco, c] of canonicos) {
		const v = c.vehicleId ? vehiculoPorId.get(c.vehicleId) : undefined;
		resueltos.set(sifco, {
			...c,
			titularNombre: (c.leadId && nombrePorLead.get(c.leadId)) || "",
			vehiculo:
				v?.marca && v.modelo
					? { marca: v.marca, modelo: v.modelo, anio: v.anio, placa: v.placa }
					: null,
		});
	}
	return resueltos;
}

/**
 * Oportunidad → SIFCOs donde vive: su propio `numero_sifco` y el de los casos
 * cuyo contrato apunta a ella (un crédito financiado puede tener el SIFCO solo
 * en el caso). `resolverCreditos` carga esas oportunidades por id, así que la
 * búsqueda tiene que llegar a ellas por el mismo camino.
 */
async function sifcosDeOportunidades(
	ids: (string | null)[],
): Promise<Map<string, string[]>> {
	const unicos = [...new Set(ids.filter((id): id is string => Boolean(id)))];
	const sifcos = new Map<string, string[]>();
	if (unicos.length === 0) return sifcos;
	const [propios, porContrato] = await Promise.all([
		db
			.select({ id: opportunities.id, sifco: opportunities.numeroSifco })
			.from(opportunities)
			.where(
				and(
					inArray(opportunities.id, unicos),
					isNotNull(opportunities.numeroSifco),
				),
			),
		db
			.select({
				id: clients.opportunityId,
				sifco: casosCobros.numeroCreditoSifco,
			})
			.from(casosCobros)
			.innerJoin(
				contratosFinanciamiento,
				eq(contratosFinanciamiento.id, casosCobros.contratoId),
			)
			.innerJoin(clients, eq(clients.id, contratosFinanciamiento.clientId))
			.where(inArray(clients.opportunityId, unicos)),
	]);
	for (const f of [...propios, ...porContrato]) {
		if (!f.id || !f.sifco) continue;
		const lista = sifcos.get(f.id) ?? [];
		if (!lista.includes(f.sifco)) lista.push(f.sifco);
		sifcos.set(f.id, lista);
	}
	return sifcos;
}

/**
 * Busca PERSONAS que coinciden (leads y codeudores) y después los créditos
 * de los que de verdad son titular o codeudor, resueltos con
 * `resolverCreditos`. Así una fila vieja (otra oportunidad con el mismo
 * SIFCO, un vehículo o un lead que ya no son los del contrato) no decide nada.
 */
async function buscarFilas(
	semillas: Semillas,
): Promise<FilaPersonaEnCredito[]> {
	const telefonos = semillas.telefonos.map((s) => s.telefono);
	const nombres = semillas.nombres.map((s) => s.nombre);
	if (telefonos.length === 0 && nombres.length === 0) return [];

	const [personasLead, codeudores, solicitudesTitular] = await Promise.all([
		db
			.select({
				id: leads.id,
				nombre: nombreLeadSql,
				phone: leads.phone,
				porTelefono: porTelefono(leads.phone, telefonos),
			})
			.from(leads)
			.where(
				and(
					or(
						filtroTelefonos(leads.phone, telefonos),
						filtroNombres(nombreLeadSql, nombres),
					),
					// Solo personas con algún crédito, para que los homónimos sin
					// crédito no ocupen el tope. `IN (… UNION …)` y no dos EXISTS:
					// así Postgres arma el conjunto una vez (~30 ms contra ~180 ms).
					sql`${leads.id} IN (
						SELECT lead_id FROM opportunities WHERE status IN ('won', 'migrate')
						UNION
						SELECT lead_id FROM clients
					)`,
				),
			)
			.orderBy(sql`por_telefono DESC`)
			.limit(LIMITE_FILAS),
		db
			.selectDistinct({
				opportunityId: coDebtors.opportunityId,
				nombre: coDebtors.fullName,
				telefonos: telefonosCodeudorSql,
				porTelefono: porTelefono(telefonosCodeudorSql, telefonos),
			})
			.from(coDebtors)
			// Su solicitud (única por oportunidad + persona): ahí puede estar el
			// único número del codeudor, igual que en `cargarCodeudores`.
			.leftJoin(
				creditApplications,
				and(
					eq(creditApplications.opportunityId, coDebtors.opportunityId),
					eq(creditApplications.personType, "coDebtor"),
					eq(creditApplications.personId, coDebtors.id),
				),
			)
			.where(
				or(
					filtroTelefonos(telefonosCodeudorSql, telefonos),
					filtroNombres(sql`${coDebtors.fullName}`, nombres),
				),
			)
			.orderBy(sql`por_telefono DESC`)
			.limit(LIMITE_FILAS),
		// Titulares cuyo número está solo en el móvil de su solicitud.
		telefonos.length > 0
			? db
					.selectDistinct({
						opportunityId: creditApplications.opportunityId,
						telMovil: creditApplications.telMovil,
					})
					.from(creditApplications)
					.where(
						and(
							or(
								eq(creditApplications.personType, "lead"),
								isNull(creditApplications.personType),
							),
							filtroTelefonos(creditApplications.telMovil, telefonos),
						),
					)
					.limit(LIMITE_FILAS)
			: Promise.resolve([]),
	]);

	// SIFCOs donde esas personas pueden estar. Quién es el titular o codeudor
	// real de cada uno lo decide `resolverCreditos`.
	const idsLead = personasLead.map((p) => p.id);
	const [oppsDeLeads, sifcosPorContratoDeLead] =
		idsLead.length > 0
			? await Promise.all([
					db
						.select({ id: opportunities.id })
						.from(opportunities)
						.where(inArray(opportunities.leadId, idsLead)),
					db
						.select({ sifco: casosCobros.numeroCreditoSifco })
						.from(casosCobros)
						.innerJoin(
							contratosFinanciamiento,
							eq(contratosFinanciamiento.id, casosCobros.contratoId),
						)
						.innerJoin(
							clients,
							eq(clients.id, contratosFinanciamiento.clientId),
						)
						.where(inArray(clients.leadId, idsLead)),
				])
			: [[], []];
	const sifcosPorOpp = await sifcosDeOportunidades([
		...oppsDeLeads.map((o) => o.id),
		...codeudores.map((c) => c.opportunityId),
		...solicitudesTitular.map((s) => s.opportunityId),
	]);

	const creditos = await resolverCreditos([
		...[...sifcosPorOpp.values()].flat(),
		...sifcosPorContratoDeLead.map((f) => f.sifco ?? ""),
	]);
	const vigente = (c: CreditoResuelto | undefined): c is CreditoResuelto =>
		Boolean(c && ESTADOS_CON_CREDITO.some((e) => e === c.status));

	const personaPorLead = new Map(personasLead.map((p) => [p.id, p]));
	const filas: FilaPersonaEnCredito[] = [];
	for (const [sifco, c] of creditos) {
		if (!vigente(c) || !c.leadId) continue;
		const persona = personaPorLead.get(c.leadId);
		if (!persona) continue;
		filas.push({
			numeroSifco: sifco,
			rol: "titular",
			personaNombre: limpiarNombre(String(persona.nombre ?? "")),
			personaTelefono: persona.phone,
			titularNombre: c.titularNombre,
			vehiculo: c.vehiculo,
		});
	}
	for (const cd of codeudores) {
		for (const sifco of sifcosPorOpp.get(cd.opportunityId) ?? []) {
			const c = creditos.get(sifco);
			// Solo si es codeudor de la oportunidad vigente del SIFCO.
			if (!vigente(c) || c.opportunityId !== cd.opportunityId) continue;
			filas.push({
				numeroSifco: sifco,
				rol: "codeudor",
				personaNombre: limpiarNombre(cd.nombre),
				personaTelefono: cd.telefonos,
				titularNombre: c.titularNombre,
				vehiculo: c.vehiculo,
			});
		}
	}
	for (const sol of solicitudesTitular) {
		if (!sol.opportunityId) continue;
		for (const sifco of sifcosPorOpp.get(sol.opportunityId) ?? []) {
			const c = creditos.get(sifco);
			// Solo la solicitud del titular de la oportunidad vigente.
			if (!vigente(c) || c.opportunityId !== sol.opportunityId) continue;
			filas.push({
				numeroSifco: sifco,
				rol: "titular",
				personaNombre: c.titularNombre,
				personaTelefono: sol.telMovil,
				titularNombre: c.titularNombre,
				vehiculo: c.vehiculo,
			});
		}
	}
	return filas;
}

/** Créditos relacionados al caso, sin datos de cartera. */
export async function buscarCreditosRelacionadosBase(
	ctx: ContextoCaso,
): Promise<CreditoRelacionadoBase[]> {
	const semillas = await cargarSemillas(ctx);
	const filas = await buscarFilas(semillas);
	return consolidarCreditosRelacionados({
		filas,
		semillas,
		sifcoActual: ctx.numeroCreditoSifco,
	});
}

async function estadosPorSifco(
	sifcos: string[],
): Promise<Map<string, EstadoCarteraRelacionado>> {
	const estados = new Map<string, EstadoCarteraRelacionado>();
	if (sifcos.length === 0 || !isCarteraBackEnabled()) return estados;
	const respuesta = await carteraBackClient.getBucketPorSifco({ sifcos });
	for (const f of respuesta.data ?? []) {
		estados.set(f.numero_credito_sifco, {
			bucket: f.bucket,
			prefijo: f.prefijo,
			nombre: f.nombre,
			fueraFunnel: f.fuera_funnel,
		});
	}
	return estados;
}

/** Log y valor por defecto: un dato de cartera que falla no tumba la card. */
function tolerar<T>(nombre: string, promesa: Promise<T>, porDefecto: T) {
	return promesa.catch((error) => {
		console.error(`[creditosRelacionados] ${nombre}:`, error);
		return porDefecto;
	});
}

export async function buscarCreditosRelacionados(params: {
	ctx: ContextoCaso;
	userId: string;
	userRole: string;
}): Promise<CreditoRelacionado[]> {
	const base = (await buscarCreditosRelacionadosBase(params.ctx)).slice(
		0,
		LIMITE_CANDIDATOS_ACCESO,
	);
	if (base.length === 0) return [];
	const sifcos = base.map((c) => c.numeroSifco);

	const [duenos, estados] = await Promise.all([
		tolerar(
			"dueños en cartera",
			duenosEnCarteraPorSifco(sifcos),
			new Map<string, { asesorId: number; nombre: string }>(),
		),
		tolerar(
			"buckets",
			estadosPorSifco(sifcos),
			new Map<string, EstadoCarteraRelacionado>(),
		),
	]);
	// Falla cerrado: si cartera no confirma el dueño, se ve en el modal.
	const permitidos = await tolerar(
		"acceso",
		sifcosQueTrabaja({
			userId: params.userId,
			userRole: params.userRole,
			sifcos,
			duenos,
		}),
		new Set<string>() as Set<string> | null,
	);

	return filtrarPorAccesoYTopar(
		base.map((c) => ({
			...c,
			puedeAbrir: permitidos === null || permitidos.has(c.numeroSifco),
			asesorNombre: duenos.get(c.numeroSifco)?.nombre ?? null,
			estado: estados.get(c.numeroSifco) ?? null,
		})),
	);
}

export type ResumenCreditoRelacionado = {
	numeroSifco: string;
	titularNombre: string;
	vehiculo: CreditoRelacionadoBase["vehiculo"];
	personas: CreditoRelacionadoBase["personas"];
	motivos: CreditoRelacionadoBase["motivos"];
	soloPorNombre: boolean;
	asesorNombre: string | null;
	estado: EstadoCarteraRelacionado | null;
	/** null si cartera no tiene el crédito o no respondió. */
	cartera: {
		statusCredito: string;
		cuotaMensual: string;
		capitalActivo: string;
		cuotasAtrasadas: number;
		cuotasPagadas: number;
		plazo: number;
		proximaFechaPago: string | null;
		cuotaActual: {
			numero: number;
			de: number;
			fechaVencimiento: string;
			vencida: boolean;
		} | null;
		moraMonto: string | null;
		moraPorConfirmar: boolean;
		enConvenio: boolean;
	} | null;
};

/**
 * Resumen para el modal. Solo de un SIFCO que de verdad esté relacionado con
 * el caso: si no, NOT_FOUND (no sirve para consultar créditos ajenos al azar).
 */
export async function resumenCreditoRelacionado(params: {
	ctx: ContextoCaso;
	numeroSifco: string;
}): Promise<ResumenCreditoRelacionado | null> {
	const sifco = params.numeroSifco.trim();
	const base = (await buscarCreditosRelacionadosBase(params.ctx)).find(
		(c) => c.numeroSifco === sifco,
	);
	// El resumen exige un vínculo por teléfono: un nombre igual puede ser un
	// homónimo y no autoriza a ver el crédito de otra persona.
	if (!base || base.soloPorNombre) return null;

	const [duenos, estados, resumen] = await Promise.all([
		tolerar(
			"dueño en cartera",
			duenosEnCarteraPorSifco([sifco]),
			new Map<string, { asesorId: number; nombre: string }>(),
		),
		tolerar(
			"bucket",
			estadosPorSifco([sifco]),
			new Map<string, EstadoCarteraRelacionado>(),
		),
		isCarteraBackEnabled()
			? tolerar("resumen", carteraBackClient.getResumenCredito(sifco), null)
			: Promise.resolve(null),
	]);

	return {
		numeroSifco: base.numeroSifco,
		titularNombre: base.titularNombre,
		vehiculo: base.vehiculo,
		personas: base.personas,
		motivos: base.motivos,
		soloPorNombre: base.soloPorNombre,
		asesorNombre: duenos.get(sifco)?.nombre ?? resumen?.asesor?.nombre ?? null,
		estado: estados.get(sifco) ?? null,
		cartera: resumen
			? {
					statusCredito: resumen.status_credito,
					cuotaMensual: resumen.cuota_mensual,
					capitalActivo: resumen.capital_activo,
					cuotasAtrasadas: resumen.cuotas_atrasadas,
					cuotasPagadas: resumen.cuotas_pagadas,
					plazo: resumen.plazo,
					proximaFechaPago: resumen.proxima_fecha_pago,
					cuotaActual: resumen.cuota_actual
						? {
								numero: resumen.cuota_actual.numero,
								de: resumen.cuota_actual.de,
								fechaVencimiento: resumen.cuota_actual.fecha_vencimiento,
								vencida: resumen.cuota_actual.vencida,
							}
						: null,
					moraMonto: resumen.mora?.monto ?? null,
					moraPorConfirmar: resumen.mora_por_confirmar,
					enConvenio: resumen.convenio !== null,
				}
			: null,
	};
}
