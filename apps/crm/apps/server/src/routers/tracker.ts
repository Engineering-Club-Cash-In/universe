import { ORPCError } from "@orpc/server";
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
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
import { vehicles } from "../db/schema/vehicles";
import { partnerProcedure } from "../lib/orpc";
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
	monto: number | null;
	pasoActual: PasoTracker;
	porcentaje: number;
	estado: EstadoCaso;
	cerrado: boolean;
	actualizadoAt: string;
	historial: EntradaHistorial[];
};

// Fecha de cierre efectiva: los perdidos nunca traen actual_close_date.
const fechaCierre = sql<Date>`COALESCE(${opportunities.actualCloseDate}, ${opportunities.updatedAt})`;

const filaSelect = {
	id: opportunities.id,
	value: opportunities.value,
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
};

type Fila = {
	id: string;
	value: string | null;
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
};

function nombreCliente(firstName: string | null, lastName: string | null) {
	const nombre = (firstName ?? "").trim();
	const apellido = (lastName ?? "").trim();
	if (!nombre && !apellido) return "Cliente sin nombre";
	if (!apellido) return nombre;
	return `${nombre} ${apellido.charAt(0).toUpperCase()}.`.trim();
}

function descripcionVehiculo(fila: Fila) {
	if (!fila.vehicleMake || !fila.vehicleModel) return null;
	return [fila.vehicleMake, fila.vehicleModel, fila.vehicleYear]
		.filter(Boolean)
		.join(" ");
}

function estadoDeCaso(status: string, paso: PasoTracker): EstadoCaso {
	if (status === "lost") return "rechazado";
	if (status === "on_hold") return "en_pausa";
	if (status === "won" || paso === 5) return "desembolsado";
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
		monto: fila.value === null ? null : Number(fila.value),
		pasoActual,
		porcentaje: fila.closurePercentage,
		estado: estadoDeCaso(fila.status, pasoActual),
		cerrado: fila.status === "won" || fila.status === "lost",
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
		.leftJoin(vehicles, eq(vehicles.id, opportunities.vehicleId));

export const trackerRouter = {
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
							inArray(opportunities.status, ["won", "lost"]),
							gte(fechaCierre, desde),
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
