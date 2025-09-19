import { pgTable, varchar, date } from "drizzle-orm/pg-core";

// Tabla de personas
export const renapInfo = pgTable("renapinfo", {
  dpi: varchar("dpi", { length: 20 }).primaryKey(), // Llave primaria
  firstName: varchar("first_name", { length: 100 }).notNull(),
  secondName: varchar("second_name", { length: 100 }),
  thirdName: varchar("third_name", { length: 100 }),
  firstLastName: varchar("first_last_name", { length: 100 }).notNull(),
  secondLastName: varchar("second_last_name", { length: 100 }),
  marriedLastName: varchar("married_last_name", { length: 100 }),
  picture: varchar("picture", { length: 255 }),
  birthDate: date("birth_date"),
  gender: varchar("gender", { length: 1 }).$type<"M" | "F">(),
  civilStatus: varchar("civil_status", { length: 1 }).$type<"S" | "C">(),
  nationality: varchar("nationality", { length: 100 }),
  bornedIn: varchar("borned_in", { length: 100 }),
  departmentBornedIn: varchar("department_borned_in", { length: 100 }),
  municipalityBornedIn: varchar("municipality_borned_in", { length: 100 }),
  deathDate: date("death_date"),
  ocupation: varchar("ocupation", { length: 100 }),
  cedulaOrder: varchar("cedula_order", { length: 50 }),
  cedulaRegister: varchar("cedula_register", { length: 50 }),
  dpiExpiracyDate: date("dpi_expiracy_date"),
});
