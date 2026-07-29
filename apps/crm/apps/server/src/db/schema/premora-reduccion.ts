/**
 * CB-010 — Reducción de recordatorios premora a clientes que pagan bien.
 *
 * Dos tablas que viven en el CRM (aquí se orquesta el funnel premora y el
 * Gerente de Cobros es un rol del CRM):
 *
 *  1. `premora_pago_tracking`: la FOTO del comportamiento de pago de cada
 *     crédito, refrescada por un job diario contra cartera-back. Responde
 *     "¿este crédito paga bien?" = racha de cuotas consecutivas pagadas AL DÍA
 *     (fecha_pago <= fecha_vencimiento). Elegible = racha >= 4 (≈4 meses).
 *
 *  2. `premora_reduccion_config`: lo que el Gerente APLICA manualmente sobre un
 *     crédito elegible — qué pasos del embudo (D-5/D-3/D-1) se le quitan. D-0
 *     NUNCA se quita (monitoreo preventivo). El job de recordatorios lee esta
 *     tabla y salta los pasos configurados. El sistema propone (tracking); el
 *     humano decide (config).
 *
 * El puente entre ambas y cartera es `numero_credito_sifco` (mismo criterio que
 * el resto de cobros; sin FK dura porque los datos de pago viven en otra DB).
 */

import { relations } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * Comportamiento de pago por crédito (una fila por crédito, upsert del job
 * diario). `cuotas_al_dia_consecutivas` es la racha de cuotas ya vencidas
 * pagadas al día contando desde la más reciente hacia atrás; `elegible` es
 * simplemente `racha >= 4`, materializado para no recalcular en cada consulta
 * del módulo del gerente.
 */
export const premoraPagoTracking = pgTable(
	"premora_pago_tracking",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		numeroCreditoSifco: text("numero_credito_sifco").notNull(),
		// credito_id de cartera-back (sin FK dura, otra DB) — para trazar.
		creditoId: integer("credito_id"),

		// Datos del crédito cacheados desde cartera (para el módulo del gerente
		// sin llamar a cartera en cada consulta). El NOMBRE viene de cartera
		// (usuarios), completo para todo crédito. Se refrescan con el job diario.
		cliente: text("cliente"),
		cuotaMensual: text("cuota_mensual"),
		proximaFechaPago: text("proxima_fecha_pago"), // YYYY-MM-DD

		// Racha de cuotas ya vencidas pagadas AL DÍA (fecha_pago <= vencimiento),
		// contadas desde la más reciente hacia atrás hasta el primer atraso.
		cuotasAlDiaConsecutivas: integer("cuotas_al_dia_consecutivas")
			.notNull()
			.default(0),
		// numero_cuota más alto ya vencido que se evaluó (para depurar la foto).
		ultimaCuotaEvaluada: integer("ultima_cuota_evaluada"),
		// Total de cuotas ya vencidas consideradas en el cálculo.
		totalVencidas: integer("total_vencidas"),

		// racha >= 4. Materializado: el módulo del gerente filtra por esta columna.
		elegible: boolean("elegible").notNull().default(false),

		// Cuándo corrió el job que dejó esta foto.
		calculadoAt: timestamp("calculado_at").notNull().defaultNow(),

		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("uq_premora_pago_tracking_sifco").on(t.numeroCreditoSifco),
		index("idx_premora_pago_tracking_elegible").on(t.elegible),
	],
);

/**
 * Reducción de recordatorios que el Gerente aplicó a un crédito. Una fila por
 * crédito (upsert): al reconfigurar se actualiza, al revocar se apaga
 * `activo=false` conservando la fila como historial.
 *
 * `pasos_removidos` guarda los DÍAS exactos quitados (subconjunto de {5,3,1}),
 * NO un conteo, para que el job de recordatorios sepa cuáles saltar. D-0 jamás
 * entra aquí (se valida en el endpoint).
 */
export const premoraReduccionConfig = pgTable(
	"premora_reduccion_config",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		numeroCreditoSifco: text("numero_credito_sifco").notNull(),

		// Días del embudo que NO se envían (subconjunto de {5,3,1}; máx 2).
		pasosRemovidos: integer("pasos_removidos").array().notNull(),

		activo: boolean("activo").notNull().default(true),

		// Quién y cuándo configuró (el gerente). Para auto-revoke el origen es
		// 'auto' y configuradoPor queda con el usuario sistema del job.
		configuradoPor: text("configurado_por")
			.notNull()
			.references(() => user.id),
		configuradoAt: timestamp("configurado_at").notNull().defaultNow(),
		// 'manual' (gerente) | 'auto' (nunca se crea auto, solo se revoca auto).
		origen: text("origen").notNull().default("manual"),

		// Auto-revoke: cuándo y por qué se apagó (motivo 'auto' = dejó de pagar
		// bien; 'manual' = el gerente lo quitó).
		revocadoAt: timestamp("revocado_at"),
		revocadoMotivo: text("revocado_motivo"),

		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("uq_premora_reduccion_config_sifco").on(t.numeroCreditoSifco),
		index("idx_premora_reduccion_config_activo").on(t.activo),
	],
);

export const premoraReduccionConfigRelations = relations(
	premoraReduccionConfig,
	({ one }) => ({
		configurador: one(user, {
			fields: [premoraReduccionConfig.configuradoPor],
			references: [user.id],
		}),
	}),
);

export type PremoraPagoTracking = typeof premoraPagoTracking.$inferSelect;
export type NewPremoraPagoTracking = typeof premoraPagoTracking.$inferInsert;
export type PremoraReduccionConfig = typeof premoraReduccionConfig.$inferSelect;
export type NewPremoraReduccionConfig =
	typeof premoraReduccionConfig.$inferInsert;
