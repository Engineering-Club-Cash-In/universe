import { z } from "zod";

/** Clave para los errores que no cuelgan de ningún campo (refinements del objeto). */
export const ERROR_GENERAL = "_form";

/** Nombre técnico del campo -> etiqueta que ve el usuario. */
export const ETIQUETAS_CAMPOS: Record<string, string> = {
  // Registro de pago
  monto_boleta: "Monto Boleta",
  monto_boleta_cuota: "Monto Boleta por Cuota",
  otros: "Otros",
  observaciones: "Observaciones",
  fecha_boleta: "Fecha Boleta",
  fecha_pago: "Fecha de Pago",
  banco_id: "Banco",
  numeroAutorizacion: "Número de Autorización",
  credito_id: "Crédito",
  credito_sifco: "Crédito SIFCO",
  usuario_id: "Usuario",
  origen_pago: "Origen de Pago",
  cuotaApagar: "Cuota a Pagar",
  abono_directo_capital: "Abono Directo a Capital",
  url_boletas: "Boleta",
  registerBy: "Usuario Registrador",
  llamada: "Llamada",
  renuevo_o_nuevo: "Renuevo o Nuevo",

  // Registro / edición de crédito
  usuario: "Cliente",
  numero_credito_sifco: "No. Crédito SIFCO",
  capital: "Capital",
  porcentaje_interes: "Porcentaje de Interés",
  seguro_10_cuotas: "Seguro 10 Cuotas",
  gps: "GPS",
  no_poliza: "No. de Póliza",
  como_se_entero: "Cómo se enteró",
  asesor_id: "Asesor",
  plazo: "Plazo",
  cuota: "Cuota",
  dia_pago_mensual: "Día de Pago Mensual",
  membresias_pago: "Membresías",
  porcentaje_royalti: "Porcentaje de Royalti",
  royalti: "Royalti",
  categoria: "Categoría",
  nit: "NIT",
  reserva: "Reserva",
  esInsoluto: "Crédito Insoluto",
  direccion: "Dirección",
  municipio: "Municipio",
  departamento: "Departamento",
  codigo_postal: "Código Postal",
  pais: "País",
  vehiculo_marca: "Marca del Vehículo",
  vehiculo_linea: "Línea del Vehículo",
  vehiculo_modelo: "Modelo del Vehículo",
  vehiculo_placa: "Placa del Vehículo",
  monto_asegurado: "Monto Asegurado",
  opportunity_id: "Oportunidad",
  inversionistas: "Inversionistas",
  inversionista_id: "Inversionista",
  monto_aportado: "Monto Aportado",
  porcentaje_cash_in: "Porcentaje Cash In",
  porcentaje_inversion: "Porcentaje de Inversión",
  tipo_inversion: "Tipo de Inversión",
  fecha_inicio_participacion: "Fecha de Inicio de Participación",
  rubros: "Rubros",
  nombre_rubro: "Nombre del Rubro",
  monto: "Monto",
};

/** "monto_boleta" y "creditId" -> "Monto Boleta" / "Credit Id". */
function humanizar(campo: string): string {
  return campo
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join(" ");
}

/**
 * Resuelve la etiqueta de un campo, incluyendo rutas anidadas de zod
 * ("inversionistas.0.monto_aportado" -> "Inversionistas #1 › Monto Aportado").
 */
export function etiquetaCampo(campo: string): string {
  const segmentos: string[] = [];

  for (const parte of campo.split(".")) {
    if (/^\d+$/.test(parte) && segmentos.length > 0) {
      segmentos[segmentos.length - 1] += ` #${Number(parte) + 1}`;
      continue;
    }
    segmentos.push(ETIQUETAS_CAMPOS[parte] ?? humanizar(parte));
  }

  return segmentos.join(" › ");
}

/**
 * Arma el texto del toast a partir de un mapa campo -> mensaje.
 * Con `encabezado` vacío devuelve sólo las viñetas (lo usa `apiError.ts`).
 * Devuelve `null` si no hay errores que mostrar.
 */
export function formatFieldErrors(
  errores: Record<string, unknown>,
  encabezado = "Campos con errores:",
): string | null {
  const lineas = Object.entries(errores)
    .map(([campo, mensaje]) => {
      const texto = normalizarMensaje(mensaje);
      if (!texto) return null;
      // ERROR_GENERAL es un error del formulario completo, no de un campo.
      return campo === ERROR_GENERAL ? `• ${texto}` : `• ${etiquetaCampo(campo)}: ${texto}`;
    })
    .filter((linea): linea is string => linea !== null);

  if (lineas.length === 0) return null;
  if (!encabezado) return lineas.join("\n");
  return `${encabezado}\n${lineas.join("\n")}`;
}

/** El valor puede venir como string, como string[] (fieldErrors de zod) o anidado. */
function normalizarMensaje(mensaje: unknown): string | null {
  if (typeof mensaje === "string") return mensaje.trim() || null;
  if (Array.isArray(mensaje)) {
    const textos = mensaje.map(normalizarMensaje).filter(Boolean) as string[];
    return textos.length > 0 ? textos.join(", ") : null;
  }
  if (mensaje && typeof mensaje === "object") {
    const textos = Object.values(mensaje).map(normalizarMensaje).filter(Boolean) as string[];
    return textos.length > 0 ? textos.join(", ") : null;
  }
  return null;
}

/**
 * Puente zod -> formik. Usa la ruta completa del issue para no aplastar los
 * errores anidados de `inversionistas[]` / `rubros[]` sobre la llave del array.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function zodToFormikValidate(schema: z.ZodSchema<any>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (values: any) => {
    const result = schema.safeParse(values);
    if (result.success) return {};

    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join(".") || ERROR_GENERAL;
      if (!errors[path]) errors[path] = issue.message;
    }
    return errors;
  };
}
