import { eq, and, lte, sql } from "drizzle-orm";
import { db } from "../database";
import { usuarios, creditos, cuotas_credito } from "../database/db";

// 📊 INTERFACE PARA EL INPUT
interface LiquidarCuotasInput {
  nombre_usuario: string; // Nombre del usuario a buscar
  meses_liquidar: number; // Hasta qué cuota marcar como liquidada
}

// 🔥 ENDPOINT PRINCIPAL
export async function liquidarCuotasPorUsuario(input: LiquidarCuotasInput) {
  try {
    console.log("🔥 ========== INICIANDO LIQUIDACIÓN DE CUOTAS ==========");
    console.log("📝 Input:", JSON.stringify(input, null, 2));

    const { nombre_usuario, meses_liquidar } = input;

    // ============================================
    // 1️⃣ BUSCAR USUARIO CON BÚSQUEDA PERMISIVA
    // ============================================
    console.log("✅ Paso 1: Buscando usuario...");
    console.log("🔍 Nombre a buscar:", nombre_usuario);

    const usuariosEncontrados = await db
      .select()
      .from(usuarios)
      .where(
        sql`LOWER(${usuarios.nombre}) LIKE LOWER(${"%" + nombre_usuario + "%"})`
      );

    console.log(`✅ ${usuariosEncontrados.length} usuarios encontrados`);

    if (usuariosEncontrados.length === 0) {
      throw new Error(
        `No se encontró ningún usuario con nombre: ${nombre_usuario}`
      );
    }

    if (usuariosEncontrados.length > 1) {
      console.log("⚠️ Múltiples usuarios encontrados:");
      usuariosEncontrados.forEach((u) => {
        console.log(`   - ${u.nombre} (ID: ${u.usuario_id})`);
      });
      throw new Error(
        `Se encontraron ${usuariosEncontrados.length} usuarios. Especificá mejor el nombre.`
      );
    }

    const usuario = usuariosEncontrados[0];
    console.log(
      "✅ Usuario encontrado:",
      usuario.nombre,
      `(ID: ${usuario.usuario_id})`
    );

    // ============================================
    // 2️⃣ BUSCAR CRÉDITOS DEL USUARIO
    // ============================================
    console.log("✅ Paso 2: Buscando créditos del usuario...");

    const creditosUsuario = await db
      .select()
      .from(creditos)
      .where(eq(creditos.usuario_id, usuario.usuario_id));

    console.log(`✅ ${creditosUsuario.length} créditos encontrados`);

    if (creditosUsuario.length === 0) {
      throw new Error(`El usuario ${usuario.nombre} no tiene créditos`);
    }

    // ============================================
    // 3️⃣ PROCESAR CADA CRÉDITO
    // ============================================
    let resultado;

    for (const credito of creditosUsuario) {
      console.log(`\n💳 Procesando crédito: ${credito.numero_credito_sifco}`);
      console.log(`   📅 Plazo: ${credito.plazo} meses`);

      // Validar que no se exceda el plazo
      if (meses_liquidar > credito.plazo) {
        console.log(
          `   ⚠️ Se pidió liquidar ${meses_liquidar} meses pero el crédito solo tiene ${credito.plazo} meses`
        );
      }

      // ============================================
      // 4️⃣ MARCAR CUOTAS COMO LIQUIDADAS
      // ============================================
      console.log(
        `   ✅ Marcando cuotas hasta la ${meses_liquidar} como liquidadas...`
      );

      const cuotasExistentes = await db
        .select()
        .from(cuotas_credito)
        .where(eq(cuotas_credito.credito_id, credito.credito_id));

      console.log(`   🔍 Total cuotas del crédito: ${cuotasExistentes.length}`);

      if (cuotasExistentes.length > 0) {
        console.log(`   🔍 Primera cuota:`, cuotasExistentes[0]);

        const cuotasNoLiquidadas = cuotasExistentes.filter(
          (c) =>
            c.liquidado_inversionistas === false ||
            c.liquidado_inversionistas === null
        );
        console.log(`   🔍 Cuotas NO liquidadas: ${cuotasNoLiquidadas.length}`);

        const cuotasHastaLimite = cuotasNoLiquidadas.filter(
          (c) => c.numero_cuota <= meses_liquidar
        );
        console.log(
          `   🔍 Cuotas <= ${meses_liquidar}: ${cuotasHastaLimite.length}`
        );
      }

      // Luego sí el UPDATE...
        resultado = await db
        .update(cuotas_credito)
        .set({
          liquidado_inversionistas: true,
          fecha_liquidacion_inversionistas: new Date(),
        })
        .where(
          and(
            eq(cuotas_credito.credito_id, credito.credito_id),
            lte(cuotas_credito.numero_cuota, meses_liquidar),
            eq(cuotas_credito.liquidado_inversionistas, false)
          )
        )
        .returning();

         
    }

    // ============================================
    // 5️⃣ RESPUESTA FINAL
    // ============================================
    console.log("\n🎉 ========== LIQUIDACIÓN COMPLETADA ==========");
    console.log(`✅ Usuario: ${usuario.nombre}`);
    console.log(`✅ Créditos procesados: ${creditosUsuario.length}`);
    console.log(`✅ Cuotas liquidadas hasta: ${meses_liquidar}`);

    return {
      success: true,
      data: {
        usuario: {
          usuario_id: usuario.usuario_id,
          nombre: usuario.nombre,
        },
        creditos_procesados: creditosUsuario.length,
        meses_liquidados: meses_liquidar,
        resultados: resultado,
      },
      message: `Liquidación completada exitosamente para ${usuario.nombre}`,
    };
  } catch (error) {
    console.error("❌ Error en liquidación de cuotas:", error);
    return {
      success: false,
      data: null,
      message: error instanceof Error ? error.message : "Error desconocido",
      error: error,
    };
  }
}
