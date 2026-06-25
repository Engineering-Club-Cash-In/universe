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

// Carga catálogos (asesores + categorías) para matching por nombre normalizado.
const cargarCatalogos = async () => {
  const asesoresDb = await db
    .select({ asesor_id: asesores.asesor_id, nombre: asesores.nombre })
    .from(asesores);
  return {
    asesorPorNombre: new Map(asesoresDb.map((a) => [norm(a.nombre), a])),
    categoriaPorNombre: new Map(CATEGORIAS.map((c) => [norm(c), c])),
  };
};

type Catalogos = Awaited<ReturnType<typeof cargarCatalogos>>;

// Valida y normaliza una fila contra los catálogos. Resuelve la categoría y el
// asesor canónicos EN EL SERVIDOR (no se confía en lo que mande el cliente).
const validarDatosFila = (
  data: {
    fila: number;
    cliente: unknown;
    nit?: unknown;
    categoria: unknown;
    asesor: unknown;
    capital: unknown;
    plazo: unknown;
    observaciones?: unknown;
  },
  { asesorPorNombre, categoriaPorNombre }: Catalogos
): FilaInsoluto => {
  const cliente = String(data.cliente ?? "").trim();
  const nit = String(data.nit ?? "").trim();
  const categoriaRaw = String(data.categoria ?? "").trim();
  const asesorRaw = String(data.asesor ?? "").trim();
  const observaciones = String(data.observaciones ?? "").trim();

  const errores: string[] = [];
  if (!cliente) errores.push("cliente vacío");

  const categoria = categoriaPorNombre.get(norm(categoriaRaw));
  if (!categoria) errores.push(`categoría inválida: "${categoriaRaw}"`);

  const asesor = asesorPorNombre.get(norm(asesorRaw));
  if (!asesor) errores.push(`asesor no encontrado: "${asesorRaw}"`);

  const capital = Number(data.capital);
  if (!Number.isFinite(capital) || capital <= 0)
    errores.push(`capital inválido: "${String(data.capital)}"`);

  const plazo = Number(data.plazo);
  if (!Number.isInteger(plazo) || plazo < 1 || plazo > 360)
    errores.push(`plazo inválido: "${String(data.plazo)}" (debe ser un entero entre 1 y 360)`);

  return {
    fila: data.fila,
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

  const catalogos = await cargarCatalogos();

  // Lee una columna por nombre normalizado (tolera acentos/espacios/mayúsculas en el header)
  const getCol = (row: Record<string, unknown>, name: string) => {
    const key = Object.keys(row).find((k) => norm(k) === norm(name));
    return key ? row[key] : "";
  };

  const filas: FilaInsoluto[] = rows.map((row, i) =>
    validarDatosFila(
      {
        fila: i + 1,
        cliente: getCol(row, "cliente"),
        nit: getCol(row, "nit"),
        categoria: getCol(row, "categoria"),
        asesor: getCol(row, "asesor"),
        capital: getCol(row, "capital"),
        plazo: getCol(row, "plazo"),
        observaciones: getCol(row, "observaciones"),
      },
      catalogos
    )
  );

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

  // Re-validamos SIEMPRE en el servidor: no se confía en el flag `valido` ni en
  // el asesor_id/capital/categoría que mande el cliente. Se re-resuelven contra
  // los catálogos, evitando que un payload manipulado cree créditos inválidos.
  const catalogos = await cargarCatalogos();

  for (let i = 0; i < filas.length; i++) {
    const entrada = filas[i] ?? ({} as Partial<FilaInsoluto>);
    const f = validarDatosFila(
      {
        fila: entrada.fila ?? i + 1,
        cliente: entrada.cliente,
        nit: entrada.nit,
        categoria: entrada.categoria,
        asesor: entrada.asesor,
        capital: entrada.capital,
        plazo: entrada.plazo,
        observaciones: entrada.observaciones,
      },
      catalogos
    );

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
