import { inArray, sql } from "drizzle-orm";
import { docusealDocuments } from "../database/schemas/docuseal";
import { db } from "../database";
import { and, eq } from "drizzle-orm";
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
      .where(
        inArray(docusealDocuments.nombre_documento, [...documentEnumValues])
      )
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

/**
 * 🌎 Fetch RENAP info from external API
 */
async function fetchRenapInfo(dpi: string) {
  const url = `https://crmapi.s3.devteamatcci.site/info/renap-only`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dpi }),
  });

  if (!response.ok) {
    throw new Error(`RENAP API failed with status ${response.status}`);
  }

  const data = await response.json();
  if (!data.success) {
    throw new Error(`RENAP API error: ${data.message || "unknown error"}`);
  }

  return data;
}

/**
 * 🎯 Controller: Fetch RENAP info + query document directly from DB by gender
 */
export async function getDocumentsByDpiController(
  dpi: string,
  documentName: string
) {
  try {
    // 1️⃣ Fetch RENAP info
    const renapResponse = await fetchRenapInfo(dpi);
    const renapData = renapResponse.data;

    if (!renapData?.gender) {
      return { success: false, message: "Missing gender info", renapData };
    }

    // 2️⃣ Determine gender for filtering
    const gender = renapData.gender.toLowerCase();
    const genero = gender.startsWith("m") ? "hombre" : "mujer";

    // 3️⃣ Validate enum name
    const validEnums = [
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

    if (!validEnums.includes(documentName as any)) {
      return { success: false, message: "Invalid document name" };
    }

    // 4️⃣ Query principal — busca por género
    let document = await db
      .select()
      .from(docusealDocuments)
      .where(
        and(
          eq(
            docusealDocuments.nombre_documento,
            documentName as (typeof validEnums)[number]
          ),
          eq(docusealDocuments.genero, genero)
        )
      )
      .limit(1);

    // 5️⃣ Si no hay documento por género, intenta con UNISEX
    if (!document.length) {
      document = await db
        .select()
        .from(docusealDocuments)
        .where(
          and(
            eq(
              docusealDocuments.nombre_documento,
              documentName as (typeof validEnums)[number]
            ),
            eq(docusealDocuments.genero, "unisex")
          )
        )
        .limit(1);
    }

    // 6️⃣ Si aún no hay resultados, devolver error
    if (!document.length) {
      return {
        success: false,
        message: `No document found for '${documentName}' (gender '${genero}' or unisex).`,
        renapData,
      };
    }

    // 7️⃣ Success response
    const doc = document[0];
    return {
      success: true,
      message: `Document '${doc.nombre_documento}' available for ${doc.genero}`,
      renapData,
      documento: {
        id: doc.id,
        nombre_documento: doc.nombre_documento,
        descripcion: doc.descripcion,
        genero: doc.genero,
        serialid: doc.serialid,
        url_insercion: doc.url_insercion,
      },
    };
  } catch (error: any) {
    console.error("[ERROR] getDocumentsByDpiController:", error);
    return {
      success: false,
      message: "Internal server error while fetching document by DPI",
      error: error.message,
    };
  }
}
