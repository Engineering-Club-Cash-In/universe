/**
 * F8 (#1864) · Direcciones del cliente corregidas desde la Ficha 360.
 *
 * La residencia de origen es la del lead (`leads.direccion`) y el trabajo el
 * de la solicitud de crédito firmada (`getDatosLaboralesCaso`). Ninguna se
 * pisa: lo corregido por cobros va en columnas propias de `casos_cobros`
 * (migración 0078) y las lecturas lo prefieren cuando existe.
 *
 * Plan: docs/features/cobros-02/21-plan-backend-ficha-360.md
 */

import { ORPCError } from "@orpc/server";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { creditApplications } from "../db/schema/client-forms";
import { casosCobros } from "../db/schema/cobros";
import { leads } from "../db/schema/crm";
import {
	type OrigenCambio,
	registrarCambiosCaso,
	type ValoresCampos,
} from "./cambios-datos-cliente";

/**
 * Residencia del caso para los SELECT que leen `direccion_contacto`: la
 * corregida desde la ficha, si existe.
 */
export const direccionResidenciaCasoSql = sql<string>`COALESCE(NULLIF(TRIM(${casosCobros.direccionResidenciaCobros}), ''), ${casosCobros.direccionContacto})`;

/**
 * Trabajo efectivo: lo corregido desde cobros gana campo por campo sobre la
 * solicitud de crédito. Pura.
 */
export interface DatosLaborales {
	empresa: string | null;
	puesto: string | null;
	direccion: string | null;
	telefono: string | null;
	horario: string | null;
}

export function trabajoEfectivo(
	solicitud: DatosLaborales | null,
	corregido: { empresa: string | null; direccion: string | null },
): DatosLaborales | null {
	const empresa = corregido.empresa?.trim() || null;
	const direccion = corregido.direccion?.trim() || null;
	const base: DatosLaborales = solicitud ?? {
		empresa: null,
		puesto: null,
		direccion: null,
		telefono: null,
		horario: null,
	};
	const datos = {
		...base,
		empresa: empresa ?? base.empresa,
		direccion: direccion ?? base.direccion,
	};
	return Object.values(datos).some(Boolean) ? datos : null;
}

export interface CambioDirecciones {
	/** `undefined` = no se toca; `null`/"" = volver a la de origen. */
	residencia?: string | null;
	trabajo?: { empresa?: string | null; direccion?: string | null };
}

/**
 * Guarda las direcciones corregidas y deja cada cambio en la bitácora (F3),
 * en una sola transacción. El "antes" de la bitácora es lo que la ficha
 * mostraba: la corregida si había, si no la de origen que se pasa.
 */
export async function guardarDireccionesCaso(params: {
	casoCobroId: string;
	cambio: CambioDirecciones;
	/** Lo que la ficha mostraba de origen (lead y solicitud), para el "antes". */
	origenActual: {
		residencia: string | null;
		empresaTrabajo: string | null;
		direccionTrabajo: string | null;
	};
	origen: OrigenCambio;
	userId: string;
}) {
	const { cambio } = params;
	const limpio = (v: string | null | undefined) => v?.trim() || null;
	return db.transaction(async (tx) => {
		const [actual] = await tx
			.select({
				residencia: casosCobros.direccionResidenciaCobros,
				empresaTrabajo: casosCobros.empresaTrabajoCobros,
				direccionTrabajo: casosCobros.direccionTrabajoCobros,
			})
			.from(casosCobros)
			.where(eq(casosCobros.id, params.casoCobroId))
			.for("update");
		if (!actual) {
			throw new ORPCError("NOT_FOUND", {
				message: "Caso de cobro no encontrado.",
			});
		}

		const set: Partial<typeof casosCobros.$inferInsert> = {};
		const antes: ValoresCampos = {};
		const despues: ValoresCampos = {};
		const efectivo = (corregido: string | null, deOrigen: string | null) =>
			limpio(corregido) ?? limpio(deOrigen);

		if (cambio.residencia !== undefined) {
			set.direccionResidenciaCobros = limpio(cambio.residencia);
			antes.direccion_residencia = efectivo(
				actual.residencia,
				params.origenActual.residencia,
			);
			despues.direccion_residencia = efectivo(
				set.direccionResidenciaCobros,
				params.origenActual.residencia,
			);
		}
		if (cambio.trabajo?.empresa !== undefined) {
			set.empresaTrabajoCobros = limpio(cambio.trabajo.empresa);
			antes.empresa_trabajo = efectivo(
				actual.empresaTrabajo,
				params.origenActual.empresaTrabajo,
			);
			despues.empresa_trabajo = efectivo(
				set.empresaTrabajoCobros,
				params.origenActual.empresaTrabajo,
			);
		}
		if (cambio.trabajo?.direccion !== undefined) {
			set.direccionTrabajoCobros = limpio(cambio.trabajo.direccion);
			antes.direccion_trabajo = efectivo(
				actual.direccionTrabajo,
				params.origenActual.direccionTrabajo,
			);
			despues.direccion_trabajo = efectivo(
				set.direccionTrabajoCobros,
				params.origenActual.direccionTrabajo,
			);
		}
		if (Object.keys(set).length === 0) {
			throw new ORPCError("BAD_REQUEST", {
				message: "Indique al menos una dirección para guardar.",
			});
		}

		const [guardado] = await tx
			.update(casosCobros)
			.set({ ...set, updatedAt: new Date() })
			.where(eq(casosCobros.id, params.casoCobroId))
			.returning({
				residencia: casosCobros.direccionResidenciaCobros,
				empresaTrabajo: casosCobros.empresaTrabajoCobros,
				direccionTrabajo: casosCobros.direccionTrabajoCobros,
			});
		const cambios = await registrarCambiosCaso(tx, {
			casoCobroId: params.casoCobroId,
			antes,
			despues,
			origen: params.origen,
			userId: params.userId,
		});
		return { ...guardado, cambiosRegistrados: cambios };
	});
}

/**
 * El trabajo como lo declaró el titular en su Solicitud de Crédito (lo único
 * en el monorepo que guarda la dirección del trabajo). `null` si no hay.
 */
export async function solicitudLaboralTitular(
	opportunityId: string | null,
): Promise<DatosLaborales | null> {
	if (!opportunityId) return null;
	const [solicitud] = await db
		.select({
			empresa: creditApplications.empresa,
			puesto: creditApplications.puesto,
			direccion: creditApplications.direccionTrabajo,
			telefono: creditApplications.telTrabajo,
			horario: creditApplications.horarios,
		})
		.from(creditApplications)
		.where(
			and(
				eq(creditApplications.opportunityId, opportunityId),
				// La del titular. NULL = solicitud anterior a la 0015, cuando
				// había una sola por oportunidad (mismo criterio que CB-036).
				or(
					eq(creditApplications.personType, "lead"),
					isNull(creditApplications.personType),
				),
			),
		)
		.orderBy(desc(creditApplications.updatedAt))
		.limit(1);
	if (!solicitud) return null;
	const limpio = (v: string | null) => v?.trim() || null;
	const datos: DatosLaborales = {
		empresa: limpio(solicitud.empresa),
		puesto: limpio(solicitud.puesto),
		direccion: limpio(solicitud.direccion),
		telefono: limpio(solicitud.telefono),
		horario: limpio(solicitud.horario),
	};
	return Object.values(datos).some(Boolean) ? datos : null;
}

/** Residencia de origen del caso: la del lead (lo que la ficha mostraba). */
export async function residenciaDeOrigen(
	leadId: string | null,
): Promise<string | null> {
	if (!leadId) return null;
	const [lead] = await db
		.select({ direccion: leads.direccion })
		.from(leads)
		.where(eq(leads.id, leadId))
		.limit(1);
	return lead?.direccion?.trim() || null;
}
