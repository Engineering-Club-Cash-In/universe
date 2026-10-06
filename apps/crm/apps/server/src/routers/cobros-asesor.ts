/**
 * Rediseño COBROS-02 · Dashboard del asesor y Mi Cartera (Figma «CRM Ventas» ›
 * Asesor Junior / Asesor Senior). Datos personales del asesor logueado: SIEMPRE
 * se resuelven desde la sesión, nunca desde lo que mande el front.
 *
 * Lo que todavía no existe en el backend está CONECTADO pero devuelve `null`
 * (las cards del front muestran "—"). Cada uno tiene su `TODO(José)` con el
 * contrato ya fijado: solo hay que llenar el cuerpo, el front no se toca.
 * Detalle de cada tarea: docs/features/cobros-02/13-dashboard-asesor-backend.md
 */

import { and, eq, gte, inArray, lt, ne, not, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
	cierreDiarioCreditoCobros,
	contactosCobros,
} from "../db/schema/cobros";
import {
	PERIODOS_DESEMPENO,
	type RangoFechas,
	rangosDesempeno,
} from "../lib/desempeno-asesor";
import {
	esContactoEfectivo,
	esGestionAutomatica,
} from "../lib/historial-agendas";
import { cobrosProcedure } from "../lib/orpc";
import { PERMISSIONS } from "../lib/roles";
import { carteraBackClient } from "../services/cartera-back-client";

/** Nivel del asesor según los buckets de su pool en cartera (no es un rol del CRM). */
export type NivelAsesor = "junior" | "senior";

/**
 * Junior = B0–B1; senior = B2 en adelante (regla de negocio 2026-10-06: "los
 * junior están en B0 y B1, los senior en B2, B3, B4; es por bucket").
 */
export function nivelPorBuckets(buckets: number[]): NivelAsesor {
	return buckets.some((b) => b >= 2) ? "senior" : "junior";
}

/** Contrato de "Recuperación" (KPI de Mi desempeño). Lo llena José. */
export interface RecuperacionAsesor {
	/** Q recuperados en el período (definición: ver docs, tarea B2). */
	monto: number;
	/** Q del mismo tramo del período anterior (para la tendencia ▲▼). */
	montoAnterior: number | null;
	/** Meta del asesor para el período en Q (tarea B3); null si no hay meta cargada. */
	meta: number | null;
}

async function contactabilidad(userId: string, r: RangoFechas) {
	const [fila] = await db
		.select({
			total: sql<number>`count(*)::int`,
			logrados: sql<number>`count(*) FILTER (WHERE ${esContactoEfectivo()} OR ${contactosCobros.estadoContacto} IN ('promesa_pago', 'pago_registrado'))::int`,
		})
		.from(contactosCobros)
		.where(
			and(
				eq(contactosCobros.realizadoPor, userId),
				gte(contactosCobros.fechaContacto, r.desde),
				lt(contactosCobros.fechaContacto, r.hasta),
				ne(contactosCobros.estadoContacto, "link_pago_generado"),
				not(esGestionAutomatica()),
			),
		);
	const total = Number(fila?.total ?? 0);
	const logrados = Number(fila?.logrados ?? 0);
	return {
		total,
		logrados,
		porcentaje: total > 0 ? Math.round((logrados / total) * 1000) / 10 : null,
	};
}

/**
 * Promesas del asesor cuya fecha prometida cae en el rango (hasta hoy):
 * pactadas = todas, cumplidas = las que cartera ya marcó cumplidas.
 */
async function promesas(userId: string, r: RangoFechas, ahora: Date) {
	const tope = r.hasta.getTime() < ahora.getTime() ? r.hasta : ahora;
	const [fila] = await db
		.select({
			pactadas: sql<number>`count(*)::int`,
			cumplidas: sql<number>`count(*) FILTER (WHERE ${contactosCobros.estadoPromesa} = 'cumplida')::int`,
		})
		.from(contactosCobros)
		.where(
			and(
				eq(contactosCobros.realizadoPor, userId),
				eq(contactosCobros.estadoContacto, "promesa_pago"),
				gte(contactosCobros.fechaProximoContacto, r.desde),
				lt(contactosCobros.fechaProximoContacto, tope),
			),
		);
	return {
		pactadas: Number(fila?.pactadas ?? 0),
		cumplidas: Number(fila?.cumplidas ?? 0),
	};
}

/** Créditos que bajaron / subieron de bucket, del cierre diario (corre a las 22:00). */
async function movimiento(userId: string, r: RangoFechas) {
	const [fila] = await db
		.select({
			subieron: sql<number>`count(*) FILTER (WHERE ${cierreDiarioCreditoCobros.tipo} = 'subida')::int`,
			bajaron: sql<number>`count(*) FILTER (WHERE ${cierreDiarioCreditoCobros.tipo} = 'bajada')::int`,
		})
		.from(cierreDiarioCreditoCobros)
		.where(
			and(
				eq(cierreDiarioCreditoCobros.asesorId, userId),
				gte(cierreDiarioCreditoCobros.fecha, r.desdeStr),
				sql`${cierreDiarioCreditoCobros.fecha} <= ${r.hastaStr}`,
				inArray(cierreDiarioCreditoCobros.tipo, ["subida", "bajada"]),
			),
		);
	return {
		subieron: Number(fila?.subieron ?? 0),
		bajaron: Number(fila?.bajaron ?? 0),
	};
}

export const cobrosAsesorRouter = {
	/**
	 * Quién es el usuario para cobros: su asesor de cartera, sus buckets y su
	 * nivel. El front arma con esto el Dashboard y los chips de bucket de Mi
	 * Cartera (B0/B1 para junior; B2–B4 para senior).
	 */
	getMiPerfilCobros: cobrosProcedure.handler(async ({ context }) => {
		const esSupervision = PERMISSIONS.canAssignCobros(context.userRole ?? "");
		const email = context.session?.user?.email?.trim().toLowerCase();
		const pool = await carteraBackClient.getPoolPorAsesor();
		const propio = email
			? pool.find((a) => a.email_cash_in?.trim().toLowerCase() === email)
			: undefined;
		const buckets = [...(propio?.buckets ?? [])].sort((a, b) => a - b);
		return {
			esSupervision,
			sinAsesor: !propio,
			asesorId: propio?.asesor_id ?? null,
			nombre: propio?.nombre ?? context.session?.user?.name ?? null,
			buckets,
			nivel: nivelPorBuckets(buckets),
		};
	}),

	/**
	 * KPIs de "Mi desempeño" (Figma: Recuperación, Promesas cumplidas,
	 * Contactabilidad, Movimiento). La "Mora de mi cartera" y "Cartera al día"
	 * salen de `getCobrosDashboardStats` (ya filtrado por sesión).
	 */
	getMiDesempeno: cobrosProcedure
		.input(z.object({ periodo: z.enum(PERIODOS_DESEMPENO) }))
		.handler(async ({ input, context }) => {
			const ahora = new Date();
			const { actual, anterior } = rangosDesempeno(input.periodo, ahora);
			const userId = context.userId;
			const [cA, cP, pA, pP, mov] = await Promise.all([
				contactabilidad(userId, actual),
				contactabilidad(userId, anterior),
				promesas(userId, actual, ahora),
				promesas(userId, anterior, ahora),
				movimiento(userId, actual),
			]);

			// TODO(José) · tarea B2 + B3 (docs/features/cobros-02/13-dashboard-asesor-backend.md):
			// devolver { monto, montoAnterior, meta } del asesor de la sesión para
			// `actual` y `anterior`. Hoy cartera-back solo tiene recuperación MENSUAL y
			// para supervisor (/reportes/mora-recuperacion-por-asesor), y no hay metas
			// por asesor. Mientras sea null, el front muestra "—" en la card.
			const recuperacion = null as RecuperacionAsesor | null;

			return {
				periodo: input.periodo,
				rango: { desde: actual.desdeStr, hasta: actual.hastaStr },
				rangoAnterior: { desde: anterior.desdeStr, hasta: anterior.hastaStr },
				recuperacion,
				promesas: {
					cumplidas: pA.cumplidas,
					pactadas: pA.pactadas,
					cumplidasAnterior: pP.cumplidas,
					pactadasAnterior: pP.pactadas,
				},
				contactabilidad: {
					porcentaje: cA.porcentaje,
					porcentajeAnterior: cP.porcentaje,
					logrados: cA.logrados,
					intentos: cA.total,
				},
				movimiento: {
					bajaron: mov.bajaron,
					subieron: mov.subieron,
					// El cierre diario corre a las 22:00: el día en curso no aparece
					// hasta esa hora. Para verlo en vivo: tarea B9 en los docs.
					incluyeHoy: false,
				},
			};
		}),

	/**
	 * Contadores de la "Agenda de hoy" que todavía no tienen fuente. Conectados
	 * en el front como "pronto" mientras sean null.
	 */
	getMiAgendaContadoresPendientes: cobrosProcedure.handler(async () => {
		// TODO(José) · tarea B6: pagos reportados por el cliente que esperan
		// validación, de los créditos del asesor de la sesión (definir con negocio
		// la fuente: pagos_credito.validation_status='pending' en cartera, boletas
		// del bot en revisión, …). Número, o null si no aplica.
		const pagosPorConfirmar: number | null = null;
		// TODO(José) · tarea B7: créditos del asesor con referencias que hay que
		// contactar (definir la regla: p. ej. N intentos fallidos al titular y
		// referencias sin gestión). Número, o null si no aplica.
		const referenciasPorContactar: number | null = null;
		return { pagosPorConfirmar, referenciasPorContactar };
	}),
};
