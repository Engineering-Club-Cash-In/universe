import axios from "axios";
import { db } from "../database";
import { eq } from "drizzle-orm";
import { docusealDocuments } from "../database/schemas/docuseal";

/**
 * 🔥 Servicio GENÉRICO para crear submissions en DocuSeal
 *
 * @param templateIds - Array de IDs de los templates/documentos
 * @param email - Email del submitter
 * @param fieldValues - Objeto con los valores de los campos (key: value)
 * @returns Array de respuestas de DocuSeal
 */
const DOCUSEAL_API_URL = process.env.DOCUSEAL_API_URL!;
const DOCUSEAL_API_TOKEN = process.env.DOCUSEAL_API_TOKEN!;
const api = axios.create({
  baseURL: DOCUSEAL_API_URL,
  headers: {
    "X-Auth-Token": DOCUSEAL_API_TOKEN,
    "Content-Type": "application/json",
  },
});

/**
 * 🔥 Interface para el campo individual
 */
interface DocusealField {
  key: string;
  value: any;
}
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
 * 🎯 Interface para el documento a enviar
 */
interface DocusealSubmissionRequest {
  id: number; // ID del documento/template
  email: string; // Email del submitter
  fields: DocusealField[]; // Array de campos con key-value
}
/**
 * 🚀 Servicio GENÉRICO para crear submissions en DocuSeal
 *
 * @param requests - Array de objetos con estructura { id, email, fields }
 * @returns Array de respuestas de DocuSeal
 */ export async function generateDocusealSubmissions(
  requests: DocusealSubmissionRequest[]
) {
  try {
    const results = [];

    for (const request of requests) {
      // 🎯 Convertir el array de fields a objeto key-value
      const fieldValues: Record<string, any> = {};

      console.log(`\n🔍 Procesando template ${request.id}:`);
      console.log(`📧 Email: ${request.email}`);
      console.log(`📝 Campos a enviar:`);

      for (const field of request.fields) {
        fieldValues[field.key] = field.value;
        console.log(`   ✓ "${field.key}" = "${field.value}"`);
      }
      // 📤 Payload completo para DocuSeal
      const payload = {
        template_id: request.id,
        submitters: [
          {
            email: request.email,
            values: fieldValues,
            send_email: false, // 🚫 No enviar email automático
            send_sms: false,
          },
        ],
      };

      console.log("\n📤 Payload completo a DocuSeal:");
      console.log(JSON.stringify(payload, null, 2));

      try {
        const response = await api.post("/submissions", payload);
        console.log(`✅ Submission creado exitosamente`);
        console.log(
          "📨 Respuesta DocuSeal:",
          JSON.stringify(response.data, null, 2)
        );
        const [nameDocument]= await db.select().from(docusealDocuments).where(eq(docusealDocuments.id_docuseal, request.id));
            const formatted = Array.from(
      new Map(
        [nameDocument].map((doc) => [
          doc.nombre_documento,
          {
            enum: doc.nombre_documento,
            label: formatDocumentName(doc.nombre_documento),
          },
        ])
      ).values()
    );
        results.push({
          templateId: request.id,
          nameDocument: formatted|| "Desconocido",
          success: true,
          data: response.data,
        });
      } catch (axiosError: any) {
        console.error(`❌ Error en template ${request.id}:`);
        console.error("Status:", axiosError.response?.status);
        console.error(
          "Error data:",
          JSON.stringify(axiosError.response?.data, null, 2)
        );

        results.push({
          templateId: request.id,
          success: false,
          error: axiosError.response?.data || axiosError.message,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return {
      success: failCount === 0,
      message: `✅ ${successCount} exitoso(s), ❌ ${failCount} fallido(s)`,
      results,
    };
  } catch (error: any) {
    console.error("❌ Error general:", error.message);

    return {
      success: false,
      message: "Error al crear submissions",
      error: error.message,
    };
  }
}
