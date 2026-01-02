import { eq, and, lte, gte, sql } from "drizzle-orm";
import { db } from "../database";
import { usuarios, creditos, cuotas_credito, inversionistas, creditos_inversionistas } from "../database/db";
import Big from "big.js";

// 📊 INTERFACE PARA EL INPUT
interface LiquidarCuotasInput {
  nombre_usuario: string;
  cuota_mes: string;
  capital: number; // 🆕 NUEVO CAPITAL A APLICAR
  nombre_inversionista: string; // 🆕 NOMBRE DEL INVERSIONISTA
}

// 🧹 NORMALIZAR FORMATO DE MES - ULTRA PERMISIVO
function normalizarCuotaMes(cuota_mes: string): string {
  console.log(`   🔧 Normalizando mes: "${cuota_mes}"`);
  
  let normalizado = cuota_mes.trim();
  
  // 1. Remover puntos extras al final
  normalizado = normalizado.replace(/\.+$/g, '');
  
  // 2. Convertir año de 4 dígitos a 2
  normalizado = normalizado.replace(/\b2025\b/g, '25');
  normalizado = normalizado.replace(/\b2024\b/g, '24');
  normalizado = normalizado.replace(/\b2023\b/g, '23');
  normalizado = normalizado.replace(/\b2022\b/g, '22');
  normalizado = normalizado.replace(/\b2021\b/g, '21');
  normalizado = normalizado.replace(/\b2020\b/g, '20');
  
  // 3. Casos especiales: múltiples meses (ej: "ago. 25 y sep. 25")
  if (normalizado.includes(' y ')) {
    console.log(`   ⚠️ Múltiples meses detectados, tomando el último`);
    const meses = normalizado.split(' y ').map(m => m.trim());
    normalizado = meses[meses.length - 1];
    console.log(`   ✅ Mes seleccionado: "${normalizado}"`);
  }
  
  // 4. Si tiene múltiples meses separados por comas
  if (normalizado.includes(',')) {
    console.log(`   ⚠️ Múltiples meses con coma, tomando el último`);
    const meses = normalizado.split(',').map(m => m.trim());
    normalizado = meses[meses.length - 1];
    console.log(`   ✅ Mes seleccionado: "${normalizado}"`);
  }
  
  // 5. Limpiar espacios múltiples
  normalizado = normalizado.replace(/\s+/g, ' ');
  
  // 6. Asegurar que tiene punto después del mes
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
    .replace(/\s+/g, ' ') // espacios múltiples
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

// 🔍 BÚSQUEDA ULTRA PERMISIVA DE INVERSIONISTA (🆕 NUEVA FUNCIÓN)
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

// 🔥 ENDPOINT PRINCIPAL (MODIFICADO CON CAPITAL E INVERSIONISTA)
export async function liquidarCuotasPorUsuario(input: LiquidarCuotasInput) {
  try {
    console.log("🔥 ========== INICIANDO LIQUIDACIÓN DE CUOTAS ==========");
    console.log("📝 Input original:", JSON.stringify(input, null, 2));

    // 🆕 VALIDAR INPUT ANTES DE PROCESAR
    if (!input.nombre_usuario || input.nombre_usuario.trim() === '') {
      const errorMsg = "❌ El nombre del usuario es requerido";
      console.error(errorMsg);
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
      return {
        success: false,
        data: null,
        message: errorMsg,
        error: "Usuario no encontrado en la base de datos",
        nombre_buscado: nombre_usuario,
        sugerencia: "Verificá que el nombre esté escrito correctamente (tildes, mayúsculas, etc.)"
      };
    }

    // DECLARAR VARIABLE USUARIO FUERA DEL IF
    let usuario;

    if (usuariosEncontrados.length > 1) {
      console.log("⚠️ Múltiples usuarios encontrados:");
      usuariosEncontrados.forEach((u, idx) => {
        console.log(`   ${idx + 1}. ${u.nombre} (ID: ${u.usuario_id})`);
      });
      
      // BUSCAR MATCH EXACTO (case insensitive)
      const matchExacto = usuariosEncontrados.find(
        u => u.nombre.trim().toLowerCase() === nombre_usuario.trim().toLowerCase()
      );
      
      if (matchExacto) {
        console.log(`✅ MATCH EXACTO ENCONTRADO: ${matchExacto.nombre}`);
        usuario = matchExacto;
      } else if (usuariosEncontrados.length <= 10) {
        console.log(`⚠️ Sin match exacto, TOMANDO EL PRIMERO: ${usuariosEncontrados[0].nombre}`);
        usuario = usuariosEncontrados[0];
      } else {
        const errorMsg = `❌ Se encontraron ${usuariosEncontrados.length} usuarios con nombres similares y ninguno coincide exactamente`;
        console.error(errorMsg);
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
    // 2️⃣ BUSCAR INVERSIONISTA CON BÚSQUEDA ULTRA PERMISIVA (🆕 NUEVO)
    // ============================================
    const inversionistasEncontrados = await buscarInversionistaPermisivo(nombre_inversionista);

    if (inversionistasEncontrados.length === 0) {
      const errorMsg = `❌ No se encontró ningún inversionista con nombre: "${nombre_inversionista}"`;
      console.error(errorMsg);
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
      } else {
        const errorMsg = `❌ Se encontraron ${inversionistasEncontrados.length} inversionistas con nombres similares`;
        console.error(errorMsg);
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
    let totalInversionistasActualizados = 0; // 🆕 CONTADOR

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

      if (cuotaDelMes.length > 0) {
        console.log(`   🎯 Cuotas que coinciden con ${cuota_mes_normalizada}:`);
        cuotaDelMes.forEach((c) => {
          console.log(`      - Cuota #${c.numero_cuota} | Vence: ${c.fecha_vencimiento}`);
        });
      }

      if (cuotaDelMes.length === 0) {
        console.log(`   ⚠️ NO SE ENCONTRÓ cuota que venza en ${cuota_mes_normalizada}`);
        console.log(`   ⚠️ Revisá que las fechas de vencimiento estén en el rango correcto`);
        
        creditosSinCuotas++;
        
        resultadosPorCredito.push({
          credito_id: credito.credito_id,
          numero_credito: credito.numero_credito_sifco,
          cuotas_liquidadas: 0,
          inversionistas_actualizados: 0,
          mensaje: `No hay cuota que venza en ${cuota_mes_normalizada}`,
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

      console.log(`   ✅ ${resultado.length} cuotas ACTUALIZADAS\n`);

      // ============================================
      // 🆕 9️⃣ BUSCAR SI ESTE CRÉDITO TIENE AL INVERSIONISTA
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
        console.log(`   ⚠️ El inversionista "${inversionista.nombre}" NO participa en este crédito`);
        resultadosPorCredito.push({
          credito_id: credito.credito_id,
          numero_credito: credito.numero_credito_sifco,
          cuotas_liquidadas: resultado.length,
          inversionistas_actualizados: 0,
          mensaje: `Inversionista no participa en este crédito`
        });
        continue;
      }

      const relacion = relacionInversionista[0].creditos_inversionistas
      
      console.log(`   ✅ INVERSIONISTA ENCONTRADO EN ESTE CRÉDITO`);
      console.log(`      Monto aportado ANTERIOR: ${relacion.monto_aportado}`);
      console.log(`      % Cash In: ${relacion.porcentaje_cash_in}%`);
      console.log(`      % Inversionista: ${relacion.porcentaje_participacion_inversionista}%`);
      console.log(`      Cuota inversionista: ${relacion.cuota_inversionista}%`);

      // ============================================
      // 🆕 🔟 RECALCULAR TODO CON EL NUEVO CAPITAL
      // ============================================
      console.log(`\n   🧮 ========== RECALCULANDO MONTOS ==========`);
      
      // 💰 EL CAPITAL ES EL NUEVO MONTO APORTADO
      const nuevoMontoAportado = capitalTotal;
      
      console.log(`      💰 NUEVO Monto aportado: ${nuevoMontoAportado.toFixed(2)}`);
      
      // Obtener porcentajes de la BD (vienen en formato 0-100)
      const porcentajeCashIn = new Big(relacion.porcentaje_cash_in || 0).div(100);
      const porcentajeInversionista = new Big(relacion.porcentaje_participacion_inversionista || 0).div(100);
      const interes = new Big(relacionInversionista[0].creditos.porcentaje_interes || 0).div(100); // % de interés
      
      console.log(`      📊 % Cash In: ${porcentajeCashIn.times(100).toString()}%`);
      console.log(`      📊 % Inversionista: ${porcentajeInversionista.times(100).toString()}%`);
      console.log(`      📊 % Interés: ${interes.times(100).toString()}%`);
      
      // 🧮 CALCULAR CUOTA DE INTERÉS BASE
      const cuotaInteres = nuevoMontoAportado.times(interes);
      
      console.log(`      💵 Cuota interés total: ${cuotaInteres.toFixed(2)}`);
      
      // 💸 DIVIDIR ENTRE INVERSIONISTA Y CASH_IN
      const nuevoMontoInversionista = cuotaInteres.times(porcentajeInversionista).toFixed(2);
      const nuevoMontoCashIn = cuotaInteres.times(porcentajeCashIn).toFixed(2);
      
      console.log(`      💵 Monto inversionista: ${nuevoMontoInversionista}`);
      console.log(`      💵 Monto cash_in: ${nuevoMontoCashIn}`);
      
      // 📄 CALCULAR IVAs (12%)
      const nuevoIvaInversionista = Number(nuevoMontoInversionista) > 0
        ? new Big(nuevoMontoInversionista).times(0.12).toFixed(2)
        : "0.00";
      
      const nuevoIvaCashIn = Number(nuevoMontoCashIn) > 0
        ? new Big(nuevoMontoCashIn).times(0.12).toFixed(2)
        : "0.00";
      
      console.log(`      📄 IVA inversionista: ${nuevoIvaInversionista}`);
      console.log(`      📄 IVA cash_in: ${nuevoIvaCashIn}`);
      
      // 💾 ACTUALIZAR EN LA BASE DE DATOS
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
        cuota_encontrada: numeroCuotaALiquidar,
        cuotas_liquidadas: resultado.length,
        inversionistas_actualizados: 1,
        cuotas_actualizadas: resultado.map(c => ({
          numero_cuota: c.numero_cuota,
          fecha_vencimiento: c.fecha_vencimiento
        }))
      });
    }

    // 🆕 SI NINGÚN CRÉDITO TIENE CUOTAS PARA ESE MES
    if (creditosSinCuotas === creditosUsuario.length) {
      const errorMsg = `❌ Ninguno de los ${creditosUsuario.length} crédito(s) de "${usuario.nombre}" tiene cuotas que venzan en ${rangoMes.mesDescriptivo}`;
      console.error(errorMsg);
      return {
        success: false,
        data: null,
        message: errorMsg,
        error: "No hay cuotas para liquidar en ese mes",
        usuario: {
          usuario_id: usuario.usuario_id,
          nombre: usuario.nombre
        },
        creditos_revisados: creditosUsuario.length,
        mes_buscado: rangoMes.mesDescriptivo,
        rango_fechas: `${rangoMes.inicio} - ${rangoMes.fin}`,
        detalle_por_credito: resultadosPorCredito,
        sugerencia: "Verificá que las fechas de vencimiento de las cuotas estén correctas en la BD"
      };
    }

    // ============================================
    // 1️⃣1️⃣ RESPUESTA FINAL
    // ============================================
    console.log("\n🎉 ========== LIQUIDACIÓN COMPLETADA ==========");
    console.log(`✅ Usuario: ${usuario.nombre}`);
    console.log(`✅ Inversionista: ${inversionista.nombre}`);
    console.log(`✅ Créditos procesados: ${creditosUsuario.length}`);
    console.log(`✅ Cuotas reseteadas inicialmente: ${totalCuotasReseteadas}`);
    console.log(`✅ Mes liquidado: ${rangoMes.mesDescriptivo}`);
    console.log(`💰 Capital aplicado: ${capitalTotal.toString()}`);
    console.log(`👥 Inversionistas actualizados: ${totalInversionistasActualizados}`);

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
        cuota_mes_original: input.cuota_mes,
        cuota_mes_normalizada: cuota_mes_normalizada,
        rango_liquidado: rangoMes,
        total_cuotas_liquidadas: totalCuotasLiquidadas,
        detalle_por_credito: resultadosPorCredito,
      },
      message: `Liquidación completada para ${usuario.nombre} - Inversionista: ${inversionista.nombre} - Mes: ${rangoMes.mesDescriptivo} - Capital: Q${capitalTotal.toString()}`,
    };
  } catch (error) {
    console.error("❌ Error en liquidación de cuotas:", error);
    return {
      success: false,
      data: null,
      message: `❌ Error inesperado: ${error instanceof Error ? error.message : 'Error desconocido'}`,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    };
  }
}