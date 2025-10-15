import { pgSchema, pgEnum, pgTable, varchar, text, uniqueIndex, serial } from "drizzle-orm/pg-core";

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
]);

// 📗 Tabla principal
export const docusealDocuments = docusealSchema.table(
  "documents",
  {
    id: serial("id").primaryKey(), // 🔹 ID autoincremental (tipo SERIAL)

    nombre_documento: documentNameEnum("nombre_documento").notNull(),
    id_docuseal: varchar("id_docuseal", { length: 255 }).notNull(),
    genero: varchar("genero", { length: 10 }).notNull(),
    descripcion: text("descripcion"),
    serialid: varchar("serialid", { length: 255 }).notNull(),
    url_insercion: text("url_insercion").notNull(),
  },
  (table) => ({
    // 🚫 Evita duplicados
    uniqueDocusealId: uniqueIndex("unique_docuseal_id").on(table.id_docuseal),
    uniqueSerial: uniqueIndex("unique_serialid").on(table.serialid),
    uniqueCombo: uniqueIndex("unique_document_combo").on(
      table.nombre_documento,
      table.id_docuseal
    ),
  })
);
