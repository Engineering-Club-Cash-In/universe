import { and, asc, eq, sql } from "drizzle-orm";
import { detail_document_field, docusealDocuments, field } from "../database/schemas/docuseal";
import { db } from "../database";
import { getRenapData } from "./renap";

/**
 * 🏷️ Labels que no se derivan del enum (el enum vive en la DB de prod y no se renombra)
 */
const DOCUMENT_LABEL_OVERRIDES: Record<string, string> = {
  cobertura_inrexsa: "Cobertura Placas Particulares",
  cobertura_inrexsa_comercial: "Cobertura Placas Comerciales",
};

/**
 * 🔤 Converts snake_case names into a clean readable format
 */
function formatDocumentName(name: string): string {
  const override = DOCUMENT_LABEL_OVERRIDES[name];
  if (override) return override;
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
 * 🚻 Normaliza el género que manda el CRM (fallback cuando RENAP no responde)
 */
function normalizeGenero(value?: string | null): "hombre" | "mujer" | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (["hombre", "masculino", "male", "m"].includes(v)) return "hombre";
  if (["mujer", "femenino", "female", "f"].includes(v)) return "mujer";
  return null;
}

/**
 * 🎯 Controller: Fetch RENAP info + documents + fields from DB by gender
 *
 * RENAP solo se usa para (a) saber el género y así elegir la plantilla y
 * (b) pre-llenar campos que el CRM no tenga. Si RENAP no tiene la persona
 * (pasa con DPIs válidos), seguimos con el género que manda el CRM y
 * devolvemos `renapData: null` — el wizard ya prioriza los datos del CRM.
 */
export async function getDocumentsByDpiController(
  dpi: string,
  documentNames: string[],
  generoFallback?: string
) {
  try {
    // 1️⃣ Fetch RENAP info (best-effort: no debe bloquear la generación)
    let renapData: any = null;
    let renapError: string | null = null;

    try {
      const renapResponse = await fetchRenapInfo(dpi);
      renapData = renapResponse.data;
    } catch (error: any) {
      renapError = error?.message ?? "Error consultando RENAP";
      console.warn(
        `[getDocumentsByDpiController] RENAP no disponible para el DPI ${dpi}: ${renapError}`
      );
    }

    // 2️⃣ Determine gender for filtering (RENAP manda; si no, el del CRM)
    const generoRenap = renapData?.gender
      ? renapData.gender.toLowerCase().startsWith("m")
        ? "hombre"
        : "mujer"
      : null;
    const genero = generoRenap ?? normalizeGenero(generoFallback);

    if (!genero) {
      return {
        success: false,
        message: renapError
          ? "No se pudo validar el DPI en RENAP y el cliente no tiene género registrado en el CRM. Verifique el DPI o complete el género del cliente."
          : "Missing gender info",
        renapData,
        renapError,
      };
    }

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
      // 🚩 Para que el CRM avise que los datos salieron solo de la oportunidad
      renapUnavailable: !renapData,
      renapError,
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