/**
 * CB-036 · De dónde salen las referencias de un caso: el puente caso → lead y
 * oportunidad, y la carga de las seis fuentes que arman la lista unificada
 * (`lib/referencias-cobros.ts`).
 *
 * Vive en un servicio y no en `routers/referencias-cobros.ts` porque también lo
 * lee el checklist de la solicitud de recuperación (CB-043), que se arma desde
 * routers/cobros.ts: importarlo del router cerraba un ciclo cobros → referencias
 * → cobros. La autorización NO va acá: cada llamador exige el acceso al caso
 * antes de pedir estos datos.
 */

import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { creditApplications } from "../db/schema/client-forms";
import { casosCobros, contratosFinanciamiento } from "../db/schema/cobros";
import {
	clients,
	coDebtors,
	opportunities,
	referenciasLead,
} from "../db/schema/crm";
import {
	contactosReferenciasCobros,
	referenciasTelefonosCobros,
} from "../db/schema/referencias-cobros";
import { construirReferencias } from "../lib/referencias-cobros";

/** Tope de la bitácora que se pinta en la ficha (una ficha, un caso). */
export const LIMITE_BITACORA = 200;

export type ContextoCaso = {
	casoCobroId: string;
	telefonoPrincipal: string;
	telefonoAlternativo: string | null;
	leadId: string | null;
	opportunityId: string | null;
};

/**
 * Caso → SIFCO → oportunidad → lead, el puente de siempre
 * (`numero_credito_sifco = opportunities.numero_sifco`). Se prefiere la
 * oportunidad won/migrate más reciente, como `getActividadBot`; si no hay
 * ninguna se cae a cualquiera con ese SIFCO, que es lo que hacía la ficha al
 * buscar la oportunidad por texto — así ningún crédito pierde las referencias
 * que ya mostraba.
 */
export async function resolverContextoCaso(
	casoCobroId: string,
): Promise<ContextoCaso> {
	const [caso] = await db
		.select({
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			contratoId: casosCobros.contratoId,
			telefonoPrincipal: casosCobros.telefonoPrincipal,
			telefonoAlternativo: casosCobros.telefonoAlternativo,
		})
		.from(casosCobros)
		.where(eq(casosCobros.id, casoCobroId))
		.limit(1);
	if (!caso) {
		throw new ORPCError("NOT_FOUND", {
			message: "Caso de cobro no encontrado.",
		});
	}

	const base = {
		casoCobroId,
		telefonoPrincipal: caso.telefonoPrincipal,
		telefonoAlternativo: caso.telefonoAlternativo,
	};

	// Con contrato vinculado, el cliente del contrato manda: SIFCO puede
	// repetirse en oportunidades duplicadas u obsoletas y la heurística de
	// abajo elegiría la de otro lead. Sin contrato (o sin oportunidad en su
	// cliente) se cae a la heurística por SIFCO.
	if (caso.contratoId) {
		const [delContrato] = await db
			.select({
				opportunityId: clients.opportunityId,
				clientLeadId: clients.leadId,
				oppLeadId: opportunities.leadId,
			})
			.from(contratosFinanciamiento)
			.innerJoin(clients, eq(clients.id, contratosFinanciamiento.clientId))
			.leftJoin(opportunities, eq(opportunities.id, clients.opportunityId))
			.where(eq(contratosFinanciamiento.id, caso.contratoId))
			.limit(1);
		if (delContrato?.opportunityId) {
			return {
				...base,
				leadId: delContrato.oppLeadId ?? delContrato.clientLeadId ?? null,
				opportunityId: delContrato.opportunityId,
			};
		}
	}

	if (!caso.numeroCreditoSifco) {
		return { ...base, leadId: null, opportunityId: null };
	}

	const [opp] = await db
		.select({ id: opportunities.id, leadId: opportunities.leadId })
		.from(opportunities)
		.where(eq(opportunities.numeroSifco, caso.numeroCreditoSifco))
		.orderBy(
			sql`CASE WHEN ${opportunities.status} IN ('won', 'migrate') THEN 0 ELSE 1 END`,
			desc(opportunities.createdAt),
		)
		.limit(1);

	return {
		...base,
		leadId: opp?.leadId ?? null,
		opportunityId: opp?.id ?? null,
	};
}

/** Carga las seis fuentes y arma la lista unificada. */
export async function cargarReferencias(ctx: ContextoCaso) {
	const [
		filasReferenciasLead,
		solicitudesTitular,
		codeudores,
		telefonosAgregados,
		contactos,
	] = await Promise.all([
		ctx.leadId
			? db
					.select({
						id: referenciasLead.id,
						nombre: referenciasLead.nombre,
						telefono: referenciasLead.telefono,
						parentesco: referenciasLead.parentesco,
						notas: referenciasLead.notas,
					})
					.from(referenciasLead)
					.where(eq(referenciasLead.leadId, ctx.leadId))
					.orderBy(desc(referenciasLead.createdAt))
			: Promise.resolve([]),
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
							// Solo la solicitud del titular. NULL = solicitud anterior a
							// la migración 0015, cuando había una sola por oportunidad.
							or(
								eq(creditApplications.personType, "lead"),
								isNull(creditApplications.personType),
							),
						),
					)
					.orderBy(asc(creditApplications.createdAt))
			: Promise.resolve([]),
		ctx.opportunityId
			? db
					.select({
						id: coDebtors.id,
						fullName: coDebtors.fullName,
						phone: coDebtors.phone,
					})
					.from(coDebtors)
					.where(eq(coDebtors.opportunityId, ctx.opportunityId))
					.orderBy(asc(coDebtors.createdAt))
			: Promise.resolve([]),
		ctx.leadId
			? db
					.select({
						id: referenciasTelefonosCobros.id,
						referenciaKey: referenciasTelefonosCobros.referenciaKey,
						telefono: referenciasTelefonosCobros.telefono,
						notas: referenciasTelefonosCobros.notas,
						registradoPor: user.name,
						createdAt: referenciasTelefonosCobros.createdAt,
					})
					.from(referenciasTelefonosCobros)
					.leftJoin(user, eq(referenciasTelefonosCobros.registradoPor, user.id))
					.where(eq(referenciasTelefonosCobros.leadId, ctx.leadId))
					.orderBy(asc(referenciasTelefonosCobros.createdAt))
			: Promise.resolve([]),
		db
			.select({
				id: contactosReferenciasCobros.id,
				referenciaKey: contactosReferenciasCobros.referenciaKey,
				referenciaOrigen: contactosReferenciasCobros.referenciaOrigen,
				referenciaNombre: contactosReferenciasCobros.referenciaNombre,
				telefono: contactosReferenciasCobros.telefono,
				metodoContacto: contactosReferenciasCobros.metodoContacto,
				resultado: contactosReferenciasCobros.resultado,
				comentarios: contactosReferenciasCobros.comentarios,
				fechaContacto: contactosReferenciasCobros.fechaContacto,
				realizadoPor: user.name,
			})
			.from(contactosReferenciasCobros)
			.leftJoin(user, eq(contactosReferenciasCobros.realizadoPor, user.id))
			.where(eq(contactosReferenciasCobros.casoCobroId, ctx.casoCobroId))
			.orderBy(desc(contactosReferenciasCobros.fechaContacto))
			.limit(LIMITE_BITACORA),
	]);

	const referencias = construirReferencias({
		referenciasLead: filasReferenciasLead,
		solicitudesTitular,
		codeudores,
		telefonosAgregados,
		contactos,
	});

	return { referencias, contactos };
}
