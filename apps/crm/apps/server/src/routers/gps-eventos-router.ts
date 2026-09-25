/**
 * CB-119 · Historial de eventos GPS (desconexión de energía, ignición,
 * GPS sin reportar, salida de geocerca) para la Ficha 360.
 *
 * Módulo aparte de wialon.ts y gps-integracion.ts: mismo motivo de siempre
 * (D-03 en docs/features/cobros-02/09-integracion-gps-wialon.md) — evitar
 * que TS7056 trunque el tipo inferido hacia apps/web al agregar procedures
 * a un router ya grande.
 */

import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { casosCobros } from "../db/schema/cobros";
import { gpsEventos } from "../db/schema/gps-eventos";
import { assertCreditoAsignadoEnCarteraPorSifco } from "../lib/credito-cartera-ownership";
import { cobrosProcedure } from "../lib/orpc";
import {
	gpsEventosCasoInputSchema,
	gpsEventosCasoOutputSchema,
} from "../services/wialon/wialon-types";
import { assertAccesoCasoCobro } from "./cobros";

export const gpsEventosRouter = {
	/**
	 * Historial de eventos GPS de un caso, para la Ficha 360.
	 *
	 * `assertAccesoCasoCobro` NO alcanza como autorización completa:
	 * `getDetallesCreditoCarteraBack` auto-crea un caso con
	 * `responsableCobros = quien consulta` cuando el crédito no tenía uno
	 * activo — un asesor puede fabricarse el acceso abriendo el SIFCO de
	 * otro (mismo hallazgo de Codex ya corregido en `routers/wialon.ts` vía
	 * `assertCreditoAsignadoEnCarteraPorSifco`, la fuente autoritativa es
	 * CARTERA, no el caso local). Acá se aplica el mismo guard antes de
	 * devolver lat/lon histórica.
	 */
	getGpsEventosCaso: cobrosProcedure
		.input(gpsEventosCasoInputSchema)
		.output(gpsEventosCasoOutputSchema)
		.handler(async ({ input, context }) => {
			await assertAccesoCasoCobro(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);

			const [caso] = await db
				.select({ numeroCreditoSifco: casosCobros.numeroCreditoSifco })
				.from(casosCobros)
				.where(eq(casosCobros.id, input.casoCobroId))
				.limit(1);

			if (caso?.numeroCreditoSifco) {
				await assertCreditoAsignadoEnCarteraPorSifco({
					numeroSifco: caso.numeroCreditoSifco,
					emailUsuario: context.user?.email || context.session?.user?.email,
					userRole: context.userRole,
					accion: "ver el historial de eventos GPS de este vehículo",
				});
			}

			const filas = await db
				.select({
					id: gpsEventos.id,
					tipo: gpsEventos.tipo,
					wialonUnitId: gpsEventos.wialonUnitId,
					ocurridoAt: gpsEventos.ocurridoAt,
					lat: gpsEventos.lat,
					lon: gpsEventos.lon,
					velocidadKmh: gpsEventos.velocidadKmh,
					notificado: gpsEventos.notificado,
				})
				.from(gpsEventos)
				.where(eq(gpsEventos.casoCobroId, input.casoCobroId))
				.orderBy(desc(gpsEventos.ocurridoAt))
				.limit(input.limit);

			return filas;
		}),
};
