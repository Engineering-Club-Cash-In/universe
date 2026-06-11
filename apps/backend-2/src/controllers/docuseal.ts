import { and, asc, eq, sql } from "drizzle-orm";
import { detail_document_field, docusealDocuments, field } from "../database/schemas/docuseal";
import { db } from "../database";
import { getRenapData } from "./renap";

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

export type DocumentCategoria = "ventas" | "inversiones" | "inversiones_sociedad" | "carta_poder";

/**
 * 🎯 Controller: Fetch unique document names with both enum and formatted label.
 * Optionally filters by categoria.
 */
export async function getDocusealDocumentsController(
  categoria?: DocumentCategoria
) {
  try {
    // Default a "ventas" para no afectar a llamadas existentes
    const categoriaFiltro: DocumentCategoria = categoria ?? "ventas";

    const result = await db
      .select({
        nombre_documento: docusealDocuments.nombre_documento,
        categoria: docusealDocuments.categoria,
      })
      .from(docusealDocuments)
      .where(eq(docusealDocuments.categoria, categoriaFiltro))
      .groupBy(
        docusealDocuments.nombre_documento,
        docusealDocuments.categoria
      )
      .orderBy(sql`${docusealDocuments.nombre_documento} ASC`);

    // 🧹 Map to { enum, label, categoria } and ensure unique names
    const formatted = Array.from(
      new Map(
        result.map((doc) => [
          doc.nombre_documento,
          {
            enum: doc.nombre_documento,
            label: formatDocumentName(doc.nombre_documento),
            categoria: doc.categoria,
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
 * 🌎 Fetch RENAP info using direct Centinela API
 */
async function fetchRenapInfo(dpi: string) {
  const response = await getRenapData(dpi);

  if (!response.success) {
    throw new Error(`RENAP API error: ${response.message || "unknown error"}`);
  }

  return response;
}

/**
 * 🎯 Controller: Fetch RENAP info + documents + fields from DB by gender
 */
export async function getDocumentsByDpiController(
  dpi: string,
  documentNames: string[]
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

    const documentosEncontrados = [];
    const camposMap = new Map<number, any>();
    const notFound: string[] = [];

    // 3️⃣ Procesar cada documento (sin lista hardcodeada: cualquier nombre vale)
    for (const documentName of documentNames) {
      // 🔍 Busca por género
      let document = await db
        .select()
        .from(docusealDocuments)
        .where(
          and(
            eq(
              docusealDocuments.nombre_documento,
              documentName as any
            ),
            eq(docusealDocuments.genero, genero)
          )
        )
        .limit(1);

      // 4️⃣ Si no hay documento por género, intenta con UNISEX
      if (!document.length) {
        document = await db
          .select()
          .from(docusealDocuments)
          .where(
            and(
              eq(
                docusealDocuments.nombre_documento,
                documentName as any
              ),
              eq(docusealDocuments.genero, "unisex")
            )
          )
          .limit(1);
      }

      // 5️⃣ Si no se encuentra el documento, continuar con el siguiente
      if (!document.length) {
        console.warn(`Document '${documentName}' not found for gender '${genero}' or unisex`);
        notFound.push(documentName);
        continue;
      }

      const doc = document[0];
      documentosEncontrados.push({
        id: doc.id_docuseal,
        nombre_documento: doc.nombre_documento,
        descripcion: doc.descripcion,
        genero: doc.genero,
        serialid: doc.serialid,
        url_insercion: doc.url_insercion,
        large_spacing: doc.large_spacing,
        count_doble_line: doc.count_double_line
      });

      // 6️⃣ 🔥 Traer los campos del documento
      const documentFields = await db
        .select({
          id: field.id,
          name: field.name,
          key: field.key,
          regex: field.regex,
          required: field.required,
          relation: field.relation,
          description: field.description,
          default: field.default,
          is_double_line: field.is_double_line,
          type: field.type,
          options: field.options,
        })
        .from(detail_document_field)
        .innerJoin(field, eq(detail_document_field.idField, field.id))
        .where(eq(detail_document_field.idDocument, Number(doc.id_docuseal)))
        .orderBy(asc(field.id));

      // 7️⃣ Agrupar campos por ID y acumular documentos
      for (const f of documentFields) {
        if (camposMap.has(f.id)) {
          // Si el campo ya existe, agregar el documento al array
          const existingField = camposMap.get(f.id);
          if (!existingField.iddocuments.includes(doc.id_docuseal)) {
            existingField.iddocuments.push(doc.id_docuseal);
          }
        } else {
          // Si es nuevo, crear el campo con el array de documentos
          camposMap.set(f.id, {
            id: f.id,
            name: f.name,
            key: f.key,
            regex: f.regex,
            required: f.required,
            iddocuments: [doc.id_docuseal],
            relation: f.relation,
            description: f.description,
            default: f.default,
            is_double_line: f.is_double_line,
            type: f.type,
            options: f.options,
          });
        }
      }
    }

    // 8️⃣ Convertir el Map a array
    const camposArray = Array.from(camposMap.values());

    // 9️⃣ Success response
    return {
      success: true,
      message: `Found ${documentosEncontrados.length} document(s)`,
      renapData,
      documents: documentosEncontrados,
      campos: camposArray,
      notFound,
    };
  } catch (error: any) {
    console.error("[ERROR] getDocumentsByDpiController:", error);

    const isRenapError = error.message?.includes("RENAP");
    return {
      success: false,
      message: isRenapError
        ? `No se pudo validar el DPI en RENAP. Verifique que el número de DPI sea correcto.`
        : "Error interno al obtener documentos por DPI",
      error: error.message,
    };
  }
}