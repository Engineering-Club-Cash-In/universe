import { asc, desc, inArray, sql } from "drizzle-orm";
import { detail_document_field, docusealDocuments, field } from "../database/schemas/docuseal";
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
      "declaracion_vendedor",
      "contrato_privado_uso_carro_usado"
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

    // 3️⃣ Validate enum names
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
      "declaracion_vendedor",
      "contrato_privado_uso_carro_usado"
    ] as const;

    // Validar todos los nombres
    const invalidNames = documentNames.filter(name => !validEnums.includes(name as any));
    if (invalidNames.length > 0) {
      return { 
        success: false, 
        message: `Invalid document names: ${invalidNames.join(", ")}` 
      };
    }

    const documentosEncontrados = [];
    const camposMap = new Map<number, any>();

    // 4️⃣ Procesar cada documento
    for (const documentName of documentNames) {
      // 🔍 Busca por género
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

      // 6️⃣ Si no se encuentra el documento, continuar con el siguiente
      if (!document.length) {
        console.warn(`Document '${documentName}' not found for gender '${genero}' or unisex`);
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

      // 7️⃣ 🔥 Traer los campos del documento
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
          
        })
        .from(detail_document_field)
        .innerJoin(field, eq(detail_document_field.idField, field.id))
        .where(eq(detail_document_field.idDocument, Number(doc.id_docuseal)))
        .orderBy(asc(field.id));

      // 8️⃣ Agrupar campos por ID y acumular documentos
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
            
          });
        }
      }
    }

    // 9️⃣ Convertir el Map a array
    const camposArray = Array.from(camposMap.values());

    // 🔟 Success response
    return {
      success: true,
      message: `Found ${documentosEncontrados.length} document(s)`,
      renapData,
      documents: documentosEncontrados,
      campos: camposArray,
    };
  } catch (error: any) {
    console.error("[ERROR] getDocumentsByDpiController:", error);
    return {
      success: false,
      message: "Internal server error while fetching documents by DPI",
      error: error.message,
    };
  }
}