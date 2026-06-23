import * as XLSX from "xlsx";
import { db } from "../database";
import { asesores } from "../database/db";
import { createCreditCore, buildInsolutoCreditData } from "./createCredit";

// Categorías canónicas (mismas que el formulario individual de crédito).
const CATEGORIAS = [
  "Contraseña",
  "CV Vehículo",
  "CV Vehículo nuevo",
  "Fiduciario",
  "Hipotecario",
  "Vehículo",
];

// Columnas de la plantilla (el día NO va: siempre toma el default).
const COLUMNAS = [
  "cliente",
  "nit",
  "categoria",
  "asesor",
  "capital",
  "plazo",
  "observaciones",
];

// Normaliza para comparar nombres: minúsculas, sin acentos, sin espacios.
const norm = (s: unknown) =>
  (s ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .trim();

export interface FilaInsoluto {
  fila: number; // número de fila de datos en el Excel (1-based, sin contar el header)
  cliente: string;
  nit: string;
  categoria: string; // canónica
  asesor: string; // nombre canónico
  asesor_id: number;
  capital: number;
  plazo: number;
  observaciones: string;
  valido: boolean;
  error?: string;
}

// ========================================
// PASO 1: plantilla
// ========================================
export const generarPlantillaInsolutos = (): string => {
  const ejemplo = [
    "Juan Pérez",
    "1234567-8",
    "Vehículo",
    "Nombre del Asesor",
    7500,
    6,
    "Saldo insoluto de crédito anterior (opcional)",
  ];
  const ws = XLSX.utils.aoa_to_sheet([COLUMNAS, ejemplo]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Insolutos");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return buf.toString("base64");
};

// ========================================
// PASO 2: validar formato + datos
// ========================================
export const validarInsolutosExcel = async (archivoBase64: string) => {
  let rows: Record<string, unknown>[];
  try {
    const buf = Buffer.from(archivoBase64, "base64");
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  } catch {
    return { formatoOk: false, error: "No se pudo leer el archivo. ¿Es un Excel válido?" };
  }

  // Validar formato (columnas requeridas presentes)
  const headersPresentes =
    rows.length > 0 ? Object.keys(rows[0]).map(norm) : [];
  const requeridas = ["cliente", "categoria", "asesor", "capital", "plazo"];
  const faltantes = requeridas.filter((c) => !headersPresentes.includes(norm(c)));
  if (rows.length === 0) {
    return { formatoOk: false, error: "El archivo no tiene filas de datos." };
  }
  if (faltantes.length > 0) {
    return {
      formatoOk: false,
      error: `Faltan columnas requeridas: ${faltantes.join(", ")}. Usá la plantilla.`,
    };
  }

  // Catálogos para matching por nombre normalizado
  const asesoresDb = await db
    .select({ asesor_id: asesores.asesor_id, nombre: asesores.nombre })
    .from(asesores);
  const asesorPorNombre = new Map(asesoresDb.map((a) => [norm(a.nombre), a]));
  const categoriaPorNombre = new Map(CATEGORIAS.map((c) => [norm(c), c]));

  // Lee una columna por nombre normalizado (tolera acentos/espacios/mayúsculas en el header)
  const getCol = (row: Record<string, unknown>, name: string) => {
    const key = Object.keys(row).find((k) => norm(k) === norm(name));
    return key ? row[key] : "";
  };

  const filas: FilaInsoluto[] = rows.map((row, i) => {
    const cliente = String(getCol(row, "cliente") ?? "").trim();
    const nit = String(getCol(row, "nit") ?? "").trim();
    const categoriaRaw = String(getCol(row, "categoria") ?? "").trim();
    const asesorRaw = String(getCol(row, "asesor") ?? "").trim();
    const capitalRaw = getCol(row, "capital");
    const plazoRaw = getCol(row, "plazo");
    const observaciones = String(getCol(row, "observaciones") ?? "").trim();

    const errores: string[] = [];
    if (!cliente) errores.push("cliente vacío");

    const categoria = categoriaPorNombre.get(norm(categoriaRaw));
    if (!categoria) errores.push(`categoría inválida: "${categoriaRaw}"`);

    const asesor = asesorPorNombre.get(norm(asesorRaw));
    if (!asesor) errores.push(`asesor no encontrado: "${asesorRaw}"`);

    const capital = Number(capitalRaw);
    if (!Number.isFinite(capital) || capital <= 0)
      errores.push(`capital inválido: "${capitalRaw}"`);

    const plazo = Number(plazoRaw);
    if (!Number.isInteger(plazo) || plazo < 1)
      errores.push(`plazo inválido: "${plazoRaw}"`);

    return {
      fila: i + 1,
      cliente,
      nit,
      categoria: categoria ?? categoriaRaw,
      asesor: asesor?.nombre ?? asesorRaw,
      asesor_id: asesor?.asesor_id ?? 0,
      capital: Number.isFinite(capital) ? capital : 0,
      plazo: Number.isInteger(plazo) ? plazo : 0,
      observaciones,
      valido: errores.length === 0,
      error: errores.length ? errores.join("; ") : undefined,
    };
  });

  return {
    formatoOk: true,
    filas,
    resumen: {
      total: filas.length,
      validas: filas.filter((f) => f.valido).length,
      invalidas: filas.filter((f) => !f.valido).length,
    },
  };
};

// ========================================
// PASO 3: cargar (crea cada insoluto en su propia transacción)
// ========================================
export const cargarInsolutos = async (filas: FilaInsoluto[]) => {
  const resultados: {
    fila: number;
    cliente: string;
    success: boolean;
    numero_credito_sifco?: string;
    error?: string;
  }[] = [];

  for (const f of filas) {
    if (!f.valido) {
      resultados.push({
        fila: f.fila,
        cliente: f.cliente,
        success: false,
        error: f.error ?? "Fila inválida",
      });
      continue;
    }
    try {
      const creditData = buildInsolutoCreditData({
        usuario: f.cliente,
        nit: f.nit,
        categoria: f.categoria,
        asesor_id: f.asesor_id,
        capital: f.capital,
        plazo: f.plazo,
        observaciones: f.observaciones,
      });
      const { newCredit } = await db.transaction((tx) =>
        createCreditCore(creditData, tx)
      );
      resultados.push({
        fila: f.fila,
        cliente: f.cliente,
        success: true,
        numero_credito_sifco: String(newCredit.numero_credito_sifco),
      });
    } catch (err) {
      resultados.push({
        fila: f.fila,
        cliente: f.cliente,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    resultados,
    resumen: {
      total: filas.length,
      creados: resultados.filter((r) => r.success).length,
      fallidos: resultados.filter((r) => !r.success).length,
    },
  };
};
