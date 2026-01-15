import Big from "big.js";
import { db } from "../database";
import { creditos, creditos_inversionistas, inversionistas } from "../database/db";
import { eq, or, ilike } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";

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

interface InversionistaNoEncontrado {
  nombreExcel: string;
  creditoSIFCO: string;
  cliente: string;
  capital: string;
  timestamp: string;
  candidatosCercanos?: Array<{
    nombre: string;
    similitud: number;
    inversionista_id: number;
  }>;
}

interface ErrorPorcentaje {
  creditoSIFCO: string;
  cliente: string;
  inversionistas: Array<{
    nombre: string;
    porcentajeCashIn: string;
    porcentajeInversionista: string;
  }>;
  sumaTotal: string;
  diferencia: string;
  timestamp: string;
  razon: string;
}

// ========================================
// GUARDAR CSV
// ========================================

async function guardarCSV(
  inversionistas: InversionistaNoEncontrado[],
  filepath: string
): Promise<void> {
  try {
    const headers = [
      'Nombre Excel',
      'Crédito SIFCO',
      'Cliente',
      'Capital',
      'Candidato 1',
      'Similitud 1',
      'ID 1',
      'Candidato 2',
      'Similitud 2',
      'ID 2',
      'Candidato 3',
      'Similitud 3',
      'ID 3',
      'Fecha/Hora'
    ];

    const rows = inversionistas.map(inv => {
      const candidatos = inv.candidatosCercanos || [];
      return [
        inv.nombreExcel,
        inv.creditoSIFCO,
        inv.cliente,
        inv.capital,
        candidatos[0]?.nombre || '',
        candidatos[0]?.similitud.toFixed(1) || '',
        candidatos[0]?.inversionista_id || '',
        candidatos[1]?.nombre || '',
        candidatos[1]?.similitud.toFixed(1) || '',
        candidatos[1]?.inversionista_id || '',
        candidatos[2]?.nombre || '',
        candidatos[2]?.similitud.toFixed(1) || '',
        candidatos[2]?.inversionista_id || '',
        new Date(inv.timestamp).toLocaleString('es-GT')
      ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    await fs.writeFile(filepath, csv, 'utf-8');
    console.log(`   ✅ CSV actualizado: ${filepath}`);
  } catch (error) {
    console.error(`❌ Error guardando CSV:`, error);
    throw error;
  }
}

// ========================================
// GUARDAR CSV DE ERRORES DE PORCENTAJES
// ========================================

async function guardarCSVPorcentajes(
  errores: ErrorPorcentaje[],
  filepath: string
): Promise<void> {
  try {
    const headers = [
      'Crédito SIFCO',
      'Cliente',
      'Suma Total %',
      'Diferencia %',
      'Razón',
      'Inversionistas (Nombre | % CashIn | % Inv)',
      'Fecha/Hora'
    ];

    const rows = errores.map(err => {
      const invsString = err.inversionistas
        .map(i => `${i.nombre} | ${i.porcentajeCashIn}% | ${i.porcentajeInversionista}%`)
        .join(' || ');
      
      return [
        err.creditoSIFCO,
        err.cliente,
        err.sumaTotal,
        err.diferencia,
        err.razon,
        invsString,
        new Date(err.timestamp).toLocaleString('es-GT')
      ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    await fs.writeFile(filepath, csv, 'utf-8');
    console.log(`   ✅ CSV de porcentajes actualizado: ${filepath}`);
  } catch (error) {
    console.error(`❌ Error guardando CSV de porcentajes:`, error);
    throw error;
  }
}

// ========================================
// FUNCIONES AUXILIARES: Normalización y Similitud
// ========================================

const normalizarNombre = (nombre: string): string => {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,\-_()]/g, " ")
    .replace(/\b(s\.?a\.?|sa|ltda|inc|corp|sociedad|anonima)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
};

const extraerPalabrasClave = (nombre: string): string[] => {
  const nombreNorm = normalizarNombre(nombre);
  const palabrasComunes = new Set([
    "de", "del", "la", "los", "las", "el", 
    "y", "e", "o", "u", "con", "por"
  ]);
  
  return nombreNorm
    .split(" ")
    .filter(palabra => palabra.length > 2 && !palabrasComunes.has(palabra));
};

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

function calcularSimilitud(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  if (s1 === s2) return 100;
  
  const len1 = s1.length;
  const len2 = s2.length;
  
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
  
  const maxLen = Math.max(len1, len2);
  const distance = matrix[len1][len2];
  const similarity = ((maxLen - distance) / maxLen) * 100;
  
  return Math.max(0, similarity);
}

// 🔥 NUEVA: Similitud por tokens
const calcularSimilitudTokens = (str1: string, str2: string): number => {
  const tokens1 = extraerPalabrasClave(str1);
  const tokens2 = extraerPalabrasClave(str2);
  
  if (tokens1.length === 0 || tokens2.length === 0) return 0;
  
  let matches = 0;
  const tokensUsados = new Set<number>();
  
  for (const token1 of tokens1) {
    for (let i = 0; i < tokens2.length; i++) {
      if (tokensUsados.has(i)) continue;
      
      const token2 = tokens2[i];
      const tokenSimilitud = calcularLevenshtein(token1, token2);
      
      if (tokenSimilitud >= 85) {
        matches++;
        tokensUsados.add(i);
        break;
      }
    }
  }
  
  const totalTokens = Math.max(tokens1.length, tokens2.length);
  let similitud = (matches / totalTokens) * 100;
  
  // Bonus por tokens importantes
  if (tokens1.length > 0 && tokens2.length > 0) {
    if (calcularLevenshtein(tokens1[0], tokens2[0]) >= 80) {
      similitud += 15;
    }
    
    const ultimo1 = tokens1[tokens1.length - 1];
    const ultimo2 = tokens2[tokens2.length - 1];
    if (calcularLevenshtein(ultimo1, ultimo2) >= 80) {
      similitud += 15;
    }
  }
  
  return Math.min(100, similitud);
};

// ========================================
// BÚSQUEDA INTELIGENTE MEJORADA
// ========================================

const buscarInversionistaInteligente = async (
  nombreBuscado: string,
  todosInversionistas: Array<{ inversionista_id: number; nombre: string }>
): Promise<{ 
  inversionista_id: number; 
  nombre: string; 
  similitud: number; 
  metodo: string;
  candidatosCercanos?: Array<{ nombre: string; similitud: number; inversionista_id: number }>;
} | null> => {
  
  console.log(`\n   🔍 Buscando match para: "${nombreBuscado}"`);
  
  const nombreNorm = normalizarNombre(nombreBuscado);
  const palabrasClave = extraerPalabrasClave(nombreBuscado);
  console.log(`   📊 Palabras clave: [${palabrasClave.join(", ")}]`);

  let candidatosCercanos: Array<{ nombre: string; similitud: number; inversionista_id: number }> = [];

  // 0️⃣ EXACT match
  console.log(`   📍 Estrategia 0: Match exacto...`);
  for (const inv of todosInversionistas) {
    if (normalizarNombre(inv.nombre) === nombreNorm) {
      console.log(`   ✅ EXACT match: "${inv.nombre}"`);
      return {
        inversionista_id: inv.inversionista_id,
        nombre: inv.nombre,
        similitud: 100,
        metodo: "EXACT"
      };
    }
  }

  // 1️⃣ TOKEN match (⭐ MEJOR PARA "Jose Massis", "Diego Furlan")
  console.log(`   📍 Estrategia 1: Similitud por tokens...`);
  
  const candidatosTokens = todosInversionistas
    .map(inv => ({
      ...inv,
      similitud: calcularSimilitudTokens(nombreBuscado, inv.nombre),
      tokens: extraerPalabrasClave(inv.nombre)
    }))
    .filter(c => c.similitud >= 50)
    .sort((a, b) => b.similitud - a.similitud);
  
  if (candidatosTokens.length > 0) {
    const mejor = candidatosTokens[0];
    
    console.log(`   ✅ TOKEN match: "${mejor.nombre}" (${mejor.similitud.toFixed(1)}%)`);
    console.log(`      Tokens origen: [${palabrasClave.join(", ")}]`);
    console.log(`      Tokens match: [${mejor.tokens.join(", ")}]`);
    
    candidatosCercanos = candidatosTokens.slice(0, 5).map(c => ({
      nombre: c.nombre,
      similitud: c.similitud,
      inversionista_id: c.inversionista_id
    }));
    
    if (mejor.similitud >= 60) {
      return {
        inversionista_id: mejor.inversionista_id,
        nombre: mejor.nombre,
        similitud: mejor.similitud,
        metodo: "TOKEN",
        candidatosCercanos
      };
    }
  }

  // 2️⃣ LIKE en BD
  if (palabrasClave.length > 0) {
    console.log(`   📍 Estrategia 2: LIKE en BD...`);
    
    try {
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
        let mejorMatch: { inversionista_id: number; nombre: string; similitud: number } | null = null;

        for (const inv of resultadosLike) {
          const simLevenshtein = calcularSimilitud(nombreBuscado, inv.nombre);
          const simTokens = calcularSimilitudTokens(nombreBuscado, inv.nombre);
          const similitud = Math.max(simLevenshtein, simTokens);
          
          console.log(`   💡 Candidato LIKE: "${inv.nombre}" → ${similitud.toFixed(1)}%`);

          candidatosCercanos.push({
            nombre: inv.nombre,
            similitud,
            inversionista_id: inv.inversionista_id
          });

          if (!mejorMatch || similitud > mejorMatch.similitud) {
            mejorMatch = {
              inversionista_id: inv.inversionista_id,
              nombre: inv.nombre,
              similitud: similitud,
            };
          }
        }

        if (mejorMatch && mejorMatch.similitud >= 50) {
          console.log(`   ✅ MEJOR MATCH (LIKE): "${mejorMatch.nombre}" → ${mejorMatch.similitud.toFixed(1)}%`);
          return { ...mejorMatch, metodo: "LIKE", candidatosCercanos };
        }
      }
    } catch (error) {
      console.error(`   ⚠️ Error en búsqueda LIKE:`, error);
    }
  }

  // 3️⃣ FUZZY fallback
  console.log(`   📍 Estrategia 3: Fuzzy matching...`);

  let mejorMatch: { inversionista_id: number; nombre: string; similitud: number } | null = null;
  const topCandidatos: Array<{ nombre: string; similitud: number; inversionista_id: number }> = [];

  for (const inv of todosInversionistas) {
    const simLevenshtein = calcularSimilitud(nombreBuscado, inv.nombre);
    const simTokens = calcularSimilitudTokens(nombreBuscado, inv.nombre);
    const similitud = Math.max(simLevenshtein, simTokens);

    if (similitud >= 30) {
      topCandidatos.push({
        nombre: inv.nombre,
        similitud,
        inversionista_id: inv.inversionista_id
      });
    }

    if (similitud >= 50) {
      if (!mejorMatch || similitud > mejorMatch.similitud) {
        mejorMatch = {
          inversionista_id: inv.inversionista_id,
          nombre: inv.nombre,
          similitud: similitud,
        };
        
        console.log(`   🎯 Candidato fuzzy: "${inv.nombre}" → ${similitud.toFixed(1)}%`);
      }
    }
  }

  topCandidatos.sort((a, b) => b.similitud - a.similitud);
  candidatosCercanos = topCandidatos.slice(0, 5);

  if (mejorMatch) {
    console.log(`   ✅ MEJOR MATCH (FUZZY): "${mejorMatch.nombre}" → ${mejorMatch.similitud.toFixed(1)}%`);
    return { ...mejorMatch, metodo: "FUZZY", candidatosCercanos };
  }

  console.log(`   ❌ No se encontró match >= 50%`);
  console.log(`   🔍 Top 5 candidatos más cercanos:`);
  candidatosCercanos.forEach((c, idx) => {
    console.log(`      ${idx + 1}. [${c.similitud.toFixed(1)}%] "${c.nombre}" (ID: ${c.inversionista_id})`);
  });

  return null;
};

// ========================================
// LIMPIEZA DE VALORES
// ========================================

const cleanNumericValue = (value: any): string => {
  if (value === null || value === undefined) return "0";
  return String(value).replace(/[Q$,()"\s]/g, "").replace(/^-/, "").trim() || "0";
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
// GUARDAR LOGS
// ========================================

async function guardarInversionistasNoEncontrados(
  inversionistas: InversionistaNoEncontrado[]
): Promise<string> {
  try {
    const logsDir = path.join(process.cwd(), 'logs');
    await fs.mkdir(logsDir, { recursive: true });

    const jsonPath = path.join(logsDir, 'inversionistas-no-encontrados.json');
    const csvPath = path.join(logsDir, 'inversionistas-no-encontrados.csv');

    console.log(`\n📁 Guardando inversionistas no encontrados...`);

    let datosExistentes: InversionistaNoEncontrado[] = [];
    
    try {
      const contenidoExistente = await fs.readFile(jsonPath, 'utf-8');
      const archivoExistente = JSON.parse(contenidoExistente);
      datosExistentes = archivoExistente.inversionistas || [];
      console.log(`   ✅ Cargados ${datosExistentes.length} registros existentes`);
    } catch (error) {
      console.log(`   ℹ️  No existe archivo previo, creando nuevo`);
    }

    const nuevosAgregados: InversionistaNoEncontrado[] = [];
    
    for (const nuevoInv of inversionistas) {
      const yaExiste = datosExistentes.some(
        existente =>
          existente.nombreExcel === nuevoInv.nombreExcel &&
          existente.creditoSIFCO === nuevoInv.creditoSIFCO
      );

      if (!yaExiste) {
        datosExistentes.push(nuevoInv);
        nuevosAgregados.push(nuevoInv);
      } else {
        console.log(`   ⏭️  Ya existe: "${nuevoInv.nombreExcel}" en ${nuevoInv.creditoSIFCO}`);
      }
    }

    console.log(`   ➕ Agregados ${nuevosAgregados.length} nuevos registros`);
    console.log(`   📊 Total acumulado: ${datosExistentes.length} registros`);

    datosExistentes.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    const resumen = {
      ultima_actualizacion: new Date().toISOString(),
      total_acumulado: datosExistentes.length,
      inversionistas_unicos: Array.from(
        new Set(datosExistentes.map(i => i.nombreExcel))
      ).length,
      creditos_afectados: Array.from(
        new Set(datosExistentes.map(i => i.creditoSIFCO))
      ).length,
      inversionistas: datosExistentes
    };

    await fs.writeFile(jsonPath, JSON.stringify(resumen, null, 2), 'utf-8');
    console.log(`   ✅ JSON actualizado: ${jsonPath}`);

    await guardarCSV(datosExistentes, csvPath);

    if (nuevosAgregados.length > 0) {
      console.log(`\n   📋 Nuevos inversionistas no encontrados:`);
      nuevosAgregados.forEach((inv, idx) => {
        console.log(`      ${idx + 1}. "${inv.nombreExcel}" (${inv.creditoSIFCO})`);
      });
    }

    return jsonPath;
  } catch (error) {
    console.error(`❌ Error guardando log:`, error);
    throw error;
  }
}

async function guardarErroresPorcentajes(errores: ErrorPorcentaje[]): Promise<string> {
  try {
    const logsDir = path.join(process.cwd(), 'logs');
    await fs.mkdir(logsDir, { recursive: true });

    const jsonPath = path.join(logsDir, 'errores-porcentajes.json');
    const csvPath = path.join(logsDir, 'errores-porcentajes.csv');

    console.log(`\n📁 Guardando errores de porcentajes...`);

    let datosExistentes: ErrorPorcentaje[] = [];
    
    try {
      const contenidoExistente = await fs.readFile(jsonPath, 'utf-8');
      const archivoExistente = JSON.parse(contenidoExistente);
      datosExistentes = archivoExistente.errores || [];
      console.log(`   ✅ Cargados ${datosExistentes.length} errores existentes`);
    } catch (error) {
      console.log(`   ℹ️  No existe archivo previo, creando nuevo`);
    }

    const nuevosAgregados: ErrorPorcentaje[] = [];
    
    for (const nuevoErr of errores) {
      const yaExiste = datosExistentes.some(
        existente => existente.creditoSIFCO === nuevoErr.creditoSIFCO
      );

      if (!yaExiste) {
        datosExistentes.push(nuevoErr);
        nuevosAgregados.push(nuevoErr);
      }
    }

    console.log(`   ➕ Agregados ${nuevosAgregados.length} nuevos errores`);
    console.log(`   📊 Total acumulado: ${datosExistentes.length} errores`);

    const resumen = {
      ultima_actualizacion: new Date().toISOString(),
      total_errores: datosExistentes.length,
      errores: datosExistentes
    };

    await fs.writeFile(jsonPath, JSON.stringify(resumen, null, 2), 'utf-8');
    console.log(`   ✅ JSON actualizado: ${jsonPath}`);

    await guardarCSVPorcentajes(datosExistentes, csvPath);

    return jsonPath;
  } catch (error) {
    console.error(`❌ Error guardando errores de porcentajes:`, error);
    throw error;
  }
}

// ========================================
// FUNCIÓN PRINCIPAL
// ========================================

export async function procesarInversionistasSoloExcel(
  creditoAgrupado: CreditoAgrupadoInversionistas
) {
  try {
    console.log("\n🔄 ========== PROCESANDO INVERSIONISTAS DESDE EXCEL ==========");
    console.log(`📋 Crédito Base: ${creditoAgrupado.creditoBase}`);
    console.log(`👤 Cliente: ${creditoAgrupado.cliente}`);
    console.log(`👥 Filas recibidas: ${creditoAgrupado.filas.length}`);

    if (!creditoAgrupado.filas || creditoAgrupado.filas.length === 0) {
      throw new Error(`❌ No se encontraron filas para ${creditoAgrupado.creditoBase}`);
    }

    // PASO 0: Eliminar duplicados
    console.log(`\n🔍 Verificando duplicados en el Excel...`);
    
    const filasUnicas = new Map<string, typeof creditoAgrupado.filas[0]>();
    const duplicadosEncontrados: string[] = [];
    
    for (const fila of creditoAgrupado.filas) {
      const nombreInversionista = String(fila.Inversionista || "").trim();
      
      if (!nombreInversionista) {
        console.warn(`   ⚠️  Fila sin inversionista, saltando...`);
        continue;
      }
      
      const claveUnica = nombreInversionista.toLowerCase().replace(/\s+/g, ' ');
      
      if (filasUnicas.has(claveUnica)) {
        duplicadosEncontrados.push(nombreInversionista);
        console.warn(`   ⚠️  DUPLICADO: "${nombreInversionista}"`);
      } else {
        filasUnicas.set(claveUnica, fila);
      }
    }
    
    const filasLimpias = Array.from(filasUnicas.values());
    
    console.log(`\n📊 Resumen de limpieza:`);
    console.log(`   - Filas originales: ${creditoAgrupado.filas.length}`);
    console.log(`   - Duplicados removidos: ${duplicadosEncontrados.length}`);
    console.log(`   - Filas únicas: ${filasLimpias.length}`);

    // PASO 1: Buscar crédito
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

    // PASO 2: Borrar inversionistas viejos
    console.log(`\n🗑️  Eliminando inversionistas existentes...`);
    
    const deletedCount = await db
      .delete(creditos_inversionistas)
      .where(eq(creditos_inversionistas.credito_id, creditoDB.credito_id));

    console.log(`✅ ${deletedCount.rowCount ?? 0} inversionistas eliminados`);

    // PASO 3: Cargar inversionistas de BD
    console.log(`\n📋 Cargando todos los inversionistas de la BD...`);
    
    const todosInversionistas = await db
      .select({
        inversionista_id: inversionistas.inversionista_id,
        nombre: inversionistas.nombre,
      })
      .from(inversionistas);

    console.log(`✅ ${todosInversionistas.length} inversionistas cargados`);

    // PASO 4: Validar porcentajes
    console.log(`\n🔍 Validando porcentajes...`);
    
    let sumaTotal = new Big(0);
    const porcentajesInfo: Array<{nombre: string, pctCashIn: string, pctInv: string}> = [];
    
    for (const fila of filasLimpias) {
      const nombreInv = String(fila.Inversionista || "").trim();
      if (!nombreInv) continue;
      
      const pctCashIn = toBigExcel(fila.PorcentajeCashIn || 0, "0");
      const pctInv = toBigExcel(fila.PorcentajeInversionista || 0, "0");
      sumaTotal = sumaTotal.plus(pctCashIn).plus(pctInv);
      
      porcentajesInfo.push({
        nombre: nombreInv,
        pctCashIn: pctCashIn.times(100).toFixed(2) + '%',
        pctInv: pctInv.times(100).toFixed(2) + '%'
      });
    }
    
    console.log(`\n📊 Porcentajes de inversionistas:`);
    console.log(`   ${'Inversionista'.padEnd(40)} | % Cash-In | % Inversionista`);
    console.log(`   ${'-'.repeat(70)}`);
    porcentajesInfo.forEach(info => {
      console.log(`   ${info.nombre.padEnd(40)} | ${info.pctCashIn.padStart(9)} | ${info.pctInv.padStart(15)}`);
    });
    console.log(`   ${'-'.repeat(70)}`);
    console.log(`   TOTAL: ${sumaTotal.times(100).toFixed(2)}%`);
    
    const diferencia = sumaTotal.minus(1).abs();
    const erroresPorcentajes: ErrorPorcentaje[] = [];
    
    if (diferencia.gt(0.01)) {
      const razon = sumaTotal.lt(1) 
        ? `Suma menor a 100% (falta ${diferencia.times(100).toFixed(2)}%)`
        : `Suma mayor a 100% (sobra ${diferencia.times(100).toFixed(2)}%)`;
      
      console.warn(`\n⚠️  WARNING: Los porcentajes no suman 100%`);
      console.warn(`   Suma actual: ${sumaTotal.times(100).toFixed(2)}%`);
      console.warn(`   Diferencia: ${diferencia.times(100).toFixed(2)}%`);
      console.warn(`   Razón: ${razon}`);
      console.warn(`   → Continuando de todas formas...`);
      
      erroresPorcentajes.push({
        creditoSIFCO: creditoAgrupado.creditoBase,
        cliente: creditoAgrupado.cliente,
        inversionistas: porcentajesInfo.map(p => ({
          nombre: p.nombre,
          porcentajeCashIn: p.pctCashIn,
          porcentajeInversionista: p.pctInv
        })),
        sumaTotal: sumaTotal.times(100).toFixed(2) + '%',
        diferencia: diferencia.times(100).toFixed(2) + '%',
        timestamp: new Date().toISOString(),
        razon
      });
    } else {
      console.log(`\n✅ Porcentajes validados correctamente (suman ~100%)`);
    }

    // PASO 5: Mapear inversionistas
    console.log(`\n👥 Mapeando inversionistas desde Excel...`);
    
    const inversionistasData = [];
    const inversionistasNoEncontrados: InversionistaNoEncontrado[] = [];
    const matchStats = { EXACT: 0, TOKEN: 0, LIKE: 0, FUZZY: 0 };
    const inversionistasYaProcesados = new Set<number>();

    for (const fila of filasLimpias) {
      const nombreInversionista = String(fila.Inversionista || "").trim();
      
      if (!nombreInversionista) {
        console.warn(`   ⚠️  Fila sin nombre de inversionista, saltando...`);
        continue;
      }

      console.log(`\n   📋 Procesando: "${nombreInversionista}"`);

      const match = await buscarInversionistaInteligente(
        nombreInversionista,
        todosInversionistas
      );

      if (!match) {
        console.error(`   ❌ No se encontró match`);
        
        const candidatosCercanos = todosInversionistas
          .map(inv => ({
            nombre: inv.nombre,
            similitud: Math.max(
              calcularSimilitud(nombreInversionista, inv.nombre),
              calcularSimilitudTokens(nombreInversionista, inv.nombre)
            ),
            inversionista_id: inv.inversionista_id
          }))
          .sort((a, b) => b.similitud - a.similitud)
          .slice(0, 3);
        
        console.log(`   🔍 Candidatos más cercanos:`);
        candidatosCercanos.forEach((c, idx) => {
          console.log(`      ${idx + 1}. ${c.nombre} (${c.similitud.toFixed(1)}%) [ID: ${c.inversionista_id}]`);
        });
        
        inversionistasNoEncontrados.push({
          nombreExcel: nombreInversionista,
          creditoSIFCO: fila.CreditoSIFCO,
          cliente: creditoAgrupado.cliente,
          capital: String(fila.Capital || "0"),
          timestamp: new Date().toISOString(),
          candidatosCercanos
        });
        
        continue;
      }

      if (inversionistasYaProcesados.has(match.inversionista_id)) {
        console.warn(`   ⚠️  DUPLICADO: ${match.nombre} (ID: ${match.inversionista_id}) ya procesado`);
        continue;
      }

      inversionistasYaProcesados.add(match.inversionista_id);
      matchStats[match.metodo as keyof typeof matchStats]++;

      if (match.similitud === 100) {
        console.log(`   ✅ Match perfecto (${match.metodo}): "${match.nombre}"`);
      } else {
        console.log(`   🔍 Match (${match.metodo}) ${match.similitud.toFixed(1)}%: "${match.nombre}"`);
      }

      // Calcular montos
      const montoAportado = toBigExcel(fila.Capital, "0");
      const porcentajeCashIn = toBigExcel(fila.PorcentajeCashIn || 0, "0");
      const porcentajeInversion = toBigExcel(fila.PorcentajeInversionista || 0, "0");
      const interes = new Big(creditoDB.porcentaje_interes || 0);

      const newCuotaInteres = montoAportado.times(interes.div(100));
      const montoInversionista = newCuotaInteres.times(porcentajeInversion).round(2);
      const montoCashIn = newCuotaInteres.times(porcentajeCashIn).round(2);
      const ivaInversionista = montoInversionista.gt(0) ? montoInversionista.times(0.12).round(2) : new Big(0);
      const ivaCashIn = montoCashIn.gt(0) ? montoCashIn.times(0.12).round(2) : new Big(0);
      const cuotaInv = fila.Cuota ? toBigExcel(fila.Cuota, "0") : new Big(0);

      console.log(`   💰 Monto Aportado: Q${montoAportado}`);
      console.log(`   📊 % Cash-In: ${porcentajeCashIn.times(100)}% / % Inv: ${porcentajeInversion.times(100)}%`);

      const porcentajeCashInParaBD = porcentajeCashIn.times(100).toString();
      const porcentajeInversionParaBD = porcentajeInversion.times(100).toString();

      inversionistasData.push({
        credito_id: creditoDB.credito_id,
        inversionista_id: match.inversionista_id,
        monto_aportado: montoAportado.toFixed(2),
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

    // PASO 6: Estadísticas
    console.log(`\n📊 ========== ESTADÍSTICAS ==========`);
    console.log(`   ✅ EXACT: ${matchStats.EXACT}`);
    console.log(`   ✅ TOKEN: ${matchStats.TOKEN}`);
    console.log(`   ✅ LIKE: ${matchStats.LIKE}`);
    console.log(`   ✅ FUZZY: ${matchStats.FUZZY}`);
    console.log(`   ❌ No encontrados: ${inversionistasNoEncontrados.length}`);
    console.log(`   🔄 Duplicados removidos: ${duplicadosEncontrados.length}`);

    // PASO 7: Guardar logs
    let logFilePath = null;
    let logPorcentajesPath = null;
    
    if (inversionistasNoEncontrados.length > 0) {
      console.warn(`\n⚠️  INVERSIONISTAS NO ENCONTRADOS:`);
      inversionistasNoEncontrados.forEach((inv) => {
        console.warn(`   - "${inv.nombreExcel}" (${inv.creditoSIFCO})`);
      });
      logFilePath = await guardarInversionistasNoEncontrados(inversionistasNoEncontrados);
    }
    
    if (erroresPorcentajes.length > 0) {
      logPorcentajesPath = await guardarErroresPorcentajes(erroresPorcentajes);
    }

    // PASO 8: Insertar
    console.log(`\n💾 Insertando ${inversionistasData.length} inversionistas...`);
    
    if (inversionistasData.length === 0) {
      return {
        success: false,
        creditoBase: creditoAgrupado.creditoBase,
        error: "No se encontraron inversionistas válidos",
        inversionistas_procesados: 0,
        log_file: logFilePath,
        log_porcentajes: logPorcentajesPath
      };
    }

    await db.insert(creditos_inversionistas).values(inversionistasData);

    console.log(`✅ ${inversionistasData.length} inversionistas insertados`);
    console.log(`\n✅ ========== PROCESO COMPLETADO ==========\n`);

    return {
      success: true,
      creditoBase: creditoAgrupado.creditoBase,
      cliente: creditoAgrupado.cliente,
      credito_id: creditoDB.credito_id,
      inversionistas_procesados: inversionistasData.length,
      inversionistas_eliminados: deletedCount.rowCount ?? 0,
      inversionistas_no_encontrados: inversionistasNoEncontrados.map(inv => inv.nombreExcel),
      duplicados_removidos: duplicadosEncontrados,
      match_stats: matchStats,
      log_file: logFilePath,
      log_porcentajes: logPorcentajesPath,
      detalles: inversionistasData.map(inv => ({
        inversionista_id: inv.inversionista_id,
        monto_aportado: inv.monto_aportado,
        porcentaje_cash_in: inv.porcentaje_cash_in,
        porcentaje_inversionista: inv.porcentaje_participacion_inversionista,
      })),
    };

  } catch (error) {
    console.error("\n❌ ========== ERROR ==========");
    console.error(error);
    console.error("❌ ========== FIN ERROR ==========\n");
    throw error;
  }
}