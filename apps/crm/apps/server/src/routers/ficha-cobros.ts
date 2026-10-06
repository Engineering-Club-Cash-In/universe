/**
 * Rediseño COBROS-02 · Ficha 360 (Figma «CRM Ventas» › Asesor Junior › 04 ·
 * Consulta · Ficha 360 · Ubicaciones). Es la misma ficha para todos los
 * créditos y todos los roles de cobros.
 *
 * - `getSeguimientoFicha`: la franja del Resumen (contactabilidad, días sin
 *   gestión, intentos sin contacto, próximo contacto) y el chip de estado de
 *   gestión del encabezado. Real, sale de `contactos_cobros`.
 * - `getFichaComplementos`: lo que Figma pide y el backend todavía no tiene.
 *   Está CONECTADO: devuelve `null` en cada bloque y el front muestra "—" o
 *   "pronto". Cada bloque tiene su `TODO(José) · tarea Fn` con el contrato ya
 *   fijado; solo hay que llenar el cuerpo, el front no se toca.
 *   Detalle: docs/features/cobros-02/15-ficha-360-backend.md
 */

import { and, eq, gte, ne, not, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { contactosCobros } from "../db/schema/cobros";
import {
	DIAS_VENTANA_CONTACTABILIDAD,
	diasSinGestion,
	type NivelContactabilidad,
	nivelContactabilidad,
} from "../lib/ficha-cobros";
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
			// TODO(José) · tarea F1: datos personales del titular desde RENAP
			// (nombre, DPI, fecha de nacimiento, sexo, estado civil). Solo lectura.
			const datosPersonales = null as DatosPersonalesFicha | null;
			// TODO(José) · tarea F2: codeudores del crédito (oportunidad/contrato)
			// con sus teléfonos, correo y direcciones. [] si no tiene.
			const codeudores = null as CodeudorFicha[] | null;
			// TODO(José) · tarea F3: bitácora de cambios de los datos del cliente
			// (antes → después, autor, origen). Ver la bitácora crm_entity_audit.
			const historialCambios = null as CambioFicha[] | null;
			// TODO(José) · tarea F4: vida del crédito — entradas/salidas de bucket
			// (cartera.buckets_historial), reestructuras, convenios, promesas
			// cumplidas. Más reciente primero.
			const historico = null as HitoCredito[] | null;
			// TODO(José) · tarea F5: tipo de seguro y coberturas de la póliza.
			const seguro = null as SeguroComplemento | null;
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
};
