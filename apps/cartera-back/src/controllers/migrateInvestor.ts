import Big from "big.js";
import { db } from "../database";
import { creditos, creditos_inversionistas, inversionistas } from "../database/db";
import { eq, or, ilike, sql } from "drizzle-orm";

// ========================================
// TIPOS E INTERFACES
// ========================================

interface FilaExcelInversionista {
  CreditoSIFCO: string;
  Inversionista: string;
  Capital: number | string;
  porcentaje: number | string;
  PorcentajeCashIn?: number | string;
  PorcentajeInversionista?: number | string;
  Cuota?: number | string;
}

interface CreditoAgrupadoInversionistas {
  creditoBase: string;
  cliente: string;
  filas: FilaExcelInversionista[];
}

// ========================================
// FUNCIONES AUXILIARES: Normalización y Similitud
// ========================================

/**
 * Normaliza un nombre de forma MUY agresiva para matching
 */
const normalizarNombreAgresivo = (nombre: string): string => {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Quita tildes
    .replace(/[.,\-_()]/g, " ") // Reemplaza puntuación por espacios
    .replace(/\b(s\.?a\.?|sa|ltda|inc|corp|sociedad|anonima)\b/gi, "") // Quita sufijos corporativos
    .replace(/\s+/g, " ") // Múltiples espacios → uno solo
    .trim();
};

/**
 * Extrae las palabras clave del nombre (sin palabras comunes)
 */
const extraerPalabrasClave = (nombre: string): string[] => {
  const nombreNorm = normalizarNombreAgresivo(nombre);
  const palabrasComunes = new Set([
    "de", "del", "la", "los", "las", "el", 
    "y", "e", "o", "u"
  ]);
  
  return nombreNorm
    .split(" ")
    .filter(palabra => palabra.length > 2 && !palabrasComunes.has(palabra));
};

/**
 * Calcula la distancia de Levenshtein entre dos strings
 */
const calcularLevenshtein = (str1: string, str2: string): number => {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 100;

  const len1 = s1.length;
  const len2 = s2.length;

  if (len1 === 0) return len2 === 0 ? 100 : 0;
  if (len2 === 0) return 0;

  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  const similarity = ((maxLen - distance) / maxLen) * 100;

  return Math.round(similarity);
};

/**
 * Calcula similitud mejorada con matching por palabras MÁS FLEXIBLE
 */
const calcularSimilitudMejorada = (str1: string, str2: string): number => {
  const s1Norm = normalizarNombreAgresivo(str1);
  const s2Norm = normalizarNombreAgresivo(str2);

  console.log(`      🔎 Comparando: "${s1Norm}" <-> "${s2Norm}"`);

  // 1️⃣ Match exacto después de normalización
  if (s1Norm === s2Norm) {
    console.log(`      ✅ Match exacto: 100%`);
    return 100;
  }

  // 2️⃣ Uno contiene al otro completamente
  if (s1Norm.includes(s2Norm)) {
    const porcentaje = Math.round((s2Norm.length / s1Norm.length) * 100);
    console.log(`      ✅ "${s2Norm}" está contenido en "${s1Norm}": ${porcentaje}%`);
    return porcentaje;
  }
  
  if (s2Norm.includes(s1Norm)) {
    const porcentaje = Math.round((s1Norm.length / s2Norm.length) * 100);
    console.log(`      ✅ "${s1Norm}" está contenido en "${s2Norm}": ${porcentaje}%`);
    return porcentaje;
  }

  // 3️⃣ Matching por palabras clave (MÁS FLEXIBLE)
  const palabras1 = extraerPalabrasClave(str1);
  const palabras2 = extraerPalabrasClave(str2);

  console.log(`      📊 Palabras1: [${palabras1.join(", ")}]`);
  console.log(`      📊 Palabras2: [${palabras2.join(", ")}]`);

  if (palabras1.length === 0 || palabras2.length === 0) {
    return calcularLevenshtein(s1Norm, s2Norm);
  }

  // Contar coincidencias de palabras
  let palabrasCoincidentes = 0;
  
  for (const p1 of palabras1) {
    let mejorMatchPalabra = 0;
    
    for (const p2 of palabras2) {
      if (p1 === p2) {
        mejorMatchPalabra = Math.max(mejorMatchPalabra, 100);
        console.log(`      ✅ Palabra match exacto: "${p1}" = "${p2}"`);
      } else if (p1.includes(p2) || p2.includes(p1)) {
        const lenMenor = Math.min(p1.length, p2.length);
        const lenMayor = Math.max(p1.length, p2.length);
        const similitudParcial = (lenMenor / lenMayor) * 100;
        mejorMatchPalabra = Math.max(mejorMatchPalabra, similitudParcial);
        console.log(`      ⚡ Palabra match parcial: "${p1}" ~ "${p2}" → ${similitudParcial.toFixed(0)}%`);
      } else {
        const simPalabra = calcularLevenshtein(p1, p2);
        if (simPalabra >= 70) {
          mejorMatchPalabra = Math.max(mejorMatchPalabra, simPalabra);
          console.log(`      💡 Palabra similar: "${p1}" ~ "${p2}" → ${simPalabra}%`);
        }
      }
    }
    
    if (mejorMatchPalabra >= 70) {
      palabrasCoincidentes += (mejorMatchPalabra / 100);
    }
  }

  // Si al menos 1 palabra coincide bien, dar score alto
  if (palabrasCoincidentes >= 1) {
    const minPalabras = Math.min(palabras1.length, palabras2.length);
    const similitudPalabras = (palabrasCoincidentes / minPalabras) * 100;
    console.log(`      💰 Coincidencias: ${palabrasCoincidentes.toFixed(2)} de ${minPalabras} → ${similitudPalabras.toFixed(0)}%`);
    return Math.round(similitudPalabras);
  }

  // 4️⃣ Fallback a Levenshtein
  const similitudLevenshtein = calcularLevenshtein(s1Norm, s2Norm);
  console.log(`      📏 Levenshtein: ${similitudLevenshtein}%`);
  
  return similitudLevenshtein;
};

/**
 * 🔥 BUSCA INVERSIONISTA CON LIKE EN DB + FUZZY FALLBACK
 */
const buscarInversionistaConLike = async (
  nombreBuscado: string,
  todosInversionistas: Array<{ inversionista_id: number; nombre: string }>
): Promise<{ inversionista_id: number; nombre: string; similitud: number; metodo: string } | null> => {
  
  console.log(`\n   🔍 Buscando match para: "${nombreBuscado}"`);
  
  const palabrasClave = extraerPalabrasClave(nombreBuscado);
  console.log(`   📊 Palabras clave: [${palabrasClave.join(", ")}]`);

  // 1️⃣ ESTRATEGIA 1: LIKE con las palabras clave en BD
  if (palabrasClave.length > 0) {
    console.log(`   🎯 Intentando búsqueda con LIKE en BD...`);
    
    try {
      // Crear condiciones LIKE para cada palabra
      const likeConditions = palabrasClave.map(palabra => 
        ilike(inversionistas.nombre, `%${palabra}%`)
      );

      const resultadosLike = await db
        .select({
          inversionista_id: inversionistas.inversionista_id,
          nombre: inversionistas.nombre,
        })
        .from(inversionistas)
        .where(or(...likeConditions));

      console.log(`   📋 Encontrados ${resultadosLike.length} candidatos con LIKE`);

      if (resultadosLike.length > 0) {
        // Calcular similitud con cada resultado y elegir el mejor
        let mejorMatch: { inversionista_id: number; nombre: string; similitud: number } | null = null;

        for (const inv of resultadosLike) {
          const similitud = calcularSimilitudMejorada(nombreBuscado, inv.nombre);
          console.log(`   💡 Candidato LIKE: "${inv.nombre}" → ${similitud}%`);

          if (!mejorMatch || similitud > mejorMatch.similitud) {
            mejorMatch = {
              inversionista_id: inv.inversionista_id,
              nombre: inv.nombre,
              similitud: similitud,
            };
          }
        }

        if (mejorMatch && mejorMatch.similitud >= 50) {
          console.log(`   ✅ MEJOR MATCH (LIKE): "${mejorMatch.nombre}" → ${mejorMatch.similitud}%`);
          return { ...mejorMatch, metodo: "LIKE" };
        }
      }
    } catch (error) {
      console.error(`   ⚠️ Error en búsqueda LIKE:`, error);
    }
  }

  // 2️⃣ ESTRATEGIA 2: Fuzzy matching en memoria (FALLBACK)
  console.log(`   🔄 Intentando fuzzy matching en memoria...`);

  let mejorMatch: {
    inversionista_id: number;
    nombre: string;
    similitud: number;
  } | null = null;

  for (const inv of todosInversionistas) {
    const similitud = calcularSimilitudMejorada(nombreBuscado, inv.nombre);

    if (similitud >= 50) {
      if (!mejorMatch || similitud > mejorMatch.similitud) {
        mejorMatch = {
          inversionista_id: inv.inversionista_id,
          nombre: inv.nombre,
          similitud: similitud,
        };
        
        console.log(`   🎯 Candidato fuzzy: "${inv.nombre}" → ${similitud}%`);
      }
    }
  }

  if (mejorMatch) {
    console.log(`   ✅ MEJOR MATCH (FUZZY): "${mejorMatch.nombre}" → ${mejorMatch.similitud}%`);
    return { ...mejorMatch, metodo: "FUZZY" };
  }

  console.log(`   ❌ No se encontró match`);
  return null;
};

// ========================================
// FUNCIÓN AUXILIAR: Limpiar valores numéricos
// ========================================

const cleanNumericValue = (value: any): string => {
  if (value === null || value === undefined) return "0";

  return (
    String(value)
      .replace(/[Q$,()"\s]/g, "")
      .replace(/^-/, "")
      .trim() || "0"
  );
};

const toBigExcel = (value: any, defaultValue: string | number = "0"): Big => {
  try {
    const cleaned = cleanNumericValue(value);
    return new Big(cleaned || defaultValue);
  } catch {
    return new Big(defaultValue);
  }
};

// ========================================
// FUNCIÓN PRINCIPAL: Procesar inversionistas
// ========================================

export async function procesarInversionistasSoloExcel(
  creditoAgrupado: CreditoAgrupadoInversionistas
) {
  try {
    console.log("\n🔄 ========== PROCESANDO INVERSIONISTAS DESDE EXCEL ==========");
    console.log(`📋 Crédito Base: ${creditoAgrupado.creditoBase}`);
    console.log(`👤 Cliente: ${creditoAgrupado.cliente}`);
    console.log(`👥 Filas: ${creditoAgrupado.filas.length}`);

    if (!creditoAgrupado.filas || creditoAgrupado.filas.length === 0) {
      throw new Error(
        `❌ No se encontraron filas para ${creditoAgrupado.creditoBase}`
      );
    }

    // 1️⃣ Buscar el crédito en la BD
    console.log(`\n🔍 Buscando crédito ${creditoAgrupado.creditoBase}...`);
    
    const [creditoDB] = await db
      .select({
        credito_id: creditos.credito_id,
        numero_credito_sifco: creditos.numero_credito_sifco,
        porcentaje_interes: creditos.porcentaje_interes,
        capital: creditos.capital,
      })
      .from(creditos)
      .where(eq(creditos.numero_credito_sifco, creditoAgrupado.creditoBase))
      .limit(1);

    if (!creditoDB) {
      console.error(`❌ Crédito ${creditoAgrupado.creditoBase} NO existe en la BD`);
      return {
        success: false,
        creditoBase: creditoAgrupado.creditoBase,
        error: "Crédito no encontrado en base de datos",
        inversionistas_procesados: 0,
      };
    }

    console.log(`✅ Crédito encontrado: ID ${creditoDB.credito_id}`);
    console.log(`   Capital: Q${creditoDB.capital}`);
    console.log(`   Interés: ${creditoDB.porcentaje_interes}%`);

    // 2️⃣ Borrar inversionistas viejos
    console.log(`\n🗑️  Eliminando inversionistas existentes...`);
    
    const deletedCount = await db
      .delete(creditos_inversionistas)
      .where(eq(creditos_inversionistas.credito_id, creditoDB.credito_id));

    console.log(`✅ ${deletedCount.rowCount ?? 0} inversionistas eliminados`);

    // 3️⃣ Traer TODOS los inversionistas de la BD (para fuzzy fallback)
    console.log(`\n📋 Cargando todos los inversionistas de la BD...`);
    
    const todosInversionistas = await db
      .select({
        inversionista_id: inversionistas.inversionista_id,
        nombre: inversionistas.nombre,
      })
      .from(inversionistas);

    console.log(`✅ ${todosInversionistas.length} inversionistas cargados`);

    // 4️⃣ Mapear inversionistas desde Excel con búsqueda LIKE + fuzzy
    console.log(`\n👥 Mapeando inversionistas desde Excel (LIKE + Fuzzy)...`);
    
    const inversionistasData = [];
    const inversionistasNoEncontrados: string[] = [];
    const matchStats = { LIKE: 0, FUZZY: 0 };

    for (const fila of creditoAgrupado.filas) {
      const nombreInversionista = String(fila.Inversionista || "").trim();
      
      if (!nombreInversionista) {
        console.warn(`   ⚠️  Fila sin nombre de inversionista, saltando...`);
        continue;
      }

      console.log(`\n   📋 Procesando: "${nombreInversionista}"`);

      // 🔥 Búsqueda con LIKE + Fuzzy fallback
      const match = await buscarInversionistaConLike(
        nombreInversionista,
        todosInversionistas
      );

      if (!match) {
        console.error(`   ❌ No se encontró match para "${nombreInversionista}"`);
        inversionistasNoEncontrados.push(nombreInversionista);
        continue;
      }

      // 📊 Contar estadística de método usado
      matchStats[match.metodo as keyof typeof matchStats]++;

      // 🎯 Match encontrado
      if (match.similitud === 100) {
        console.log(`   ✅ Match perfecto (${match.metodo}): "${match.nombre}" (ID: ${match.inversionista_id})`);
      } else {
        console.log(`   🔍 Match (${match.metodo}) ${match.similitud}%: "${nombreInversionista}" → "${match.nombre}" (ID: ${match.inversionista_id})`);
      }

      // Calcular montos
      const montoAportado = toBigExcel(fila.Capital, "0");
      
      // 🔥 LOS PORCENTAJES YA VIENEN EN DECIMAL DEL EXCEL (0.2, 0.8)
      const porcentajeCashIn = toBigExcel(fila.PorcentajeCashIn || 0, "0");
      const porcentajeInversion = toBigExcel(fila.PorcentajeInversionista || 0, "0");
      const interes = new Big(creditoDB.porcentaje_interes || 0);

      console.log(`   💰 Monto Aportado: Q${montoAportado.toString()}`);
      console.log(`   📊 % Cash-In (decimal): ${porcentajeCashIn.toString()}`);
      console.log(`   📊 % Inversionista (decimal): ${porcentajeInversion.toString()}`);

      // Calcular cuota de interés del inversionista
      const newCuotaInteres = montoAportado.times(interes.div(100));

      // 🔥 FIX CRÍTICO: NO DIVIDIR ENTRE 100 PORQUE YA SON DECIMALES
      // Excel viene: 0.2 (20%) y 0.8 (80%)
      // Antes: cuotaInteres × 0.8 ÷ 100 = ERROR ❌
      // Ahora: cuotaInteres × 0.8 = CORRECTO ✅
      const montoInversionista = newCuotaInteres
        .times(porcentajeInversion)  // 234.95 × 0.8 = 187.96 ✅
        .round(2);
        
      const montoCashIn = newCuotaInteres
        .times(porcentajeCashIn)  // 234.95 × 0.2 = 46.99 ✅
        .round(2);

      // Calcular IVAs
      const ivaInversionista = montoInversionista.gt(0)
        ? montoInversionista.times(0.12).round(2)
        : new Big(0);
        
      const ivaCashIn = montoCashIn.gt(0)
        ? montoCashIn.times(0.12).round(2)
        : new Big(0);

      // Cuota del inversionista
      const cuotaInv = fila.Cuota
        ? toBigExcel(fila.Cuota, "0")
        : new Big(0);

      console.log(`   💵 Monto Inversionista: Q${montoInversionista.toString()}`);
      console.log(`   💸 Monto Cash-In: Q${montoCashIn.toString()}`);
      console.log(`   📊 IVA Inversionista: Q${ivaInversionista.toString()}`);
      console.log(`   📊 IVA Cash-In: Q${ivaCashIn.toString()}`);
      console.log(`   🎯 Cuota: Q${cuotaInv.toString()}`);

      // 🔥 CONVERTIR PORCENTAJES A FORMATO ENTERO PARA BD (0.2 → 20, 0.8 → 80)
      const porcentajeCashInParaBD = porcentajeCashIn.times(100).toString();
      const porcentajeInversionParaBD = porcentajeInversion.times(100).toString();

      console.log(`   💾 % Cash-In para BD: ${porcentajeCashInParaBD}`);
      console.log(`   💾 % Inversionista para BD: ${porcentajeInversionParaBD}`);

      inversionistasData.push({
        credito_id: creditoDB.credito_id,
        inversionista_id: match.inversionista_id,
        monto_aportado: montoAportado.toFixed(2),
        // 🔥 GUARDAR COMO ENTEROS (20, 80) NO DECIMALES (0.20, 0.80)
        porcentaje_cash_in: porcentajeCashInParaBD,
        porcentaje_participacion_inversionista: porcentajeInversionParaBD,
        monto_inversionista: montoInversionista.toFixed(2),
        monto_cash_in: montoCashIn.toFixed(2),
        iva_inversionista: ivaInversionista.toFixed(2),
        iva_cash_in: ivaCashIn.toFixed(2),
        fecha_creacion: new Date(),
        cuota_inversionista: cuotaInv.toFixed(2),
      });
    }

    // 5️⃣ Mostrar estadísticas de matching
    console.log(`\n📊 ========== ESTADÍSTICAS DE MATCHING ==========`);
    console.log(`   🎯 Matches por LIKE: ${matchStats.LIKE}`);
    console.log(`   🔍 Matches por FUZZY: ${matchStats.FUZZY}`);
    console.log(`   ✅ Total exitosos: ${inversionistasData.length}`);
    console.log(`   ❌ No encontrados: ${inversionistasNoEncontrados.length}`);

    // 6️⃣ Validar si hubo inversionistas no encontrados
    if (inversionistasNoEncontrados.length > 0) {
      console.warn(`\n⚠️  INVERSIONISTAS NO ENCONTRADOS:`);
      inversionistasNoEncontrados.forEach((nombre) => {
        console.warn(`   - "${nombre}"`);
      });
    }

    // 7️⃣ Insertar todos los inversionistas
    console.log(`\n💾 Insertando ${inversionistasData.length} inversionistas...`);
    
    if (inversionistasData.length === 0) {
      console.warn(`⚠️  No hay inversionistas válidos para insertar`);
      return {
        success: false,
        creditoBase: creditoAgrupado.creditoBase,
        error: "No se encontraron inversionistas válidos",
        inversionistas_procesados: 0,
        inversionistas_no_encontrados: inversionistasNoEncontrados,
      };
    }

    await db.insert(creditos_inversionistas).values(inversionistasData);

    console.log(`✅ ${inversionistasData.length} inversionistas insertados exitosamente`);
    console.log(`\n✅ ========== PROCESO COMPLETADO ==========\n`);

    return {
      success: true,
      creditoBase: creditoAgrupado.creditoBase,
      cliente: creditoAgrupado.cliente,
      credito_id: creditoDB.credito_id,
      inversionistas_procesados: inversionistasData.length,
      inversionistas_eliminados: deletedCount.rowCount ?? 0,
      inversionistas_no_encontrados: inversionistasNoEncontrados,
      match_stats: matchStats,
      detalles: inversionistasData.map(inv => ({
        inversionista_id: inv.inversionista_id,
        monto_aportado: inv.monto_aportado,
        porcentaje_cash_in: inv.porcentaje_cash_in,
      })),
    };

  } catch (error) {
    console.error("\n❌ ========== ERROR PROCESANDO INVERSIONISTAS ==========");
    console.error(error);
    console.error("❌ ========== FIN ERROR ==========\n");
    
    throw error;
  }
}