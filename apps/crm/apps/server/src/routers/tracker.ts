import { ORPCError } from "@orpc/server";
import {
	and,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	like,
	or,
	sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../db";
import {
	companies,
	leads,
	opportunities,
	opportunityStageHistory,
	salesStages,
} from "../db/schema/crm";
import { partnerAccounts } from "../db/schema/partners";
import { quotations } from "../db/schema/quotations";
import { notifications } from "../db/schema/notifications";
import { vehicles } from "../db/schema/vehicles";
import { partnerIdentityProcedure, partnerProcedure } from "../lib/orpc";
import { partnerAuth } from "../lib/partner-auth";
import {
	construirHistorial,
	type EntradaHistorial,
} from "../lib/tracker-historial";
import { type PasoTracker, pasoDesdeCierre } from "../lib/tracker-pasos";

// Los cerrados se acotan para que el payload no crezca sin límite; los activos
// van siempre porque el socio necesita verlos aunque lleven meses parados.
const MESES_HISTORICO = 24;

export type EstadoCaso =
	| "en_proceso"
	| "en_pausa"
	| "rechazado"
	| "desembolsado";

export type { EntradaHistorial };

export type CasoTracker = {
	id: string;
	referencia: string;
	cliente: string;
	agencia: string;
	vehiculo: string | null;
	valorVehiculo: number | null;
	pasoActual: PasoTracker;
	porcentaje: number;
	estado: EstadoCaso;
	cerrado: boolean;
	actualizadoAt: string;
	historial: EntradaHistorial[];
};

// Fecha de cierre efectiva: los perdidos nunca traen actual_close_date.
const fechaCierre = sql<Date>`COALESCE(${opportunities.actualCloseDate}, ${opportunities.updatedAt})`;

// Una oportunidad puede tener varias cotizaciones. El tracker solo expone el
// valor del vehículo de la última cotización actualizada, nunca el valor del
// crédito de la oportunidad.
const ultimaCotizacion = db
	.selectDistinctOn([quotations.opportunityId], {
		opportunityId: quotations.opportunityId,
		vehicleBrand: quotations.vehicleBrand,
		vehicleLine: quotations.vehicleLine,
		vehicleModel: quotations.vehicleModel,
		vehicleValue: quotations.vehicleValue,
	})
	.from(quotations)
	.orderBy(
		quotations.opportunityId,
		desc(quotations.updatedAt),
		desc(quotations.createdAt),
	)
	.as("ultima_cotizacion");

// El CRM persiste esta notificaciÃ³n cuando contabilidad confirma que el
// desembolso fue completado. No usamos `status = won`, porque ese estado se
// asigna antes, al crear el crÃ©dito en cartera-back.
const desembolsosCompletados = db
	.select({
		opportunityId: notifications.relatedEntityId,
		completedAt: sql<Date>`max(${notifications.createdAt})`.as("completed_at"),
	})
	.from(notifications)
	.where(
		and(
			eq(notifications.type, "aviso"),
			eq(notifications.createdByRole, "accounting"),
			eq(notifications.assignedToRole, "sales"),
			eq(notifications.relatedEntityType, "opportunity_client"),
			like(notifications.titulo, "Desembolso completado -%"),
		),
	)
	.groupBy(notifications.relatedEntityId)
	.as("desembolsos_completados");

const filaSelect = {
	id: opportunities.id,
	status: opportunities.status,
	createdAt: opportunities.createdAt,
	updatedAt: opportunities.updatedAt,
	closurePercentage: salesStages.closurePercentage,
	agenciaNombre: companies.name,
	leadFirstName: leads.firstName,
	leadLastName: leads.lastName,
		vehicleMake: vehicles.make,
		vehicleModel: vehicles.model,
		vehicleYear: vehicles.year,
		quotationBrand: ultimaCotizacion.vehicleBrand,
		quotationLine: ultimaCotizacion.vehicleLine,
		quotationModel: ultimaCotizacion.vehicleModel,
		vehicleValue: ultimaCotizacion.vehicleValue,
		disbursementCompleted: sql<boolean>`(${desembolsosCompletados.opportunityId} IS NOT NULL)`,
		disbursementCompletedAt: desembolsosCompletados.completedAt,
};

type Fila = {
	id: string;
	status: string;
	createdAt: Date;
	updatedAt: Date;
	closurePercentage: number;
	agenciaNombre: string;
	leadFirstName: string | null;
	leadLastName: string | null;
	vehicleMake: string | null;
	vehicleModel: string | null;
	vehicleYear: number | null;
	quotationBrand: string | null;
	quotationLine: string | null;
	quotationModel: string | null;
	vehicleValue: string | null;
	disbursementCompleted: boolean;
	disbursementCompletedAt: Date | null;
};

function nombreCliente(firstName: string | null, lastName: string | null) {
	const nombre = (firstName ?? "").trim();
	const apellido = (lastName ?? "").trim();
	if (!nombre && !apellido) return "Cliente sin nombre";
	if (!apellido) return nombre;
	return `${nombre} ${apellido.charAt(0).toUpperCase()}.`.trim();
}

function descripcionVehiculo(fila: Fila) {
	const vinculado = [fila.vehicleMake, fila.vehicleModel, fila.vehicleYear]
		.filter(Boolean)
		.join(" ");
	if (vinculado) return vinculado;

	const deCotizacion = [
		fila.quotationBrand,
		fila.quotationLine,
		fila.quotationModel,
	]
		.filter(Boolean)
		.join(" ");
	return deCotizacion || null;
}

// `won` se asigna cuando se crea el crédito, antes de que contabilidad ejecute
// el pago. El tracker solo anuncia el desembolso cuando existe la notificación
// persistida de confirmación; hasta entonces el caso sigue en proceso.
function estadoDeCaso(
	status: string,
	disbursementCompleted: boolean,
): EstadoCaso {
	if (status === "lost") return "rechazado";
	if (status === "on_hold") return "en_pausa";
	if (status === "won" && disbursementCompleted) return "desembolsado";
	return "en_proceso";
}

// Carga el historial de todos los casos en una sola query, sin N+1.
async function cargarHistoriales(filas: Fila[]) {
	const porCaso = new Map<string, EntradaHistorial[]>();
	if (filas.length === 0) return porCaso;

	const etapaOrigen = alias(salesStages, "etapa_origen");
	const eventos = await db
		.select({
			opportunityId: opportunityStageHistory.opportunityId,
			changedAt: opportunityStageHistory.changedAt,
			pctDestino: salesStages.closurePercentage,
			pctOrigen: etapaOrigen.closurePercentage,
		})
		.from(opportunityStageHistory)
		.innerJoin(
			salesStages,
			eq(salesStages.id, opportunityStageHistory.toStageId),
		)
		.leftJoin(
			etapaOrigen,
			eq(etapaOrigen.id, opportunityStageHistory.fromStageId),
		)
		.where(
			inArray(
				opportunityStageHistory.opportunityId,
				filas.map((f) => f.id),
			),
		)
		.orderBy(opportunityStageHistory.changedAt);

	const eventosPorCaso = new Map<string, typeof eventos>();
	for (const evento of eventos) {
		const lista = eventosPorCaso.get(evento.opportunityId);
		if (lista) lista.push(evento);
		else eventosPorCaso.set(evento.opportunityId, [evento]);
	}

	for (const fila of filas) {
		porCaso.set(
			fila.id,
			construirHistorial(eventosPorCaso.get(fila.id) ?? [], fila),
		);
	}

	return porCaso;
}

// Arma el DTO campo por campo: la fila de opportunity trae DPI, ingresos,
// buró, inversionistas y tasas que el socio no debe ver nunca.
function aCaso(fila: Fila, historial: EntradaHistorial[]): CasoTracker {
	const pasoActual = pasoDesdeCierre(fila.closurePercentage);
	return {
		id: fila.id,
		referencia: fila.id.slice(0, 8).toUpperCase(),
		cliente: nombreCliente(fila.leadFirstName, fila.leadLastName),
		agencia: fila.agenciaNombre.trim(),
		vehiculo: descripcionVehiculo(fila),
		valorVehiculo:
			fila.vehicleValue === null ? null : Number(fila.vehicleValue),
		pasoActual,
		porcentaje: fila.closurePercentage,
		estado: estadoDeCaso(fila.status, fila.disbursementCompleted),
		cerrado:
			fila.status === "lost" ||
			(fila.status === "won" && fila.disbursementCompleted),
		actualizadoAt: fila.updatedAt.toISOString(),
		historial,
	};
}

const consultaBase = () =>
	db
		.select(filaSelect)
		.from(opportunities)
		.innerJoin(salesStages, eq(salesStages.id, opportunities.stageId))
		.innerJoin(companies, eq(companies.id, opportunities.companyId))
		.leftJoin(leads, eq(leads.id, opportunities.leadId))
		.leftJoin(vehicles, eq(vehicles.id, opportunities.vehicleId))
		.leftJoin(
			ultimaCotizacion,
			eq(ultimaCotizacion.opportunityId, opportunities.id),
		)
		.leftJoin(
			desembolsosCompletados,
			eq(desembolsosCompletados.opportunityId, opportunities.id),
		);

export const trackerRouter = {
	getPartnerAgencies: partnerIdentityProcedure.handler(async ({ context }) => {
		return db
			.select({ id: companies.id, name: companies.name })
			.from(companies)
			.where(inArray(companies.id, context.companyIds))
			.orderBy(companies.name);
	}),

	getPartnerPasswordStatus: partnerIdentityProcedure.handler(({ context }) => ({
		mustChangePassword: !context.partnerAccount?.passwordChangedAt,
	})),

	changePartnerPassword: partnerIdentityProcedure
		.input(
			z
				.object({
					email: z.string().email(),
					currentPassword: z.string().min(1),
					newPassword: z.string().min(8),
					confirmPassword: z.string().min(8),
				})
				.refine((data) => data.newPassword === data.confirmPassword, {
					message: "Las contraseñas nuevas no coinciden",
					path: ["confirmPassword"],
				}),
		)
		.handler(async ({ input, context }) => {
			if (
				input.email.trim().toLowerCase() !==
				context.user.email.trim().toLowerCase()
			) {
				throw new ORPCError("BAD_REQUEST", {
					message: "El correo no coincide con la sesión actual",
				});
			}

			await partnerAuth.api.changePassword({
				headers: context.headers,
				body: {
					currentPassword: input.currentPassword,
					newPassword: input.newPassword,
					revokeOtherSessions: true,
				},
			});

			const ahora = new Date();
			await db
				.insert(partnerAccounts)
				.values({
					userId: context.userId,
					passwordChangedAt: ahora,
					createdAt: ahora,
					updatedAt: ahora,
				})
				.onConflictDoUpdate({
					target: partnerAccounts.userId,
					set: {
						passwordChangedAt: ahora,
						updatedAt: ahora,
					},
				});

			return { success: true };
		}),

	// Devuelve el universo completo del socio; el filtrado por período lo hace
	// el front, que necesita el historial para saber cuándo llegó a cada etapa.
	getCasos: partnerProcedure.handler(async ({ context }) => {
		const desde = new Date();
		desde.setUTCMonth(desde.getUTCMonth() - MESES_HISTORICO);

		const filas = await consultaBase()
			.where(
				and(
					inArray(opportunities.companyId, context.companyIds),
					or(
						inArray(opportunities.status, ["open", "on_hold"]),
						and(
							eq(opportunities.status, "won"),
							isNull(desembolsosCompletados.opportunityId),
						),
						and(
							eq(opportunities.status, "lost"),
							gte(fechaCierre, desde),
						),
						and(
							eq(opportunities.status, "won"),
							isNotNull(desembolsosCompletados.opportunityId),
							gte(desembolsosCompletados.completedAt, desde),
						),
					),
				),
			)
			.orderBy(desc(opportunities.updatedAt));

		const historiales = await cargarHistoriales(filas);
		return filas.map((fila) => aCaso(fila, historiales.get(fila.id) ?? []));
	}),

	getCasoById: partnerProcedure
		.input(z.object({ id: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const [fila] = await db
				.select({ ...filaSelect, companyId: opportunities.companyId })
				.from(opportunities)
				.innerJoin(salesStages, eq(salesStages.id, opportunities.stageId))
				.innerJoin(companies, eq(companies.id, opportunities.companyId))
				.leftJoin(leads, eq(leads.id, opportunities.leadId))
				.leftJoin(vehicles, eq(vehicles.id, opportunities.vehicleId))
				.leftJoin(
					ultimaCotizacion,
					eq(ultimaCotizacion.opportunityId, opportunities.id),
				)
				.leftJoin(
					desembolsosCompletados,
					eq(desembolsosCompletados.opportunityId, opportunities.id),
				)
				.where(eq(opportunities.id, input.id))
				.limit(1);

			if (!fila) {
				throw new ORPCError("NOT_FOUND", { message: "Caso no encontrado" });
			}

			// El alcance se revalida contra la membresía, nunca contra el id que manda el cliente.
			if (!fila.companyId || !context.companyIds.includes(fila.companyId)) {
				throw new ORPCError("FORBIDDEN", {
					message: "Este caso no pertenece a tu agencia",
				});
			}

			const historiales = await cargarHistoriales([fila]);
			return aCaso(fila, historiales.get(fila.id) ?? []);
		}),
};
