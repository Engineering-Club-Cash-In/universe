import { pgTable, text, uuid, uniqueIndex } from "drizzle-orm/pg-core";

// Catálogo de departamentos y municipios de Guatemala
export const guatemalaLocations = pgTable(
	"guatemala_locations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		departamento: text("departamento").notNull(),
		municipio: text("municipio").notNull(),
	},
	(table) => [
		// Índice único para evitar duplicados de departamento-municipio
		uniqueIndex("dept_muni_unique_idx").on(table.departamento, table.municipio),
	],
);

// Export types
export type GuatemalaLocation = typeof guatemalaLocations.$inferSelect;
export type NewGuatemalaLocation = typeof guatemalaLocations.$inferInsert;

// Datos de los 22 departamentos de Guatemala con sus municipios
// Se pueden insertar con un seed script
export const GUATEMALA_DEPARTMENTS = [
	"Alta Verapaz",
	"Baja Verapaz",
	"Chimaltenango",
	"Chiquimula",
	"El Progreso",
	"Escuintla",
	"Guatemala",
	"Huehuetenango",
	"Izabal",
	"Jalapa",
	"Jutiapa",
	"Petén",
	"Quetzaltenango",
	"Quiché",
	"Retalhuleu",
	"Sacatepéquez",
	"San Marcos",
	"Santa Rosa",
	"Sololá",
	"Suchitepéquez",
	"Totonicapán",
	"Zacapa",
] as const;
