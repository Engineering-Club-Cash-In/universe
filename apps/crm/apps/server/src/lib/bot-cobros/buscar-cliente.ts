/**
 * Búsqueda del cliente por DPI, NIT o placa para el bot de cobros.
 *
 * Reglas y decisiones en
 * docs/features/bot-whatsapp-cobros/01-identificacion-y-acceso.md
 *
 * Dónde vive cada identificador:
 *   DPI   → leads.dpi y co_debtors.dpi        (D-20)
 *   NIT   → leads.nit y opportunities.nit
 *   placa → vehicles.license_plate
 *
 * Solo se encuentra a alguien que tenga al menos una oportunidad `won` o
 * `migrate` (D-17, D-21): este bot es para clientes con crédito, y así no se le
 * manda un SMS —ni se le revela el nombre— a un lead de ventas.
 */

import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { coDebtors, leads, opportunities } from "../../db/schema/crm";
import { vehicles } from "../../db/schema/vehicles";
import { normalizarDpi } from "../../utils/cui-validation";
import { eqDpi } from "../dpi-lookup";
import type { TipoBusqueda } from "./identificadores";
import { detectarTipoBusqueda } from "./identificadores";
import type { Ejecutor } from "./otp";

/** Estados de oportunidad que representan un crédito real (D-17). */
const ESTADOS_CON_CREDITO = ["won", "migrate"] as const;

export type ClienteBot = {
	tipo: "titular" | "codeudor";
	/** Lead del titular. En un match por codeudor es el titular del crédito. */
	leadId: string;
	/** Solo cuando el `search` resultó ser el DPI de un codeudor. */
	coDebtorId: string | null;
	nombreCompleto: string;
	/** Campo crudo del CRM: puede traer varios números separados por `,` o `/`. */
	telefonos: string | null;
	/** DPI de quien se identificó (titular o codeudor), como se guardó. */
	dpi: string | null;
};

export type ResultadoBusqueda =
	| { estado: "encontrado"; cliente: ClienteBot; tipoBusqueda: TipoBusqueda }
	| { estado: "no_encontrado"; tipoBusqueda: TipoBusqueda | null }
	| { estado: "dato_invalido"; motivo: string }
	/** La placa parcial calzó con varios vehículos: hay que pedir la completa. */
	| { estado: "ambiguo"; tipoBusqueda: TipoBusqueda };

/** Arma el nombre completo del lead con las partes que tenga cargadas. */
function nombreDeLead(lead: {
	firstName: string;
	middleName: string | null;
	lastName: string;
	secondLastName: string | null;
}): string {
	return [lead.firstName, lead.middleName, lead.lastName, lead.secondLastName]
		.filter((parte) => parte && parte.trim() !== "")
		.join(" ")
		.trim();
}

/** Normaliza una columna de texto en SQL igual que `normalizarPlaca`. */
function placaNormalizada(columna: unknown) {
	return sql`regexp_replace(upper(${columna}), '[^A-Z0-9]', '', 'g')`;
}

/** Normaliza un NIT en SQL: sin guiones ni espacios, en mayúsculas. */
function nitNormalizado(columna: unknown) {
	return sql`regexp_replace(upper(${columna}), '[^A-Z0-9]', '', 'g')`;
}

/** Trae el lead titular junto con la validación de que tenga crédito. */
async function traerTitularConCredito(
	leadId: string,
): Promise<ClienteBot | null> {
	const [fila] = await db
		.select({
			id: leads.id,
			firstName: leads.firstName,
			middleName: leads.middleName,
			lastName: leads.lastName,
			secondLastName: leads.secondLastName,
			phone: leads.phone,
			dpi: leads.dpi,
		})
		.from(leads)
		.innerJoin(opportunities, eq(opportunities.leadId, leads.id))
		.where(
			and(
				eq(leads.id, leadId),
				inArray(opportunities.status, [...ESTADOS_CON_CREDITO]),
			),
		)
		.limit(1);

	if (!fila) return null;

	return {
		tipo: "titular",
		leadId: fila.id,
		coDebtorId: null,
		nombreCompleto: nombreDeLead(fila),
		telefonos: fila.phone,
		dpi: fila.dpi,
	};
}

/**
 * Avisa que un identificador apunta a más de un registro.
 *
 * Elegir uno "el que sea" haría que el código se mande a un teléfono viejo y
 * que el nombre cambie entre consultas, así que la elección es determinista y
 * el duplicado queda registrado para que alguien lo limpie. Se registran los
 * ids, no el identificador: es lo que hace falta para corregirlo y no mete PII
 * en los logs (D-14).
 */
function alertarDuplicado(tipo: string, ids: string[]) {
	console.warn(
		"[BotCobros] IDENTIFICADOR DUPLICADO",
		JSON.stringify({
			tipo,
			usado: ids[0],
			otros: ids.slice(1),
			nota: "Se eligió el del crédito más reciente. Revisar y unificar.",
		}),
	);
}

/**
 * DPI: primero el titular, y si no aparece, los codeudores.
 *
 * Hay personas que son titular de un crédito y codeudor de otro; en ese caso
 * gana el titular, que es el dueño de la relación principal.
 *
 * Cuando varios registros comparten el mismo DPI —pasa, hay precedente de
 * duplicados por formato— se toma el del **crédito más reciente**, con el id
 * como desempate para que la respuesta no cambie entre consultas.
 */
async function buscarPorDpi(dpi: string): Promise<ClienteBot | null> {
	const titulares = await db
		.select({
			id: leads.id,
			ultimo: sql<Date>`max(${opportunities.createdAt})`,
		})
		.from(leads)
		.innerJoin(opportunities, eq(opportunities.leadId, leads.id))
		.where(
			and(
				eqDpi(leads.dpi, dpi),
				inArray(opportunities.status, [...ESTADOS_CON_CREDITO]),
			),
		)
		.groupBy(leads.id)
		.orderBy(sql`max(${opportunities.createdAt}) DESC`, asc(leads.id))
		.limit(2);

	if (titulares.length > 0) {
		if (titulares.length > 1) {
			alertarDuplicado(
				"dpi_en_varios_leads",
				titulares.map((t) => t.id),
			);
		}
		return traerTitularConCredito(titulares[0].id);
	}

	const codeudores = await db
		.select({
			id: coDebtors.id,
			fullName: coDebtors.fullName,
			phone: coDebtors.phone,
			dpi: coDebtors.dpi,
			leadId: opportunities.leadId,
		})
		.from(coDebtors)
		.innerJoin(opportunities, eq(opportunities.id, coDebtors.opportunityId))
		.where(
			and(
				eqDpi(coDebtors.dpi, dpi),
				inArray(opportunities.status, [...ESTADOS_CON_CREDITO]),
			),
		)
		.orderBy(desc(opportunities.createdAt), asc(coDebtors.id))
		.limit(2);

	const codeudor = codeudores[0];
	if (!codeudor?.leadId) return null;

	// Ser codeudor de varios créditos es normal; solo se avisa si además cambia
	// el teléfono, porque ahí sí importa a cuál se le manda el código.
	const telefonos = new Set(codeudores.map((c) => c.phone ?? ""));
	if (telefonos.size > 1) {
		alertarDuplicado(
			"codeudor_con_telefonos_distintos",
			codeudores.map((c) => c.id),
		);
	}

	return {
		tipo: "codeudor",
		leadId: codeudor.leadId,
		coDebtorId: codeudor.id,
		nombreCompleto: codeudor.fullName,
		telefonos: codeudor.phone,
		dpi: codeudor.dpi,
	};
}

/**
 * NIT: está tanto en el lead como en la oportunidad, y en la mayoría de los
 * clientes viejos solo en la oportunidad (332 de 1,760 no lo tienen en el lead).
 */
async function buscarPorNit(nit: string): Promise<ClienteBot | null> {
	const porLead = await db
		.select({ id: leads.id })
		.from(leads)
		.innerJoin(opportunities, eq(opportunities.leadId, leads.id))
		.where(
			and(
				sql`${nitNormalizado(leads.nit)} = ${nit}`,
				inArray(opportunities.status, [...ESTADOS_CON_CREDITO]),
			),
		)
		.groupBy(leads.id)
		.orderBy(sql`max(${opportunities.createdAt}) DESC`, asc(leads.id))
		.limit(2);

	if (porLead.length > 0) {
		if (porLead.length > 1) {
			alertarDuplicado(
				"nit_en_varios_leads",
				porLead.map((l) => l.id),
			);
		}
		return traerTitularConCredito(porLead[0].id);
	}

	const porOportunidad = await db
		.select({ leadId: opportunities.leadId })
		.from(opportunities)
		.where(
			and(
				sql`${nitNormalizado(opportunities.nit)} = ${nit}`,
				inArray(opportunities.status, [...ESTADOS_CON_CREDITO]),
			),
		)
		.groupBy(opportunities.leadId)
		.orderBy(
			sql`max(${opportunities.createdAt}) DESC`,
			asc(opportunities.leadId),
		)
		.limit(2);

	const leadId = porOportunidad[0]?.leadId;
	if (!leadId) return null;

	if (porOportunidad.length > 1) {
		alertarDuplicado(
			"nit_en_varios_clientes",
			porOportunidad.map((o) => o.leadId ?? "(sin lead)"),
		);
	}

	return traerTitularConCredito(leadId);
}

/**
 * Placa: se compara normalizando los dos lados. Si el cliente escribió la placa
 * sin la letra de tipo (`185KKW` en vez de `P-185KKW`) se acepta el match por
 * sufijo, salvo que calce con más de un vehículo.
 */
async function buscarPorPlaca(
	placa: string,
): Promise<ClienteBot | null | "ambiguo"> {
	const exactos = await db
		.selectDistinct({ leadId: opportunities.leadId })
		.from(vehicles)
		.innerJoin(opportunities, eq(opportunities.vehicleId, vehicles.id))
		.where(
			and(
				sql`${placaNormalizada(vehicles.licensePlate)} = ${placa}`,
				inArray(opportunities.status, [...ESTADOS_CON_CREDITO]),
			),
		)
		.limit(2);

	const candidatos =
		exactos.length > 0 ? exactos : await buscarPorPlacaParcial(placa);

	if (candidatos.length === 0) return null;
	if (candidatos.length > 1) return "ambiguo";

	const leadId = candidatos[0].leadId;
	if (!leadId) return null;

	return traerTitularConCredito(leadId);
}

/**
 * Búsqueda tolerante a que falte la letra de tipo, en cualquiera de los dos
 * lados:
 *
 * - El cliente escribe `185KKW` y la placa guardada es `P-185KKW`
 *   → la guardada **termina en** lo que mandó.
 * - El cliente escribe `P-185KKW` y la placa quedó guardada como `185KKW`
 *   → hay 19 vehículos así en la base.
 */
async function buscarPorPlacaParcial(placa: string) {
	const condicion = /^[A-Z]/.test(placa)
		? sql`${placaNormalizada(vehicles.licensePlate)} = ${placa.slice(1)}`
		: sql`${placaNormalizada(vehicles.licensePlate)} LIKE ${`%${placa}`}`;

	return db
		.selectDistinct({ leadId: opportunities.leadId })
		.from(vehicles)
		.innerJoin(opportunities, eq(opportunities.vehicleId, vehicles.id))
		.where(
			and(condicion, inArray(opportunities.status, [...ESTADOS_CON_CREDITO])),
		)
		.limit(2);
}

export type CreditoBot = {
	numeroSifco: string;
	/** Lo que el bot muestra en el menú de selección. */
	etiqueta: string;
	vehiculo: {
		placa: string | null;
		marca: string;
		modelo: string;
		anio: number;
	} | null;
};

/**
 * Créditos de quien ya validó su código (servicio 2).
 *
 * Se resuelve con la identidad que quedó guardada al emitir el OTP, sin volver
 * a buscar por `search`.
 *
 * Un cliente ve **todos** los créditos donde aparece: los suyos como titular y
 * aquellos en los que es codeudor. No se consulta cartera, así que los ya
 * liquidados también salen (D-17): en el CRM la oportunidad sigue ganada.
 */
export async function listarCreditosDeCliente(
	identidad: {
		leadId: string | null;
		dpi: string | null;
	},
	ejecutor: Ejecutor = db,
): Promise<CreditoBot[]> {
	const condiciones = [];

	if (identidad.leadId) {
		condiciones.push(eq(opportunities.leadId, identidad.leadId));
	}

	if (identidad.dpi) {
		const dpi = normalizarDpi(identidad.dpi);

		// Como titular, aunque el lead sea otro registro con el mismo DPI.
		condiciones.push(eqDpi(leads.dpi, dpi));

		// Como codeudor de cualquier crédito.
		condiciones.push(
			sql`EXISTS (
				SELECT 1 FROM ${coDebtors} cd
				WHERE cd.opportunity_id = ${opportunities.id}
				  AND regexp_replace(cd.dpi, '\\s', '', 'g') = ${dpi}
			)`,
		);
	}

	if (condiciones.length === 0) return [];

	const filas = await ejecutor
		.selectDistinct({
			numeroSifco: opportunities.numeroSifco,
			placa: vehicles.licensePlate,
			marca: vehicles.make,
			modelo: vehicles.model,
			anio: vehicles.year,
			firstName: leads.firstName,
			middleName: leads.middleName,
			lastName: leads.lastName,
			secondLastName: leads.secondLastName,
		})
		.from(opportunities)
		.leftJoin(vehicles, eq(vehicles.id, opportunities.vehicleId))
		.leftJoin(leads, eq(leads.id, opportunities.leadId))
		.where(
			and(
				inArray(opportunities.status, [...ESTADOS_CON_CREDITO]),
				or(...condiciones),
			),
		);

	const creditos: CreditoBot[] = [];

	for (const fila of filas) {
		// Una oportunidad ganada siempre tiene número SIFCO; si aparece una sin
		// él es un dato roto, no un crédito que el cliente pueda gestionar.
		if (!fila.numeroSifco) continue;

		const tieneVehiculo = Boolean(fila.marca && fila.modelo);

		// Sin info del vehículo se usa el nombre del titular como etiqueta.
		const etiqueta = tieneVehiculo
			? [`${fila.marca} ${fila.modelo} ${fila.anio}`, fila.placa]
					.filter(Boolean)
					.join(" · ")
			: nombreDeLead({
					firstName: fila.firstName ?? "",
					middleName: fila.middleName,
					lastName: fila.lastName ?? "",
					secondLastName: fila.secondLastName,
				}) || `Crédito ${fila.numeroSifco}`;

		creditos.push({
			numeroSifco: fila.numeroSifco,
			etiqueta,
			vehiculo: tieneVehiculo
				? {
						placa: fila.placa,
						marca: fila.marca as string,
						modelo: fila.modelo as string,
						anio: fila.anio as number,
					}
				: null,
		});
	}

	return creditos;
}

/** Punto de entrada: deduce qué mandó el cliente y lo busca donde corresponde. */
export async function buscarCliente(
	search: string,
): Promise<ResultadoBusqueda> {
	const deteccion = detectarTipoBusqueda(search);

	if (deteccion.tipo === null) {
		return { estado: "dato_invalido", motivo: deteccion.motivo };
	}

	const { tipo, valor } = deteccion;

	if (tipo === "placa") {
		const resultado = await buscarPorPlaca(valor);

		if (resultado === "ambiguo") {
			return { estado: "ambiguo", tipoBusqueda: tipo };
		}
		if (!resultado) {
			return { estado: "no_encontrado", tipoBusqueda: tipo };
		}
		return { estado: "encontrado", cliente: resultado, tipoBusqueda: tipo };
	}

	const cliente =
		tipo === "dpi" ? await buscarPorDpi(valor) : await buscarPorNit(valor);

	if (!cliente) {
		return { estado: "no_encontrado", tipoBusqueda: tipo };
	}

	return { estado: "encontrado", cliente, tipoBusqueda: tipo };
}
