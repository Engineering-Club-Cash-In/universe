import { eq } from "drizzle-orm";
import { db } from "../database";
import { creditos, moras_credito } from "../database/db";
import * as readline from "readline";
import * as fs from "fs";
import * as iconv from "iconv-lite";
import Big from "big.js";


interface CreditoMora {
  numeroCredito: string;
  mora: boolean;
  cuotasAtrasadas: number;
    montoMora: number;
}
export const leerCreditosMora = async (filePath: string): Promise<CreditoMora[]> => {
  console.time("⏳ Lectura CSV créditos mora");
  
  // 🔧 FIX: Cambiar encoding a utf8
  const stream = fs.createReadStream(filePath).pipe(iconv.decodeStream("utf8"));
  const rl = readline.createInterface({ input: stream });
  
  let headers: string[] | null = null;
  const creditosConMora: CreditoMora[] = [];
  let saltados = 0;
  let totalProcesados = 0;
  
  // 🔍 DEBUG: Contador para ver valores reales
  let debugCount = 0;
  
  // 📊 Contadores por tipo de mora
  let mora30Count = 0;
  let mora60Count = 0;
  let mora90Count = 0;
  let mora120Count = 0;
  let negativosEncontrados = 0;
  
  for await (const linea of rl) {
    try {
      // Primera línea = headers
      if (!headers) {
        // 🔧 FIX: Usar ; como delimitador y limpiar BOM
        headers = linea
          .replace(/^\uFEFF/, '') // Remover BOM UTF-8
          .split(';')
          .map(h => h.trim());
        
        console.log("📋 Headers encontrados:", headers);
        console.log("🔍 Buscando columnas de mora...");
        
        // Verificar si existen las columnas esperadas
        const columnasMora = headers.filter(h => h.toLowerCase().includes('mora'));
        console.log("📊 Columnas que contienen 'mora':", columnasMora);
        
        continue;
      }
      
      totalProcesados++;
      // 🔧 FIX: Usar ; como delimitador
      const valores = linea.split(';').map(v => v.trim());
    
    // Crear objeto row
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = valores[index] || '';
    });
    
    const numeroCredito = row['# crédito SIFCO'];
    
    if (!numeroCredito) {
      saltados++;
      continue;
    }
    
   
    
    // 🔧 Leer capital para calcular mora
    // Limpiar: comas, "Q", espacios
    const limpiarNumero = (str: string): string => {
      return str?.replace(/,/g, '').replace(/Q/g, '').trim() || '0';
    };
    
    const capitalStr = limpiarNumero(row['Capital']);
    
    // Leer columnas de mora (pueden tener comas, "Q", y espacios)
    const mora30Str = limpiarNumero(row['mora 30 dias Q']);
    const mora60Str = limpiarNumero(row['mora 60 dias Q']);
    const mora90Str = limpiarNumero(row['mora 90 dias Q']);
    const mora120Str = limpiarNumero(row['MORA 120 dias Q']); // 🔧 Mayúscula!
    
    // 💎 Helper para convertir a Big manejando vacíos y negativos
    const toBigPositive = (str: string, campo: string): Big => {
      if (str === '' || str === undefined || str === null) return new Big(0);
      try {
        const val = new Big(str);
        // Si es negativo, registrar y retornar 0
        if (val.lt(0)) {
          negativosEncontrados++;
          if (debugCount < 5) {
            console.log(`   ⚠️  Valor negativo en "${campo}": ${str} → convertido a 0`);
          }
          return new Big(0);
        }
        return val;
      } catch {
        return new Big(0);
      }
    };
    
    const capital = toBigPositive(capitalStr, 'Capital');
    const mora30 = toBigPositive(mora30Str, 'mora 30 dias Q');
    const mora60 = toBigPositive(mora60Str, 'mora 60 dias Q');
    const mora90 = toBigPositive(mora90Str, 'mora 90 dias Q');
    const mora120 = toBigPositive(mora120Str, 'MORA 120 dias Q');
    
    let cuotasAtrasadas = 0;
    let tieneMora = false;
    
    if (mora120.gt(0)) {
      cuotasAtrasadas = 4;
      tieneMora = true;
      mora120Count++;
    } else if (mora90.gt(0)) {
      cuotasAtrasadas = 3;
      tieneMora = true;
      mora90Count++;
    } else if (mora60.gt(0)) {
      cuotasAtrasadas = 2;
      tieneMora = true;
      mora60Count++;
    } else if (mora30.gt(0)) {
      cuotasAtrasadas = 1;
      tieneMora = true;
      mora30Count++;
    }
    
    if (tieneMora) {
      // 💰 Calcular monto de mora: capital * 1.12% * cuotasAtrasadas
      const tasaMora = new Big('0.0112'); // 1.12%
      const montoMora = capital
        .times(tasaMora)
        .times(cuotasAtrasadas)
        .toFixed(2);
      
      creditosConMora.push({
        numeroCredito,
        mora: true,
        cuotasAtrasadas,
        montoMora: parseFloat(montoMora)
      });
    }
    
    } catch (error) {
      // 🛡️ Manejo de errores por fila
      console.error(`❌ Error procesando fila ${totalProcesados}:`, error instanceof Error ? error.message : error);
      saltados++;
    }
  }
  
  console.timeEnd("⏳ Lectura CSV créditos mora");
  console.log(`\n📊 Resumen:`);
  console.log(`   Total filas procesadas: ${totalProcesados}`);
  console.log(`   Créditos en mora encontrados: ${creditosConMora.length}`);
  console.log(`   Filas saltadas (sin # crédito): ${saltados}`);
  if (negativosEncontrados > 0) {
    console.log(`   ⚠️  Valores negativos convertidos a 0: ${negativosEncontrados}`);
  }
  console.log(`\n📈 Desglose por tipo de mora:`);
  console.log(`   🟡 Mora 30 días (1 cuota):  ${mora30Count}`);
  console.log(`   🟠 Mora 60 días (2 cuotas): ${mora60Count}`);
  console.log(`   🔴 Mora 90 días (3 cuotas): ${mora90Count}`);
  console.log(`   ⛔ Mora 120 días (4 cuotas): ${mora120Count}`);
  console.log(`   ➕ Total: ${mora30Count + mora60Count + mora90Count + mora120Count}`);
  
  return creditosConMora;
};

/**
 * Procesa los créditos en mora: actualiza el estado y crea registro de mora
 */
export const procesarCreditosMora = async (filePath: string) => {
  const creditosConMora = await leerCreditosMora(filePath);
  
  const resultados = {
    procesados: 0,
    actualizados: 0,
    insertados: 0,
    errores: 0,
    detalles: [] as any[]
  };

  for (const creditoMora of creditosConMora) {
    try {
      // 1. Buscar el crédito por número SIFCO
      const [credito] = await db
        .select()
        .from(creditos)
        .where(eq(creditos.numero_credito_sifco, creditoMora.numeroCredito))
        .limit(1);

      if (!credito) {
        resultados.errores++;
        resultados.detalles.push({
          numeroCredito: creditoMora.numeroCredito,
          error: 'Crédito no encontrado'
        });
        continue;
      }

      // 2. Actualizar estado del crédito a MOROSO
      await db
        .update(creditos)
        .set({ statusCredit: 'MOROSO' })
        .where(eq(creditos.credito_id, credito.credito_id));

      // 3. 🔥 UPSERT en moras_credito
      const [moraExistente] = await db
        .select()
        .from(moras_credito)
        .where(eq(moras_credito.credito_id, credito.credito_id))
        .limit(1);

      let accion = '';
      
      if (moraExistente) {
        // ✅ Ya existe → UPDATE
        await db
          .update(moras_credito)
          .set({
            cuotas_atrasadas: creditoMora.cuotasAtrasadas,
            monto_mora: creditoMora.montoMora.toString(),
            updated_at: new Date()
          })
          .where(eq(moras_credito.credito_id, credito.credito_id));
        
        resultados.actualizados++;
        accion = 'actualizado';
      } else {
        // ✅ No existe → INSERT
        await db
          .insert(moras_credito)
          .values({
            credito_id: credito.credito_id,
            cuotas_atrasadas: creditoMora.cuotasAtrasadas,
            monto_mora: creditoMora.montoMora.toString()
          });
        
        resultados.insertados++;
        accion = 'insertado';
      }

      resultados.procesados++;
      resultados.detalles.push({
        numeroCredito: creditoMora.numeroCredito,
        creditoId: credito.credito_id,
        cuotasAtrasadas: creditoMora.cuotasAtrasadas,
        montoMora: creditoMora.montoMora,
        accion,
        exito: true
      });

    } catch (error) {
      resultados.errores++;
      resultados.detalles.push({
        numeroCredito: creditoMora.numeroCredito,
        error: error instanceof Error ? error.message : 'Error desconocido'
      });
    }
  }

  console.log(`\n✅ Procesamiento completado:`);
  console.log(`   Total procesados: ${resultados.procesados}`);
  console.log(`   📝 Insertados: ${resultados.insertados}`);
  console.log(`   🔄 Actualizados: ${resultados.actualizados}`);
  console.log(`   ❌ Errores: ${resultados.errores}`);

  return resultados;
};