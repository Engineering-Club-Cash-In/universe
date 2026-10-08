/**
 * Ficha 360 rediseñada (issue #1864) · mutaciones nuevas.
 *
 * Van en un router aparte, montado en `src/index.ts` y no en
 * `routers/index.ts`: `cobrosAppRouter` está en el límite de TS7056 (ver
 * doc 17). El front, cuando las consuma, las tipa en `orpcAparte`
 * (`web/src/utils/orpc.ts`).
 *
 * - F8 · `guardarDireccionesCaso`: residencia y trabajo corregidos.
 * - F6 · `enviarDocumentoClienteWhatsapp` (tarjeta de circulación, seguro),
 *   `solicitarDocumentoCaso` (asesor) y `getSolicitudesDocumentos` /
 *   `resolverSolicitudDocumento` (supervisor).
 * - F7 · `preguntarAsistenteCaso`: preguntas al asistente IA del caso
 *   (apagado mientras `COBROS_ASISTENTE_IA` no sea "on").
 *
 * Plan: docs/features/cobros-02/21-plan-backend-ficha-360.md
 */

import { z } from "zod";
import { preguntarAsistente } from "../lib/asistente-ia-cobros";
import { origenCambioSchema } from "../lib/cambios-datos-cliente";
import {
	guardarDireccionesCaso,
	residenciaDeOrigen,
	solicitudLaboralTitular,
} from "../lib/direcciones-caso";
import {
	DOCUMENTOS_ENVIAR,
	DOCUMENTOS_SOLICITAR,
	enviarDocumentoCliente,
	listarSolicitudesDocumentos,
	resolverSolicitudDocumento,
	solicitarDocumento,
} from "../lib/documentos-ficha";
import { cobrosProcedure, cobrosSupervisorProcedure } from "../lib/orpc";
import { resolverContextoCaso } from "../services/referencias-cobros-datos";
import { assertAccesoCasoCobro } from "./cobros";

/** `undefined` = no se toca; "" o `null` = volver a la dirección de origen. */
const direccionSchema = z.string().trim().max(500).nullable().optional();

export const fichaCobrosAccionesRouter = {
	/**
	 * F8 · Guarda la dirección de residencia y la de trabajo corregidas desde
	 * Contacto › Editar. No pisa el lead ni la solicitud de crédito: van en
	 * `casos_cobros` y la ficha, el Workspace y las visitas las prefieren.
	 * Cada cambio queda en la bitácora (F3).
	 */
	guardarDireccionesCaso: cobrosProcedure
		.input(
			z
				.object({
					casoCobroId: z.string().uuid(),
					residencia: direccionSchema,
					trabajo: z
						.object({
							empresa: z.string().trim().max(200).nullable().optional(),
							direccion: direccionSchema,
						})
						.optional(),
					origen: origenCambioSchema,
				})
				.refine(
					(v) =>
						v.residencia !== undefined ||
						v.trabajo?.empresa !== undefined ||
						v.trabajo?.direccion !== undefined,
					{ message: "Indique al menos una dirección para guardar." },
				),
		)
		.handler(async ({ input, context }) => {
			await assertAccesoCasoCobro(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			const ctx = await resolverContextoCaso(input.casoCobroId);
			const [residencia, trabajo] = await Promise.all([
				residenciaDeOrigen(ctx.leadId),
				solicitudLaboralTitular(ctx.opportunityId),
			]);
			return guardarDireccionesCaso({
				casoCobroId: input.casoCobroId,
				cambio: { residencia: input.residencia, trabajo: input.trabajo },
				origenActual: {
					residencia,
					empresaTrabajo: trabajo?.empresa ?? null,
					direccionTrabajo: trabajo?.direccion ?? null,
				},
				origen: input.origen,
				userId: context.userId,
			});
		}),

	/**
	 * F6 · Envía al cliente por WhatsApp la tarjeta de circulación o la
	 * información del seguro (el PDF más reciente cargado al vehículo o a la
	 * oportunidad; para el seguro, si no hay póliza, la cobertura general).
	 */
	enviarDocumentoClienteWhatsapp: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				clave: z.enum(DOCUMENTOS_ENVIAR),
			}),
		)
		.handler(async ({ input, context }) => {
			await assertAccesoCasoCobro(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			const ctx = await resolverContextoCaso(input.casoCobroId);
			const r = await enviarDocumentoCliente({
				ctx,
				clave: input.clave,
				userId: context.userId,
			});
			return { success: true as const, ...r };
		}),

	/**
	 * F6 · El asesor pide al supervisor el contrato, la carta poder, el cambio
	 * de placas o el expertaje. Una sola pendiente por caso y documento.
	 */
	solicitarDocumentoCaso: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				clave: z.enum(DOCUMENTOS_SOLICITAR),
				comentario: z.string().trim().max(1000).optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			await assertAccesoCasoCobro(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			const ctx = await resolverContextoCaso(input.casoCobroId);
			return solicitarDocumento({
				casoCobroId: input.casoCobroId,
				numeroCreditoSifco: ctx.numeroCreditoSifco,
				clave: input.clave,
				comentario: input.comentario || null,
				userId: context.userId,
			});
		}),

	/** F6 · Bandeja del supervisor: solicitudes de documentos (S1). */
	getSolicitudesDocumentos: cobrosSupervisorProcedure
		.input(
			z
				.object({
					estado: z.enum(["pendiente", "aprobada", "rechazada"]).optional(),
					casoCobroId: z.string().uuid().optional(),
					limite: z.number().int().min(1).max(500).default(100),
				})
				.default({ limite: 100 }),
		)
		.handler(({ input }) => listarSolicitudesDocumentos(input)),

	/** F6 · El supervisor aprueba o rechaza la solicitud, con una nota. */
	resolverSolicitudDocumento: cobrosSupervisorProcedure
		.input(
			z.object({
				solicitudId: z.string().uuid(),
				decision: z.enum(["aprobada", "rechazada"]),
				nota: z.string().trim().max(1000).optional(),
			}),
		)
		.handler(({ input, context }) =>
			resolverSolicitudDocumento({
				solicitudId: input.solicitudId,
				decision: input.decision,
				nota: input.nota || null,
				userId: context.userId,
			}),
		),

	/**
	 * F7 · Pregunta al asistente IA sobre el caso. Responde solo con los datos
	 * del caso; tope de preguntas por usuario en 24 horas.
	 */
	preguntarAsistenteCaso: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				pregunta: z.string().trim().min(3).max(500),
			}),
		)
		.handler(async ({ input, context }) => {
			await assertAccesoCasoCobro(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			return preguntarAsistente({
				casoCobroId: input.casoCobroId,
				pregunta: input.pregunta,
				userId: context.userId,
			});
		}),
};
