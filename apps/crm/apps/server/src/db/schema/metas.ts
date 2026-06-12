import {
	integer,
	numeric,
	pgTable,
	serial,
	text,
	timestamp,
	unique,
	varchar,
} from "drizzle-orm/pg-core";

export const TIPOS_META = [
	"colocacion",
	"cobros",
	"mora_maxima",
	"captacion",
] as const;
export type TipoMeta = (typeof TIPOS_META)[number];

export const metasMensuales = pgTable(
	"metas_mensuales",
	{
		id: serial("id").primaryKey(),
		tipo: varchar("tipo", { length: 50 }).notNull(),
		anio: integer("anio").notNull(),
		mes: integer("mes").notNull(),
		monto: numeric("monto", { precision: 18, scale: 2 }).notNull(),
		descripcion: text("descripcion"),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()),
	},
	(t) => ({ uniqueTipoAnioMes: unique().on(t.tipo, t.anio, t.mes) }),
);
