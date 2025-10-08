import { inArray, sql } from "drizzle-orm";
import { docusealDocuments } from "../database/schemas/docuseal";
import { db } from "../database";

/**
 * 🔤 Converts snake_case names into a clean readable format
 */
function formatDocumentName(name: string): string {
  return name
    .split("_")
    .map((word) => {
      // Mantiene minúsculas en preposiciones comunes
      const lower = word.toLowerCase();
      if (["de", "del", "la", "el", "y", "en"].includes(lower)) return lower;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * 🎯 Controller: Fetch unique document names with both enum and formatted label
 */
export async function getDocusealDocumentsController() {
  try {
    // 🧩 Enum literal array (const assertion)
    const documentEnumValues = [
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
    ] as const;

    // 🧠 Query optimized: only select distinct document names
    const result = await db
      .select({
        nombre_documento: docusealDocuments.nombre_documento,
      })
      .from(docusealDocuments)
      .where(inArray(docusealDocuments.nombre_documento, [...documentEnumValues]))
      .groupBy(docusealDocuments.nombre_documento)
      .orderBy(sql`${docusealDocuments.nombre_documento} ASC`);

    // 🧹 Map to { enum, label } and ensure unique names
    const formatted = Array.from(
      new Map(
        result.map((doc) => [
          doc.nombre_documento,
          {
            enum: doc.nombre_documento,
            label: formatDocumentName(doc.nombre_documento),
          },
        ])
      ).values()
    );

    return {
      success: true,
      total: formatted.length,
      data: formatted,
    };
  } catch (error: any) {
    console.error("[ERROR] getDocusealDocumentsController:", error);
    return {
      success: false,
      message: "Internal server error while fetching document names",
      error: error.message,
    };
  }
}
