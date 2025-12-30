import { pgSchema, pgEnum, pgTable, varchar, text, uniqueIndex, serial, boolean, integer, primaryKey } from "drizzle-orm/pg-core";

// 🧱 Schema principal
export const docusealSchema = pgSchema("docuseal");

// 📘 ENUM de nombres de documentos
export const documentNameEnum = docusealSchema.enum("document_name_enum", [
  "solicitud_compra_vehiculo_tercero",
  "carta_aceptacion_instalacion_gps",
  "carta_traspaso_vehiculo_rdbe",
  "descargo_responsabilidades",
  "cobertura_inrexsa",
  "reconocimiento_deuda_feb_2025",
  "carta_carro_nuevo",
  "contrato_privado_uso_carro_nuevo",
  "pagare_unico_libre_protesto",
  "carta_emision_cheques",
  "garantia_mobiliaria",
  "declaracion_vendedor",
  "contrato_privado_uso_carro_usado"
]);

// 📗 Tabla principal
export const docusealDocuments = docusealSchema.table(
  "documents",
  { 

    nombre_documento: documentNameEnum("nombre_documento").notNull(),
    id_docuseal: integer("id_docuseal").notNull().primaryKey(),
    genero: varchar("genero", { length: 10 }).notNull(),
    descripcion: text("descripcion"),
    serialid: varchar("serialid", { length: 255 }).notNull(),
    url_insercion: text("url_insercion").notNull(),
    large_spacing: boolean("large_spacing").default(false),
    count_double_line:integer("count_double_line").default(0)
  },
  (table) => ({
    // 🚫 Evita duplicados
    uniqueDocusealId: uniqueIndex("unique_docuseal_id").on(table.id_docuseal),
 
    uniqueCombo: uniqueIndex("unique_document_combo").on(
      table.nombre_documento,
      table.id_docuseal
    ),
  })
);
// Tabla de detalles (relación many-to-many)
export const detail_document_field = docusealSchema.table('detail_document_field', {
  idField: integer('id_field').notNull().references(() => field.id, { onDelete: 'cascade' }),
  idDocument: integer('id_document').notNull().references(() => docusealDocuments.id_docuseal, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.idField, table.idDocument] }),
}));
export const field = docusealSchema.table('field', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  key: varchar('key', { length: 100 }).notNull().unique(),
  regex: varchar('regex', { length: 500 }),
  description: text('description'),
  is_double_line: boolean('is_double_line').default(false),
  default: text('default'),
  required: boolean('required').default(false),
  relation: varchar('relation', { length: 100 }),
});

