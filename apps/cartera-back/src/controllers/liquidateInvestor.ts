import { eq, and, lte, gte, sql } from "drizzle-orm";
import { db } from "../database";
import { usuarios, creditos, cuotas_credito } from "../database/db";

// 📊 INTERFACE PARA EL INPUT
interface LiquidarCuotasInput {
  nombre_usuario: string;
  cuota_mes: string;
}

// 📅 Función helper para convertir "oct. 25" a rango de fechas
function obtenerRangoDelMes(cuota_mes: string): { inicio: string; fin: string; mesDescriptivo: string } {
  const cleanInput = cuota_mes.trim().toLowerCase().replace(/\./g, '');
  
  const mesesMap: { [key: string]: number } = {
    'ene': 0, 'feb': 1, 'mar': 2, 'abr': 3,
    'may': 4, 'jun': 5, 'jul': 6, 'ago': 7,
    'sep': 8, 'oct': 9, 'nov': 10, 'dic': 11,
  };

  const partes = cleanInput.split(/\s+/);
  
  if (partes.length !== 2) {
    throw new Error(`Formato inválido: "${cuota_mes}". Esperado: "mes. año" (ej: "oct. 25")`);
  }

  const mesTexto = partes[0];
  let anio = parseInt(partes[1]);

  if (anio < 100) {
    anio += 2000;
  }

  const mesNumero = mesesMap[mesTexto];
  
  if (mesNumero === undefined) {
    throw new Error(`Mes no reconocido: "${mesTexto}". Use formato de 3 letras (ej: "oct", "ago")`);
  }

  const primerDia = new Date(anio, mesNumero, 1);
  const ultimoDia = new Date(anio, mesNumero + 1, 0);

  return {
    inicio: primerDia.toISOString().slice(0, 10),
    fin: ultimoDia.toISOString().slice(0, 10),
    mesDescriptivo: primerDia.toLocaleString('es-GT', { month: 'long', year: 'numeric' })
  };
}

// 🔥 ENDPOINT PRINCIPAL
export async function liquidarCuotasPorUsuario(input: LiquidarCuotasInput) {
  try {
    console.log("🔥 ========== INICIANDO LIQUIDACIÓN DE CUOTAS ==========");
    console.log("📝 Input:", JSON.stringify(input, null, 2));

    const { nombre_usuario, cuota_mes } = input;

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
    // 🆕 2.5️⃣ RESETEAR TODAS LAS CUOTAS DEL USUARIO
    // ============================================
    console.log("\n🔄 ========== RESETEANDO CUOTAS ==========");
    let totalCuotasReseteadas = 0;
    
    for (const credito of creditosUsuario) {
      console.log(`   🔄 Reseteando cuotas del crédito ${credito.numero_credito_sifco}...`);
      
      const cuotasReseteadas = await db
        .update(cuotas_credito)
        .set({
          liquidado_inversionistas: false,
          fecha_liquidacion_inversionistas: null,
        })
        .where(eq(cuotas_credito.credito_id, credito.credito_id))
        .returning();

      console.log(`   ✅ ${cuotasReseteadas.length} cuotas reseteadas`);
      totalCuotasReseteadas += cuotasReseteadas.length;
    }
    
    console.log(`✅ Total cuotas reseteadas: ${totalCuotasReseteadas}`);
    console.log("========================================\n");

    // ============================================
    // 3️⃣ CALCULAR RANGO DEL MES
    // ============================================
    const rangoMes = obtenerRangoDelMes(cuota_mes);
    console.log(`\n📅 ========== RANGO CALCULADO ==========`);
    console.log(`   Input original: "${cuota_mes}"`);
    console.log(`   Mes descriptivo: ${rangoMes.mesDescriptivo}`);
    console.log(`   Rango inicio: ${rangoMes.inicio}`);
    console.log(`   Rango fin: ${rangoMes.fin}`);
    console.log(`========================================\n`);

    // ============================================
    // 4️⃣ PROCESAR CADA CRÉDITO
    // ============================================
    const resultadosPorCredito = [];

    for (const credito of creditosUsuario) {
      console.log(`\n💳 ========== CRÉDITO: ${credito.numero_credito_sifco} ==========`);
      console.log(`   📅 Plazo: ${credito.plazo} meses`);
      console.log(`   🆔 ID: ${credito.credito_id}`);

      // 🔍 PRIMERO: Ver TODAS las cuotas del crédito
      console.log(`\n   📋 LISTANDO TODAS LAS CUOTAS DEL CRÉDITO:`);
      const todasLasCuotas = await db
        .select()
        .from(cuotas_credito)
        .where(eq(cuotas_credito.credito_id, credito.credito_id))
        .orderBy(cuotas_credito.numero_cuota);

      console.log(`   Total cuotas en BD: ${todasLasCuotas.length}`);
      
      // Mostrar solo las primeras 10 y las últimas 5 para no saturar logs
      if (todasLasCuotas.length > 15) {
        todasLasCuotas.slice(0, 10).forEach((c, idx) => {
          const liquidado = c.liquidado_inversionistas ? '✅ LIQ' : '❌ NO LIQ';
          console.log(
            `      ${idx + 1}. Cuota #${c.numero_cuota} | Vence: ${c.fecha_vencimiento} | ${liquidado}`
          );
        });
        console.log(`      ... (${todasLasCuotas.length - 15} cuotas más) ...`);
        todasLasCuotas.slice(-5).forEach((c, idx) => {
          const liquidado = c.liquidado_inversionistas ? '✅ LIQ' : '❌ NO LIQ';
          const numero = todasLasCuotas.length - 5 + idx + 1;
          console.log(
            `      ${numero}. Cuota #${c.numero_cuota} | Vence: ${c.fecha_vencimiento} | ${liquidado}`
          );
        });
      } else {
        todasLasCuotas.forEach((c, idx) => {
          const liquidado = c.liquidado_inversionistas ? '✅ LIQ' : '❌ NO LIQ';
          console.log(
            `      ${idx + 1}. Cuota #${c.numero_cuota} | Vence: ${c.fecha_vencimiento} | ${liquidado}`
          );
        });
      }

      // ============================================
      // 5️⃣ BUSCAR LA CUOTA QUE COINCIDE CON EL MES
      // ============================================
      console.log(`\n   🔍 BUSCANDO cuota que vence en ${cuota_mes}...`);
      console.log(`   🔍 Buscando entre ${rangoMes.inicio} y ${rangoMes.fin}`);

      const cuotaDelMes = await db
        .select()
        .from(cuotas_credito)
        .where(
          and(
            eq(cuotas_credito.credito_id, credito.credito_id),
            gte(cuotas_credito.fecha_vencimiento, rangoMes.inicio),
            lte(cuotas_credito.fecha_vencimiento, rangoMes.fin)
          )
        )
        .orderBy(cuotas_credito.numero_cuota);

      console.log(`   📊 Cuotas encontradas en el rango: ${cuotaDelMes.length}`);

      if (cuotaDelMes.length > 0) {
        console.log(`   🎯 Cuotas que coinciden con ${cuota_mes}:`);
        cuotaDelMes.forEach((c) => {
          console.log(`      - Cuota #${c.numero_cuota} | Vence: ${c.fecha_vencimiento}`);
        });
      }

      if (cuotaDelMes.length === 0) {
        console.log(`   ⚠️ NO SE ENCONTRÓ cuota que venza en ${cuota_mes}`);
        console.log(`   ⚠️ Revisá que las fechas de vencimiento estén en el rango correcto`);
        
        resultadosPorCredito.push({
          credito_id: credito.credito_id,
          numero_credito: credito.numero_credito_sifco,
          cuotas_liquidadas: 0,
          mensaje: `No hay cuota que venza en ${cuota_mes}`,
          debug: {
            rango_buscado: `${rangoMes.inicio} - ${rangoMes.fin}`,
            total_cuotas_credito: todasLasCuotas.length,
            primeras_fechas: todasLasCuotas.slice(0, 5).map(c => c.fecha_vencimiento),
            ultimas_fechas: todasLasCuotas.slice(-5).map(c => c.fecha_vencimiento)
          }
        });
        continue;
      }

      // Tomar la PRIMERA cuota del rango
      const cuotaEncontrada = cuotaDelMes[0];
      const numeroCuotaALiquidar = cuotaEncontrada.numero_cuota;

      console.log(`\n   ✅ CUOTA SELECCIONADA: #${numeroCuotaALiquidar}`);
      console.log(`      Vence: ${cuotaEncontrada.fecha_vencimiento}`);
      console.log(`      Liquidado: ${cuotaEncontrada.liquidado_inversionistas ? 'SÍ' : 'NO'}`);
      console.log(`\n   📊 LIQUIDANDO cuotas desde 1 hasta ${numeroCuotaALiquidar}...`);

      // ============================================
      // 6️⃣ LIQUIDAR HASTA ESA CUOTA
      // ============================================
      const cuotasALiquidar = await db
        .select()
        .from(cuotas_credito)
        .where(
          and(
            eq(cuotas_credito.credito_id, credito.credito_id),
            lte(cuotas_credito.numero_cuota, numeroCuotaALiquidar)
          )
        );

      console.log(`   🔍 Total cuotas hasta ${numeroCuotaALiquidar}: ${cuotasALiquidar.length}`);

      const cuotasNoLiquidadas = cuotasALiquidar.filter(
        (c) => c.liquidado_inversionistas === false || c.liquidado_inversionistas === null
      );
      
      console.log(`   🔍 Cuotas NO liquidadas: ${cuotasNoLiquidadas.length}`);

      if (cuotasNoLiquidadas.length > 0) {
        console.log(`   📝 Cuotas a actualizar:`);
        cuotasNoLiquidadas.forEach(c => {
          console.log(`      - Cuota #${c.numero_cuota} (vence: ${c.fecha_vencimiento})`);
        });
      }

      // Actualizar cuotas
      const resultado = await db
        .update(cuotas_credito)
        .set({
          liquidado_inversionistas: true,
          fecha_liquidacion_inversionistas: new Date(),
        })
        .where(
          and(
            eq(cuotas_credito.credito_id, credito.credito_id),
            lte(cuotas_credito.numero_cuota, numeroCuotaALiquidar),
            eq(cuotas_credito.liquidado_inversionistas, false)
          )
        )
        .returning();

      console.log(`   ✅ ${resultado.length} cuotas ACTUALIZADAS\n`);

      resultadosPorCredito.push({
        credito_id: credito.credito_id,
        numero_credito: credito.numero_credito_sifco,
        cuota_encontrada: numeroCuotaALiquidar,
        cuotas_liquidadas: resultado.length,
        cuotas_actualizadas: resultado.map(c => ({
          numero_cuota: c.numero_cuota,
          fecha_vencimiento: c.fecha_vencimiento
        }))
      });
    }

    // ============================================
    // 7️⃣ RESPUESTA FINAL
    // ============================================
    console.log("\n🎉 ========== LIQUIDACIÓN COMPLETADA ==========");
    console.log(`✅ Usuario: ${usuario.nombre}`);
    console.log(`✅ Créditos procesados: ${creditosUsuario.length}`);
    console.log(`✅ Cuotas reseteadas inicialmente: ${totalCuotasReseteadas}`);
    console.log(`✅ Mes liquidado: ${rangoMes.mesDescriptivo}`);

    const totalCuotasLiquidadas = resultadosPorCredito.reduce(
      (sum, r) => sum + r.cuotas_liquidadas, 0
    );

    console.log(`✅ Total cuotas liquidadas: ${totalCuotasLiquidadas}`);

    return {
      success: true,
      data: {
        usuario: {
          usuario_id: usuario.usuario_id,
          nombre: usuario.nombre,
        },
        creditos_procesados: creditosUsuario.length,
        cuotas_reseteadas: totalCuotasReseteadas,
        cuota_mes_liquidado: cuota_mes,
        rango_liquidado: rangoMes,
        total_cuotas_liquidadas: totalCuotasLiquidadas,
        detalle_por_credito: resultadosPorCredito,
      },
      message: `Liquidación completada exitosamente para ${usuario.nombre} - Mes: ${rangoMes.mesDescriptivo}`,
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