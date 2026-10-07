/**
 * Rediseño COBROS-02 · Dashboard del supervisor (Figma «CRM Ventas» ›
 * Supervisor › Dashboard · Supervisor, `1954:14`).
 *
 * El dashboard ya arma casi todo con procedimientos existentes (aprobaciones,
 * coberturas, Págalo, carga por bucket, historial de agendas, cierre diario).
 * Lo que el Figma pide y el backend todavía no tiene vive acá:
 *
 * - `getSupervisionComplementos`: está CONECTADO. Devuelve `null` en cada campo
 *   y el front muestra "—" o "Pronto". Cada campo tiene su
 *   `TODO(José) · tarea Sn` con el contrato ya fijado: solo hay que llenar el
 *   cuerpo, el front no se toca.
 *   Detalle: docs/features/cobros-02/17-supervision-backend.md
 *
 * Archivo aparte (y montado aparte en src/index.ts), no en routers/index.ts:
 * `cobrosAppRouter` está en el límite donde TS7056 trunca EN SILENCIO el tipo
 * inferido en el web (ver la nota de routers/bucket-capacidad.ts). El web lo
 * tipa por `orpcAparte` (web/src/utils/orpc.ts).
 */

import { z } from "zod";
import { cobrosSupervisorProcedure } from "../lib/orpc";

/** Mismos períodos que el segmentado Día / Semana / Mes del dashboard. */
export const PERIODOS_SUPERVISION = ["dia", "semana", "mes"] as const;

/* ── Contratos de lo que llena José ─────────────────────────────────────────── */

/** Tarea S1 · Pendientes del supervisor que hoy no tienen fuente. */
export interface PendientesSupervision {
	/** Documentos que los asesores pidieron y esperan autorización (se apoya en F6). */
	documentosPorAutorizar: number | null;
	/** Solicitudes de rebaja de mora por revisar (W2). */
	rebajasPorRevisar: number | null;
	/** Créditos que cumplen el criterio para pasar a Prejurídico (criterio por definir). */
	listosPrejuridico: number | null;
	/**
	 * Aprobaciones que el supervisor resolvió hoy (convenios, recuperaciones,
	 * apagados y, cuando existan, rebajas y documentos). Alimenta la barra
	 * «x de y aprobaciones resueltas hoy».
	 */
	aprobacionesResueltasHoy: number | null;
}

/** Tarea S3 · KPIs del equipo en el período (Día / Semana / Mes). */
export interface KpisEquipoSupervision {
	/** Monto recuperado por el equipo y su meta en Q (versión de equipo de B2/B3). */
	recuperacion: {
		monto: number;
		meta: number | null;
		/** Mismo monto en el período anterior, para la tendencia. */
		montoAnterior: number | null;
	} | null;
	/** Cuentas curadas: quedaron sin mora y siguen en su bucket (definirlo). */
	cuentasCuradas: {
		curadas: number;
		/** Universo del que salen (el «/ 70» del Figma). */
		total: number;
		curadasAnterior: number | null;
	} | null;
	/** Promesas de pago del equipo con fecha en el período. */
	promesasCumplidas: {
		cumplidas: number;
		pactadas: number;
		/** Monto prometido que no se pagó (el «−Q28k» del Figma). */
		montoIncumplido: number;
	} | null;
}

/** Tarea S4 · Columnas de la tabla Equipo que no tienen fuente. */
export interface EquipoAsesorSupervision {
	/** asesor_id de cartera (el mismo de getAsesoresTraslados). */
	asesorId: number;
	/** Contactos que registró hoy, en vivo (el cierre diario solo llega a las 22:00). */
	contactosHoy: number | null;
	/** Meta del asesor, en % (definir sobre qué). */
	meta: number | null;
	/** «Rescate», en % (definirlo). */
	rescate: number | null;
}

export const supervisionCobrosRouter = {
	/**
	 * Mismo permiso que el resto de la supervisión de cobros
	 * (`cobrosSupervisorProcedure` = admin + cobros_supervisor).
	 */
	getSupervisionComplementos: cobrosSupervisorProcedure
		.input(z.object({ periodo: z.enum(PERIODOS_SUPERVISION) }))
		.handler(async ({ input }) => {
			// TODO(José) · tarea S1: documentos por autorizar (F6), rebajas de mora
			// por revisar (W2), listos para Prejurídico (criterio + consulta) y las
			// aprobaciones que este supervisor resolvió hoy (para «x de y»).
			const pendientes = null as PendientesSupervision | null;
			// TODO(José) · tarea S2: créditos del equipo sin contacto efectivo en
			// más de 3 días hábiles. Hoy hay tres umbrales distintos (3 días hábiles
			// en la alerta, más de 5 días en la cola, 48 h en la cartera): unificar
			// y exponer el conteo aquí y como filtro de la cola/cartera.
			const sinContacto3Dias = null as number | null;
			// TODO(José) · tarea S3: recuperación del equipo con meta en Q, cuentas
			// curadas y promesas cumplidas del equipo para `input.periodo`.
			const kpis = null as KpisEquipoSupervision | null;
			// TODO(José) · tarea S4: por asesor, contactos de hoy en vivo, meta y
			// «rescate». Una fila por asesor del pool.
			const equipo = null as EquipoAsesorSupervision[] | null;
			return {
				periodo: input.periodo,
				pendientes,
				sinContacto3Dias,
				kpis,
				equipo,
			};
		}),
};
