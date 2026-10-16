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
import { coDebtors, leads, opportunities } from "../db/schema/crm";
import { vehicles } from "../db/schema/vehicles";
import {
	duenosEnCarteraPorSifco,
	sifcosQueTrabaja,
} from "../lib/acceso-caso-cobro";
import { ESTADOS_CON_CREDITO } from "../lib/bot-cobros/buscar-cliente";
import {
	armarSemillas,
	type CreditoRelacionadoBase,
	consolidarCreditosRelacionados,
	type FilaPersonaEnCredito,
	limpiarNombre,
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
			telefonos: [lead?.phone ?? null],
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

async function buscarFilas(
	semillas: Semillas,
): Promise<FilaPersonaEnCredito[]> {
	const telefonos = semillas.telefonos.map((s) => s.telefono);
	const nombres = semillas.nombres.map((s) => s.nombre);
	if (telefonos.length === 0 && nombres.length === 0) return [];

	const base = and(
		inArray(opportunities.status, [...ESTADOS_CON_CREDITO]),
		isNotNull(opportunities.numeroSifco),
	);
	const columnasCredito = {
		numeroSifco: opportunities.numeroSifco,
		titularNombre: nombreLeadSql,
		marca: vehicles.make,
		modelo: vehicles.model,
		anio: vehicles.year,
		placa: vehicles.licensePlate,
	};

	const [titulares, codeudores] = await Promise.all([
		db
			.selectDistinct({ ...columnasCredito, personaTelefono: leads.phone })
			.from(opportunities)
			.innerJoin(leads, eq(leads.id, opportunities.leadId))
			.leftJoin(vehicles, eq(vehicles.id, opportunities.vehicleId))
			.where(
				and(
					base,
					or(
						filtroTelefonos(leads.phone, telefonos),
						filtroNombres(nombreLeadSql, nombres),
					),
				),
			)
			.limit(200),
		db
			.selectDistinct({
				...columnasCredito,
				personaNombre: coDebtors.fullName,
				personaTelefono: coDebtors.phone,
			})
			.from(coDebtors)
			.innerJoin(opportunities, eq(opportunities.id, coDebtors.opportunityId))
			.leftJoin(leads, eq(leads.id, opportunities.leadId))
			.leftJoin(vehicles, eq(vehicles.id, opportunities.vehicleId))
			.where(
				and(
					base,
					or(
						filtroTelefonos(coDebtors.phone, telefonos),
						filtroNombres(sql`${coDebtors.fullName}`, nombres),
					),
				),
			)
			.limit(200),
	]);

	const vehiculo = (f: {
		marca: string | null;
		modelo: string | null;
		anio: number | null;
		placa: string | null;
	}) =>
		f.marca && f.modelo
			? { marca: f.marca, modelo: f.modelo, anio: f.anio, placa: f.placa }
			: null;

	return [
		...titulares.map((f) => ({
			numeroSifco: f.numeroSifco ?? "",
			rol: "titular" as const,
			personaNombre: limpiarNombre(String(f.titularNombre ?? "")),
			personaTelefono: f.personaTelefono,
			titularNombre: limpiarNombre(String(f.titularNombre ?? "")),
			vehiculo: vehiculo(f),
		})),
		...codeudores.map((f) => ({
			numeroSifco: f.numeroSifco ?? "",
			rol: "codeudor" as const,
			personaNombre: limpiarNombre(f.personaNombre),
			personaTelefono: f.personaTelefono,
			titularNombre: limpiarNombre(String(f.titularNombre ?? "")),
			vehiculo: vehiculo(f),
		})),
	];
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
	const base = await buscarCreditosRelacionadosBase(params.ctx);
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

	return base.map((c) => ({
		...c,
		puedeAbrir: permitidos === null || permitidos.has(c.numeroSifco),
		asesorNombre: duenos.get(c.numeroSifco)?.nombre ?? null,
		estado: estados.get(c.numeroSifco) ?? null,
	}));
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
	if (!base) return null;

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
