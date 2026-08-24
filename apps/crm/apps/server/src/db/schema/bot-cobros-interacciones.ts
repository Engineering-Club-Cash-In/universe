/**
 * El historial de interacciones del bot de cobros: una fila por petición que el
 * bot le hizo a nuestros servicios en nombre del cliente.
 *
 * Contrato: docs/features/bot-whatsapp-cobros/06-historial-interacciones.md
 *
 * La "sesión" es la `referencia` del paso 1 (la fila de `otps`): no existe otra
 * noción de conversación (D-04, D-16). La Ficha 360 agrupa por `otp_id` y numera
 * al leer ("Referencia 1" = la más vieja del cliente, D-44).
 *
 * Acá NO va PII (D-42): ni el código OTP, ni teléfonos completos, ni el
 * identificador de búsqueda crudo. El `detalle` lo arma una allowlist por
 * acción en `lib/bot-cobros/historial.ts`; lo que no está en la lista no se
 * escribe. Por eso la tabla no necesita retención (D-14 no la alcanza).
 */

import {
	boolean,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { coDebtors, leads } from "./crm";
import { otps } from "./otp";

export const botCobrosInteracciones = pgTable(
	"bot_cobros_interacciones",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		/**
		 * La sesión (referencia del paso 1). `SET NULL`, nunca CASCADE: purgar un
		 * OTP vencido no puede llevarse el historial — mismo criterio que
		 * `bot_cobros_boletas.otp_id`.
		 *
		 * Nullable también por D-43: los intentos de acceso donde el OTP nunca se
		 * emitió (`acceso_fallido`) no tienen sesión a la cual colgarse.
		 */
		otpId: uuid("otp_id").references(() => otps.id, { onDelete: "set null" }),

		/**
		 * El MISMO id de la sesión, pero sin FK a propósito (Codex, PR #1411):
		 * cuando la purga de D-14 borre el OTP, el `SET NULL` de arriba se lleva
		 * `otp_id` — y sin esta copia, las interacciones de una sesión real se
		 * desagrupaban y caían a "intentos sin sesión". Esta columna es la llave
		 * de agrupado de la ficha y sobrevive a la purga; `otp_id` queda para el
		 * join mientras el OTP viva. NULL solo cuando la sesión nunca existió
		 * (`acceso_fallido`, D-43).
		 */
		sesionId: uuid("sesion_id"),

		/**
		 * Identidad propia, resuelta al escribir, para sobrevivir a la purga del
		 * OTP y para que la consulta de la ficha sea un WHERE plano. Cuando operó
		 * un codeudor, `lead_id` es el TITULAR de su crédito (resuelto vía su
		 * oportunidad) y `co_debtor_id` dice quién operó de verdad (D-44 cierra
		 * así la pregunta 2 de D-11).
		 */
		leadId: uuid("lead_id").references(() => leads.id, {
			onDelete: "set null",
		}),
		coDebtorId: uuid("co_debtor_id").references(() => coDebtors.id, {
			onDelete: "set null",
		}),

		/**
		 * `buscar_cliente`, `listar_creditos`, `menu_credito`, `estado_cuenta`,
		 * `boleta_leer`, `boleta_confirmar`, `acceso_fallido`… Va como `text` y no
		 * como enum de Postgres a propósito: el bot va a seguir creciendo (regla
		 * general de D-41) y agregar un valor a un enum en producción es una
		 * migración con lock — mismo criterio que `bot_cobros_boletas.estado`.
		 */
		accion: text("accion").notNull(),

		exito: boolean("exito").notNull(),
		/** El `codigo` de la respuesta cuando falló (OTP_INVALIDO, …). Null si éxito. */
		codigo: text("codigo"),
		/** Solo en acciones sobre un crédito; la ficha marca los de OTRO crédito. */
		numeroSifco: text("numero_sifco"),
		/** La allowlist del curador de esa acción (D-42), nada más. */
		detalle: jsonb("detalle").$type<Record<string, unknown>>(),

		creadoEn: timestamp("creado_en", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		// La consulta de la ficha: todas las interacciones de un cliente, en orden.
		index("bot_cobros_interacciones_lead_idx").on(t.leadId, t.creadoEn),
		index("bot_cobros_interacciones_otp_idx").on(t.otpId),
		index("bot_cobros_interacciones_codebtor_idx").on(t.coDebtorId),
	],
);
