import { eq, and, lte, gte, sql } from "drizzle-orm";
import { db } from "../database";
import { usuarios, creditos, cuotas_credito, inversionistas, creditos_inversionistas } from "../database/db";
import Big from "big.js";
import fs from "fs"; // 🆕 Para escribir logs

// 📊 INTERFACE PARA EL INPUT
interface LiquidarCuotasInput {
  nombre_usuario: string;
  cuota_mes: string;
  capital: number;
  nombre_inversionista: string;
}

// 🆕 FUNCIÓN PARA ESCRIBIR LOG DE ADVERTENCIAS
function escribirLogAdvertencias(tipo: 'ADVERTENCIA' | 'ERROR' | 'RELACION_CREADA', mensaje: string, data?: any) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    tipo,
    mensaje,
    data: data || null
  };
  
  const logLine = `[${timestamp}] ${tipo}: ${mensaje}\n${data ? JSON.stringify(data, null, 2) : ''}\n${'='.repeat(80)}\n`;
  
  // 🔥 Escribir en archivo de log
  const logPath = './logs/liquidacion_advertencias.log';
  
  try {
    // Crear carpeta logs si no existe
    if (!fs.existsSync('./logs')) {
      fs.mkdirSync('./logs', { recursive: true });
    }
    
    fs.appendFileSync(logPath, logLine);
    console.log(`   📝 Log escrito en: ${logPath}`);
  } catch (err) {
    console.error(`   ❌ Error escribiendo log:`, err);
  }
}

// 🧹 NORMALIZAR FORMATO DE MES - ULTRA PERMISIVO
function normalizarCuotaMes(cuota_mes: string): string {
  console.log(`   🔧 Normalizando mes: "${cuota_mes}"`);
  
  let normalizado = cuota_mes.trim();
  
  // 🆕 1. Si tiene formato "nov.25" o "nov25" sin espacio, agregar espacio
  if (/^[a-zA-Z]{3}\.?\d{2,4}$/.test(normalizado)) {
    const match = normalizado.match(/^([a-zA-Z]{3})\.?(\d{2,4})$/);
    if (match) {
      normalizado = `${match[1]}. ${match[2]}`;
      console.log(`   🔧 Agregado espacio: "${normalizado}"`);
    }
  }
  
  // 2. Remover puntos extras al final
  normalizado = normalizado.replace(/\.+$/g, '');
  
  // 3. Convertir año de 4 dígitos a 2
  normalizado = normalizado.replace(/\b2025\b/g, '25');
  normalizado = normalizado.replace(/\b2024\b/g, '24');
  normalizado = normalizado.replace(/\b2023\b/g, '23');
  normalizado = normalizado.replace(/\b2022\b/g, '22');
  normalizado = normalizado.replace(/\b2021\b/g, '21');
  normalizado = normalizado.replace(/\b2020\b/g, '20');
  
  // 4. Casos especiales: múltiples meses (ej: "ago. 25 y sep. 25")
  if (normalizado.includes(' y ')) {
    console.log(`   ⚠️ Múltiples meses detectados, tomando el último`);
    const meses = normalizado.split(' y ').map(m => m.trim());
    normalizado = meses[meses.length - 1];
    console.log(`   ✅ Mes seleccionado: "${normalizado}"`);
  }
  
  // 5. Si tiene múltiples meses separados por comas
  if (normalizado.includes(',')) {
    console.log(`   ⚠️ Múltiples meses con coma, tomando el último`);
    const meses = normalizado.split(',').map(m => m.trim());
    normalizado = meses[meses.length - 1];
    console.log(`   ✅ Mes seleccionado: "${normalizado}"`);
  }
  
  // 6. Limpiar espacios múltiples
  normalizado = normalizado.replace(/\s+/g, ' ');
  
  // 7. Asegurar que tiene punto después del mes
  const partes = normalizado.split(/\s+/);
  if (partes.length === 2) {
    let mes = partes[0].toLowerCase().replace('.', '');
    const año = partes[1];
    
    // Mapeo de meses en español
    const mesesValidos = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 
                          'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    
    // Si el mes tiene más de 3 letras, tomar solo las primeras 3
    if (mes.length > 3) {
      mes = mes.substring(0, 3);
    }
    
    if (mesesValidos.includes(mes)) {
      normalizado = `${mes}. ${año}`;
    }
  }
  
  console.log(`   ✅ Resultado normalizado: "${normalizado}"`);
  return normalizado;
}

// 🔍 BÚSQUEDA ULTRA PERMISIVA DE USUARIO
async function buscarUsuarioPermisivo(nombre_usuario: string) {
  console.log(`\n🔍 ========== BÚSQUEDA PERMISIVA DE USUARIO ==========`);
  console.log(`   📝 Buscando: "${nombre_usuario}"`);
  
  // Limpiar el nombre de entrada
  const nombreLimpio = nombre_usuario
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[áàäâã]/gi, 'a')
    .replace(/[éèëê]/gi, 'e')
    .replace(/[íìïî]/gi, 'i')
    .replace(/[óòöôõ]/gi, 'o')
    .replace(/[úùüû]/gi, 'u')
    .replace(/ñ/gi, 'n');
  
  console.log(`   🧹 Nombre limpio: "${nombreLimpio}"`);
  
  // ESTRATEGIA 1: Búsqueda exacta (case insensitive)
  console.log(`   🎯 Estrategia 1: Búsqueda exacta...`);
  let usuarios_encontrados = await db
    .select()
    .from(usuarios)
    .where(sql`LOWER(${usuarios.nombre}) = LOWER(${nombreLimpio})`);
  
  if (usuarios_encontrados.length > 0) {
    console.log(`   ✅ Encontrados ${usuarios_encontrados.length} con búsqueda exacta`);
    return usuarios_encontrados;
  }
  
  // ESTRATEGIA 1.5: Búsqueda exacta con tildes normalizadas
  console.log(`   🎯 Estrategia 1.5: Búsqueda exacta sin tildes...`);
  usuarios_encontrados = await db
    .select()
    .from(usuarios)
    .where(
      sql`LOWER(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
          REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            ${usuarios.nombre},
            'á', 'a'), 'é', 'e'), 'í', 'i'), 'ó', 'o'), 'ú', 'u'),
          'Á', 'a'), 'É', 'e'), 'Í', 'i'), 'Ó', 'o'), 'Ú', 'u')
      ) = LOWER(${nombreLimpio})`
    );
  
  if (usuarios_encontrados.length > 0) {
    console.log(`   ✅ Encontrados ${usuarios_encontrados.length} con búsqueda exacta sin tildes`);
    return usuarios_encontrados;
  }
  
  // ESTRATEGIA 2: Búsqueda CONTAINS - nombre completo
  console.log(`   🎯 Estrategia 2: Búsqueda con LIKE (contiene)...`);
  usuarios_encontrados = await db
    .select()
    .from(usuarios)
    .where(sql`LOWER(${usuarios.nombre}) LIKE LOWER(${'%' + nombreLimpio + '%'})`);
  
  if (usuarios_encontrados.length > 0) {
    console.log(`   ✅ Encontrados ${usuarios_encontrados.length} con LIKE`);
    
    // FILTRAR: Buscar el que más se parezca
    const usuariosConScore = usuarios_encontrados.map(u => {
      const nombreBD = u.nombre.toLowerCase();
      const nombreBuscado = nombreLimpio.toLowerCase();
      
      const palabrasBuscadas = nombreBuscado.split(' ').filter(p => p.length > 2);
      const palabrasEncontradas = palabrasBuscadas.filter(palabra => 
        nombreBD.includes(palabra)
      ).length;
      const scoreCoincidencia = palabrasEncontradas / palabrasBuscadas.length;
      
      const diffLongitud = Math.abs(nombreBD.length - nombreBuscado.length);
      const scoreLongitud = 1 - (diffLongitud / Math.max(nombreBD.length, nombreBuscado.length));
      
      const scoreInicio = nombreBD.startsWith(nombreBuscado.split(' ')[0].toLowerCase()) ? 1 : 0;
      
      const scoreTotal = (scoreCoincidencia * 0.5) + (scoreLongitud * 0.3) + (scoreInicio * 0.2);
      
      return {
        ...u,
        score: scoreTotal,
        scoreCoincidencia,
        scoreLongitud,
        scoreInicio
      };
    });
    
    usuariosConScore.sort((a, b) => b.score - a.score);
    
    console.log(`   📊 Usuarios ordenados por score:`);
    usuariosConScore.forEach((u, idx) => {
      console.log(`      ${idx + 1}. ${u.nombre} (score: ${u.score.toFixed(2)})`);
    });
    
    if (usuariosConScore[0].score >= 0.6) {
      console.log(`   ✅ Usuario con mejor score (${usuariosConScore[0].score.toFixed(2)}): ${usuariosConScore[0].nombre}`);
      return [usuariosConScore[0]];
    }
    
    return usuariosConScore.slice(0, 3).map(u => ({
      usuario_id: u.usuario_id,
      nombre: u.nombre,
      nit: u.nit,
      categoria: u.categoria,
      como_se_entero: u.como_se_entero,
      saldo_a_favor: u.saldo_a_favor
    }));
  }
  
  // ESTRATEGIA 3: Búsqueda por partes del nombre (primer y último apellido)
  console.log(`   🎯 Estrategia 3: Búsqueda por partes del nombre...`);
  const palabras = nombreLimpio.split(' ').filter(p => p.length > 2);
  
  if (palabras.length >= 2) {
    const primeraPalabra = palabras[0];
    const ultimaPalabra = palabras[palabras.length - 1];
    
    console.log(`   🔍 Buscando con: "${primeraPalabra}" Y "${ultimaPalabra}"`);
    
    usuarios_encontrados = await db
      .select()
      .from(usuarios)
      .where(
        and(
          sql`LOWER(${usuarios.nombre}) LIKE LOWER(${'%' + primeraPalabra + '%'})`,
          sql`LOWER(${usuarios.nombre}) LIKE LOWER(${'%' + ultimaPalabra + '%'})`
        )
      );
    
    if (usuarios_encontrados.length > 0) {
      console.log(`   ✅ Encontrados ${usuarios_encontrados.length} con búsqueda por partes`);
      return usuarios_encontrados;
    }
  }
  
  // ESTRATEGIA 4: Búsqueda con similitud (si PostgreSQL tiene la extensión pg_trgm)
  console.log(`   🎯 Estrategia 4: Búsqueda con similitud...`);
  try {
    usuarios_encontrados = await db
      .select()
      .from(usuarios)
      .where(sql`SIMILARITY(LOWER(${usuarios.nombre}), LOWER(${nombreLimpio})) > 0.3`)
      .orderBy(sql`SIMILARITY(LOWER(${usuarios.nombre}), LOWER(${nombreLimpio})) DESC`);
    
    if (usuarios_encontrados.length > 0) {
      console.log(`   ✅ Encontrados ${usuarios_encontrados.length} con similitud`);
      usuarios_encontrados.forEach((u, idx) => {
        console.log(`      ${idx + 1}. ${u.nombre}`);
      });
      return usuarios_encontrados;
    }
  } catch (error) {
    console.log(`   ⚠️ Extensión pg_trgm no disponible, saltando...`);
  }
  
  // ESTRATEGIA 5: Buscar cualquier palabra del nombre
  console.log(`   🎯 Estrategia 5: Búsqueda con cualquier palabra...`);
  for (const palabra of palabras) {
    if (palabra.length < 3) continue;
    
    console.log(`   🔍 Probando con: "${palabra}"`);
    usuarios_encontrados = await db
      .select()
      .from(usuarios)
      .where(sql`LOWER(${usuarios.nombre}) LIKE LOWER(${'%' + palabra + '%'})`);
    
    if (usuarios_encontrados.length > 0 && usuarios_encontrados.length < 10) {
      console.log(`   ✅ Encontrados ${usuarios_encontrados.length} con palabra "${palabra}"`);
      return usuarios_encontrados;
    }
  }
  
  console.log(`   ❌ No se encontró ningún usuario`);
  return [];
}

// 🔍 BÚSQUEDA ULTRA PERMISIVA DE INVERSIONISTA
async function buscarInversionistaPermisivo(nombre_inversionista: string) {
  console.log(`\n🔍 ========== BÚSQUEDA PERMISIVA DE INVERSIONISTA ==========`);
  console.log(`   📝 Buscando: "${nombre_inversionista}"`);
  
  // Limpiar el nombre de entrada
  const nombreLimpio = nombre_inversionista
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[áàäâã]/gi, 'a')
    .replace(/[éèëê]/gi, 'e')
    .replace(/[íìïî]/gi, 'i')
    .replace(/[óòöôõ]/gi, 'o')
    .replace(/[úùüû]/gi, 'u')
    .replace(/ñ/gi, 'n');
  
  console.log(`   🧹 Nombre limpio: "${nombreLimpio}"`);
  
  // ESTRATEGIA 1: Búsqueda exacta (case insensitive)
  console.log(`   🎯 Estrategia 1: Búsqueda exacta...`);
  let inversionistas_encontrados = await db
    .select()
    .from(inversionistas)
    .where(sql`LOWER(${inversionistas.nombre}) = LOWER(${nombreLimpio})`);
  
  if (inversionistas_encontrados.length > 0) {
    console.log(`   ✅ Encontrados ${inversionistas_encontrados.length} con búsqueda exacta`);
    return inversionistas_encontrados;
  }
  
  // ESTRATEGIA 1.5: Búsqueda exacta sin tildes
  console.log(`   🎯 Estrategia 1.5: Búsqueda exacta sin tildes...`);
  inversionistas_encontrados = await db
    .select()
    .from(inversionistas)
    .where(
      sql`LOWER(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
          REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            ${inversionistas.nombre},
            'á', 'a'), 'é', 'e'), 'í', 'i'), 'ó', 'o'), 'ú', 'u'),
          'Á', 'a'), 'É', 'e'), 'Í', 'i'), 'Ó', 'o'), 'Ú', 'u')
      ) = LOWER(${nombreLimpio})`
    );
  
  if (inversionistas_encontrados.length > 0) {
    console.log(`   ✅ Encontrados ${inversionistas_encontrados.length} con búsqueda exacta sin tildes`);
    return inversionistas_encontrados;
  }
  
  // ESTRATEGIA 2: Búsqueda CONTAINS
  console.log(`   🎯 Estrategia 2: Búsqueda con LIKE (contiene)...`);
  inversionistas_encontrados = await db
    .select()
    .from(inversionistas)
    .where(sql`LOWER(${inversionistas.nombre}) LIKE LOWER(${'%' + nombreLimpio + '%'})`);
  
  if (inversionistas_encontrados.length > 0) {
    console.log(`   ✅ Encontrados ${inversionistas_encontrados.length} con LIKE`);
    
    // Calcular score de similitud
    const inversionistasConScore = inversionistas_encontrados.map(inv => {
      const nombreBD = inv.nombre.toLowerCase();
      const nombreBuscado = nombreLimpio.toLowerCase();
      
      const palabrasBuscadas = nombreBuscado.split(' ').filter(p => p.length > 2);
      const palabrasEncontradas = palabrasBuscadas.filter(palabra => 
        nombreBD.includes(palabra)
      ).length;
      const scoreCoincidencia = palabrasEncontradas / palabrasBuscadas.length;
      
      const diffLongitud = Math.abs(nombreBD.length - nombreBuscado.length);
      const scoreLongitud = 1 - (diffLongitud / Math.max(nombreBD.length, nombreBuscado.length));
      
      const scoreInicio = nombreBD.startsWith(nombreBuscado.split(' ')[0].toLowerCase()) ? 1 : 0;
      
      const scoreTotal = (scoreCoincidencia * 0.5) + (scoreLongitud * 0.3) + (scoreInicio * 0.2);
      
      return { ...inv, score: scoreTotal };
    });
    
    inversionistasConScore.sort((a, b) => b.score - a.score);
    
    console.log(`   📊 Inversionistas ordenados por score:`);
    inversionistasConScore.forEach((inv, idx) => {
      console.log(`      ${idx + 1}. ${inv.nombre} (score: ${inv.score.toFixed(2)})`);
    });
    
    if (inversionistasConScore[0].score >= 0.6) {
      console.log(`   ✅ Inversionista con mejor score: ${inversionistasConScore[0].nombre}`);
      return [inversionistasConScore[0]];
    }
    
    return inversionistasConScore.slice(0, 3).map(inv => ({
      inversionista_id: inv.inversionista_id,
      nombre: inv.nombre
    }));
  }
  
  // ESTRATEGIA 3: Búsqueda por partes del nombre
  console.log(`   🎯 Estrategia 3: Búsqueda por partes del nombre...`);
  const palabras = nombreLimpio.split(' ').filter(p => p.length > 2);
  
  if (palabras.length >= 2) {
    const primeraPalabra = palabras[0];
    const ultimaPalabra = palabras[palabras.length - 1];
    
    console.log(`   🔍 Buscando con: "${primeraPalabra}" Y "${ultimaPalabra}"`);
    
    inversionistas_encontrados = await db
      .select()
      .from(inversionistas)
      .where(
        and(
          sql`LOWER(${inversionistas.nombre}) LIKE LOWER(${'%' + primeraPalabra + '%'})`,
          sql`LOWER(${inversionistas.nombre}) LIKE LOWER(${'%' + ultimaPalabra + '%'})`
        )
      );
    
    if (inversionistas_encontrados.length > 0) {
      console.log(`   ✅ Encontrados ${inversionistas_encontrados.length} con búsqueda por partes`);
      return inversionistas_encontrados;
    }
  }
  
  console.log(`   ❌ No se encontró ningún inversionista`);
  return [];
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

// 🔥 ENDPOINT PRINCIPAL (MODO AGRESIVO - CREA RELACIONES AUTOMÁTICAMENTE)
export async function liquidarCuotasPorUsuario(input: LiquidarCuotasInput) {
  try {
    console.log("🔥 ========== INICIANDO LIQUIDACIÓN DE CUOTAS ==========");
    console.log("📝 Input original:", JSON.stringify(input, null, 2));

    // 🆕 VALIDAR INPUT ANTES DE PROCESAR
    if (!input.nombre_usuario || input.nombre_usuario.trim() === '') {
      const errorMsg = "❌ El nombre del usuario es requerido";
      console.error(errorMsg);
      escribirLogAdvertencias('ERROR', errorMsg, { input });
      return {
        success: false,
        data: null,
        message: errorMsg,
        error: "Nombre de usuario vacío"
      };
    }

    if (!input.cuota_mes || input.cuota_mes.trim() === '') {
      const errorMsg = "❌ La cuota mes es requerida";
      console.error(errorMsg);
      escribirLogAdvertencias('ERROR', errorMsg, { input });
      return {
        success: false,
        data: null,
        message: errorMsg,
        error: "Cuota mes vacía"
      };
    }

    if (!input.capital || input.capital <= 0) {
      const errorMsg = "❌ El capital debe ser mayor a 0";
      console.error(errorMsg);
      escribirLogAdvertencias('ERROR', errorMsg, { input });
      return {
        success: false,
        data: null,
        message: errorMsg,
        error: "Capital inválido"
      };
    }

    if (!input.nombre_inversionista || input.nombre_inversionista.trim() === '') {
      const errorMsg = "❌ El nombre del inversionista es requerido";
      console.error(errorMsg);
      escribirLogAdvertencias('ERROR', errorMsg, { input });
      return {
        success: false,
        data: null,
        message: errorMsg,
        error: "Nombre de inversionista vacío"
      };
    }

    // 🧹 NORMALIZAR INPUT CON TRY-CATCH
    let cuota_mes_normalizada: string;
    try {
      cuota_mes_normalizada = normalizarCuotaMes(input.cuota_mes);
    } catch (err) {
      const errorMsg = `❌ Formato de mes inválido: "${input.cuota_mes}". Use formato "mes. año" (ej: "oct. 25")`;
      console.error(errorMsg, err);
      escribirLogAdvertencias('ERROR', errorMsg, { input_recibido: input.cuota_mes, error: err });
      return {
        success: false,
        data: null,
        message: errorMsg,
        error: err instanceof Error ? err.message : String(err),
        input_recibido: input.cuota_mes
      };
    }

    const nombre_usuario = input.nombre_usuario;
    const nombre_inversionista = input.nombre_inversionista;
    const capitalTotal = new Big(input.capital);

    console.log(`💰 Capital total recibido: ${capitalTotal.toString()}`);
    console.log(`👤 Inversionista buscado: "${nombre_inversionista}"`);

    // ============================================
    // 1️⃣ BUSCAR USUARIO CON BÚSQUEDA ULTRA PERMISIVA
    // ============================================
    const usuariosEncontrados = await buscarUsuarioPermisivo(nombre_usuario);

    if (usuariosEncontrados.length === 0) {
      const errorMsg = `❌ No se encontró ningún usuario con nombre: "${nombre_usuario}"`;
      console.error(errorMsg);
      escribirLogAdvertencias('ERROR', errorMsg, { nombre_buscado: nombre_usuario });
      return {
        success: false,
        data: null,
        message: errorMsg,
        error: "Usuario no encontrado en la base de datos",
        nombre_buscado: nombre_usuario,
        sugerencia: "Verificá que el nombre esté escrito correctamente (tildes, mayúsculas, etc.)"
      };
    }

    let usuario;

    if (usuariosEncontrados.length > 1) {
      console.log("⚠️ Múltiples usuarios encontrados:");
      usuariosEncontrados.forEach((u, idx) => {
        console.log(`   ${idx + 1}. ${u.nombre} (ID: ${u.usuario_id})`);
      });
      
      const matchExacto = usuariosEncontrados.find(
        u => u.nombre.trim().toLowerCase() === nombre_usuario.trim().toLowerCase()
      );
      
      if (matchExacto) {
        console.log(`✅ MATCH EXACTO ENCONTRADO: ${matchExacto.nombre}`);
        usuario = matchExacto;
      } else if (usuariosEncontrados.length <= 10) {
        console.log(`⚠️ Sin match exacto, TOMANDO EL PRIMERO: ${usuariosEncontrados[0].nombre}`);
        usuario = usuariosEncontrados[0];
        
        escribirLogAdvertencias('ADVERTENCIA', 'Múltiples usuarios encontrados, se tomó el primero', {
          nombre_buscado: nombre_usuario,
          usuario_seleccionado: usuariosEncontrados[0].nombre,
          otros_encontrados: usuariosEncontrados.slice(1, 5).map(u => u.nombre)
        });
      } else {
        const errorMsg = `❌ Se encontraron ${usuariosEncontrados.length} usuarios con nombres similares y ninguno coincide exactamente`;
        console.error(errorMsg);
        escribirLogAdvertencias('ERROR', errorMsg, {
          nombre_buscado: nombre_usuario,
          usuarios_encontrados: usuariosEncontrados.slice(0, 10).map(u => u.nombre)
        });
        return {
          success: false,
          data: null,
          message: errorMsg,
          error: "Múltiples usuarios encontrados sin match exacto",
          nombre_buscado: nombre_usuario,
          usuarios_encontrados: usuariosEncontrados.slice(0, 10).map(u => u.nombre),
          sugerencia: "Especificá el nombre COMPLETO Y EXACTO del usuario"
        };
      }
    } else {
      usuario = usuariosEncontrados[0];
    }

    console.log(
      "✅ Usuario seleccionado:",
      usuario.nombre,
      `(ID: ${usuario.usuario_id})`
    );

    // ============================================
    // 2️⃣ BUSCAR INVERSIONISTA CON BÚSQUEDA ULTRA PERMISIVA
    // ============================================
    const inversionistasEncontrados = await buscarInversionistaPermisivo(nombre_inversionista);

    if (inversionistasEncontrados.length === 0) {
      const errorMsg = `❌ No se encontró ningún inversionista con nombre: "${nombre_inversionista}"`;
      console.error(errorMsg);
      escribirLogAdvertencias('ERROR', errorMsg, { nombre_buscado: nombre_inversionista });
      return {
        success: false,
        data: null,
        message: errorMsg,
        error: "Inversionista no encontrado en la base de datos",
        nombre_buscado: nombre_inversionista,
        sugerencia: "Verificá que el nombre del inversionista esté correcto"
      };
    }

    let inversionista;

    if (inversionistasEncontrados.length > 1) {
      console.log("⚠️ Múltiples inversionistas encontrados:");
      inversionistasEncontrados.forEach((inv, idx) => {
        console.log(`   ${idx + 1}. ${inv.nombre} (ID: ${inv.inversionista_id})`);
      });
      
      const matchExacto = inversionistasEncontrados.find(
        inv => inv.nombre.trim().toLowerCase() === nombre_inversionista.trim().toLowerCase()
      );
      
      if (matchExacto) {
        console.log(`✅ MATCH EXACTO ENCONTRADO: ${matchExacto.nombre}`);
        inversionista = matchExacto;
      } else if (inversionistasEncontrados.length <= 10) {
        console.log(`⚠️ Sin match exacto, TOMANDO EL PRIMERO: ${inversionistasEncontrados[0].nombre}`);
        inversionista = inversionistasEncontrados[0];
        
        escribirLogAdvertencias('ADVERTENCIA', 'Múltiples inversionistas encontrados, se tomó el primero', {
          nombre_buscado: nombre_inversionista,
          inversionista_seleccionado: inversionistasEncontrados[0].nombre,
          otros_encontrados: inversionistasEncontrados.slice(1, 5).map(inv => inv.nombre)
        });
      } else {
        const errorMsg = `❌ Se encontraron ${inversionistasEncontrados.length} inversionistas con nombres similares`;
        console.error(errorMsg);
        escribirLogAdvertencias('ERROR', errorMsg, {
          nombre_buscado: nombre_inversionista,
          inversionistas_encontrados: inversionistasEncontrados.slice(0, 10).map(inv => inv.nombre)
        });
        return {
          success: false,
          data: null,
          message: errorMsg,
          error: "Múltiples inversionistas encontrados sin match exacto",
          nombre_buscado: nombre_inversionista,
          inversionistas_encontrados: inversionistasEncontrados.slice(0, 10).map(inv => inv.nombre),
          sugerencia: "Especificá el nombre COMPLETO Y EXACTO del inversionista"
        };
      }
    } else {
      inversionista = inversionistasEncontrados[0];
    }

    console.log(
      "✅ Inversionista seleccionado:",
      inversionista.nombre,
      `(ID: ${inversionista.inversionista_id})`
    );

    // ============================================
    // 3️⃣ BUSCAR CRÉDITOS DEL USUARIO
    // ============================================
    console.log("✅ Paso 3: Buscando créditos del usuario...");

    const creditosUsuario = await db
      .select()
      .from(creditos)
      .where(eq(creditos.usuario_id, usuario.usuario_id));

    console.log(`✅ ${creditosUsuario.length} créditos encontrados`);

    if (creditosUsuario.length === 0) {
      const errorMsg = `❌ El usuario "${usuario.nombre}" no tiene créditos registrados`;
      console.error(errorMsg);
      escribirLogAdvertencias('ERROR', errorMsg, {
        usuario_id: usuario.usuario_id,
        nombre: usuario.nombre
      });
      return {
        success: false,
        data: null,
        message: errorMsg,
        error: "Usuario sin créditos",
        usuario: {
          usuario_id: usuario.usuario_id,
          nombre: usuario.nombre
        },
        sugerencia: "Verificá que los créditos estén cargados en la base de datos"
      };
    }

    // ============================================
    // 4️⃣ RESETEAR TODAS LAS CUOTAS DEL USUARIO
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
    // 5️⃣ CALCULAR RANGO DEL MES CON TRY-CATCH
    // ============================================
    let rangoMes;
    try {
      rangoMes = obtenerRangoDelMes(cuota_mes_normalizada);
      console.log(`\n📅 ========== RANGO CALCULADO ==========`);
      console.log(`   Input original: "${input.cuota_mes}"`);
      console.log(`   Normalizado: "${cuota_mes_normalizada}"`);
      console.log(`   Mes descriptivo: ${rangoMes.mesDescriptivo}`);
      console.log(`   Rango inicio: ${rangoMes.inicio}`);
      console.log(`   Rango fin: ${rangoMes.fin}`);
      console.log(`========================================\n`);
    } catch (err) {
      const errorMsg = `❌ Error al procesar el mes: "${input.cuota_mes}"`;
      console.error(errorMsg, err);
      escribirLogAdvertencias('ERROR', errorMsg, {
        cuota_mes_recibida: input.cuota_mes,
        cuota_mes_normalizada: cuota_mes_normalizada,
        error: err
      });
      return {
        success: false,
        data: null,
        message: errorMsg,
        error: err instanceof Error ? err.message : String(err),
        cuota_mes_recibida: input.cuota_mes,
        cuota_mes_normalizada: cuota_mes_normalizada,
        sugerencia: "Use formato 'mes. año' (ej: 'oct. 25', 'sep. 2025')"
      };
    }

    // ============================================
    // 6️⃣ PROCESAR CADA CRÉDITO
    // ============================================
    const resultadosPorCredito = [];
    let creditosSinCuotas = 0;
    let totalInversionistasActualizados = 0;
    let totalRelacionesCreadas = 0; // 🆕 CONTADOR
    const advertencias: string[] = [];

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
      // 7️⃣ BUSCAR LA CUOTA QUE COINCIDE CON EL MES
      // ============================================
      console.log(`\n   🔍 BUSCANDO cuota que vence en ${cuota_mes_normalizada}...`);
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

      let numeroCuotaALiquidar = 0;
      let cuotasLiquidadas = 0;

      if (cuotaDelMes.length === 0) {
        const advertencia = `⚠️ Crédito ${credito.numero_credito_sifco}: No hay cuota que venza en ${cuota_mes_normalizada}`;
        console.log(`   ${advertencia}`);
        advertencias.push(advertencia);
        
        escribirLogAdvertencias('ADVERTENCIA', advertencia, {
          credito_id: credito.credito_id,
          numero_credito: credito.numero_credito_sifco,
          mes_buscado: cuota_mes_normalizada,
          rango_busqueda: `${rangoMes.inicio} - ${rangoMes.fin}`
        });
        
        creditosSinCuotas++;
      } else {
        console.log(`   🎯 Cuotas que coinciden con ${cuota_mes_normalizada}:`);
        cuotaDelMes.forEach((c) => {
          console.log(`      - Cuota #${c.numero_cuota} | Vence: ${c.fecha_vencimiento}`);
        });

        const cuotaEncontrada = cuotaDelMes[0];
        numeroCuotaALiquidar = cuotaEncontrada.numero_cuota;

        console.log(`\n   ✅ CUOTA SELECCIONADA: #${numeroCuotaALiquidar}`);
        console.log(`      Vence: ${cuotaEncontrada.fecha_vencimiento}`);
        console.log(`      Liquidado: ${cuotaEncontrada.liquidado_inversionistas ? 'SÍ' : 'NO'}`);
        console.log(`\n   📊 LIQUIDANDO cuotas desde 1 hasta ${numeroCuotaALiquidar}...`);

        // ============================================
        // 8️⃣ LIQUIDAR HASTA ESA CUOTA
        // ============================================
        const resultado = await db
          .update(cuotas_credito)
          .set({
            liquidado_inversionistas: true,
            fecha_liquidacion_inversionistas: new Date(),
          })
          .where(
            and(
              eq(cuotas_credito.credito_id, credito.credito_id),
              lte(cuotas_credito.numero_cuota, numeroCuotaALiquidar)
            )
          )
          .returning();

        cuotasLiquidadas = resultado.length;
        console.log(`   ✅ ${cuotasLiquidadas} cuotas ACTUALIZADAS\n`);
      }

      // ============================================
      // 🆕 9️⃣ BUSCAR Y ACTUALIZAR INVERSIONISTA (MODO AGRESIVO)
      // ============================================
      console.log(`\n   👥 ========== BUSCANDO INVERSIONISTA EN ESTE CRÉDITO ==========`);
      
      const relacionInversionista = await db
        .select()
        .from(creditos_inversionistas)
        .innerJoin(creditos, eq(creditos.credito_id, creditos_inversionistas.credito_id))
        .where(
          and(
            eq(creditos_inversionistas.credito_id, credito.credito_id),
            eq(creditos_inversionistas.inversionista_id, inversionista.inversionista_id)
          )
        );

      if (relacionInversionista.length === 0) {
        // 🔥 MODO AGRESIVO: CREAR LA RELACIÓN AUTOMÁTICAMENTE
        const advertencia = `🔥 Crédito ${credito.numero_credito_sifco}: El inversionista "${inversionista.nombre}" NO participaba - CREANDO RELACIÓN AUTOMÁTICAMENTE`;
        console.log(`   ${advertencia}`);
        advertencias.push(advertencia);
        
        console.log(`\n   🔧 ========== CREANDO RELACIÓN AUTOMÁTICA ==========`);
        
        // Calcular valores
        const porcentajeInteres = new Big(credito.porcentaje_interes || 0).div(100);
        const cuotaInteres = capitalTotal.times(porcentajeInteres);
        
        // 🔥 Valores por defecto (50/50)
        const porcentajeCashIn = 50;
        const porcentajeInversionista = 50;
        
        const montoInversionista = cuotaInteres.times(0.5).toFixed(2);
        const montoCashIn = cuotaInteres.times(0.5).toFixed(2);
        const ivaInversionista = new Big(montoInversionista).times(0.12).toFixed(2);
        const ivaCashIn = new Big(montoCashIn).times(0.12).toFixed(2);
        
        console.log(`      💰 Capital: ${capitalTotal.toFixed(2)}`);
        console.log(`      📊 % Interés crédito: ${porcentajeInteres.times(100).toString()}%`);
        console.log(`      💵 Cuota interés: ${cuotaInteres.toFixed(2)}`);
        console.log(`      📊 % Cash In: ${porcentajeCashIn}% (por defecto)`);
        console.log(`      📊 % Inversionista: ${porcentajeInversionista}% (por defecto)`);
        console.log(`      💵 Monto inversionista: ${montoInversionista}`);
        console.log(`      💵 Monto cash_in: ${montoCashIn}`);
        console.log(`      📄 IVA inversionista: ${ivaInversionista}`);
        console.log(`      📄 IVA cash_in: ${ivaCashIn}`);
        
        // 🔥 INSERTAR EN BD
        await db
          .insert(creditos_inversionistas)
          .values({
            credito_id: credito.credito_id,
            inversionista_id: inversionista.inversionista_id,
            monto_aportado: capitalTotal.toFixed(2),
            porcentaje_cash_in: porcentajeCashIn.toString(),
            porcentaje_participacion_inversionista: porcentajeInversionista.toString(),
            cuota_inversionista: "0",
            monto_inversionista: montoInversionista,
            monto_cash_in: montoCashIn,
            iva_inversionista: ivaInversionista,
            iva_cash_in: ivaCashIn
          });
        
        console.log(`      ✅ RELACIÓN CREADA CON ÉXITO`);
        totalInversionistasActualizados++;
        totalRelacionesCreadas++; // 🆕
        
        // 🆕 ESCRIBIR LOG DE RELACIÓN CREADA
        escribirLogAdvertencias('RELACION_CREADA', 
          `Se creó automáticamente la relación inversionista-crédito`, 
          {
            usuario: usuario.nombre,
            usuario_id: usuario.usuario_id,
            inversionista: inversionista.nombre,
            inversionista_id: inversionista.inversionista_id,
            credito: credito.numero_credito_sifco,
            credito_id: credito.credito_id,
            capital: capitalTotal.toString(),
            porcentaje_cash_in: porcentajeCashIn,
            porcentaje_inversionista: porcentajeInversionista,
            monto_inversionista: montoInversionista,
            monto_cash_in: montoCashIn,
            iva_inversionista: ivaInversionista,
            iva_cash_in: ivaCashIn,
            mes: rangoMes.mesDescriptivo
          }
        );
        
        resultadosPorCredito.push({
          credito_id: credito.credito_id,
          numero_credito: credito.numero_credito_sifco,
          cuota_encontrada: numeroCuotaALiquidar || null,
          cuotas_liquidadas: cuotasLiquidadas,
          inversionistas_actualizados: 1,
          relacion_creada: true, // 🆕
          advertencia: "Relación inversionista-crédito creada automáticamente (50/50)",
          cuotas_actualizadas: cuotasLiquidadas > 0 ? todasLasCuotas
            .filter(c => c.numero_cuota <= numeroCuotaALiquidar)
            .map(c => ({
              numero_cuota: c.numero_cuota,
              fecha_vencimiento: c.fecha_vencimiento
            })) : []
        });
        
        continue;
      }

      // ✅ SI SÍ EXISTE LA RELACIÓN - ACTUALIZAR
      const relacion = relacionInversionista[0].creditos_inversionistas;
      
      console.log(`   ✅ INVERSIONISTA ENCONTRADO EN ESTE CRÉDITO`);
      console.log(`      Monto aportado ANTERIOR: ${relacion.monto_aportado}`);
      console.log(`      % Cash In: ${relacion.porcentaje_cash_in}%`);
      console.log(`      % Inversionista: ${relacion.porcentaje_participacion_inversionista}%`);
      console.log(`      Cuota inversionista: ${relacion.cuota_inversionista}%`);

      // ============================================
      // 🆕 🔟 RECALCULAR TODO CON EL NUEVO CAPITAL
      // ============================================
      console.log(`\n   🧮 ========== RECALCULANDO MONTOS ==========`);
      
      const nuevoMontoAportado = capitalTotal;
      
      console.log(`      💰 NUEVO Monto aportado: ${nuevoMontoAportado.toFixed(2)}`);
      
      const porcentajeCashIn = new Big(relacion.porcentaje_cash_in || 0).div(100);
      const porcentajeInversionista = new Big(relacion.porcentaje_participacion_inversionista || 0).div(100);
      const interes = new Big(relacionInversionista[0].creditos.porcentaje_interes || 0).div(100);
      
      console.log(`      📊 % Cash In: ${porcentajeCashIn.times(100).toString()}%`);
      console.log(`      📊 % Inversionista: ${porcentajeInversionista.times(100).toString()}%`);
      console.log(`      📊 % Interés: ${interes.times(100).toString()}%`);
      
      const cuotaInteres = nuevoMontoAportado.times(interes);
      
      console.log(`      💵 Cuota interés total: ${cuotaInteres.toFixed(2)}`);
      
      const nuevoMontoInversionista = cuotaInteres.times(porcentajeInversionista).toFixed(2);
      const nuevoMontoCashIn = cuotaInteres.times(porcentajeCashIn).toFixed(2);
      
      console.log(`      💵 Monto inversionista: ${nuevoMontoInversionista}`);
      console.log(`      💵 Monto cash_in: ${nuevoMontoCashIn}`);
      
      const nuevoIvaInversionista = Number(nuevoMontoInversionista) > 0
        ? new Big(nuevoMontoInversionista).times(0.12).toFixed(2)
        : "0.00";
      
      const nuevoIvaCashIn = Number(nuevoMontoCashIn) > 0
        ? new Big(nuevoMontoCashIn).times(0.12).toFixed(2)
        : "0.00";
      
      console.log(`      📄 IVA inversionista: ${nuevoIvaInversionista}`);
      console.log(`      📄 IVA cash_in: ${nuevoIvaCashIn}`);
      
      console.log(`\n      💾 ACTUALIZANDO EN BD...`);
      
      await db
        .update(creditos_inversionistas)
        .set({
          monto_aportado: nuevoMontoAportado.toFixed(2),
          monto_inversionista: nuevoMontoInversionista,
          monto_cash_in: nuevoMontoCashIn,
          iva_inversionista: nuevoIvaInversionista,
          iva_cash_in: nuevoIvaCashIn,
          fecha_creacion: new Date(),
        })
        .where(
          and(
            eq(creditos_inversionistas.credito_id, credito.credito_id),
            eq(creditos_inversionistas.inversionista_id, inversionista.inversionista_id)
          )
        );
      
      console.log(`      ✅ INVERSIONISTA ACTUALIZADO`);
      totalInversionistasActualizados++;

      resultadosPorCredito.push({
        credito_id: credito.credito_id,
        numero_credito: credito.numero_credito_sifco,
        cuota_encontrada: numeroCuotaALiquidar || null,
        cuotas_liquidadas: cuotasLiquidadas,
        inversionistas_actualizados: 1,
        relacion_creada: false,
        advertencia: cuotasLiquidadas === 0 ? "No había cuota para liquidar en este mes, pero el inversionista fue actualizado" : null,
        cuotas_actualizadas: cuotasLiquidadas > 0 ? todasLasCuotas
          .filter(c => c.numero_cuota <= numeroCuotaALiquidar)
          .map(c => ({
            numero_cuota: c.numero_cuota,
            fecha_vencimiento: c.fecha_vencimiento
          })) : []
      });
    }

    // ============================================
    // 1️⃣1️⃣ RESPUESTA FINAL
    // ============================================
    console.log("\n🎉 ========== LIQUIDACIÓN COMPLETADA ==========");
    console.log(`✅ Usuario: ${usuario.nombre}`);
    console.log(`✅ Inversionista: ${inversionista.nombre}`);
    console.log(`✅ Créditos procesados: ${creditosUsuario.length}`);
    console.log(`✅ Cuotas reseteadas inicialmente: ${totalCuotasReseteadas}`);
    console.log(`✅ Mes buscado: ${rangoMes.mesDescriptivo}`);
    console.log(`💰 Capital aplicado: ${capitalTotal.toString()}`);
    console.log(`👥 Inversionistas actualizados: ${totalInversionistasActualizados}`);
    console.log(`🔥 Relaciones creadas: ${totalRelacionesCreadas}`); // 🆕
    console.log(`⚠️ Créditos sin cuotas para este mes: ${creditosSinCuotas}`);

    if (advertencias.length > 0) {
      console.log(`\n⚠️ ========== ADVERTENCIAS ==========`);
      advertencias.forEach(adv => console.log(`   ${adv}`));
      console.log(`======================================`);
    }

    const totalCuotasLiquidadas = resultadosPorCredito.reduce(
      (sum, r) => sum + (r.cuotas_liquidadas || 0), 0
    );

    console.log(`✅ Total cuotas liquidadas: ${totalCuotasLiquidadas}`);

    return {
      success: true,
      data: {
        usuario: {
          usuario_id: usuario.usuario_id,
          nombre: usuario.nombre,
        },
        inversionista: {
          inversionista_id: inversionista.inversionista_id,
          nombre: inversionista.nombre,
        },
        capital_aplicado: capitalTotal.toString(),
        creditos_procesados: creditosUsuario.length,
        creditos_sin_cuotas: creditosSinCuotas,
        cuotas_reseteadas: totalCuotasReseteadas,
        inversionistas_actualizados: totalInversionistasActualizados,
        relaciones_creadas: totalRelacionesCreadas, // 🆕
        cuota_mes_original: input.cuota_mes,
        cuota_mes_normalizada: cuota_mes_normalizada,
        rango_liquidado: rangoMes,
        total_cuotas_liquidadas: totalCuotasLiquidadas,
        advertencias: advertencias,
        detalle_por_credito: resultadosPorCredito,
      },
      message: `Liquidación completada para ${usuario.nombre} - Inversionista: ${inversionista.nombre} - Mes: ${rangoMes.mesDescriptivo} - Capital: Q${capitalTotal.toString()}${totalRelacionesCreadas > 0 ? ` (${totalRelacionesCreadas} relación${totalRelacionesCreadas > 1 ? 'es' : ''} creada${totalRelacionesCreadas > 1 ? 's' : ''})` : ''}${advertencias.length > 0 ? ` (${advertencias.length} advertencia${advertencias.length > 1 ? 's' : ''})` : ''}`,
    };
  } catch (error) {
    console.error("❌ Error en liquidación de cuotas:", error);
    escribirLogAdvertencias('ERROR', 'Error fatal en liquidación', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    return {
      success: false,
      data: null,
      message: `❌ Error inesperado: ${error instanceof Error ? error.message : 'Error desconocido'}`,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    };
  }
}