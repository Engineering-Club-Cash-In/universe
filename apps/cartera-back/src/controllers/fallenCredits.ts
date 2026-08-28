import { db } from "../database/index";
import {
  creditos,
  creditos_caidos,
  cuotas_credito,
  pagos_credito,
  usuarios,
  asesores,
  StatusCredit,
} from "../database/db/schema";
import { and, eq, sql, ne, desc, gte, lte } from "drizzle-orm";

/**
 * Marca un crédito como CAIDO:
 * 1. Cambia el status a CAIDO
 * 2. Elimina cuotas (excepto cuota 0)
 * 3. Elimina pagos (excepto los de cuota 0)
 * 4. Registra el motivo en creditos_caidos
 */
export async function marcarCreditoComoCaido({
  credito_id,
  motivo,
  observaciones,
}: {
  credito_id: number;
  motivo: string;
  observaciones?: string;
}) {
  // Verificar que el crédito existe
  const [credito] = await db
    .select()
    .from(creditos)
    .where(eq(creditos.credito_id, credito_id))
    .limit(1);

  if (!credito) {
    return { success: false, message: "Crédito no encontrado." };
  }

  if (credito.statusCredit === StatusCredit.CAIDO) {
    return { success: false, message: "El crédito ya está marcado como CAIDO." };
  }

  // Obtener la cuota 0 para excluirla
  const [cuota0] = await db
    .select({ cuota_id: cuotas_credito.cuota_id })
    .from(cuotas_credito)
    .where(
      and(
        eq(cuotas_credito.credito_id, credito_id),
        eq(cuotas_credito.numero_cuota, 0)
      )
    )
    .limit(1);

  const cuota0Id = cuota0?.cuota_id;

  return await db.transaction(async (tx) => {
    // 1. Eliminar pagos (excepto los de cuota 0)
    if (cuota0Id) {
      await tx
        .delete(pagos_credito)
        .where(
          and(
            eq(pagos_credito.credito_id, credito_id),
            ne(pagos_credito.cuota_id, cuota0Id)
          )
        );
    } else {
      // Si no hay cuota 0, eliminar todos los pagos
      await tx
        .delete(pagos_credito)
        .where(eq(pagos_credito.credito_id, credito_id));
    }

    // 2. Eliminar cuotas (excepto cuota 0)
    await tx
      .delete(cuotas_credito)
      .where(
        and(
          eq(cuotas_credito.credito_id, credito_id),
          ne(cuotas_credito.numero_cuota, 0)
        )
      );

    // 3. Cambiar status a CAIDO
    await tx
      .update(creditos)
      .set({ statusCredit: StatusCredit.CAIDO })
      .where(eq(creditos.credito_id, credito_id));

    // 4. Registrar en creditos_caidos
    const [registro] = await tx
      .insert(creditos_caidos)
      .values({
        credit_id: credito_id,
        motivo,
        observaciones: observaciones || null,
      })
      .returning();

    return {
      success: true,
      message: "Crédito marcado como CAIDO exitosamente.",
      data: registro,
    };
  });
}

/**
 * Obtener créditos caídos con filtros opcionales
 */
export async function getCreditosCaidos({
  page = 1,
  perPage = 10,
  numero_credito_sifco,
  fecha_desde,
  fecha_hasta,
}: {
  page?: number;
  perPage?: number;
  numero_credito_sifco?: string;
  fecha_desde?: string;
  fecha_hasta?: string;
}) {
  const offset = (page - 1) * perPage;
  const conditions: any[] = [eq(creditos.statusCredit, StatusCredit.CAIDO)];

  if (numero_credito_sifco && numero_credito_sifco.trim().length > 0) {
    conditions.push(eq(creditos.numero_credito_sifco, numero_credito_sifco.trim()));
  }

  if (fecha_desde) {
    conditions.push(gte(creditos_caidos.fecha_caida, new Date(fecha_desde)));
  }

  if (fecha_hasta) {
    // Agregar un día para incluir todo el día final
    const hasta = new Date(fecha_hasta);
    hasta.setDate(hasta.getDate() + 1);
    conditions.push(lte(creditos_caidos.fecha_caida, hasta));
  }

  const data = await db
    .select({
      credito: creditos,
      usuario: usuarios,
      asesor: asesores,
      caido: creditos_caidos,
    })
    .from(creditos_caidos)
    .innerJoin(creditos, eq(creditos_caidos.credit_id, creditos.credito_id))
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
    .where(and(...conditions))
    .orderBy(desc(creditos_caidos.fecha_caida))
    .limit(perPage)
    .offset(offset);

  // Count
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(creditos_caidos)
    .innerJoin(creditos, eq(creditos_caidos.credit_id, creditos.credito_id))
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
    .where(and(...conditions));

  return {
    data,
    page,
    perPage,
    totalCount: count,
    totalPages: Math.ceil(count / perPage),
  };
}
