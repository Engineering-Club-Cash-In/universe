import { Elysia, t } from "elysia";
import { eq, and } from "drizzle-orm";
import { db } from "../database";
import { documentos_inversionista, inversionistas } from "../database/db";
import {
  uploadDocumentoInversionista,
  getSignedDocumentUrl,
  deleteDocumentoFromR2,
} from "../utils/functions/uploadsFiles";
import { authMiddleware } from "./midleware";

export const investorDocumentsRouter = new Elysia()
  .use(authMiddleware)

  // POST - Crear documento
  .post(
    "/investor-documents",
    async ({ body, set }) => {
      try {
        const { file, inversionista_id, nombre, descripcion, visible, created_by } = body;

        // Validar que el inversionista exista
        const [investor] = await db
          .select()
          .from(inversionistas)
          .where(eq(inversionistas.inversionista_id, inversionista_id));

        if (!investor) {
          set.status = 404;
          return { success: false, message: "Inversionista no encontrado" };
        }

        // Subir archivo a R2
        const key = await uploadDocumentoInversionista(file, inversionista_id);

        // Insertar en DB
        const [documento] = await db
          .insert(documentos_inversionista)
          .values({
            inversionista_id,
            key,
            nombre,
            descripcion: descripcion || null,
            visible: visible ?? false,
            created_by: created_by || null,
          })
          .returning();

        // Generar URL firmada para la respuesta
        const url = await getSignedDocumentUrl(key);

        return {
          success: true,
          message: "Documento creado exitosamente",
          data: { ...documento, url },
        };
      } catch (error) {
        console.error("Error al crear documento:", error);
        set.status = 500;
        return {
          success: false,
          message: "Error al crear documento",
          error: error instanceof Error ? error.message : "Error desconocido",
        };
      }
    },
    {
      body: t.Object({
        file: t.File(),
        inversionista_id: t.Numeric(),
        nombre: t.String(),
        descripcion: t.Optional(t.String()),
        visible: t.Optional(t.BooleanString()),
        created_by: t.Optional(t.String()),
      }),
    }
  )

  // GET Admin - Todos los documentos de un inversionista
  .get(
    "/investor-documents/admin/:inversionistaId",
    async ({ params, set }) => {
      try {
        const inversionistaId = Number(params.inversionistaId);

        const documentos = await db
          .select()
          .from(documentos_inversionista)
          .where(eq(documentos_inversionista.inversionista_id, inversionistaId));

        // Firmar URLs
        const documentosConUrl = await Promise.all(
          documentos.map(async (doc) => ({
            ...doc,
            url: await getSignedDocumentUrl(doc.key),
          }))
        );

        return { success: true, data: documentosConUrl };
      } catch (error) {
        console.error("Error al obtener documentos (admin):", error);
        set.status = 500;
        return {
          success: false,
          message: "Error al obtener documentos",
          error: error instanceof Error ? error.message : "Error desconocido",
        };
      }
    },
    {
      params: t.Object({
        inversionistaId: t.String(),
      }),
    }
  )

  // GET Cliente - Solo documentos visibles, busca por email del inversionista
  .get(
    "/investor-documents/client/:email",
    async ({ params, set }) => {
      try {
        // Buscar inversionista por email
        const [investor] = await db
          .select()
          .from(inversionistas)
          .where(eq(inversionistas.email, params.email));

        if (!investor) {
          set.status = 404;
          return { success: false, message: "Inversionista no encontrado con ese email" };
        }

        const documentos = await db
          .select()
          .from(documentos_inversionista)
          .where(
            and(
              eq(documentos_inversionista.inversionista_id, investor.inversionista_id),
              eq(documentos_inversionista.visible, true)
            )
          );

        const documentosConUrl = await Promise.all(
          documentos.map(async (doc) => ({
            ...doc,
            url: await getSignedDocumentUrl(doc.key),
          }))
        );

        return { success: true, data: documentosConUrl };
      } catch (error) {
        console.error("Error al obtener documentos (client):", error);
        set.status = 500;
        return {
          success: false,
          message: "Error al obtener documentos",
          error: error instanceof Error ? error.message : "Error desconocido",
        };
      }
    },
    {
      params: t.Object({
        email: t.String(),
      }),
    }
  )

  // PUT - Actualizar visibilidad
  .put(
    "/investor-documents/:documentoId/visibility",
    async ({ params, body, set }) => {
      try {
        const documentoId = Number(params.documentoId);

        const [updated] = await db
          .update(documentos_inversionista)
          .set({ visible: body.visible })
          .where(eq(documentos_inversionista.documento_id, documentoId))
          .returning();

        if (!updated) {
          set.status = 404;
          return { success: false, message: "Documento no encontrado" };
        }

        return {
          success: true,
          message: "Visibilidad actualizada exitosamente",
          data: updated,
        };
      } catch (error) {
        console.error("Error al actualizar visibilidad:", error);
        set.status = 500;
        return {
          success: false,
          message: "Error al actualizar visibilidad",
          error: error instanceof Error ? error.message : "Error desconocido",
        };
      }
    },
    {
      params: t.Object({
        documentoId: t.String(),
      }),
      body: t.Object({
        visible: t.Boolean(),
      }),
    }
  )

  // DELETE - Eliminar documento (PATCH para evitar bloqueo de CORS)
  .patch(
    "/investor-documents/:documentoId/delete",
    async ({ params, set }) => {
      try {
        const documentoId = Number(params.documentoId);

        // Obtener el documento para saber la key
        const [documento] = await db
          .select()
          .from(documentos_inversionista)
          .where(eq(documentos_inversionista.documento_id, documentoId));

        if (!documento) {
          set.status = 404;
          return { success: false, message: "Documento no encontrado" };
        }

        // Eliminar de R2
        await deleteDocumentoFromR2(documento.key);

        // Eliminar de DB
        const [deleted] = await db
          .delete(documentos_inversionista)
          .where(eq(documentos_inversionista.documento_id, documentoId))
          .returning();

        return {
          success: true,
          message: "Documento eliminado exitosamente",
          data: deleted,
        };
      } catch (error) {
        console.error("Error al eliminar documento:", error);
        set.status = 500;
        return {
          success: false,
          message: "Error al eliminar documento",
          error: error instanceof Error ? error.message : "Error desconocido",
        };
      }
    },
    {
      params: t.Object({
        documentoId: t.String(),
      }),
    }
  );
