import Big from "big.js";
import { db } from "../database";
import { creditos, creditos_inversionistas, inversionistas, usuarios } from "../database/db";
import { eq, or, ilike, and } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";

// ========================================
// TIPOS E INTERFACES
// ========================================

interface FilaExcelInversionista {
  CreditoSIFCO: string;
  Inversionista: string;
  Capital: number | string;
  CapitalRestante?: number | string;
  porcentaje: number | string;
  PorcentajeCashIn?: number | string;
  PorcentajeInversionista?: number | string;
  Cuota?: number | string;
  _decision_usuario?: number;
}

interface CreditoAgrupadoInversionistas {
  creditoBase: string;
  cliente: string;
  filas: FilaExcelInversionista[];
}

interface DecisionUsuario {
  nombre_excel: string;
  credito_sifco: string;
  decision: number;
}

interface ConsultaInteractiva {
  nombre_excel: string;
  credito_sifco: string;
  candidatos: Array<{
    nombre: string;
    similitud: number;
    inversionista_id: number;
  }>;
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
// 🔥 NUEVAS FUNCIONES: MANEJO DE PARÉNTESIS
// ========================================

const extraerNombreDeParentesis = (nombre: string): string | null => {
  const match = nombre.match(/\(([^)]+)\)/);
  return match ? match[1].trim() : null;
};

const removerParentesis = (nombre: string): string => {
  return nombre.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
};

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
  
  const totalTokens = Math.min(tokens1.length, tokens2.length);
  let similitud = (matches / totalTokens) * 100;
  
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
// 🔥 BÚSQUEDA SIMPLE (lógica refactorizada)
// ========================================

const buscarPorNombreSimple = async (
  nombreBuscado: string,
  todosInversionistas: Array<{ inversionista_id: number; nombre: string }>,
  umbralSimilitud: number
): Promise<{ 
  inversionista_id: number; 
  nombre: string; 
  similitud: number; 
  metodo: string;
  candidatosCercanos?: Array<{ nombre: string; similitud: number; inversionista_id: number }>;
  requiere_confirmacion?: boolean;
} | null> => {
  
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
        metodo: "EXACT",
        requiere_confirmacion: false
      };
    }
  }

  // 1️⃣ TOKEN match
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
    
    if (mejor.similitud >= umbralSimilitud) {
      return {
        inversionista_id: mejor.inversionista_id,
        nombre: mejor.nombre,
        similitud: mejor.similitud,
        metodo: "TOKEN",
        candidatosCercanos,
        requiere_confirmacion: false
      };
    } else if (mejor.similitud >= 50) {
      console.log(`   ⚠️  Match dudoso (${mejor.similitud.toFixed(1)}%), requiere confirmación`);
      return {
        inversionista_id: mejor.inversionista_id,
        nombre: mejor.nombre,
        similitud: mejor.similitud,
        metodo: "TOKEN",
        candidatosCercanos,
        requiere_confirmacion: true
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

        if (mejorMatch && mejorMatch.similitud >= umbralSimilitud) {
          console.log(`   ✅ MEJOR MATCH (LIKE): "${mejorMatch.nombre}" → ${mejorMatch.similitud.toFixed(1)}%`);
          return { 
            ...mejorMatch, 
            metodo: "LIKE", 
            candidatosCercanos,
            requiere_confirmacion: false
          };
        } else if (mejorMatch && mejorMatch.similitud >= 50) {
          console.log(`   ⚠️  Match dudoso (${mejorMatch.similitud.toFixed(1)}%), requiere confirmación`);
          return {
            ...mejorMatch,
            metodo: "LIKE",
            candidatosCercanos,
            requiere_confirmacion: true
          };
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
    const requiereConfirmacion = mejorMatch.similitud < umbralSimilitud;
    
    if (requiereConfirmacion) {
      console.log(`   ⚠️  Match dudoso (${mejorMatch.similitud.toFixed(1)}%), requiere confirmación`);
    } else {
      console.log(`   ✅ MEJOR MATCH (FUZZY): "${mejorMatch.nombre}" → ${mejorMatch.similitud.toFixed(1)}%`);
    }
    
    return { 
      ...mejorMatch, 
      metodo: "FUZZY", 
      candidatosCercanos,
      requiere_confirmacion: requiereConfirmacion
    };
  }

  console.log(`   ❌ No se encontró match >= 50%`);
  console.log(`   🔍 Top 5 candidatos más cercanos:`);
  candidatosCercanos.forEach((c, idx) => {
    console.log(`      ${idx + 1}. [${c.similitud.toFixed(1)}%] "${c.nombre}" (ID: ${c.inversionista_id})`);
  });

  return null;
};

// ========================================
// 🔥 BÚSQUEDA INTELIGENTE CON PARÉNTESIS
// ========================================

const buscarInversionistaInteligente = async (
  nombreBuscado: string,
  todosInversionistas: Array<{ inversionista_id: number; nombre: string }>,
  umbralSimilitud: number = 70
): Promise<{ 
  inversionista_id: number; 
  nombre: string; 
  similitud: number; 
  metodo: string;
  candidatosCercanos?: Array<{ nombre: string; similitud: number; inversionista_id: number }>;
  requiere_confirmacion?: boolean;
} | null> => {
  
  console.log(`\n   🔍 Buscando match para: "${nombreBuscado}"`);
  
  // 🔥 ESTRATEGIA: Si tiene paréntesis, buscar primero el contenido (nombre de persona)
  const nombreEnParentesis = extraerNombreDeParentesis(nombreBuscado);
  const nombreSinParentesis = removerParentesis(nombreBuscado);
  
  if (nombreEnParentesis) {
    console.log(`   👤 Nombre en paréntesis detectado: "${nombreEnParentesis}"`);
    console.log(`   🏢 Nombre sin paréntesis: "${nombreSinParentesis}"`);

    // Buscar por AMBOS y devolver el mejor match
    const matchPersona = await buscarPorNombreSimple(nombreEnParentesis, todosInversionistas, umbralSimilitud);
    const matchEmpresa = await buscarPorNombreSimple(nombreSinParentesis, todosInversionistas, umbralSimilitud);

    if (matchPersona && matchEmpresa) {
      const mejor = matchEmpresa.similitud > matchPersona.similitud ? matchEmpresa : matchPersona;
      console.log(`   ✅ Mejor match (comparando persona vs empresa): "${mejor.nombre}" (${mejor.similitud.toFixed(1)}%)`);
      return mejor;
    }
    if (matchPersona) {
      console.log(`   ✅ Match encontrado por nombre en paréntesis: "${matchPersona.nombre}"`);
      return matchPersona;
    }
    if (matchEmpresa) {
      console.log(`   ✅ Match encontrado por nombre de empresa: "${matchEmpresa.nombre}"`);
      return matchEmpresa;
    }
  }
  
  // 🔥 Si no tiene paréntesis o ninguna estrategia funcionó, búsqueda normal
  console.log(`   🔍 Búsqueda normal para: "${nombreBuscado}"`);
  return await buscarPorNombreSimple(nombreBuscado, todosInversionistas, umbralSimilitud);
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
const inversionistasFallidos: {
  nombre: string;
  razon: string;
}[] = [];
// ========================================
// 🔥 FUNCIÓN PRINCIPAL CON MODO INTERACTIVO
// ========================================

export async function procesarInversionistasSoloExcel(
  creditoAgrupado: CreditoAgrupadoInversionistas,
  opciones?: {
    modo_interactivo?: boolean;
    umbral_similitud?: number;
    decisiones_usuario?: DecisionUsuario[];
  }
) {
  try {
    const modoInteractivo = opciones?.modo_interactivo ?? false;
    const umbralSimilitud = opciones?.umbral_similitud ?? 70;
    const decisionesUsuario = opciones?.decisiones_usuario ?? [];

    const inversionistasFallidos: { nombre: string; razon: string }[] = [];

    console.log("\n🔄 ========== PROCESANDO INVERSIONISTAS DESDE EXCEL ==========");
    console.log(`📋 Crédito Base: ${creditoAgrupado.creditoBase}`);
    console.log(`👤 Cliente: ${creditoAgrupado.cliente}`);
    console.log(`👥 Filas recibidas: ${creditoAgrupado.filas.length}`);

    if (!creditoAgrupado.filas || creditoAgrupado.filas.length === 0) {
      throw new Error(`❌ No se encontraron filas para ${creditoAgrupado.creditoBase}`);
    }

    // ===============================
    // PASO 0: Eliminar duplicados
    // ===============================
    const filasUnicas = new Map<string, typeof creditoAgrupado.filas[0]>();
    const duplicadosEncontrados: string[] = [];

    for (const fila of creditoAgrupado.filas) {
      const nombre = String(fila.Inversionista || "").trim();
      if (!nombre) {
        inversionistasFallidos.push({ nombre: "(vacío)", razon: "Nombre vacío" });
        continue;
      }

      const key = nombre.toLowerCase().replace(/\s+/g, " ");
      if (filasUnicas.has(key)) {
        duplicadosEncontrados.push(nombre);
      } else {
        filasUnicas.set(key, fila);
      }
    }

    const filasLimpias = Array.from(filasUnicas.values());

    // ===============================
    // PASO 1: Buscar crédito
    // ===============================
    let creditoDB: { credito_id: number; numero_credito_sifco: string; porcentaje_interes: string | null; capital: string | null; nombre_usuario?: string | null } | undefined;

    const [creditoPorSifco] = await db
      .select({
        credito_id: creditos.credito_id,
        numero_credito_sifco: creditos.numero_credito_sifco,
        porcentaje_interes: creditos.porcentaje_interes,
        capital: creditos.capital,
      })
      .from(creditos)
      .where(eq(creditos.numero_credito_sifco, creditoAgrupado.creditoBase))
      .limit(1);

    creditoDB = creditoPorSifco;

    if (!creditoDB && creditoAgrupado.cliente) {
      // Fallback: buscar por nombre del cliente (fuzzy permisivo)
      const nombreCliente = creditoAgrupado.cliente.split("/")[0].trim();
      console.log(`   ⚠️ SIFCO no encontrado, buscando por nombre: "${nombreCliente}"`);

      // Extraer palabras clave del nombre (>= 3 chars, sin preposiciones)
      const palabrasCliente = nombreCliente
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .split(/\s+/)
        .filter((p: string) => p.length >= 3 && !["del", "de", "la", "los", "las"].includes(p));

      // Buscar con ILIKE por cada palabra clave (AND)
      const likeConditions = palabrasCliente.map((p: string) => ilike(usuarios.nombre, `%${p}%`));

      if (likeConditions.length > 0) {
        const creditosPorNombre = await db
          .select({
            credito_id: creditos.credito_id,
            numero_credito_sifco: creditos.numero_credito_sifco,
            porcentaje_interes: creditos.porcentaje_interes,
            capital: creditos.capital,
            nombre_usuario: usuarios.nombre,
          })
          .from(creditos)
          .innerJoin(usuarios, eq(usuarios.usuario_id, creditos.usuario_id))
          .where(and(...likeConditions));

        console.log(`   📋 Encontrados ${creditosPorNombre.length} creditos por nombre`);

        if (creditosPorNombre.length === 1) {
          creditoDB = creditosPorNombre[0];
          console.log(`   ✅ Encontrado por nombre: ${creditoDB.numero_credito_sifco} (${creditoDB.nombre_usuario})`);
        } else if (creditosPorNombre.length > 1) {
          // Tomar el que tenga nombre mas similar
          const mejorMatch = creditosPorNombre
            .map(c => ({
              ...c,
              sim: calcularSimilitudTokens(nombreCliente, c.nombre_usuario || "")
            }))
            .sort((a, b) => b.sim - a.sim)[0];

          if (mejorMatch && mejorMatch.sim >= 50) {
            creditoDB = mejorMatch;
            console.log(`   ✅ Mejor match por nombre (${mejorMatch.sim.toFixed(1)}%): ${creditoDB.numero_credito_sifco} (${creditoDB.nombre_usuario})`);
          } else {
            console.log(`   ⚠️ Multiples creditos, ninguno suficientemente similar`);
            return {
              success: false,
              error: `Multiples creditos para "${nombreCliente}": ${creditosPorNombre.map(c => `${c.numero_credito_sifco}(${c.nombre_usuario})`).join(", ")}`,
              inversionistas_fallidos: inversionistasFallidos,
            };
          }
        }
      }
    }

    if (!creditoDB) {
      return {
        success: false,
        error: "Crédito no encontrado",
        inversionistas_fallidos: inversionistasFallidos,
      };
    }

    // ===============================
    // PASO 2: Cargar relaciones existentes (NO se eliminan)
    // ===============================
    const relacionesExistentes = await db
      .select({
        id: creditos_inversionistas.id,
        inversionista_id: creditos_inversionistas.inversionista_id,
        monto_aportado: creditos_inversionistas.monto_aportado,
      })
      .from(creditos_inversionistas)
      .where(eq(creditos_inversionistas.credito_id, creditoDB.credito_id));

    // ===============================
    // PASO 3: Cargar inversionistas BD
    // ===============================
    const todosInversionistas = await db
      .select({
        inversionista_id: inversionistas.inversionista_id,
        nombre: inversionistas.nombre,
      })
      .from(inversionistas);

    // ===============================
    // PASO 5: Mapear inversionistas
    // ===============================
    const inversionistasData = [];
    const inversionistasYaProcesados = new Set<number>();

    for (const fila of filasLimpias) {
      const nombre = String(fila.Inversionista || "").trim();
      if (!nombre) {
        inversionistasFallidos.push({ nombre: "(vacío)", razon: "Nombre vacío" });
        continue;
      }

      let inversionistaId: number | null = null;

      const match = await buscarInversionistaInteligente(
        nombre,
        todosInversionistas,
        umbralSimilitud
      );

      if (!match) {
        inversionistasFallidos.push({
          nombre,
          razon: "No se encontró match en BD",
        });
        continue;
      }

      if (match.requiere_confirmacion && modoInteractivo) {
        inversionistasFallidos.push({
          nombre,
          razon: "Requiere confirmación del usuario",
        });
        continue;
      }

      inversionistaId = match.inversionista_id;

      if (inversionistasYaProcesados.has(inversionistaId)) {
        inversionistasFallidos.push({
          nombre,
          razon: "Inversionista duplicado en Excel",
        });
        continue;
      }

      inversionistasYaProcesados.add(inversionistaId);

      // Montos
      const montoAportado = toBigExcel(fila.CapitalRestante || fila.Capital, "0");
      const porcentajeCashIn = toBigExcel(fila.PorcentajeCashIn || 0, "0");
      const porcentajeInv = toBigExcel(fila.PorcentajeInversionista || 0, "0");
      const interes = new Big(creditoDB.porcentaje_interes || 0).div(100);

      const cuotaInteres = montoAportado.times(interes);

      // Solo actualizar monto_aportado si la relación ya existe
      const relacionExistente = relacionesExistentes.find(
        r => r.inversionista_id === inversionistaId
      );

      if (relacionExistente) {
        inversionistasData.push({
          id: relacionExistente.id,
          inversionista_id: inversionistaId,
          monto_aportado: montoAportado.toFixed(8),
          monto_anterior: relacionExistente.monto_aportado,
        });
      } else {
        inversionistasFallidos.push({
          nombre,
          razon: `No existe relación en creditos_inversionistas (inv_id: ${inversionistaId})`,
        });
      }
    }

    // ===============================
    // PASO FINAL: ACTUALIZAR monto_aportado
    // ===============================
    let actualizados = 0;
    for (const inv of inversionistasData) {
      await db
        .update(creditos_inversionistas)
        .set({ monto_aportado: inv.monto_aportado })
        .where(
          and(
            eq(creditos_inversionistas.credito_id, creditoDB.credito_id),
            eq(creditos_inversionistas.inversionista_id, inv.inversionista_id)
          )
        );
      console.log(`   ✅ Actualizado inv_id ${inv.inversionista_id}: ${inv.monto_anterior} → ${inv.monto_aportado}`);
      actualizados++;
    }

    // ===============================
    // 🔥 LOG FINAL DE FALLIDOS
    // ===============================
    if (inversionistasFallidos.length > 0) {
      console.log("\n❌ ========== INVERSIONISTAS FALLIDOS ==========");
      inversionistasFallidos.forEach((f, i) => {
        console.log(` ${i + 1}. ${f.nombre} → ${f.razon}`);
      });
      console.log("============================================\n");
    }

    return {
      success: true,
      creditoBase: creditoAgrupado.creditoBase,
      credito_id: creditoDB.credito_id,
      inversionistas_actualizados: actualizados,
      inversionistas_fallidos: inversionistasFallidos,
      duplicados_removidos: duplicadosEncontrados,
    };
  } catch (error) {
    console.error("❌ ERROR EN PROCESO:", error);
    throw error;
  }
}
