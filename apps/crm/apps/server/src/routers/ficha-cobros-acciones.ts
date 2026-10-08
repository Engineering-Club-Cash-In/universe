/**
 * Ficha 360 rediseñada (issue #1864) · mutaciones nuevas.
 *
 * Van en un router aparte, montado en `src/index.ts` y no en
 * `routers/index.ts`: `cobrosAppRouter` está en el límite de TS7056 (ver
 * doc 17). El front, cuando las consuma, las tipa en `orpcAparte`
 * (`web/src/utils/orpc.ts`).
 *
 * - F8 · `guardarDireccionesCaso`: residencia y trabajo corregidos.
 *
 * Plan: docs/features/cobros-02/21-plan-backend-ficha-360.md
 */

import { z } from "zod";
import { origenCambioSchema } from "../lib/cambios-datos-cliente";
import {
	guardarDireccionesCaso,
	residenciaDeOrigen,
	solicitudLaboralTitular,
} from "../lib/direcciones-caso";
import { cobrosProcedure } from "../lib/orpc";
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
};
