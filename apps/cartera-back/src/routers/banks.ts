// routes/bancos.ts
import { Elysia, t } from "elysia";
import { eq, isNotNull } from 'drizzle-orm';
import { db } from '../database';
import { bancos } from '../database/db';
import { authMiddleware } from "./midleware";

export const bancosRouter = new Elysia()
  .use(authMiddleware)

  // 📋 GET - Obtener todos los bancos
  .get("/bancos", async ({ query }) => {
    try {
      const soloConTransferencia = query.con_transferencia === "true";

      const baseQuery = db.select().from(bancos);
      const todosBancos = soloConTransferencia
        ? await baseQuery
            .where(isNotNull(bancos.id_banco_transferencia))
            .orderBy(bancos.nombre)
        : await baseQuery.orderBy(bancos.nombre);

      return {
        success: true,
        data: todosBancos,
      };
    } catch (error) {
      console.error('Error al obtener bancos:', error);
      return {
        success: false,
        message: 'Error al obtener bancos',
        error: error instanceof Error ? error.message : 'Error desconocido',
      };
    }
  }, {
    query: t.Object({
      con_transferencia: t.Optional(t.String()),
    }),
  })
  
  // ✨ POST - Crear nuevo banco
  .post("/bancos", async ({ body }) => {
    try {
      const { nombre } = body;

      if (!nombre || nombre.trim() === '') {
        return {
          success: false,
          message: 'El nombre del banco es requerido',
        };
      }

      const [nuevoBanco] = await db
        .insert(bancos)
        .values({
          nombre: nombre.trim(),
        })
        .returning();

      return {
        success: true,
        message: 'Banco creado exitosamente',
        data: nuevoBanco,
      };
    } catch (error) {
      console.error('Error al crear banco:', error);
      return {
        success: false,
        message: 'Error al crear banco',
        error: error instanceof Error ? error.message : 'Error desconocido',
      };
    }
  }, {
    body: t.Object({
      nombre: t.String(),
    }),
  })
  
  // ✏️ PUT - Actualizar banco
  .put("/bancos/:id", async ({ params, body }) => {
    try {
      const { id } = params;
      const { nombre } = body;

      if (!nombre || nombre.trim() === '') {
        return {
          success: false,
          message: 'El nombre del banco es requerido',
        };
      }

      const [bancoActualizado] = await db
        .update(bancos)
        .set({
          nombre: nombre.trim(),
          updatedAt: new Date(),
        })
        .where(eq(bancos.banco_id, Number(id)))
        .returning();

      if (!bancoActualizado) {
        return {
          success: false,
          message: 'Banco no encontrado',
        };
      }

      return {
        success: true,
        message: 'Banco actualizado exitosamente',
        data: bancoActualizado,
      };
    } catch (error) {
      console.error('Error al actualizar banco:', error);
      return {
        success: false,
        message: 'Error al actualizar banco',
        error: error instanceof Error ? error.message : 'Error desconocido',
      };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      nombre: t.String(),
    }),
  })
  
  // 🗑️ DELETE - Eliminar banco
  .delete("/bancos/:id", async ({ params }) => {
    try {
      const { id } = params;

      const [bancoEliminado] = await db
        .delete(bancos)
        .where(eq(bancos.banco_id, Number(id)))
        .returning();

      if (!bancoEliminado) {
        return {
          success: false,
          message: 'Banco no encontrado',
        };
      }

      return {
        success: true,
        message: 'Banco eliminado exitosamente',
        data: bancoEliminado,
      };
    } catch (error) {
      console.error('Error al eliminar banco:', error);
      return {
        success: false,
        message: 'Error al eliminar banco',
        error: error instanceof Error ? error.message : 'Error desconocido',
      };
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
  });