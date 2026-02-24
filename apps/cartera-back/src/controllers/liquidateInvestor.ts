import { eq, and, lte, gte, sql, desc } from "drizzle-orm";
import { db } from "../database";
import {
  usuarios,
  creditos,
  cuotas_credito,
  inversionistas,
  creditos_inversionistas,
  boletasPagoInversionista,
} from "../database/db";
import Big from "big.js";
import fs from "fs"; // 🆕 Para escribir logs
import path from "path/win32";

// 📊 INTERFACE PARA EL INPUT
interface LiquidarCuotasInput {
  nombre_usuario: string;
  cuota_mes: string;
  capital: number;
  nombre_inversionista: string;
}

interface RelacionFallida {
  credito: string;
  credito_id: number;
  inversionista_buscado: string;
  inversionista_id: number;
  capital_intentado: string;
  razon: string;
  inversionistas_existentes: Array<{
    nombre: string;
    inversionista_id: number;
    monto_aportado: string;
  }>;
}

interface ResultadoCredito {
  credito_id: number;
  numero_credito: string;
  cuota_encontrada: number | null;
  cuotas_liquidadas: number;
  inversionistas_actualizados: number;
  relacion_creada: boolean;
  error?: string;
  advertencia?: string;
  inversionistas_existentes?: string[];
  cuotas_actualizadas?: Array<{
    numero_cuota: number;
    fecha_vencimiento: string;
  }>;
}
const CREAR_RELACIONES_AUTOMATICAMENTE = true;
// 🔥 FUNCIÓN HELPER PARA NORMALIZAR PORCENTAJES
function normalizarPorcentaje(valor: string | number | null | undefined): Big {
  const num = new Big(valor || 0);

  // Si es menor a 1, ya está en formato decimal (0.20 = 20%)
  if (num.lt(1)) {
    console.log(
      `      🔧 Porcentaje ya en decimal: ${valor} → ${num.toString()}`,
    );
    return num; // Ya está como 0.20, usar directo
  }

  // Si es >= 1, está como entero (20 = 20%), dividir entre 100
  const decimal = num.div(100);
  console.log(
    `      🔧 Porcentaje convertido: ${valor} → ${decimal.toString()}`,
  );
  return decimal;
}

// 🆕 FUNCIÓN PARA ESCRIBIR LOG DE ADVERTENCIAS
function escribirLogAdvertencias(
  tipo: "ADVERTENCIA" | "ERROR" | "RELACION_CREADA",
  mensaje: string,
  data?: any,
) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    tipo,
    mensaje,
    data: data || null,
  };

  const logLine = `[${timestamp}] ${tipo}: ${mensaje}\n${data ? JSON.stringify(data, null, 2) : ""}\n${"=".repeat(80)}\n`;

  // 🔥 Escribir en archivo de log
  const logPath = "./logs/liquidacion_advertencias.log";

  try {
    // Crear carpeta logs si no existe
    if (!fs.existsSync("./logs")) {
      fs.mkdirSync("./logs", { recursive: true });
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
  normalizado = normalizado.replace(/\.+$/g, "");

  // 3. Convertir año de 4 dígitos a 2
  normalizado = normalizado.replace(/\b2025\b/g, "25");
  normalizado = normalizado.replace(/\b2024\b/g, "24");
  normalizado = normalizado.replace(/\b2023\b/g, "23");
  normalizado = normalizado.replace(/\b2022\b/g, "22");
  normalizado = normalizado.replace(/\b2021\b/g, "21");
  normalizado = normalizado.replace(/\b2020\b/g, "20");

  // 4. Casos especiales: múltiples meses (ej: "ago. 25 y sep. 25")
  if (normalizado.includes(" y ")) {
    console.log(`   ⚠️ Múltiples meses detectados, tomando el último`);
    const meses = normalizado.split(" y ").map((m) => m.trim());
    normalizado = meses[meses.length - 1];
    console.log(`   ✅ Mes seleccionado: "${normalizado}"`);
  }

  // 5. Si tiene múltiples meses separados por comas
  if (normalizado.includes(",")) {
    console.log(`   ⚠️ Múltiples meses con coma, tomando el último`);
    const meses = normalizado.split(",").map((m) => m.trim());
    normalizado = meses[meses.length - 1];
    console.log(`   ✅ Mes seleccionado: "${normalizado}"`);
  }

  // 6. Limpiar espacios múltiples
  normalizado = normalizado.replace(/\s+/g, " ");

  // 7. Asegurar que tiene punto después del mes
  const partes = normalizado.split(/\s+/);
  if (partes.length === 2) {
    let mes = partes[0].toLowerCase().replace(".", "");
    const año = partes[1];

    // Mapeo de meses en español
    const mesesValidos = [
      "ene",
      "feb",
      "mar",
      "abr",
      "may",
      "jun",
      "jul",
      "ago",
      "sep",
      "oct",
      "nov",
      "dic",
    ];

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
// 🔍 BÚSQUEDA ULTRA PERMISIVA DE USUARIO
// 🔍 BÚSQUEDA ULTRA PERMISIVA DE USUARIO
async function buscarUsuarioPermisivo(nombre_usuario: string) {
  console.log(`\n🔍 ========== BÚSQUEDA PERMISIVA DE USUARIO ==========`);
  console.log(`   📝 Buscando: "${nombre_usuario}"`);

  // Limpiar el nombre de entrada
  const nombreLimpio = nombre_usuario
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[áàäâã]/gi, "a")
    .replace(/[éèëê]/gi, "e")
    .replace(/[íìïî]/gi, "i")
    .replace(/[óòöôõ]/gi, "o")
    .replace(/[úùüû]/gi, "u")
    .replace(/ñ/gi, "n");

  console.log(`   🧹 Nombre limpio: "${nombreLimpio}"`);

  // ESTRATEGIA 1: Búsqueda exacta (case insensitive)
  console.log(`   🎯 Estrategia 1: Búsqueda exacta...`);
  let usuarios_encontrados = await db
    .select()
    .from(usuarios)
    .where(sql`LOWER(${usuarios.nombre}) = LOWER(${nombreLimpio})`);

  if (usuarios_encontrados.length > 0) {
    console.log(
      `   ✅ Encontrados ${usuarios_encontrados.length} con búsqueda exacta`,
    );
    return usuarios_encontrados;
  }

  // ESTRATEGIA 1.5: Búsqueda exacta con tildes normalizadas
  console.log(`   🎯 Estrategia 1.5: Búsqueda exacta sin tildes...`);
  usuarios_encontrados = await db
    .select()
    .from(usuarios)
    .where(
      sql`LOWER(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
          REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            ${usuarios.nombre},
            'á', 'a'), 'é', 'e'), 'í', 'i'), 'ó', 'o'), 'ú', 'u'),
          'Á', 'a'), 'É', 'e'), 'Í', 'i'), 'Ó', 'o'), 'Ú', 'u'), 'ñ', 'n')
      ) = LOWER(${nombreLimpio})`,
    );

  if (usuarios_encontrados.length > 0) {
    console.log(
      `   ✅ Encontrados ${usuarios_encontrados.length} con búsqueda exacta sin tildes`,
    );
    return usuarios_encontrados;
  }

  // ESTRATEGIA 1.75: 🆕 Búsqueda donde nombre del Excel está AL INICIO del nombre de BD (para mancomunados)
  console.log(
    `   🎯 Estrategia 1.75: Búsqueda al inicio del nombre (para mancomunados)...`,
  );
  usuarios_encontrados = await db
    .select()
    .from(usuarios)
    .where(
      sql`LOWER(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
          REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            ${usuarios.nombre},
            'á', 'a'), 'é', 'e'), 'í', 'i'), 'ó', 'o'), 'ú', 'u'),
          'Á', 'a'), 'É', 'e'), 'Í', 'i'), 'Ó', 'o'), 'Ú', 'u'), 'ñ', 'n')
      ) LIKE LOWER(${nombreLimpio + "%"})`,
    );

  if (usuarios_encontrados.length > 0) {
    console.log(
      `   ✅ Encontrados ${usuarios_encontrados.length} con búsqueda al inicio`,
    );

    // Si encontró solo uno, retornar inmediatamente
    if (usuarios_encontrados.length === 1) {
      console.log(
        `   ✅ Usuario único encontrado: ${usuarios_encontrados[0].nombre}`,
      );
      return usuarios_encontrados;
    }

    // Si encontró varios, calcular score de similitud
    const usuariosConScore = usuarios_encontrados.map((u) => {
      const nombreBD = u.nombre
        .toLowerCase()
        .replace(/[áàäâã]/gi, "a")
        .replace(/[éèëê]/gi, "e")
        .replace(/[íìïî]/gi, "i")
        .replace(/[óòöôõ]/gi, "o")
        .replace(/[úùüû]/gi, "u")
        .replace(/ñ/gi, "n");

      const nombreBuscado = nombreLimpio.toLowerCase();

      // Score alto si el nombre completo del Excel coincide exactamente al inicio
      const coincideAlInicio = nombreBD.startsWith(nombreBuscado);
      const scoreInicio = coincideAlInicio ? 1 : 0;

      // Score por longitud similar
      const diffLongitud = Math.abs(nombreBD.length - nombreBuscado.length);
      const scoreLongitud =
        1 - diffLongitud / Math.max(nombreBD.length, nombreBuscado.length);

      // Score total (priorizar inicio exacto)
      const scoreTotal = scoreInicio * 0.7 + scoreLongitud * 0.3;

      return { ...u, score: scoreTotal };
    });

    usuariosConScore.sort((a, b) => b.score - a.score);

    console.log(`   📊 Usuarios ordenados por score:`);
    usuariosConScore.forEach((u, idx) => {
      console.log(
        `      ${idx + 1}. ${u.nombre} (score: ${u.score.toFixed(2)})`,
      );
    });

    // Si el mejor tiene score alto, retornar solo ese
    if (usuariosConScore[0].score >= 0.7) {
      console.log(
        `   ✅ Usuario con mejor score: ${usuariosConScore[0].nombre}`,
      );
      return [usuariosConScore[0]];
    }

    // Retornar los top 3
    return usuariosConScore.slice(0, 3).map((u) => ({
      usuario_id: u.usuario_id,
      nombre: u.nombre,
      nit: u.nit,
      categoria: u.categoria,
      como_se_entero: u.como_se_entero,
      saldo_a_favor: u.saldo_a_favor,
    }));
  }

  // ESTRATEGIA 2: Búsqueda CONTAINS - nombre completo
  console.log(`   🎯 Estrategia 2: Búsqueda con LIKE (contiene)...`);
  usuarios_encontrados = await db
    .select()
    .from(usuarios)
    .where(
      sql`LOWER(${usuarios.nombre}) LIKE LOWER(${"%" + nombreLimpio + "%"})`,
    );

  if (usuarios_encontrados.length > 0) {
    console.log(`   ✅ Encontrados ${usuarios_encontrados.length} con LIKE`);

    // FILTRAR: Buscar el que más se parezca
    const usuariosConScore = usuarios_encontrados.map((u) => {
      const nombreBD = u.nombre.toLowerCase();
      const nombreBuscado = nombreLimpio.toLowerCase();

      const palabrasBuscadas = nombreBuscado
        .split(" ")
        .filter((p) => p.length > 2);
      const palabrasEncontradas = palabrasBuscadas.filter((palabra) =>
        nombreBD.includes(palabra),
      ).length;
      const scoreCoincidencia = palabrasEncontradas / palabrasBuscadas.length;

      const diffLongitud = Math.abs(nombreBD.length - nombreBuscado.length);
      const scoreLongitud =
        1 - diffLongitud / Math.max(nombreBD.length, nombreBuscado.length);

      const scoreInicio = nombreBD.startsWith(
        nombreBuscado.split(" ")[0].toLowerCase(),
      )
        ? 1
        : 0;

      const scoreTotal =
        scoreCoincidencia * 0.5 + scoreLongitud * 0.3 + scoreInicio * 0.2;

      return {
        ...u,
        score: scoreTotal,
        scoreCoincidencia,
        scoreLongitud,
        scoreInicio,
      };
    });

    usuariosConScore.sort((a, b) => b.score - a.score);

    console.log(`   📊 Usuarios ordenados por score:`);
    usuariosConScore.forEach((u, idx) => {
      console.log(
        `      ${idx + 1}. ${u.nombre} (score: ${u.score.toFixed(2)})`,
      );
    });

    if (usuariosConScore[0].score >= 0.6) {
      console.log(
        `   ✅ Usuario con mejor score (${usuariosConScore[0].score.toFixed(2)}): ${usuariosConScore[0].nombre}`,
      );
      return [usuariosConScore[0]];
    }

    return usuariosConScore.slice(0, 3).map((u) => ({
      usuario_id: u.usuario_id,
      nombre: u.nombre,
      nit: u.nit,
      categoria: u.categoria,
      como_se_entero: u.como_se_entero,
      saldo_a_favor: u.saldo_a_favor,
    }));
  }

  // ESTRATEGIA 3: Búsqueda por partes del nombre (primer y último apellido)
  console.log(`   🎯 Estrategia 3: Búsqueda por partes del nombre...`);
  const palabras = nombreLimpio.split(" ").filter((p) => p.length > 2);

  if (palabras.length >= 2) {
    const primeraPalabra = palabras[0];
    const ultimaPalabra = palabras[palabras.length - 1];

    console.log(`   🔍 Buscando con: "${primeraPalabra}" Y "${ultimaPalabra}"`);

    usuarios_encontrados = await db
      .select()
      .from(usuarios)
      .where(
        and(
          sql`LOWER(${usuarios.nombre}) LIKE LOWER(${"%" + primeraPalabra + "%"})`,
          sql`LOWER(${usuarios.nombre}) LIKE LOWER(${"%" + ultimaPalabra + "%"})`,
        ),
      );

    if (usuarios_encontrados.length > 0) {
      console.log(
        `   ✅ Encontrados ${usuarios_encontrados.length} con búsqueda por partes`,
      );
      return usuarios_encontrados;
    }
  }

  // ESTRATEGIA 4: Búsqueda con similitud (si PostgreSQL tiene la extensión pg_trgm)
  console.log(`   🎯 Estrategia 4: Búsqueda con similitud...`);
  try {
    usuarios_encontrados = await db
      .select()
      .from(usuarios)
      .where(
        sql`SIMILARITY(LOWER(${usuarios.nombre}), LOWER(${nombreLimpio})) > 0.3`,
      )
      .orderBy(
        sql`SIMILARITY(LOWER(${usuarios.nombre}), LOWER(${nombreLimpio})) DESC`,
      );

    if (usuarios_encontrados.length > 0) {
      console.log(
        `   ✅ Encontrados ${usuarios_encontrados.length} con similitud`,
      );
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
      .where(sql`LOWER(${usuarios.nombre}) LIKE LOWER(${"%" + palabra + "%"})`);

    if (usuarios_encontrados.length > 0 && usuarios_encontrados.length < 10) {
      console.log(
        `   ✅ Encontrados ${usuarios_encontrados.length} con palabra "${palabra}"`,
      );
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
    .replace(/\s+/g, " ")
    .replace(/[áàäâã]/gi, "a")
    .replace(/[éèëê]/gi, "e")
    .replace(/[íìïî]/gi, "i")
    .replace(/[óòöôõ]/gi, "o")
    .replace(/[úùüû]/gi, "u")
    .replace(/ñ/gi, "n");

  console.log(`   🧹 Nombre limpio: "${nombreLimpio}"`);

  // ESTRATEGIA 1: Búsqueda exacta (case insensitive)
  console.log(`   🎯 Estrategia 1: Búsqueda exacta...`);
  let inversionistas_encontrados = await db
    .select()
    .from(inversionistas)
    .where(sql`LOWER(${inversionistas.nombre}) = LOWER(${nombreLimpio})`);

  if (inversionistas_encontrados.length > 0) {
    console.log(
      `   ✅ Encontrados ${inversionistas_encontrados.length} con búsqueda exacta`,
    );
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
      ) = LOWER(${nombreLimpio})`,
    );

  if (inversionistas_encontrados.length > 0) {
    console.log(
      `   ✅ Encontrados ${inversionistas_encontrados.length} con búsqueda exacta sin tildes`,
    );
    return inversionistas_encontrados;
  }

  // ESTRATEGIA 2: Búsqueda CONTAINS
  console.log(`   🎯 Estrategia 2: Búsqueda con LIKE (contiene)...`);
  inversionistas_encontrados = await db
    .select()
    .from(inversionistas)
    .where(
      sql`LOWER(${inversionistas.nombre}) LIKE LOWER(${"%" + nombreLimpio + "%"})`,
    );

  if (inversionistas_encontrados.length > 0) {
    console.log(
      `   ✅ Encontrados ${inversionistas_encontrados.length} con LIKE`,
    );

    // Calcular score de similitud
    const inversionistasConScore = inversionistas_encontrados.map((inv) => {
      const nombreBD = inv.nombre.toLowerCase();
      const nombreBuscado = nombreLimpio.toLowerCase();

      const palabrasBuscadas = nombreBuscado
        .split(" ")
        .filter((p) => p.length > 2);
      const palabrasEncontradas = palabrasBuscadas.filter((palabra) =>
        nombreBD.includes(palabra),
      ).length;
      const scoreCoincidencia = palabrasEncontradas / palabrasBuscadas.length;

      const diffLongitud = Math.abs(nombreBD.length - nombreBuscado.length);
      const scoreLongitud =
        1 - diffLongitud / Math.max(nombreBD.length, nombreBuscado.length);

      const scoreInicio = nombreBD.startsWith(
        nombreBuscado.split(" ")[0].toLowerCase(),
      )
        ? 1
        : 0;

      const scoreTotal =
        scoreCoincidencia * 0.5 + scoreLongitud * 0.3 + scoreInicio * 0.2;

      return { ...inv, score: scoreTotal };
    });

    inversionistasConScore.sort((a, b) => b.score - a.score);

    console.log(`   📊 Inversionistas ordenados por score:`);
    inversionistasConScore.forEach((inv, idx) => {
      console.log(
        `      ${idx + 1}. ${inv.nombre} (score: ${inv.score.toFixed(2)})`,
      );
    });

    if (inversionistasConScore[0].score >= 0.6) {
      console.log(
        `   ✅ Inversionista con mejor score: ${inversionistasConScore[0].nombre}`,
      );
      return [inversionistasConScore[0]];
    }

    return inversionistasConScore.slice(0, 3).map((inv) => ({
      inversionista_id: inv.inversionista_id,
      nombre: inv.nombre,
    }));
  }

  // ESTRATEGIA 3: Búsqueda por partes del nombre
  console.log(`   🎯 Estrategia 3: Búsqueda por partes del nombre...`);
  const palabras = nombreLimpio.split(" ").filter((p) => p.length > 2);

  if (palabras.length >= 2) {
    const primeraPalabra = palabras[0];
    const ultimaPalabra = palabras[palabras.length - 1];

    console.log(`   🔍 Buscando con: "${primeraPalabra}" Y "${ultimaPalabra}"`);

    inversionistas_encontrados = await db
      .select()
      .from(inversionistas)
      .where(
        and(
          sql`LOWER(${inversionistas.nombre}) LIKE LOWER(${"%" + primeraPalabra + "%"})`,
          sql`LOWER(${inversionistas.nombre}) LIKE LOWER(${"%" + ultimaPalabra + "%"})`,
        ),
      );

    if (inversionistas_encontrados.length > 0) {
      console.log(
        `   ✅ Encontrados ${inversionistas_encontrados.length} con búsqueda por partes`,
      );
      return inversionistas_encontrados;
    }
  }

  console.log(`   ❌ No se encontró ningún inversionista`);
  return [];
}

// 📅 Función helper para convertir "oct. 25" a rango de fechas
function obtenerRangoDelMes(cuota_mes: string): {
  inicio: string;
  fin: string;
  mesDescriptivo: string;
} {
  const cleanInput = cuota_mes.trim().toLowerCase().replace(/\./g, "");

  const mesesMap: { [key: string]: number } = {
    ene: 0,
    feb: 1,
    mar: 2,
    abr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    ago: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dic: 11,
  };

  const partes = cleanInput.split(/\s+/);

  if (partes.length !== 2) {
    throw new Error(
      `Formato inválido: "${cuota_mes}". Esperado: "mes. año" (ej: "oct. 25")`,
    );
  }

  const mesTexto = partes[0];
  let anio = parseInt(partes[1]);

  if (anio < 100) {
    anio += 2000;
  }

  const mesNumero = mesesMap[mesTexto];

  if (mesNumero === undefined) {
    throw new Error(
      `Mes no reconocido: "${mesTexto}". Use formato de 3 letras (ej: "oct", "ago")`,
    );
  }

  const primerDia = new Date(anio, mesNumero, 1);
  const ultimoDia = new Date(anio, mesNumero + 1, 0);

  return {
    inicio: primerDia.toISOString().slice(0, 10),
    fin: ultimoDia.toISOString().slice(0, 10),
    mesDescriptivo: primerDia.toLocaleString("es-GT", {
      month: "long",
      year: "numeric",
    }),
  };
}

const guardarRelacionesFallidas = async (
  relacionesFallidas: RelacionFallida[],
  usuario: { nombre: string; usuario_id: number },
  inversionista: { nombre: string; inversionista_id: number },
  capital: string,
  mes: string,
) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `relaciones-fallidas-${timestamp}.json`;
    const filePath = path.join(process.cwd(), "logs", fileName);

    // Crear carpeta logs si no existe
    const logsDir = path.join(process.cwd(), "logs");
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const logData = {
      timestamp: new Date().toISOString(),
      usuario: {
        nombre: usuario.nombre,
        usuario_id: usuario.usuario_id,
      },
      inversionista_buscado: {
        nombre: inversionista.nombre,
        inversionista_id: inversionista.inversionista_id,
      },
      capital: capital,
      mes: mes,
      total_creditos_fallidos: relacionesFallidas.length,
      relaciones_fallidas: relacionesFallidas,
      resumen: {
        creditos_sin_relacion: relacionesFallidas.filter(
          (r) => r.razon === "No existe la relación",
        ).length,
        total_inversionistas_alternativos: relacionesFallidas.reduce(
          (sum, r) => sum + r.inversionistas_existentes.length,
          0,
        ),
      },
    };

    fs.writeFileSync(filePath, JSON.stringify(logData, null, 2), "utf-8");

    console.log(`\n💾 ========== LOG DE RELACIONES FALLIDAS ==========`);
    console.log(`   Archivo: ${filePath}`);
    console.log(`   Total créditos fallidos: ${relacionesFallidas.length}`);
    console.log(`================================================\n`);

    return filePath;
  } catch (error) {
    console.error(`❌ Error guardando log de relaciones fallidas:`, error);
    return null;
  }
};

// ========================================
// 🔥 ENDPOINT PRINCIPAL
// ========================================

interface LiquidarCuotasPorCreditoInput {
  credito_id: number;
  inversionista_id: number;
  cuota_mes: string;
  capital: number;
  porcentaje_inversor: number;
}

export async function liquidarCuotasPorCredito(
  input: LiquidarCuotasPorCreditoInput,
) {
  try {
    console.log("🔥 ========== INICIANDO LIQUIDACIÓN POR CRÉDITO ==========");
    console.log(
      `🔧 MODO CREAR RELACIONES: ${CREAR_RELACIONES_AUTOMATICAMENTE ? "ACTIVADO ✅" : "DESACTIVADO ❌"}`,
    );
    console.log("📝 Input:", JSON.stringify(input, null, 2));

    // 🆕 VALIDAR INPUT
    if (!input.credito_id) {
      const errorMsg = "❌ El ID del crédito es requerido";
      console.error(errorMsg);
      return { success: false, message: errorMsg, error: "credito_id vacío" };
    }

    if (!input.inversionista_id) {
      const errorMsg = "❌ El ID del inversionista es requerido";
      console.error(errorMsg);
      return {
        success: false,
        message: errorMsg,
        error: "inversionista_id vacío",
      };
    }

    if (!input.cuota_mes || input.cuota_mes.trim() === "") {
      const errorMsg = "❌ La cuota mes es requerida";
      console.error(errorMsg);
      return { success: false, message: errorMsg, error: "cuota_mes vacía" };
    }

    if (!input.capital || input.capital <= 0) {
      const errorMsg = "❌ El capital debe ser mayor a 0";
      console.error(errorMsg);
      return { success: false, message: errorMsg, error: "capital inválido" };
    }

    // 🧹 NORMALIZAR MES
    let cuota_mes_normalizada: string;
    try {
      cuota_mes_normalizada = normalizarCuotaMes(input.cuota_mes);
    } catch (err) {
      const errorMsg = `❌ Formato de mes inválido: "${input.cuota_mes}"`;
      console.error(errorMsg, err);
      return {
        success: false,
        message: errorMsg,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const capitalTotal = new Big(input.capital);

    console.log(`💰 Capital total: ${capitalTotal.toString()}`);
    console.log(`🆔 Crédito ID: ${input.credito_id}`);
    console.log(`👤 Inversionista ID: ${input.inversionista_id}`);

    // 🆕 MOSTRAR PORCENTAJE SI EXISTE
    if (
      input.porcentaje_inversor !== undefined &&
      input.porcentaje_inversor !== null
    ) {
      console.log(`📊 % Inversor: ${input.porcentaje_inversor}%`);
    }

    // ============================================
    // 1️⃣ BUSCAR CRÉDITO DIRECTO POR ID
    // ============================================
    console.log(`\n🔍 Buscando crédito por ID: ${input.credito_id}...`);

    const creditoResult = await db
      .select()
      .from(creditos)
      .where(eq(creditos.credito_id, input.credito_id))
      .limit(1);

    if (creditoResult.length === 0) {
      const errorMsg = `❌ No se encontró el crédito con ID: ${input.credito_id}`;
      console.error(errorMsg);
      return {
        success: false,
        message: errorMsg,
        error: "Crédito no encontrado",
      };
    }

    const credito = creditoResult[0];
    console.log(`✅ Crédito encontrado: ${credito.numero_credito_sifco}`);

    // ============================================
    // 2️⃣ BUSCAR INVERSIONISTA DIRECTO POR ID
    // ============================================
    console.log(
      `\n🔍 Buscando inversionista por ID: ${input.inversionista_id}...`,
    );

    const inversionistaResult = await db
      .select()
      .from(inversionistas)
      .where(eq(inversionistas.inversionista_id, input.inversionista_id))
      .limit(1);

    if (inversionistaResult.length === 0) {
      const errorMsg = `❌ No se encontró el inversionista con ID: ${input.inversionista_id}`;
      console.error(errorMsg);
      return {
        success: false,
        message: errorMsg,
        error: "Inversionista no encontrado",
      };
    }

    const inversionista = inversionistaResult[0];
    console.log(`✅ Inversionista encontrado: ${inversionista.nombre}`);

    // ============================================
    // 3️⃣ RESETEAR CUOTAS DEL CRÉDITO
    // ============================================
    console.log("\n🔄 ========== RESETEANDO CUOTAS ==========");

    const cuotasReseteadas = await db
      .update(cuotas_credito)
      .set({
        liquidado_inversionistas: false,
        fecha_liquidacion_inversionistas: null,
      })
      .where(eq(cuotas_credito.credito_id, credito.credito_id))
      .returning();

    console.log(`✅ ${cuotasReseteadas.length} cuotas reseteadas`);

    // ============================================
    // 4️⃣ CALCULAR RANGO DEL MES
    // ============================================
    let rangoMes;
    try {
      rangoMes = obtenerRangoDelMes(cuota_mes_normalizada);
      console.log(`\n📅 ========== RANGO CALCULADO ==========`);
      console.log(`   Normalizado: "${cuota_mes_normalizada}"`);
      console.log(`   Mes descriptivo: ${rangoMes.mesDescriptivo}`);
      console.log(`   Rango: ${rangoMes.inicio} - ${rangoMes.fin}`);
      console.log(`========================================\n`);
    } catch (err) {
      const errorMsg = `❌ Error al procesar el mes: "${input.cuota_mes}"`;
      console.error(errorMsg, err);
      return {
        success: false,
        message: errorMsg,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // ============================================
    // 5️⃣ BUSCAR CUOTA DEL MES
    // ============================================
    console.log(`\n🔍 BUSCANDO cuota que vence en ${cuota_mes_normalizada}...`);

    const cuotaDelMes = await db
      .select()
      .from(cuotas_credito)
      .where(
        and(
          eq(cuotas_credito.credito_id, credito.credito_id),
          gte(cuotas_credito.fecha_vencimiento, rangoMes.inicio),
          lte(cuotas_credito.fecha_vencimiento, rangoMes.fin),
          gte(cuotas_credito.numero_cuota, 0),
        ),
      )
      .orderBy(cuotas_credito.numero_cuota);

    console.log(`📊 Cuotas encontradas: ${cuotaDelMes.length}`);

    let numeroCuotaALiquidar = 0;
    let cuotasLiquidadas = 0;

    if (cuotaDelMes.length === 0) {
      console.log(`⚠️ No hay cuota que venza en ${cuota_mes_normalizada}`);
    } else {
      const cuotaEncontrada = cuotaDelMes[0];
      numeroCuotaALiquidar = cuotaEncontrada.numero_cuota;

      console.log(`✅ CUOTA SELECCIONADA: #${numeroCuotaALiquidar}`);
      console.log(`   Vence: ${cuotaEncontrada.fecha_vencimiento}`);

      // ============================================
      // 6️⃣ LIQUIDAR HASTA ESA CUOTA
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
            lte(cuotas_credito.numero_cuota, numeroCuotaALiquidar),
          ),
        )
        .returning();

      cuotasLiquidadas = resultado.length;
      console.log(`✅ ${cuotasLiquidadas} cuotas liquidadas`);
    }

    // ============================================
    // 7️⃣ BUSCAR RELACIÓN INVERSIONISTA
    // ============================================
    console.log(`\n👥 ========== BUSCANDO RELACIÓN INVERSIONISTA ==========`);

    const relacionInversionista = await db
      .select()
      .from(creditos_inversionistas)
      .where(
        and(
          eq(creditos_inversionistas.credito_id, credito.credito_id),
          eq(
            creditos_inversionistas.inversionista_id,
            inversionista.inversionista_id,
          ),
        ),
      );

    let relacionCreada = false;
    let inversionistasActualizados = 0;

    // 🔥 SI NO EXISTE LA RELACIÓN
    if (relacionInversionista.length === 0) {
      console.log(`❌ Relación no existe`);

      if (CREAR_RELACIONES_AUTOMATICAMENTE) {
        console.log(`\n🔥 ========== CREANDO RELACIÓN ==========`);

        const porcentajeInteres = new Big(credito.porcentaje_interes || 0).div(
          100,
        );

        // 🔥 OBTENER TODOS LOS INVERSIONISTAS DEL CRÉDITO PARA ENCONTRAR AL MAYOR
        console.log(
          `\n🔍 BUSCANDO INVERSIONISTA CON MAYOR MONTO APORTADO EN EL CRÉDITO:`,
        );

        const inversionistasDelCredito = await db
          .select({
            inversionista_id: creditos_inversionistas.inversionista_id,
            monto_aportado: creditos_inversionistas.monto_aportado,
          })
          .from(creditos_inversionistas)
          .where(eq(creditos_inversionistas.credito_id, credito.credito_id));

        // Agregar el inversionista actual a la lista para la comparación
        const todosInversionistas = [
          ...inversionistasDelCredito.map((inv) => ({
            inversionista_id: inv.inversionista_id,
            monto_aportado: new Big(inv.monto_aportado || 0),
          })),
          {
            inversionista_id: inversionista.inversionista_id,
            monto_aportado: capitalTotal,
          },
        ];

        console.log(`   📋 Inversionistas encontrados:`);
        todosInversionistas.forEach((inv, idx) => {
          console.log(
            `   [${idx + 1}] ID ${inv.inversionista_id}: Q${inv.monto_aportado.toFixed(2)}`,
          );
        });

        const inversionistaMayor = todosInversionistas.reduce((max, current) =>
          current.monto_aportado.gt(max.monto_aportado) ? current : max,
        );

        console.log(
          `   🏆 Mayor encontrado: ID ${inversionistaMayor.inversionista_id} con Q${inversionistaMayor.monto_aportado.toFixed(2)}`,
        );

        const esMayor =
          inversionista.inversionista_id ===
          inversionistaMayor.inversionista_id;
        console.log(
          `   ¿Es este inversionista el mayor? ${esMayor ? "✅ SÍ" : "❌ NO"}`,
        );

        // 🔥 CALCULAR CUOTA DEL INVERSIONISTA
        console.log(`\n💳 CÁLCULO DE CUOTA DEL INVERSIONISTA:`);

        const cuotaTotal = new Big(credito.cuota || 0);
        const seguro = new Big(credito.seguro_10_cuotas || 0);
        const membresias = new Big(credito.membresias_pago || 0);

        console.log(`   Cuota Total: Q${cuotaTotal.toFixed(2)}`);
        console.log(`   - Seguro: Q${seguro.toFixed(2)}`);
        console.log(`   - Membresía: Q${membresias.toFixed(2)}`);

        const porcentajeParticipacion = capitalTotal
          .div(new Big(credito.capital))
          .times(100);

        console.log(`\n📐 PARTICIPACIÓN:`);
        console.log(`   💰 Capital total crédito: Q${credito.capital}`);
        console.log(`   💰 Capital aportado: Q${capitalTotal.toFixed(2)}`);
        console.log(
          `   📊 % Participación: ${porcentajeParticipacion.toFixed(4)}%`,
        );
        console.log(
          `   Fórmula: (${capitalTotal.toFixed(2)} / ${credito.capital}) * 100`,
        );

        // 🔥 PASO 1: RESTAR CARGOS
        const cuotaSinCargos = cuotaTotal.minus(seguro).minus(membresias);

        console.log(`\n🔢 PASO 1: RESTAR CARGOS`);
        console.log(`   Cuota sin cargos: Q${cuotaSinCargos.toFixed(2)}`);
        console.log(
          `   Fórmula: ${cuotaTotal.toFixed(2)} - ${seguro.toFixed(2)} - ${membresias.toFixed(2)}`,
        );

        // 🔥 PASO 2: MULTIPLICAR POR PORCENTAJE
        const cuotaBase = cuotaSinCargos
          .times(porcentajeParticipacion.div(100))
          .round(2);

        console.log(`\n🔢 PASO 2: MULTIPLICAR POR PORCENTAJE`);
        console.log(`   Cuota Base: Q${cuotaBase.toFixed(2)}`);
        console.log(
          `   Fórmula: ${cuotaSinCargos.toFixed(2)} * (${porcentajeParticipacion.toFixed(4)}% / 100)`,
        );

        // 🔥 PASO 3: SI ES EL MAYOR, SUMAR CARGOS
        let cuotaInversionista = cuotaBase;

        console.log(`\n🎯 PASO 3: CALCULAR CUOTA FINAL`);

        if (esMayor) {
          console.log(`   🏆 ESTE ES EL INVERSIONISTA MAYOR`);
          console.log(`   Cuota Base: Q${cuotaBase.toFixed(2)}`);
          console.log(`   + Seguro: Q${seguro.toFixed(2)}`);
          console.log(`   + Membresía: Q${membresias.toFixed(2)}`);

          cuotaInversionista = cuotaBase.plus(seguro).plus(membresias).round(2);

          console.log(`   = Cuota Final: Q${cuotaInversionista.toFixed(2)}`);
          console.log(
            `   Fórmula: ${cuotaBase.toFixed(2)} + ${seguro.toFixed(2)} + ${membresias.toFixed(2)}`,
          );
        } else {
          console.log(`   📍 Inversionista normal (no es el mayor)`);
          console.log(
            `   Cuota Final = Cuota Base: Q${cuotaInversionista.toFixed(2)}`,
          );
          console.log(`   (No se suman cargos)`);
        }

        console.log(`\n💹 CÁLCULO DE INTERESES:`);
        console.log(
          `   Tasa de Interés: ${new Big(credito.porcentaje_interes || 0).toFixed(2)}%`,
        );
        console.log(`   Capital Aportado: Q${capitalTotal.toFixed(2)}`);

        const cuotaInteres = capitalTotal.times(porcentajeInteres);

        console.log(`   Interés Calculado: Q${cuotaInteres.toFixed(2)}`);
        console.log(
          `   Fórmula: ${capitalTotal.toFixed(2)} * ${porcentajeInteres.toFixed(4)}`,
        );

        // 🔥 USAR PORCENTAJE DEL EXCEL O DEFAULT
        let porcentajeInversionista: number;
        let porcentajeCashIn: number;

        console.log(`\n📊 DISTRIBUCIÓN DE INTERÉS:`);

        if (
          input.porcentaje_inversor !== undefined &&
          input.porcentaje_inversor !== null
        ) {
          porcentajeInversionista = input.porcentaje_inversor;
          porcentajeCashIn = 100 - porcentajeInversionista;
          console.log(
            `   ✅ % Inversor (del Excel): ${porcentajeInversionista}%`,
          );
          console.log(`   ✅ % Cash-In (calculado): ${porcentajeCashIn}%`);
        } else {
          // Valores por defecto
          porcentajeCashIn = 28;
          porcentajeInversionista = 72;
          console.log(
            `   📌 % Inversor (default): ${porcentajeInversionista}%`,
          );
          console.log(`   📌 % Cash-In (default): ${porcentajeCashIn}%`);
        }

        const montoInversionista = cuotaInteres
          .times(porcentajeInversionista)
          .div(100)
          .toFixed(2);

        const montoCashIn = cuotaInteres
          .times(porcentajeCashIn)
          .div(100)
          .toFixed(2);

        console.log(`   Monto Inversionista: Q${montoInversionista}`);
        console.log(
          `   Fórmula: ${cuotaInteres.toFixed(2)} * (${porcentajeInversionista}% / 100)`,
        );
        console.log(`   Monto Cash-In: Q${montoCashIn}`);
        console.log(
          `   Fórmula: ${cuotaInteres.toFixed(2)} * (${porcentajeCashIn}% / 100)`,
        );

        const ivaInversionista = new Big(montoInversionista)
          .times(0.12)
          .toFixed(2);
        const ivaCashIn = new Big(montoCashIn).times(0.12).toFixed(2);

        console.log(`\n🧾 CÁLCULO DE IVA (12%):`);
        console.log(`   IVA Inversionista: Q${ivaInversionista}`);
        console.log(`   Fórmula: ${montoInversionista} * 0.12`);
        console.log(`   IVA Cash-In: Q${ivaCashIn}`);
        console.log(`   Fórmula: ${montoCashIn} * 0.12`);

        console.log(`\n✅ RESUMEN FINAL ANTES DE INSERTAR:`);
        console.log(
          `   - Cuota Inversionista: Q${cuotaInversionista.toFixed(2)}`,
        );
        console.log(`   - Monto Inversionista: Q${montoInversionista}`);
        console.log(`   - IVA Inversionista: Q${ivaInversionista}`);
        console.log(`   - Monto Cash-In: Q${montoCashIn}`);
        console.log(`   - IVA Cash-In: Q${ivaCashIn}`);
        console.log(
          `   - % Participación: ${porcentajeParticipacion.toFixed(4)}%`,
        );

        // 🔥 INSERTAR
        await db.insert(creditos_inversionistas).values({
          credito_id: credito.credito_id,
          inversionista_id: inversionista.inversionista_id,
          monto_aportado: capitalTotal.toFixed(2),
          porcentaje_cash_in: porcentajeCashIn.toString(),
          porcentaje_participacion_inversionista:
            porcentajeInversionista.toString(),
          cuota_inversionista: cuotaInversionista.toString(),
          monto_inversionista: montoInversionista,
          monto_cash_in: montoCashIn,
          iva_inversionista: ivaInversionista,
          iva_cash_in: ivaCashIn,
        });

        console.log(`\n✅ Relación credito-inversionista creada exitosamente`);
        console.log(`${"=".repeat(60)}\n`);

        console.log(`✅ RELACIÓN CREADA`);
        relacionCreada = true;
        inversionistasActualizados = 1;
      } else {
        console.log(`❌ Modo crear relaciones DESACTIVADO`);
        return {
          success: false,
          message: "Relación no existe y modo crear está desactivado",
          error: "Sin relación inversionista-crédito",
        };
      }
    } else {
      // ✅ SI EXISTE LA RELACIÓN - ACTUALIZAR
      const relacion = relacionInversionista[0];

      console.log(`✅ RELACIÓN ENCONTRADA`);
      console.log(`   Monto aportado ANTERIOR: ${relacion.monto_aportado}`);

      // ============================================
      // 8️⃣ RECALCULAR TODO
      // ============================================
      console.log(`\n🧮 ========== RECALCULANDO MONTOS ==========`);

      // 🔥 RECALCULAR CUOTA DEL INVERSIONISTA
      const cuotaTotal = new Big(credito.cuota || 0);
      const porcentajeParticipacion = capitalTotal
        .div(new Big(credito.capital))
        .times(100);
      const nuevaCuotaInversionista = new Big(relacion.cuota_inversionista);

      console.log(`   💰 NUEVO Monto aportado: ${capitalTotal.toFixed(2)}`);
      console.log(
        `   📊 % Participación: ${porcentajeParticipacion.toFixed(2)}%`,
      );
      console.log(
        `   💵 NUEVA Cuota inversionista: ${nuevaCuotaInversionista.toFixed(2)}`,
      );

      // 🔥 USAR PORCENTAJE DEL EXCEL O EL QUE YA EXISTE EN BD
      let porcentajeCashIn: Big;
      let porcentajeInversionista: Big;

      if (
        input.porcentaje_inversor !== undefined &&
        input.porcentaje_inversor !== null
      ) {
        porcentajeInversionista = new Big(input.porcentaje_inversor);
        porcentajeCashIn = new Big(100).minus(porcentajeInversionista);
        console.log(
          `   📊 % Inversor (del Excel): ${porcentajeInversionista.toFixed(2)}%`,
        );
        console.log(
          `   📊 % Cash-In (calculado): ${porcentajeCashIn.toFixed(2)}%`,
        );
      } else {
        porcentajeCashIn = normalizarPorcentaje(relacion.porcentaje_cash_in);
        porcentajeInversionista = normalizarPorcentaje(
          relacion.porcentaje_participacion_inversionista,
        );
        console.log(
          `   📊 % Inversor (de BD): ${porcentajeInversionista.toFixed(2)}%`,
        );
        console.log(`   📊 % Cash-In (de BD): ${porcentajeCashIn.toFixed(2)}%`);
      }

      const interes = new Big(credito.porcentaje_interes || 0).div(100);

      const cuotaInteres = capitalTotal.times(interes);
      const nuevoMontoInversionista = cuotaInteres
        .times(porcentajeInversionista)
        .div(100)
        .toFixed(2);
      const nuevoMontoCashIn = cuotaInteres
        .times(porcentajeCashIn)
        .div(100)
        .toFixed(2);

      const nuevoIvaInversionista =
        Number(nuevoMontoInversionista) > 0
          ? new Big(nuevoMontoInversionista).times(0.12).toFixed(2)
          : "0.00";

      const nuevoIvaCashIn =
        Number(nuevoMontoCashIn) > 0
          ? new Big(nuevoMontoCashIn).times(0.12).toFixed(2)
          : "0.00";

      console.log(`   💵 Monto inversionista: ${nuevoMontoInversionista}`);
      console.log(`   💵 Monto cash_in: ${nuevoMontoCashIn}`);

      // 🔥 ACTUALIZAR
      await db
        .update(creditos_inversionistas)
        .set({
          monto_aportado: capitalTotal.toFixed(2),
          porcentaje_cash_in: porcentajeCashIn.toString(),
          porcentaje_participacion_inversionista:
            porcentajeInversionista.toString(),
          cuota_inversionista: nuevaCuotaInversionista.toString(),
          monto_inversionista: nuevoMontoInversionista,
          monto_cash_in: nuevoMontoCashIn,
          iva_inversionista: nuevoIvaInversionista,
          iva_cash_in: nuevoIvaCashIn,
          fecha_creacion: new Date(),
        })
        .where(
          and(
            eq(creditos_inversionistas.credito_id, credito.credito_id),
            eq(
              creditos_inversionistas.inversionista_id,
              inversionista.inversionista_id,
            ),
          ),
        );

      console.log(`✅ RELACIÓN ACTUALIZADA`);
      inversionistasActualizados = 1;
    }

    // ============================================
    // 9️⃣ RESPUESTA FINAL
    // ============================================
    console.log("\n🎉 ========== LIQUIDACIÓN COMPLETADA ==========");
    console.log(`✅ Crédito: ${credito.numero_credito_sifco}`);
    console.log(`✅ Inversionista: ${inversionista.nombre}`);
    console.log(`✅ Cuotas reseteadas: ${cuotasReseteadas.length}`);
    console.log(`✅ Cuotas liquidadas: ${cuotasLiquidadas}`);
    console.log(`💰 Capital aplicado: ${capitalTotal.toString()}`);
    console.log(`🔥 Relación creada: ${relacionCreada ? "SÍ" : "NO"}`);

    return {
      success: true,
      data: {
        credito: {
          credito_id: credito.credito_id,
          numero_credito: credito.numero_credito_sifco,
        },
        inversionista: {
          inversionista_id: inversionista.inversionista_id,
          nombre: inversionista.nombre,
        },
        capital_aplicado: capitalTotal.toString(),
        cuotas_reseteadas: cuotasReseteadas.length,
        cuotas_liquidadas: cuotasLiquidadas,
        inversionistas_actualizados: inversionistasActualizados,
        relacion_creada: relacionCreada,
        cuota_mes_normalizada: cuota_mes_normalizada,
        rango_liquidado: rangoMes,
      },
      message: `Liquidación completada - Crédito: ${credito.numero_credito_sifco} - Inversionista: ${inversionista.nombre}${relacionCreada ? " (relación creada)" : ""}`,
    };
  } catch (error) {
    console.error("❌ Error en liquidación por crédito:", error);
    return {
      success: false,
      message: `❌ Error inesperado: ${error instanceof Error ? error.message : "Error desconocido"}`,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Prepara las URLs completas de las boletas
 * Maneja el caso donde el base URL ya incluye el folder
 */
const prepararURLsBoletas = (url_boletas: string[]): string[] => {
  const r2BaseUrl = import.meta.env.URL_PUBLIC_R2; // https://pub-xxx.r2.dev/payments-receipts/

  if (!r2BaseUrl) {
    throw new Error(
      "URL_PUBLIC_R2 no está configurado en las variables de entorno",
    );
  }

  return url_boletas.map((filename) => {
    // Limpiar cualquier slash que venga
    const cleanFilename = filename.trim().replace(/^\/+/, "");

    // Asegurar que el base URL termina con /
    const baseUrlWithSlash = r2BaseUrl.endsWith("/")
      ? r2BaseUrl
      : `${r2BaseUrl}/`;

    // Simplemente pegar el filename
    return `${baseUrlWithSlash}${cleanFilename}`;
  });
};

// 🔥 TIPOS
interface CreateBoletaInput {
  inversionista_id: number;
  boleta_url: string;
  monto_boleta?: number | string;
  notas?: string;
  subido_por?: string;
}

interface CreateBoletaResponse {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}
export interface UpdateBoletaInput {
  boleta_url?: string;
  estado?: "PENDIENTE" | "PROCESADO";
  monto_boleta?: string;
  notas?: string;
  fecha_procesado?: Date;
}
export async function createBoleta(
  data: CreateBoletaInput,
): Promise<CreateBoletaResponse> {
  try {
    console.log("\n📝 ========== CREANDO BOLETA ==========");
    console.log("📋 Datos recibidos:", {
      inversionista_id: data.inversionista_id,
      boleta_url: data.boleta_url, // Solo el filename: "90852b27-18c4-40df-9d7b-f20c8ab7ec33.jpeg"
      monto_boleta: data.monto_boleta,
      notas: data.notas,
      subido_por: data.subido_por,
    });

    // 1️⃣ Validar que el inversionista existe
    console.log(`\n🔍 Validando inversionista ID: ${data.inversionista_id}...`);
    const [inversionista] = await db
      .select({
        inversionista_id: inversionistas.inversionista_id,
        nombre: inversionistas.nombre,
      })
      .from(inversionistas)
      .where(eq(inversionistas.inversionista_id, data.inversionista_id))
      .limit(1);

    if (!inversionista) {
      console.error(
        `❌ Inversionista con ID ${data.inversionista_id} no existe`,
      );
      return {
        success: false,
        message: `Inversionista con ID ${data.inversionista_id} no encontrado`,
        error: "INVERSIONISTA_NO_EXISTE",
      };
    }

    console.log(`✅ Inversionista encontrado: ${inversionista.nombre}`);


    const [boletaUrlCompleta] = prepararURLsBoletas([data.boleta_url]);
    console.log(`\n📎 URL de la boleta: ${boletaUrlCompleta}`);


    // 3️⃣ Preparar monto (si existe)
    let montoBoleta: string | null = null;
    if (data.monto_boleta) {
      montoBoleta = new Big(data.monto_boleta).toFixed(2);
      console.log(`💰 Monto de la boleta: Q${montoBoleta}`);
    }

    // 4️⃣ Obtener fecha y hora actual en Guatemala
    const guatemalaTimeString = new Date().toLocaleString("en-US", {
      timeZone: "America/Guatemala",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const [datePart, timePart] = guatemalaTimeString.split(", ");
    const [month, day, year] = datePart.split("/");
    const fechaGuatemala = new Date(`${year}-${month}-${day}T${timePart}`);

    console.log(`\n📅 Fecha de subida: ${fechaGuatemala.toISOString()}`);

    // 5️⃣ Insertar la boleta
    console.log("\n💾 Insertando boleta en la base de datos...");
    const [nuevaBoleta] = await db
      .insert(boletasPagoInversionista)
      .values({
        inversionista_id: data.inversionista_id,
        boleta_url: boletaUrlCompleta,
        monto_boleta: montoBoleta,
        notas: data.notas || null,
        subido_por: data.subido_por ? Number(data.subido_por) : null,
        estado: "PENDIENTE", // 🔥 SIEMPRE PENDIENTE AL CREAR
        fecha_subida: fechaGuatemala,
      })
      .returning();

    console.log(`\n✅ ========== BOLETA CREADA EXITOSAMENTE ==========`);
    console.log("📄 Detalles:");
    console.log(`   Inversionista: ${inversionista.nombre}`);
    console.log(`   URL: ${nuevaBoleta.boleta_url}`);
    console.log(
      `   Monto: ${nuevaBoleta.monto_boleta ? `Q${nuevaBoleta.monto_boleta}` : "No especificado"}`,
    );
    console.log(`   Estado: ${nuevaBoleta.estado}`);
    console.log(`   Fecha: ${nuevaBoleta.fecha_subida}`);
    console.log(`✅ ========== FIN ==========\n`);

    return {
      success: true,
      message: "Boleta creada exitosamente",
      data: {
        ...nuevaBoleta,
        inversionista_nombre: inversionista.nombre,
      },
    };
  } catch (error) {
    console.error("\n❌ ========== ERROR AL CREAR BOLETA ==========");
    console.error(error);
    console.error("❌ ========== FIN ERROR ==========\n");

    return {
      success: false,
      message: "Error al crear la boleta",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
// 📖 READ - Obtener boleta por ID
// ============================================
export async function getBoletaById(boleta_id: number) {
  try {
    console.log(`🔍 Buscando boleta ID: ${boleta_id}`);

    const boleta = await db
      .select({
        boleta: boletasPagoInversionista,
        inversionista: inversionistas,
      })
      .from(boletasPagoInversionista)
      .innerJoin(
        inversionistas,
        eq(
          boletasPagoInversionista.inversionista_id,
          inversionistas.inversionista_id,
        ),
      )
      .where(eq(boletasPagoInversionista.boleta_id, boleta_id))
      .limit(1);

    if (boleta.length === 0) {
      throw new Error(`Boleta con ID ${boleta_id} no encontrada`);
    }

    console.log("✅ Boleta encontrada:", boleta[0]);
    return boleta[0];
  } catch (error) {
    console.error("❌ Error obteniendo boleta:", error);
    throw error;
  }
}

// ============================================
// 📖 READ - Listar todas las boletas (con filtros)
// ============================================
export async function getAllBoletas(filters?: {
  inversionista_id?: number;
  estado?: "PENDIENTE" | "PROCESADO";
  limit?: number;
  offset?: number;
}) {
  try {
    console.log("📋 Listando boletas con filtros:", filters);

    // Construir condiciones
    const conditions: any[] = [];

    if (filters?.inversionista_id) {
      conditions.push(
        eq(boletasPagoInversionista.inversionista_id, filters.inversionista_id),
      );
    }

    if (filters?.estado) {
      conditions.push(eq(boletasPagoInversionista.estado, filters.estado));
    }

    const whereCondition =
      conditions.length > 0 ? and(...conditions) : undefined;

    // Query
    const boletas = await db
      .select({
        boleta: boletasPagoInversionista,
        inversionista: inversionistas,
      })
      .from(boletasPagoInversionista)
      .innerJoin(
        inversionistas,
        eq(
          boletasPagoInversionista.inversionista_id,
          inversionistas.inversionista_id,
        ),
      )
      .where(whereCondition)
      .orderBy(desc(boletasPagoInversionista.fecha_subida))
      .limit(filters?.limit || 100)
      .offset(filters?.offset || 0);

    console.log(`✅ Boletas encontradas: ${boletas.length}`);
    return boletas;
  } catch (error) {
    console.error("❌ Error listando boletas:", error);
    throw error;
  }
}

// ============================================
// 📖 READ - Obtener boletas PENDIENTES
// ============================================
export async function getBoletasPendientes(inversionista_id?: number) {
  try {
    console.log(
      `📋 Obteniendo boletas PENDIENTES${inversionista_id ? ` para inversionista ${inversionista_id}` : ""}`,
    );

    return await getAllBoletas({
      inversionista_id,
      estado: "PENDIENTE",
    });
  } catch (error) {
    console.error("❌ Error obteniendo boletas pendientes:", error);
    throw error;
  }
}

// ============================================
// 📖 READ - Obtener boletas por inversionista
// ============================================
export async function getBoletasByInversionista(inversionista_id: number) {
  try {
    console.log(`📋 Obteniendo boletas para inversionista ${inversionista_id}`);

    return await getAllBoletas({
      inversionista_id,
    });
  } catch (error) {
    console.error("❌ Error obteniendo boletas por inversionista:", error);
    throw error;
  }
}

// ============================================
// ✏️ UPDATE - Actualizar boleta
// ============================================
export async function updateBoleta(boleta_id: number, data: UpdateBoletaInput) {
  try {
    console.log(`✏️ Actualizando boleta ${boleta_id}:`, data);

    // 1️⃣ Verificar que la boleta existe
    const boletaExiste = await db
      .select()
      .from(boletasPagoInversionista)
      .where(eq(boletasPagoInversionista.boleta_id, boleta_id))
      .limit(1);

    if (boletaExiste.length === 0) {
      throw new Error(`Boleta con ID ${boleta_id} no encontrada`);
    }

    // 2️⃣ Si se marca como PROCESADO, agregar fecha_procesado
    const updateData: any = { ...data };
    if (data.estado === "PROCESADO" && !data.fecha_procesado) {
      updateData.fecha_procesado = new Date();
    }

    // 3️⃣ Actualizar
    const [boletaActualizada] = await db
      .update(boletasPagoInversionista)
      .set(updateData)
      .where(eq(boletasPagoInversionista.boleta_id, boleta_id))
      .returning();

    console.log("✅ Boleta actualizada:", boletaActualizada);
    return boletaActualizada;
  } catch (error) {
    console.error("❌ Error actualizando boleta:", error);
    throw error;
  }
}

// ============================================
// 🔄 UPDATE - Marcar boleta como PROCESADA
// ============================================
export async function marcarBoletaComoProcesada(boleta_id: number) {
  try {
    console.log(`🔄 Marcando boleta ${boleta_id} como PROCESADA`);

    return await updateBoleta(boleta_id, {
      estado: "PROCESADO",
      fecha_procesado: new Date(),
    });
  } catch (error) {
    console.error("❌ Error marcando boleta como procesada:", error);
    throw error;
  }
}

// ============================================
// 🔄 UPDATE - Marcar boleta como PENDIENTE
// ============================================
export async function marcarBoletaComoPendiente(boleta_id: number) {
  try {
    console.log(`🔄 Marcando boleta ${boleta_id} como PENDIENTE`);

    return await updateBoleta(boleta_id, {
      estado: "PENDIENTE",
      fecha_procesado: undefined,
    });
  } catch (error) {
    console.error("❌ Error marcando boleta como pendiente:", error);
    throw error;
  }
}

// ============================================
// 🗑️ DELETE - Eliminar boleta
// ============================================
export async function deleteBoleta(boleta_id: number) {
  try {
    console.log(`🗑️ Eliminando boleta ${boleta_id}`);

    // 1️⃣ Verificar que la boleta existe
    const boletaExiste = await db
      .select()
      .from(boletasPagoInversionista)
      .where(eq(boletasPagoInversionista.boleta_id, boleta_id))
      .limit(1);

    if (boletaExiste.length === 0) {
      throw new Error(`Boleta con ID ${boleta_id} no encontrada`);
    }

    // 2️⃣ Verificar que NO esté PROCESADA
    if (boletaExiste[0].estado === "PROCESADO") {
      throw new Error(
        `No se puede eliminar una boleta PROCESADA. Boleta ID: ${boleta_id}`,
      );
    }

    // 3️⃣ Eliminar
    const [boletaEliminada] = await db
      .delete(boletasPagoInversionista)
      .where(eq(boletasPagoInversionista.boleta_id, boleta_id))
      .returning();

    console.log("✅ Boleta eliminada:", boletaEliminada);
    return boletaEliminada;
  } catch (error) {
    console.error("❌ Error eliminando boleta:", error);
    throw error;
  }
}

// ============================================
// 📊 STATS - Estadísticas de boletas
// ============================================
export async function getBoletasStats(inversionista_id?: number) {
  try {
    console.log(
      `📊 Obteniendo estadísticas de boletas${inversionista_id ? ` para inversionista ${inversionista_id}` : ""}`,
    );

    const conditions: any[] = [];
    if (inversionista_id) {
      conditions.push(
        eq(boletasPagoInversionista.inversionista_id, inversionista_id),
      );
    }
    const whereCondition =
      conditions.length > 0 ? and(...conditions) : undefined;

    const todasBoletas = await db
      .select()
      .from(boletasPagoInversionista)
      .where(whereCondition);

    const stats = {
      total: todasBoletas.length,
      pendientes: todasBoletas.filter((b) => b.estado === "PENDIENTE").length,
      procesadas: todasBoletas.filter((b) => b.estado === "PROCESADO").length,
      monto_total_pendiente: todasBoletas
        .filter((b) => b.estado === "PENDIENTE")
        .reduce((sum, b) => sum + Number(b.monto_boleta || 0), 0),
      monto_total_procesado: todasBoletas
        .filter((b) => b.estado === "PROCESADO")
        .reduce((sum, b) => sum + Number(b.monto_boleta || 0), 0),
    };

    console.log("✅ Estadísticas:", stats);
    return stats;
  } catch (error) {
    console.error("❌ Error obteniendo estadísticas:", error);
    throw error;
  }
}

interface LiquidacionBatchItem {
  nombre_usuario: string;
  cuota_mes: string;
  capital: number;
}

interface LiquidacionBatchInput {
  nombre_inversionista: string;
  liquidaciones: LiquidacionBatchItem[];
}

interface ResultadoLiquidacion {
  nombre_usuario: string;
  cuota_mes: string;
  capital: number;
  success: boolean;
  data?: any;
  message?: string;
  error?: string;
}

// ============================================
// 🔥 FUNCIÓN BATCH INTELIGENTE CON SYNC
// ============================================

interface LiquidacionBatchItem {
  nombre_usuario: string;
  cuota_mes: string;
  capital: number;
  meses_en_credito?: number | null;
  porcentaje_inversor: number; // 🔥 NUEVO CAMPO OPCIONAL
}

interface LiquidacionBatchInput {
  nombre_inversionista: string;
  liquidaciones: LiquidacionBatchItem[];
}
export async function liquidarCuotasBatchInteligente(
  input: LiquidacionBatchInput,
) {
  try {
    console.log(
      "🔥 ========== INICIANDO LIQUIDACIÓN BATCH INTELIGENTE ==========",
    );
    console.log(`👤 Inversionista: ${input.nombre_inversionista}`);
    console.log(`📊 Total liquidaciones: ${input.liquidaciones.length}`);

    const { nombre_inversionista, liquidaciones } = input;

    // ============================================
    // 1️⃣ BUSCAR INVERSIONISTA UNA SOLA VEZ
    // ============================================
    console.log(`\n🔍 Buscando inversionista: "${nombre_inversionista}"...`);

    const inversionistasEncontrados =
      await buscarInversionistaPermisivo(nombre_inversionista);

    if (inversionistasEncontrados.length === 0) {
      const errorMsg = `❌ Inversionista "${nombre_inversionista}" no encontrado`;
      console.error(errorMsg);

      return {
        success: false,
        error: errorMsg,
        total_procesados: 0,
        exitosos: 0,
        fallidos: liquidaciones.length,
        agregados: 0,
        actualizados: 0,
        eliminados: 0,
      };
    }

    let inversionista;

    if (inversionistasEncontrados.length > 1) {
      console.log("⚠️ Múltiples inversionistas encontrados:");
      inversionistasEncontrados.forEach((inv, idx) => {
        console.log(
          `   ${idx + 1}. ${inv.nombre} (ID: ${inv.inversionista_id})`,
        );
      });

      const matchExacto = inversionistasEncontrados.find(
        (inv) =>
          inv.nombre.trim().toLowerCase() ===
          nombre_inversionista.trim().toLowerCase(),
      );

      if (matchExacto) {
        console.log(`✅ MATCH EXACTO: ${matchExacto.nombre}`);
        inversionista = matchExacto;
      } else {
        console.log(
          `⚠️ Sin match exacto, TOMANDO EL PRIMERO: ${inversionistasEncontrados[0].nombre}`,
        );
        inversionista = inversionistasEncontrados[0];
      }
    } else {
      inversionista = inversionistasEncontrados[0];
    }

    console.log(
      `✅ Inversionista seleccionado: ${inversionista.nombre} (ID: ${inversionista.inversionista_id})`,
    );

    // ============================================
    // 🔥 2️⃣ OBTENER TODAS LAS RELACIONES DEL INVERSIONISTA
    // ============================================
    console.log(`\n📊 ========== OBTENIENDO RELACIONES ACTUALES ==========`);

    const relacionesActuales = await db
      .select({
        credito_inversionista_id: creditos_inversionistas.id,
        credito_id: creditos_inversionistas.credito_id,
        monto_aportado: creditos_inversionistas.monto_aportado,
        usuario_nombre: usuarios.nombre,
        usuario_id: usuarios.usuario_id,
        numero_credito: creditos.numero_credito_sifco,
      })
      .from(creditos_inversionistas)
      .innerJoin(
        creditos,
        eq(creditos.credito_id, creditos_inversionistas.credito_id),
      )
      .innerJoin(usuarios, eq(usuarios.usuario_id, creditos.usuario_id))
      .where(
        eq(
          creditos_inversionistas.inversionista_id,
          inversionista.inversionista_id,
        ),
      );

    console.log(`📊 Relaciones actuales en BD: ${relacionesActuales.length}`);

    // 🔥 FUNCIÓN HELPER PARA NORMALIZAR NOMBRES
    const normalizarNombre = (nombre: string): string => {
      return nombre
        .toLowerCase()
        .trim()
        .replace(/\s+/g, " ")
        .replace(/[áàäâã]/gi, "a")
        .replace(/[éèëê]/gi, "e")
        .replace(/[íìïî]/gi, "i")
        .replace(/[óòöôõ]/gi, "o")
        .replace(/[úùüû]/gi, "u")
        .replace(/ñ/gi, "n");
    };

    // 🔥 CREAR DOS MAPS:
    // 1. Por CREDITO_ID (para tracking de eliminaciones)
    const mapRelacionesPorCredito = new Map(
      relacionesActuales.map((r) => [r.credito_id, r]),
    );

    // 2. Por USUARIO (puede tener múltiples créditos) - Array de relaciones
    const mapRelacionesPorUsuario = new Map<
      string,
      typeof relacionesActuales
    >();

    relacionesActuales.forEach((r) => {
      // 🆕 NORMALIZAR el nombre igual que en la búsqueda
      const nombreNormalizado = normalizarNombre(r.usuario_nombre);

      // 🆕 TAMBIÉN intentar con la primera parte (antes del "/")
      const nombrePrincipal = nombreNormalizado.split("/")[0].trim();

      // Agregar con el nombre completo normalizado
      if (!mapRelacionesPorUsuario.has(nombreNormalizado)) {
        mapRelacionesPorUsuario.set(nombreNormalizado, []);
      }
      mapRelacionesPorUsuario.get(nombreNormalizado)!.push(r);

      // 🆕 TAMBIÉN agregar con el nombre principal (antes del "/") si es diferente
      if (nombrePrincipal !== nombreNormalizado && nombrePrincipal.length > 0) {
        if (!mapRelacionesPorUsuario.has(nombrePrincipal)) {
          mapRelacionesPorUsuario.set(nombrePrincipal, []);
        }
        mapRelacionesPorUsuario.get(nombrePrincipal)!.push(r);
      }
    });

    console.log(`📊 Map por crédito: ${mapRelacionesPorCredito.size} créditos`);
    console.log(
      `📊 Map por usuario: ${mapRelacionesPorUsuario.size} keys únicas`,
    );

    // 🔥 Mostrar desglose si hay usuarios con múltiples créditos
    const usuariosRevisados = new Set<string>();
    for (const [nombreKey, relaciones] of mapRelacionesPorUsuario) {
      // Evitar duplicados (porque agregamos tanto nombre completo como nombre principal)
      const nombreOriginal = relaciones[0].usuario_nombre;
      if (usuariosRevisados.has(nombreOriginal)) continue;
      usuariosRevisados.add(nombreOriginal);

      if (relaciones.length > 1) {
        console.log(`   👤 ${nombreOriginal}: ${relaciones.length} créditos`);
        relaciones.forEach((rel) => {
          console.log(
            `      - Crédito ${rel.numero_credito} (ID: ${rel.credito_id}) - Q${rel.monto_aportado}`,
          );
        });
      }
    }

    // ============================================
    // 3️⃣ PROCESAR CADA LIQUIDACIÓN
    // ============================================
    const resultados: any[] = [];
    const creditosProcesados = new Set<number>(); // 🔥 TRACKING de créditos procesados
    let exitosos = 0;
    let fallidos = 0;
    let agregados = 0;
    let actualizados = 0;

    console.log(`\n📋 ========== PROCESANDO LIQUIDACIONES ==========`);

    for (let i = 0; i < liquidaciones.length; i++) {
      const liquidacion = liquidaciones[i];

      // 🔥 NORMALIZAR el nombre de búsqueda
      const nombreKeyBusqueda = normalizarNombre(liquidacion.nombre_usuario);

      const indicadorPorcentaje = liquidacion.porcentaje_inversor
        ? ` 📊 ${liquidacion.porcentaje_inversor}%`
        : "";
      console.log(
        `\n[${i + 1}/${liquidaciones.length}] 👤 ${liquidacion.nombre_usuario} - 📅 ${liquidacion.cuota_mes} - 💰 Q${liquidacion.capital.toFixed(2)} ${liquidacion.meses_en_credito === 1 ? "🆕 (MES 1)" : ""}${indicadorPorcentaje}`,
      );

      // 🔥 BUSCAR EN LAS RELACIONES EXISTENTES POR NOMBRE DE USUARIO NORMALIZADO
      const relacionesUsuario =
        mapRelacionesPorUsuario.get(nombreKeyBusqueda) || [];

      try {
        if (relacionesUsuario.length > 0) {
          // ✅ ENCONTRAMOS AL USUARIO EN LAS RELACIONES EXISTENTES
          console.log(
            `   ✅ Usuario encontrado en relaciones (${relacionesUsuario.length} crédito${relacionesUsuario.length > 1 ? "s" : ""})`,
          );

          // 🎯 Estrategia: usar el PRIMER crédito
          const relacionExistente = relacionesUsuario[0];

          if (relacionesUsuario.length > 1) {
            console.log(`   ⚠️ Usuario tiene múltiples créditos, usando:`);
            relacionesUsuario.forEach((rel, idx) => {
              const marca = idx === 0 ? "👉" : "  ";
              console.log(
                `      ${marca} Crédito ${rel.numero_credito} (ID: ${rel.credito_id}) - Q${rel.monto_aportado}`,
              );
            });
          } else {
            console.log(
              `   📋 Crédito: ${relacionExistente.numero_credito} (ID: ${relacionExistente.credito_id})`,
            );
          }

          // 🔥 MARCAR COMO PROCESADO
          creditosProcesados.add(relacionExistente.credito_id);

          // 🔥 LIQUIDAR
          const resultado = await liquidarCuotasPorCredito({
            credito_id: relacionExistente.credito_id,
            inversionista_id: inversionista.inversionista_id,
            cuota_mes: liquidacion.cuota_mes,
            capital: liquidacion.capital,
            porcentaje_inversor: liquidacion.porcentaje_inversor,
          });

          if (resultado.success) {
            exitosos++;
            if (resultado.data?.relacion_creada) {
              agregados++;
              console.log(`   ➕ Relación creada`);
            } else {
              actualizados++;
              console.log(`   🔄 Relación actualizada`);
            }
          } else {
            fallidos++;
            console.log(`   ❌ Falló: ${resultado.message}`);
          }

          resultados.push({
            nombre_usuario: liquidacion.nombre_usuario,
            cuota_mes: liquidacion.cuota_mes,
            capital: liquidacion.capital,
            credito_id: relacionExistente.credito_id,
            numero_credito: relacionExistente.numero_credito,
            meses_en_credito: liquidacion.meses_en_credito,
            porcentaje_inversor: liquidacion.porcentaje_inversor,
            ...resultado,
          });
        } else {
          // ❌ NO ENCONTRAMOS AL USUARIO EN LAS RELACIONES EXISTENTES
          console.log(
            `   ⚠️ Usuario NO tiene relación con ${inversionista.nombre}`,
          );
          console.log(`   🔍 Buscando usuario en sistema...`);

          // 🔥 BUSCAR USUARIO EN LA BASE DE DATOS
          const usuariosEncontrados = await buscarUsuarioPermisivo(
            liquidacion.nombre_usuario,
          );

          if (usuariosEncontrados.length === 0) {
            fallidos++;
            console.log(`   ❌ Usuario no encontrado en sistema`);
            resultados.push({
              nombre_usuario: liquidacion.nombre_usuario,
              cuota_mes: liquidacion.cuota_mes,
              capital: liquidacion.capital,
              meses_en_credito: liquidacion.meses_en_credito,
              porcentaje_inversor: liquidacion.porcentaje_inversor,
              success: false,
              error: "Usuario no encontrado en sistema",
            });
            continue;
          }

          const usuario = usuariosEncontrados[0];
          console.log(
            `   ✅ Usuario encontrado: ${usuario.nombre} (ID: ${usuario.usuario_id})`,
          );

          // 🔥 BUSCAR CRÉDITOS DEL USUARIO
          const creditosUsuario = await db
            .select()
            .from(creditos)
            .where(eq(creditos.usuario_id, usuario.usuario_id));

          if (creditosUsuario.length === 0) {
            fallidos++;
            console.log(`   ❌ Usuario no tiene créditos`);
            resultados.push({
              nombre_usuario: liquidacion.nombre_usuario,
              cuota_mes: liquidacion.cuota_mes,
              capital: liquidacion.capital,
              meses_en_credito: liquidacion.meses_en_credito,
              porcentaje_inversor: liquidacion.porcentaje_inversor,
              success: false,
              error: "Usuario sin créditos",
            });
            continue;
          }

          // 🎯 Tomar el primer crédito (o el más reciente)
          const creditoParaUsar = creditosUsuario[0];
          console.log(`   📋 Créditos disponibles: ${creditosUsuario.length}`);
          console.log(
            `   👉 Usando crédito: ${creditoParaUsar.numero_credito_sifco} (ID: ${creditoParaUsar.credito_id})`,
          );

          // 🔥 MARCAR COMO PROCESADO
          creditosProcesados.add(creditoParaUsar.credito_id);

          // 🔥 LIQUIDAR (esto creará o actualizará la relación)
          const resultado = await liquidarCuotasPorCredito({
            credito_id: creditoParaUsar.credito_id,
            inversionista_id: inversionista.inversionista_id,
            cuota_mes: liquidacion.cuota_mes,
            capital: liquidacion.capital,
            porcentaje_inversor: liquidacion.porcentaje_inversor,
          });

          if (resultado.success) {
            exitosos++;
            if (resultado.data?.relacion_creada) {
              agregados++;
              console.log(`   ➕ Nueva relación creada`);
            } else {
              actualizados++;
              console.log(`   🔄 Relación actualizada`);
            }
          } else {
            fallidos++;
            console.log(`   ❌ Falló: ${resultado.message}`);
          }

          resultados.push({
            nombre_usuario: liquidacion.nombre_usuario,
            cuota_mes: liquidacion.cuota_mes,
            capital: liquidacion.capital,
            credito_id: creditoParaUsar.credito_id,
            numero_credito: creditoParaUsar.numero_credito_sifco,
            meses_en_credito: liquidacion.meses_en_credito,
            porcentaje_inversor: liquidacion.porcentaje_inversor,
            ...resultado,
          });
        }
      } catch (error) {
        fallidos++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`   ❌ Error: ${errorMsg}`);

        resultados.push({
          nombre_usuario: liquidacion.nombre_usuario,
          cuota_mes: liquidacion.cuota_mes,
          capital: liquidacion.capital,
          meses_en_credito: liquidacion.meses_en_credito,
          porcentaje_inversor: liquidacion.porcentaje_inversor,
          success: false,
          error: errorMsg,
        });
      }
    }

    // ============================================
    // 🆕 4️⃣ ELIMINAR RELACIONES HUÉRFANAS (por credito_id)
    // ============================================
    console.log(`\n🧹 ========== LIMPIANDO RELACIONES HUÉRFANAS ==========`);
    console.log(
      `   📊 Créditos procesados en Excel: ${creditosProcesados.size}`,
    );
    console.log(`   📊 Créditos en BD: ${mapRelacionesPorCredito.size}`);

    let eliminados = 0;
    const relacionesEliminadas: any[] = [];

    // 🔥 Iterar sobre TODOS los créditos en BD
    for (const [creditoId, relacion] of mapRelacionesPorCredito) {
      // Si el crédito NO fue procesado en el Excel, eliminar la relación
      if (!creditosProcesados.has(creditoId)) {
        console.log(`\n   ➖ ELIMINANDO relación huérfana:`);
        console.log(`      Usuario: ${relacion.usuario_nombre}`);
        console.log(
          `      Crédito: ${relacion.numero_credito} (ID: ${creditoId})`,
        );
        console.log(`      Monto aportado: Q${relacion.monto_aportado}`);

        await db
          .delete(creditos_inversionistas)
          .where(
            eq(creditos_inversionistas.id, relacion.credito_inversionista_id),
          );

        eliminados++;

        relacionesEliminadas.push({
          usuario: relacion.usuario_nombre,
          credito: relacion.numero_credito,
          credito_id: creditoId,
          monto_aportado: relacion.monto_aportado,
        });

        console.log(`      ✅ Relación eliminada`);
      }
    }

    if (eliminados === 0) {
      console.log(`   ✅ No hay relaciones huérfanas para eliminar`);
    } else {
      console.log(`\n   🗑️  Total relaciones eliminadas: ${eliminados}`);
    }

    // ============================================
    // 5️⃣ RESUMEN FINAL
    // ============================================
    console.log(`\n🎉 ========== BATCH INTELIGENTE COMPLETADO ==========`);
    console.log(`✅ Exitosos: ${exitosos}`);
    console.log(`❌ Fallidos: ${fallidos}`);
    console.log(`➕ Agregados (nuevas relaciones): ${agregados}`);
    console.log(`🔄 Actualizados (relaciones existentes): ${actualizados}`);
    console.log(`➖ Eliminados (relaciones huérfanas): ${eliminados}`);
    console.log(`📊 Total procesados: ${liquidaciones.length}`);
    console.log(`=========================================\n`);

    return {
      success: true,
      inversionista: {
        inversionista_id: inversionista.inversionista_id,
        nombre: inversionista.nombre,
      },
      total_procesados: liquidaciones.length,
      exitosos,
      fallidos,
      agregados,
      actualizados,
      eliminados,
      relaciones_eliminadas: relacionesEliminadas,
      resultados,
    };
  } catch (error) {
    console.error("❌ Error en batch inteligente:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      total_procesados: input.liquidaciones.length,
      exitosos: 0,
      fallidos: input.liquidaciones.length,
      agregados: 0,
      actualizados: 0,
      eliminados: 0,
    };
  }
}
