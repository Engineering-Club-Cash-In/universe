/**
 * Las boletas de pago que suben los clientes por el bot de WhatsApp.
 *
 * Contrato: docs/features/bot-whatsapp-cobros/04-validacion-de-boleta.md
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ESTA TABLA ES EL PUENTE ENTRE UNA CONVERSACIÓN Y UN PAGO EN CARTERA.
 *
 * Cuando contabilidad valide (o revierta) el pago 48213, cartera nos va a avisar
 * con ese número y nada más. Sin estas filas no habría forma de saber de qué
 * cliente era, a qué teléfono escribirle, ni siquiera que vino del bot.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
	date,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { coDebtors, leads } from "./crm";
import { otps } from "./otp";

/**
 * Estados del borrador. La máquina completa vive en §4.1 del contrato:
 *
 *   leyendo ─► leida | fallida   (la lectura con IA: ver `reservarIntento`)
 *   leida ─► confirmando ─► confirmada | confirmada_a_verificar | rechazada
 *                        └► revision_manual   (nadie puede decidir solo)
 *   leida ─► descartada  (venció sin confirmar)
 *   leida ─► fallida     (cartera la rechazó)
 *
 * Va como `text` y no como enum de Postgres a propósito: la máquina todavía se
 * está construyendo por capas, y agregar un valor a un enum en producción es
 * una migración con lock.
 */
export type EstadoBoletaBot =
	// La fila se crea en `leyendo` para apartar el intento ANTES de llamar al
	// modelo; si la lectura sirve pasa a `leida`, y si no a `fallida`.
	| "leyendo"
	| "leida"
	| "confirmando"
	| "confirmada"
	| "confirmada_a_verificar"
	| "rechazada"
	| "revision_manual"
	| "descartada"
	| "fallida";

export const botCobrosBoletas = pgTable(
	"bot_cobros_boletas",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		/**
		 * La sesión del paso 1 con la que se subió.
		 *
		 * `SET NULL`, **nunca CASCADE**: purgar un OTP vencido —o borrar el lead,
		 * que cascadea hacia `otps`— se llevaría la boleta ya confirmada, y
		 * entonces el aviso de contabilidad llegaría con un `pago_id` sin dueño.
		 * El cliente nunca sabría que su pago se acreditó.
		 */
		otpId: uuid("otp_id").references(() => otps.id, { onDelete: "set null" }),

		/** Identidad propia, para sobrevivir a la purga del OTP. */
		leadId: uuid("lead_id").references(() => leads.id, {
			onDelete: "set null",
		}),
		coDebtorId: uuid("co_debtor_id").references(() => coDebtors.id, {
			onDelete: "set null",
		}),

		numeroSifco: text("numero_sifco").notNull(),
		/** El de cartera; se conoce desde la lectura, con el resumen del crédito. */
		creditoId: integer("credito_id"),

		/** 1, 2 o 3. Lo cuenta el CRM sobre esta misma tabla (D-27). */
		intento: integer("intento").notNull(),

		/** La URL de SimpleTech. Solo para trazar de dónde vino; no se reusa. */
		imagenOrigenUrl: text("imagen_origen_url").notNull(),
		/** La nuestra. Se llena al LEER, no al confirmar (D-31). */
		r2Key: text("r2_key"),
		/** sha256 del archivo: detecta la misma foto mandada dos veces (§9). */
		hashImagen: text("hash_imagen"),

		/** Lo que devolvió el modelo, crudo, por si hay que auditar una lectura. */
		lectura: jsonb("lectura").notNull(),

		bancoId: integer("banco_id"),
		monto: numeric("monto", { precision: 12, scale: 2 }),
		fechaBoleta: date("fecha_boleta"),
		numeroAutorizacion: text("numero_autorizacion"),
		cuentaDestino: text("cuenta_destino"),
		confianza: text("confianza"),

		estado: text("estado").$type<EstadoBoletaBot>().notNull(),
		motivoFallo: text("motivo_fallo"),

		/** Para el job de reconciliación de los 5 minutos (§4.1). */
		confirmandoDesde: timestamp("confirmando_desde", { withTimezone: true }),
		/** Un mensaje por boleta, no por pago (§6). */
		notificadoClienteAt: timestamp("notificado_cliente_at", {
			withTimezone: true,
		}),
		/**
		 * Qué desenlace fue el que se le contó: `validado` o `rechazado`.
		 *
		 * Sin esto, `notificado_cliente_at` significaba "ya se le dijo algo" y
		 * cerraba la boleta para siempre. Un pago validado que conta revierte
		 * después cambia el desenlace, y el cliente tiene que enterarse: comparar
		 * contra este campo es lo que distingue "ya se lo dije" de "le dije otra
		 * cosa".
		 */
		desenlaceNotificado: text("desenlace_notificado"),
		/**
		 * Alguien está mandando el aviso **ahora mismo**. Es un arrendamiento: vence.
		 *
		 * El derecho a mandar se toma antes de enviar, para que dos eventos
		 * hermanos simultáneos no manden dos WhatsApp iguales. Pero si el proceso
		 * muere entre reclamar y enviar, nadie suelta la marca. Por eso la marca no
		 * es `notificado_cliente_at` —que significaría "entregado"— sino esta, que
		 * caduca: pasado el plazo la boleta vuelve a estar disponible.
		 */
		avisoReclamadoEn: timestamp("aviso_reclamado_en", { withTimezone: true }),

		expiraEn: timestamp("expira_en", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		index("bot_cobros_boletas_otp_idx").on(t.otpId),
		index("bot_cobros_boletas_estado_idx").on(t.estado),
		index("bot_cobros_boletas_hash_idx").on(t.hashImagen),
	],
);

/**
 * Los pagos que cartera creó por esta boleta.
 *
 * Es 1:N y no una columna: `newPayment` crea o actualiza **una fila de
 * `pagos_credito` por cuota**, así que una boleta que cubre tres cuotas
 * atrasadas son tres pagos (§5.2).
 */
export const botCobrosBoletaPagos = pgTable(
	"bot_cobros_boleta_pagos",
	{
		boletaId: uuid("boleta_id")
			.notNull()
			.references(() => botCobrosBoletas.id, { onDelete: "cascade" }),
		pagoId: integer("pago_id").notNull(),
		numeroCuota: integer("numero_cuota"),
		/** Cuando contabilidad lo validó o lo revirtió. */
		resueltoEn: timestamp("resuelto_en", { withTimezone: true }),
	},
	(t) => [
		primaryKey({ columns: [t.boletaId, t.pagoId] }),
		// El unique es lo que permite que un evento entrante encuentre su boleta.
		unique("bot_cobros_boleta_pagos_pago_unico").on(t.pagoId),
	],
);

/**
 * Cada aviso de contabilidad que se recibió, para no notificar dos veces.
 *
 * Un pago se puede revertir y volver a validar, y conta puede repetir una
 * acción: el unique de abajo es lo que evita que el cliente reciba dos
 * WhatsApp por lo mismo.
 */
export const botCobrosPagoEventos = pgTable(
	"bot_cobros_pago_eventos",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		boletaId: uuid("boleta_id").references(() => botCobrosBoletas.id, {
			onDelete: "set null",
		}),
		pagoId: integer("pago_id").notNull(),
		evento: text("evento").notNull(),
		ocurridoEn: timestamp("ocurrido_en", { withTimezone: true }).notNull(),
		payload: jsonb("payload"),
		notificadoClienteAt: timestamp("notificado_cliente_at", {
			withTimezone: true,
		}),
		notificadoAsesorAt: timestamp("notificado_asesor_at", {
			withTimezone: true,
		}),
		error: text("error"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		unique("bot_cobros_pago_eventos_unico").on(
			t.pagoId,
			t.evento,
			t.ocurridoEn,
		),
		index("bot_cobros_pago_eventos_boleta_idx").on(t.boletaId),
	],
);
