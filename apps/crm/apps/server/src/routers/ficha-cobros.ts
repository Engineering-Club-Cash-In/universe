/**
 * Rediseño COBROS-02 · Ficha 360 (Figma «CRM Ventas» › Asesor Junior › 04 ·
 * Consulta · Ficha 360 · Ubicaciones). Es la misma ficha para todos los
 * créditos y todos los roles de cobros.
 *
 * - `getSeguimientoFicha`: la franja del Resumen (contactabilidad, días sin
 *   gestión, intentos sin contacto, próximo contacto) y el chip de estado de
 *   gestión del encabezado. Real, sale de `contactos_cobros`.
 * - `getFichaComplementos`: los bloques de la ficha que no salen del detalle
 *   del caso. Ya son reales F1 (datos personales), F2 (codeudores), F3
 *   (historial de cambios) y F5 (seguro), armados en `lib/ficha-complementos.ts`. Los que siguen en `null`
 *   tienen su `TODO(José) · tarea Fn`; el front los muestra "—" o "pronto".
 *   Detalle: docs/features/cobros-02/15-ficha-360-backend.md y
 *   docs/features/cobros-02/21-plan-backend-ficha-360.md
 */

import { and, eq, gte, ne, not, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { contactosCobros } from "../db/schema/cobros";
import { cargarHistorialCambios } from "../lib/cambios-datos-cliente";
import {
	DIAS_VENTANA_CONTACTABILIDAD,
	diasSinGestion,
	type NivelContactabilidad,
	nivelContactabilidad,
} from "../lib/ficha-cobros";
import {
	cargarCodeudores,
	cargarDatosPersonales,
	cargarHistorico,
	cargarSeguro,
} from "../lib/ficha-complementos";
import {
	esContactoEfectivo,
	esGestionAutomatica,
} from "../lib/historial-agendas";
import { cobrosProcedure } from "../lib/orpc";
import {
	accionPendienteDe,
	cargarSeguimientoPorCaso,
	estadoGestionDe,
} from "../lib/seguimiento-cobros";
import { resolverContextoCaso } from "../services/referencias-cobros-datos";
import { assertAccesoCasoCobro } from "./cobros";

/* ── Contratos de lo que llena José ─────────────────────────────────────────── */

/** Tarea F1 · Datos personales del titular, sincronizados de RENAP (solo lectura). */
export interface DatosPersonalesFicha {
	nombreCompleto: string;
	dpi: string | null;
	/** "YYYY-MM-DD". */
	fechaNacimiento: string | null;
	sexo: string | null;
	estadoCivil: string | null;
}

/** Tarea F2 · Codeudores del crédito, con sus datos de contacto. */
export interface CodeudorFicha {
	id: string;
	nombre: string;
	/** "Codeudor 1". */
	rol: string;
	correo: string | null;
	telefonoPrincipal: string | null;
	celularAlterno: string | null;
	telefonoCasa: string | null;
	residencia: string | null;
	trabajo: string | null;
}

/** Tarea F3 · Un cambio de los datos del cliente (pestaña "Historial de cambios"). */
export interface CambioFicha {
	id: string;
	/** "Teléfono principal". */
	campo: string;
	/** "Contacto" | "Direcciones" | "Datos personales". */
	categoria: string;
	antes: string | null;
	despues: string;
	/** "Ana Gómez (asesor)". */
	autor: string;
	fecha: string;
	/** "Ficha 360" | "Workspace" | "Carga masiva". */
	origen: string;
}

/** Tarea F4 · Hito de la vida del crédito (Historial › Histórico). */
export interface HitoCredito {
	id: string;
	/** "Ingresó a Bucket B1 · Alerta temprana", "Convenio de pago firmado"… */
	descripcion: string;
	fecha: string;
	tipo: "bucket" | "reestructura" | "convenio" | "promesa" | "otro";
}

/** Tarea F5 · Seguro del vehículo: lo que la ficha todavía no trae. */
export interface SeguroComplemento {
	tipoSeguro: string | null;
	coberturas: string | null;
}

/** Tarea F6 · Documentos de la pestaña Documentos. */
export interface DocumentoFicha {
	clave: string;
	nombre: string;
	descripcion: string;
	/** Enviar al cliente (WhatsApp) o solicitar al supervisor. */
	modo: "enviar" | "solicitar";
	disponible: boolean;
}

/** Tarea F7 · Resumen del caso generado por IA. */
export interface ResumenIA {
	texto: string;
	etiquetas: string[];
	generadoEn: string;
}

/** Tarea W5 · Una alerta del caso que el asesor ya marcó como leída. */
export interface AlertaLeidaCaso {
	id: string;
	titulo: string;
	descripcion: string | null;
	cobrosTipo: string | null;
	/** Fecha en que se generó la última repetición. */
	createdAt: string;
	leidaEn: string;
	/** "Ana Gómez" o "Automático (más de 30 días)". */
	leidaPor: string;
}

export const fichaCobrosRouter = {
	getSeguimientoFicha: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				/** statusCredit EN_CONVENIO (lo sabe la ficha por cartera). */
				enConvenio: z.boolean().default(false),
			}),
		)
		.handler(async ({ input, context }) => {
			await assertAccesoCasoCobro(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			const ahora = new Date();
			const seguimiento =
				(await cargarSeguimientoPorCaso([input.casoCobroId], ahora)).get(
					input.casoCobroId,
				) ?? null;

			const desde = new Date(
				ahora.getTime() - DIAS_VENTANA_CONTACTABILIDAD * 24 * 60 * 60 * 1000,
			);
			const [fila] = await db
				.select({
					total: sql<number>`count(*)::int`,
					logrados: sql<number>`count(*) FILTER (WHERE ${esContactoEfectivo()} OR ${contactosCobros.estadoContacto} IN ('promesa_pago', 'pago_registrado'))::int`,
				})
				.from(contactosCobros)
				.where(
					and(
						eq(contactosCobros.casoCobroId, input.casoCobroId),
						gte(contactosCobros.fechaContacto, desde),
						ne(contactosCobros.estadoContacto, "link_pago_generado"),
						not(esGestionAutomatica()),
					),
				);
			const total = Number(fila?.total ?? 0);
			const logrados = Number(fila?.logrados ?? 0);

			// "Días sin gestión" cuenta desde la última gestión manual de CUALQUIER
			// fecha: el seguimiento solo mira 60 días, y un caso abandonado hace 65
			// días mostraba "—" en vez de 65.
			const [ultima] = await db
				.select({
					fecha: sql<Date | null>`max(${contactosCobros.fechaContacto})`,
				})
				.from(contactosCobros)
				.where(
					and(
						eq(contactosCobros.casoCobroId, input.casoCobroId),
						ne(contactosCobros.estadoContacto, "link_pago_generado"),
						not(esGestionAutomatica()),
					),
				);
			const ultimaGestion = ultima?.fecha ? new Date(ultima.fecha) : null;

			const accion = seguimiento
				? accionPendienteDe(seguimiento, {}, ahora)
				: null;
			return {
				intentosSinContacto: seguimiento?.intentosSinContacto ?? 0,
				ultimoIntentoEn: seguimiento?.ultimoIntentoEn ?? null,
				proximaLlamadaEn: seguimiento?.proximaLlamadaEn ?? null,
				diasSinGestion: diasSinGestion(ultimaGestion, ahora),
				contactabilidad: {
					nivel: nivelContactabilidad(
						logrados,
						total,
					) as NivelContactabilidad | null,
					logrados,
					total,
				},
				estadoGestion: seguimiento
					? estadoGestionDe(seguimiento, input.enConvenio)
					: input.enConvenio
						? ("convenio_vigente" as const)
						: ("sin_acuerdo" as const),
				accionPendiente: accion
					? { tipo: accion.tipo, fecha: accion.fecha }
					: null,
			};
		}),

	/**
	 * Lo que la Ficha 360 de Figma pide y todavía no tiene fuente. Cada bloque en
	 * `null` = el front lo muestra como pendiente ("—" / "pronto"). Al llenarlo,
	 * el front lo pinta solo.
	 */
	getFichaComplementos: cobrosProcedure
		.input(z.object({ casoCobroId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			await assertAccesoCasoCobro(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			const ctx = await resolverContextoCaso(input.casoCobroId);
			// Cada bloque por su lado: si uno falla, queda en null (la ficha lo
			// muestra pendiente) y los demás se devuelven igual.
			const bloque = <T>(nombre: string, cargar: () => Promise<T | null>) =>
				cargar().catch((error) => {
					console.error(
						`[getFichaComplementos] ${nombre} del caso ${input.casoCobroId}:`,
						error,
					);
					return null;
				});
			const [datosPersonales, codeudores, seguro, historialCambios, historico] =
				await Promise.all([
					// F1 · RENAP → lead → solicitud, campo por campo.
					bloque<DatosPersonalesFicha>("datos personales", () =>
						cargarDatosPersonales(ctx),
					),
					// F2 · Codeudores de la oportunidad del crédito; [] si no tiene.
					bloque<CodeudorFicha[]>("codeudores", () => cargarCodeudores(ctx)),
					// F5 · Tipo de cobertura y deducible del vehículo.
					bloque<SeguroComplemento>("seguro", () => cargarSeguro(ctx)),
					// F3 · Bitácora de cambios de teléfonos, correo y direcciones.
					bloque<CambioFicha[]>("historial de cambios", () =>
						cargarHistorialCambios(input.casoCobroId),
					),
					// F4 · Buckets, convenios y promesas cumplidas, lo más reciente
					// primero.
					bloque<HitoCredito[]>("vida del crédito", () =>
						cargarHistorico(input.casoCobroId),
					),
				]);
			// TODO(José) · tarea F6: catálogo de documentos para enviar al cliente
			// (tarjeta de circulación, seguro) y para solicitar al supervisor
			// (contrato, carta poder, cambio de placas, expertaje), con su envío.
			const documentos = null as DocumentoFicha[] | null;
			// TODO(José) · tarea F7: resumen del caso por IA (requiere aprobar el
			// costo de la API antes de activarlo).
			const resumenIA = null as ResumenIA | null;
			return {
				datosPersonales,
				codeudores,
				historialCambios,
				historico,
				seguro,
				documentos,
				resumenIA,
			};
		}),

	/**
	 * Tarea W5 · Alertas del caso marcadas como leídas. `null` = todavía no
	 * existe (el front muestra «Ver alertas leídas · Pronto»).
	 */
	getAlertasLeidasCaso: cobrosProcedure
		.input(z.object({ casoCobroId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			await assertAccesoCasoCobro(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			// TODO(José) · tarea W5: alertas leídas del caso (quién y cuándo),
			// incluidas las que el job marca solas a los 30 días.
			return null as AlertaLeidaCaso[] | null;
		}),

	/**
	 * Tarea W5 · Marca como leída una alerta del caso para el usuario. Cierra el
	 * GRUPO de ese tipo (getAlertasCaso agrupa por tipo las filas que los jobs
	 * repiten cada día), no solo la fila; si el job la vuelve a generar,
	 * reaparece. Hoy el front lo muestra deshabilitado («Pronto»).
	 */
	marcarAlertaCasoLeida: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				/** El `id` que devolvió getAlertasCaso (la fila más reciente del grupo). */
				alertaId: z.string(),
			}),
		)
		.handler(async ({ input, context }) => {
			await assertAccesoCasoCobro(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			// TODO(José) · tarea W5: marcar el grupo como leído para este usuario
			// y sacarlo de getAlertasCaso. Ver
			// docs/features/cobros-02/16-workspace-backend.md.
			return { marcada: false as boolean };
		}),
};
