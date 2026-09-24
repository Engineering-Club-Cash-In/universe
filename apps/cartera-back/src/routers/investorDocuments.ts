import { Elysia, t } from "elysia";
import { eq, and } from "drizzle-orm";
import { db } from "../database";
import { documentos_inversionista, inversionistas } from "../database/db";
import {
  uploadDocumentoInversionista,
  getSignedDocumentUrl,
  resolveDocumentMimeType,
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

  // GET Cliente por id - Mismo contrato que la ruta por email (solo visibles,
  // url inline + downloadUrl), pero apuntando a una entidad concreta. La usa el
  // portal cuando la persona tiene varias: por correo se devolvía la primera
  // fila que apareciera.
  //
  // NO reusar /investor-documents/admin/:inversionistaId: esa no filtra
  // `visible` y le enseñaría al inversionista los documentos internos.
  .get(
    "/investor-documents/client-by-id/:inversionistaId",
    async ({ params, set }) => {
      try {
        const inversionistaId = Number(params.inversionistaId);
        if (!Number.isInteger(inversionistaId) || inversionistaId <= 0) {
          set.status = 400;
          return { success: false, message: "inversionistaId inválido" };
        }

        const documentos = await db
          .select()
          .from(documentos_inversionista)
          .where(
            and(
              eq(documentos_inversionista.inversionista_id, inversionistaId),
              eq(documentos_inversionista.visible, true)
            )
          );

        const documentosConUrl = await Promise.all(
          documentos.map(async (doc) => {
            const mimeType = await resolveDocumentMimeType(doc.key);
            return {
              ...doc,
              url: await getSignedDocumentUrl(doc.key, { disposition: "inline", filename: doc.nombre, mimeType }),
              downloadUrl: await getSignedDocumentUrl(doc.key, { disposition: "attachment", filename: doc.nombre, mimeType }),
            };
          })
        );

        return { success: true, data: documentosConUrl };
      } catch (error) {
        console.error("Error al obtener documentos (client-by-id):", error);
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

        // url: previsualizar (inline). downloadUrl: descargar (attachment).
        // Un solo HEAD por documento (resolveDocumentMimeType), reutilizado
        // para firmar las dos URLs en vez de repetirlo.
        const documentosConUrl = await Promise.all(
          documentos.map(async (doc) => {
            const mimeType = await resolveDocumentMimeType(doc.key);
            return {
              ...doc,
              url: await getSignedDocumentUrl(doc.key, { disposition: "inline", filename: doc.nombre, mimeType }),
              downloadUrl: await getSignedDocumentUrl(doc.key, { disposition: "attachment", filename: doc.nombre, mimeType }),
            };
          })
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
  )

  // ============================================================
  // ESPEJO DE CONTRATOS DEL CRM
  // Los contratos de inversión se emiten en el CRM (que habla con WeeTrust) y
  // se copian acá para que la ficha del inversionista y el portal los vean
  // como un documento más. El CRM es el dueño del estado de firma; esto es la
  // copia con la que trabaja inversiones.
  // ============================================================

  // POST - Crear o reemplazar el documento de un contrato del CRM
  .post(
    "/investor-documents/contrato",
    async ({ body, set }) => {
      try {
        const {
          file,
          inversionista_id,
          contrato_id,
          nombre,
          tipo_contrato,
          weetrust_document_id,
          observer_url,
          firmantes,
          estado_firma,
          created_by,
          visible,
        } = body;

        const [investor] = await db
          .select()
          .from(inversionistas)
          .where(eq(inversionistas.inversionista_id, inversionista_id));

        if (!investor) {
          set.status = 404;
          return { success: false, message: "Inversionista no encontrado" };
        }

        // Puede llegar ya parseado (Elysia) o como texto, según cómo se arme el
        // multipart. Se acepta cualquiera de los dos.
        const firmantesParsed =
          typeof firmantes === "string"
            ? JSON.parse(firmantes)
            : (firmantes ?? null);
        const ahora = new Date();

        // ¿Ya teníamos este contrato? El espejo se vuelve a mandar cada vez que
        // se reemite el documento, y tiene que ocupar la misma fila.
        const [existente] = await db
          .select()
          .from(documentos_inversionista)
          .where(eq(documentos_inversionista.contrato_id, contrato_id));

        const key = await uploadDocumentoInversionista(file, inversionista_id);

        if (existente) {
          const [actualizado] = await db
            .update(documentos_inversionista)
            .set({
              key,
              nombre,
              tipo_contrato,
              weetrust_document_id: weetrust_document_id ?? null,
              observer_url: observer_url ?? null,
              firmantes: firmantesParsed,
              estado_firma: estado_firma ?? null,
              actualizado_at: ahora,
              // `visible` sólo se enciende, nunca se apaga: si alguien decidió
              // mostrarle un documento al inversionista desde la ficha, una
              // copia posterior no tiene por qué escondérselo otra vez.
              ...(visible ? { visible: true } : {}),
            })
            .where(eq(documentos_inversionista.documento_id, existente.documento_id))
            .returning();

          // El archivo viejo ya no lo apunta nadie. Si falla el borrado queda
          // huérfano en R2, que es molesto pero no rompe nada.
          if (existente.key !== key) {
            await deleteDocumentoFromR2(existente.key).catch((error) =>
              console.warn(
                `[espejo-contrato] no se pudo borrar ${existente.key}:`,
                error
              )
            );
          }

          return {
            success: true,
            message: "Contrato actualizado",
            data: { ...actualizado, url: await getSignedDocumentUrl(key) },
          };
        }

        const [documento] = await db
          .insert(documentos_inversionista)
          .values({
            inversionista_id,
            key,
            nombre,
            // Oculto mientras se firma: en el portal, el inversionista tiene
            // que ver el contrato que vale, no el borrador sin firmas. El CRM
            // lo enciende cuando lo firman todos.
            visible: visible ?? false,
            created_by: created_by || null,
            contrato_id,
            tipo_contrato,
            weetrust_document_id: weetrust_document_id ?? null,
            observer_url: observer_url ?? null,
            firmantes: firmantesParsed,
            estado_firma: estado_firma ?? null,
            actualizado_at: ahora,
          })
          .returning();

        return {
          success: true,
          message: "Contrato guardado",
          data: { ...documento, url: await getSignedDocumentUrl(key) },
        };
      } catch (error) {
        console.error("Error al guardar el contrato del CRM:", error);
        set.status = 500;
        return {
          success: false,
          message: "Error al guardar el contrato",
          error: error instanceof Error ? error.message : "Error desconocido",
        };
      }
    },
    {
      body: t.Object({
        file: t.File(),
        inversionista_id: t.Numeric(),
        contrato_id: t.String(),
        nombre: t.String(),
        tipo_contrato: t.String(),
        weetrust_document_id: t.Optional(t.String()),
        observer_url: t.Optional(t.String()),
        /**
         * Los firmantes, con su rol, su enlace y su estado.
         *
         * `t.Any()` y no `t.String()` porque el CRM los manda como JSON dentro
         * de un multipart, y Elysia lo parsea antes de validar: pedir un string
         * rechazaba el espejo entero con "el valor del campo no es válido".
         */
        firmantes: t.Optional(t.Any()),
        estado_firma: t.Optional(t.String()),
        created_by: t.Optional(t.String()),
        /** Si el inversionista lo ve en su portal. */
        visible: t.Optional(t.BooleanString()),
      }),
    }
  )

  // PATCH - Actualizar sólo el estado de firma de un contrato ya espejado
  .patch(
    "/investor-documents/contrato/:contratoId",
    async ({ params, body, set }) => {
      try {
        // Cómo estaba antes: el CRM lo usa para saber si esta es la primera vez
        // que el contrato queda firmado y toca reemplazar el PDF por el firmado.
        // Sin esto, cada consulta de estado de un contrato ya cerrado volvía a
        // pasear el archivo entero.
        const [previo] = await db
          .select({ estado_firma: documentos_inversionista.estado_firma })
          .from(documentos_inversionista)
          .where(eq(documentos_inversionista.contrato_id, params.contratoId));

        const [actualizado] = await db
          .update(documentos_inversionista)
          .set({
            observer_url: body.observer_url ?? null,
            firmantes: body.firmantes ?? null,
            estado_firma: body.estado_firma ?? null,
            actualizado_at: new Date(),
            // Igual que en la copia: sólo se enciende, nunca se apaga.
            ...(body.visible ? { visible: true } : {}),
          })
          .where(eq(documentos_inversionista.contrato_id, params.contratoId))
          .returning();

        // No es un error: el contrato puede no haberse espejado todavía (el CRM
        // guarda primero y copia después). Quien llama decide si reintenta.
        if (!actualizado) {
          return { success: true, espejado: false };
        }

        return {
          success: true,
          espejado: true,
          estadoAnterior: previo?.estado_firma ?? null,
          data: actualizado,
        };
      } catch (error) {
        console.error("Error al actualizar el estado del contrato:", error);
        set.status = 500;
        return {
          success: false,
          message: "Error al actualizar el estado del contrato",
          error: error instanceof Error ? error.message : "Error desconocido",
        };
      }
    },
    {
      params: t.Object({ contratoId: t.String() }),
      body: t.Object({
        observer_url: t.Optional(t.String()),
        firmantes: t.Optional(t.Any()),
        estado_firma: t.Optional(t.String()),
        /** Si el inversionista lo ve en su portal. Sólo para encenderlo. */
        visible: t.Optional(t.Boolean()),
      }),
    }
  );
