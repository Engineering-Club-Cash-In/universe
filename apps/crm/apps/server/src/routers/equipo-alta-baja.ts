/**
 * Alta y baja de asesor desde «Mi equipo» (Figma «05 · Alta y Baja de
 * Asesor»). Flujo y orden de los pasos en services/alta-baja-asesor.ts.
 *
 * Permisos: supervisión de cobros y administración por igual
 * (`cobrosSupervisorProcedure` = `canAssignCobros`). Crear el usuario del CRM
 * del asesor está permitido aquí SOLO con rol Cobros y correo de la empresa
 * (crear usuarios de cualquier otro rol sigue siendo de Administración ›
 * Usuarios, `adminProcedure`).
 *
 * Archivo aparte (y montado aparte en src/index.ts), no en routers/index.ts:
 * `cobrosAppRouter` está en el límite donde TS7056 trunca EN SILENCIO el tipo
 * inferido en el web. El web lo tipa por `orpcAparte` (web/src/utils/orpc.ts).
 */

import { z } from "zod";
import {
	MAX_CARTERA_INICIAL,
	MOTIVOS_BAJA,
	ROLES_ASESOR,
} from "../lib/alta-baja-asesor";
import { cobrosSupervisorProcedure } from "../lib/orpc";
import {
	confirmarBajaAsesor,
	crearAsesorCobros,
	listarSupervisoresCobros,
	previsualizarAltaAsesor,
	previsualizarBajaAsesor,
} from "../services/alta-baja-asesor";

const datosAlta = z.object({
	nombre: z.string().trim().min(1, "Ingrese el nombre completo").max(100),
	email: z.string().trim().email("Ingrese un correo válido").max(150),
	rol: z.enum(ROLES_ASESOR),
});

const datosBaja = z
	.object({
		asesorId: z.number().int().positive(),
		motivo: z.enum(MOTIVOS_BAJA),
		ultimoDia: z.string().date("Indique el último día de trabajo"),
		detalle: z.string().trim().max(300).optional(),
	})
	.superRefine((v, ctx) => {
		if (v.motivo === "otro" && !v.detalle) {
			ctx.addIssue({
				code: "custom",
				path: ["detalle"],
				message: "Describa el motivo de la baja",
			});
		}
	});

const actorDe = (context: {
	userId: string;
	userRole?: string | null;
	session: { user: { email: string } };
}) => ({
	userId: context.userId,
	role: context.userRole,
	email: context.session.user.email,
});

export const equipoAltaBajaRouter = {
	/** Opciones del campo «Supervisor» del alta: supervisores de cobros habilitados. */
	getSupervisoresCobros: cobrosSupervisorProcedure.handler(() =>
		listarSupervisoresCobros(),
	),

	/**
	 * «Cartera inicial»: qué pasa con el usuario del CRM del correo, el equipo del
	 * nivel con su carga y la recomendación. No escribe nada. `bloqueo` dice por
	 * qué no se puede dar de alta (otro rol, ya es asesor activo, ausente…).
	 */
	previsualizarAltaAsesor: cobrosSupervisorProcedure
		.input(datosAlta)
		.handler(({ input, context }) =>
			previsualizarAltaAsesor(input, actorDe(context)),
		),

	/**
	 * «Crear asesor»: usuario del CRM (rol Cobros) → asesor y pool en cartera →
	 * cartera inicial (reasignación en bloque). Repetirlo con los mismos datos
	 * retoma lo que falte sin duplicar.
	 */
	crearAsesorCobros: cobrosSupervisorProcedure
		.input(
			datosAlta.extend({
				supervisorId: z.string().min(1).optional(),
				creditos: z.number().int().min(0).max(MAX_CARTERA_INICIAL),
			}),
		)
		.handler(({ input, context }) =>
			crearAsesorCobros(input, actorDe(context)),
		),

	/**
	 * «Redistribuir cartera»: reparto por capacidad que propone cartera para la
	 * baja (vale 10 minutos). Las cuentas fuera de cobro van a
	 * `responsableEspecialesId` (o al sugerido: su nivel, con menos carga).
	 */
	previsualizarBajaAsesor: cobrosSupervisorProcedure
		.input(
			datosBaja.and(
				z.object({
					responsableEspecialesId: z.number().int().positive().optional(),
				}),
			),
		)
		.handler(({ input, context }) =>
			previsualizarBajaAsesor(input, actorDe(context)),
		),

	/**
	 * «Confirmar baja y redistribución»: reparte y desactiva en cartera en una
	 * transacción y suspende su usuario del CRM. `id` (lo genera el cliente) hace
	 * seguro el reintento.
	 */
	confirmarBajaAsesor: cobrosSupervisorProcedure
		.input(
			datosBaja.and(
				z.object({ id: z.string().uuid(), previewId: z.string().uuid() }),
			),
		)
		.handler(({ input, context }) =>
			confirmarBajaAsesor(input, actorDe(context)),
		),
};
