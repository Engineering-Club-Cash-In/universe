export interface ExcelCreditoRow {
  Fecha: string;
  CreditoSIFCO: string;
  Numero: number;
  Nombre: string;
  Capital: string;
  porcentaje: string;
  Cuotas: string;
  DeudaQ: string;
  IVA12: string;
  PorcentajeCashIn: string;
  PorcentajeInversionista: string;
  CuotaCashIn: string;
  IVACashIn: string;
  CuotaInversionista: string;
  IVAInversionista: string;
  Seguro10Cuotas: string;
  GPS: string;
  AbonoCapital: string;
  AbonoInteres: string;
  AbonoIVA12: string;
  AbonoInteresCI: string;
  AbonoIVACI: string;
  AbonoSeguro: string;
  AbonoGPS: string;
  PagoDelMes: string;
  CapitalRestante: string;
  InteresRestante: string;
  IVA12Restante: string;
  SeguroRestante: string;
  GPSRestante: string;
  TotalRestante: string;
  Llamada: string;
  Pago: string;
  NIT: string;
  Categoria: string;
  Inversionista: string;
  Observaciones: string;
  Cuota: string;
  MontoBoleta: string;
  FechaFiltro: string;
  NumeroPoliza: string;
  ComisionVenta: string;
  AcumuladoComisionVenta: string;
  ComisionesMesCashIn: string;
  ComisionesCobradasMesCashIn: string;
  AcumuladoComisionesCashIn: string;
  AcumuladoComisionesCobradasCashIn: string;
  RenuevoONuevo: string;
  CapitalNuevosCreditos: string;
  PorcentajeRoyalty: string;
  Royalty: string;
  USRoyalty: string;
  Membresias: string;
  MembresiasPago: string;
  GastosMes: string;
  UtilidadMes: string;
  UtilidadAcumulada: string;
  ComoSeEntero: string;
  MembresiasDelMes: string;
  MembresiasDelMesCobradas: string;
  MembresiasAcumulado: string;
  Asesor: string;
  Otros: string;
  Mora: string;
  MontoBoletaCuota: string;
  Plazo: string;
  Seguro: string;
  FormatoCredito: string;
  Pagado: string;
  Facturacion: string;
  MesPagado: string;
  SeguroFacturado: string;
  GPSFacturado: string;
  Reserva: string;
} 
import fs from "fs";
import iconv from "iconv-lite"; 
 
 
import readline from "readline";
function normalize(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}
/**
 * Busca un crédito en un CSV grande sin cargar todo el archivo en memoria.
 * Puede devolver múltiples filas si hay varias coincidencias (ej. _2, _3).
 * @param filePath ruta al archivo CSV
 * @param creditoSIFCO número de crédito a buscar
 * @returns Arreglo de filas como objetos si se encuentran, o []
 */
export async function leerCreditoPorNumeroSIFCO(
  filePath: string,
  creditoSIFCO: string
): Promise<Record<string, any>[]> {
  console.time("⏳ Lectura archivo (stream)");

  const buscado = creditoSIFCO.padStart(14, "0");

  const stream = fs.createReadStream(filePath).pipe(iconv.decodeStream("latin1"));
  const rl = readline.createInterface({ input: stream });

  let headers: string[] | null = null;
  const resultados: Record<string, any>[] = [];

  for await (const line of rl) {
    const values = line.split(";").map((v) => v.trim());

    // La primera línea son encabezados
    if (!headers) {
      headers = values;
      continue;
    }

    // Mapear cada valor a su encabezado
    const row: Record<string, any> = {};
    headers.forEach((h, i) => {
      let val = values[i] ?? "";

      // 👇 solo limpiamos el prefijo "Q" si existe
      if (/^Q/i.test(val)) {
        val = val.replace(/^Q/i, "").trim();
      }

      row[h] = val;
    });

    // Buscar en la columna "CreditoSifco"
    const rawValue = row["CreditoSifco"] ?? "";
    const rowValue = String(rawValue).replace(/[^0-9]/g, "").padStart(14, "0");

    // Coincidencia exacta o con sufijos (_2, _3, etc.)
    if (rowValue === buscado || rawValue.startsWith(creditoSIFCO)) {
      resultados.push(row);
    }
  }

  console.timeEnd("⏳ Lectura archivo (stream)");

  if (resultados.length === 0) {
    console.warn("⚠️ No se encontró el crédito:", creditoSIFCO);
  }

  return resultados;
}
