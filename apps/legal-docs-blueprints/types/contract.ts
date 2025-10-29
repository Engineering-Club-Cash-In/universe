import { Gender, MaritalStatus } from '../services/GenderTranslator';

/**
 * Tipos de contratos soportados por el sistema
 */
export enum ContractType {
  USO_CARRO_USADO = 'uso_carro_usado',
  GARANTIA_MOBILIARIA = 'garantia_mobiliaria',
  RECONOCIMIENTO_DEUDA = 'reconocimiento_deuda',
  ARRENDAMIENTO = 'arrendamiento',
  COMPRAVENTA = 'compraventa',
  // Agrega más tipos aquí según sea necesario
}

/**
 * Interfaz base para todos los contratos
 */
export interface BaseContractData {
  /** Tipo de contrato */
  contractType: ContractType;

  /** Metadatos adicionales opcionales */
  metadata?: {
    clientId?: string;
    companyId?: string;
    createdBy?: string;
    tags?: string[];
  };
}

/**
 * Interfaz para los datos del contrato de uso de bien mueble (carro usado)
 * Basado en el documento: contrato_de_uso_carro_usado.docx
 */
export interface UsoCarroUsadoData extends BaseContractData {
  contractType: ContractType.USO_CARRO_USADO;
  // ===== DATOS DE LA FECHA DEL CONTRATO =====
  /** Día del contrato (ej: "15") */
  contract_day: string;

  /** Mes del contrato (ej: "octubre") */
  contract_month: string;

  /** Año del contrato solo el número (ej: "veinticinco") */
  contract_year: string;

  // ===== DATOS DEL CLIENTE/USUARIO =====
  /** Nombre completo del cliente */
  client_name: string;

  /** Edad del cliente (ej: "treinta y dos") */
  client_age: string;

  /** Género del cliente para adaptar términos del contrato */
  client_gender: Gender;

  /** Estado civil neutral (será traducido según género: single → soltero/soltera) */
  client_marital_status: MaritalStatus;

  /** Ocupación o profesión del cliente (ej: "comerciante", "ingeniero") */
  client_occupation: string;

  /** Nacionalidad base para generar gentilicio con género (ej: "guatemalteco" → guatemalteco/guatemalteca) */
  client_nationality: string;

  /** Título académico o profesional opcional, ya en género correcto (ej: "Licenciada", "Ingeniera", "Doctor") */
  client_degree?: string;

  /** Código Único de Identificación (DPI) completo */
  client_cui: string;

  /** Dirección completa para notificaciones */
  client_address: string;

  // ===== DATOS DEL VEHÍCULO =====
  /** Tipo de vehículo (ej: "Automóvil", "Pickup", "SUV") */
  vehicle_type: string;

  /** Marca del vehículo (ej: "Toyota", "Honda", "Ford") */
  vehicle_brand: string;

  /** Color del vehículo */
  vehicle_color: string;

  /** Uso del vehículo (ej: "Particular", "Comercial") */
  vehicle_use: string;

  /** Número de chasis */
  vehicle_chassis: string;

  /** Tipo de combustible (ej: "Gasolina", "Diésel", "Híbrido") */
  vehicle_fuel: string;

  /** Número de motor */
  vehicle_motor: string;

  /** Serie del vehículo */
  vehicle_series: string;

  /** Línea o estilo del vehículo */
  vehicle_line: string;

  /** Modelo del vehículo (año) */
  vehicle_model: string;

  /** Centímetros cúbicos del motor */
  vehicle_cc: string;

  /** Número de asientos */
  vehicle_seats: string;

  /** Número de cilindros */
  vehicle_cylinders: string;

  /** Código ISCV */
  vehicle_iscv: string;

  // ===== DATOS DEL PLAZO DE USO =====
  /** Nombre completo del usuario (repetido para SEGUNDA cláusula) */
  user_name: string;

  /** Duración del contrato en meses (ej: "doce", "veinticuatro") */
  contract_duration_months: string;

  /** Fecha de inicio del contrato (texto completo ej: "primero de enero del año dos mil veinticinco") */
  contract_start_date: string;

  /** Día de vencimiento (ej: "31") */
  contract_end_day: string;

  /** Mes de vencimiento (ej: "diciembre") */
  contract_end_month: string;

  /** Año de vencimiento en palabras (ej: "veintiséis") */
  contract_end_year: string;

  // ===== CAMPOS REPETIDOS PARA DISTINTAS CLÁUSULAS =====
  /** Nombre del usuario para cláusula TERCERA inciso a) */
  user_name_clause_a: string;

  /** Nombre del usuario para segunda mención en inciso a) */
  user_name_clause_a2: string;

  /** Nombre del usuario para cláusula TERCERA inciso b) */
  user_name_clause_b: string;

  /** Nombre del usuario para cláusula TERCERA inciso d) */
  user_name_clause_d: string;

  /** Nombre del usuario final para CUARTA cláusula */
  user_name_final: string;
}

/**
 * Interfaz para el contrato de garantía mobiliaria
 * Basado en el documento: garantia_mobiliaria_hombre.docx
 */
export interface GarantiaMobiliariaData extends BaseContractData {
  contractType: ContractType.GARANTIA_MOBILIARIA;

  // ===== DATOS DE LA FECHA DEL CONTRATO =====
  /** Día del contrato (ej: "28") */
  contract_day: string;

  /** Mes del contrato (ej: "octubre") */
  contract_month: string;

  /** Año del contrato en palabras (ej: "dos mil veinticinco") */
  contract_year: string;

  // ===== DATOS DEL DEUDOR/DEUDOR GARANTE (misma persona que depositario) =====
  /** Nombre completo del deudor */
  debtor_name: string;

  /** Edad del deudor en palabras (ej: "treinta y cinco") */
  debtor_age: string;

  /** Edad de José Andrés (firmante CCI) en palabras (ej: "cuarenta y cinco") */
  andres_age: string;

  /** Género del deudor para adaptar términos del contrato */
  debtor_gender: Gender;

  /** Estado civil neutral (será traducido según género: single → soltero/soltera) */
  debtor_marital_status: MaritalStatus;

  /** Ocupación o profesión del deudor (ej: "comerciante", "ingeniero") */
  debtor_occupation: string;

  /** Nacionalidad base para generar gentilicio con género (ej: "guatemalteco") */
  debtor_nationality: string;

  /** Título académico o profesional opcional, ya en género correcto */
  debtor_degree?: string;

  /** Código Único de Identificación (DPI) completo */
  debtor_cui: string;

  /** Dirección completa del deudor */
  debtor_address: string;

  /** Correo electrónico del deudor */
  debtor_email: string;

  // ===== DATOS DE LA DEUDA ORIGINAL =====
  /** Fecha completa de la deuda original en formato legal (ej: "quince de enero del año dos mil veinticinco") */
  original_debt_date: string;

  /** Monto de la deuda original en texto (ej: "cincuenta mil quetzales") */
  original_debt_amount_text: string;

  /** Monto de la deuda original en número (ej: "Q.50,000.00") */
  original_debt_amount_number: string;

  // ===== DATOS DE LA GARANTÍA =====
  /** Duración de la garantía en meses en texto (ej: "veinticuatro") */
  guarantee_duration_months: string;

  /** Día de vencimiento de la garantía (ej: "28") */
  guarantee_end_date_day: string;

  /** Mes de vencimiento de la garantía (ej: "octubre") */
  guarantee_end_date_month: string;

  /** Año de vencimiento de la garantía - solo la parte después de "dos mil" (ej: "veintisiete" para 2027) */
  guarantee_end_date_year: string;

  /** Monto garantizado en texto (ej: "sesenta mil quetzales") */
  guaranteed_amount_text: string;

  /** Monto garantizado en número (ej: "Q.60,000.00") */
  guaranteed_amount_number: string;

  // ===== DATOS DEL VEHÍCULO EN GARANTÍA =====
  /** Tipo de vehículo (ej: "Automóvil", "Pickup", "SUV") */
  vehicle_type: string;

  /** Marca del vehículo */
  vehicle_brand: string;

  /** Línea o modelo del vehículo */
  vehicle_line: string;

  /** Modelo (año) del vehículo */
  vehicle_model: string;

  /** Color del vehículo */
  vehicle_color: string;

  /** Número de placa */
  vehicle_plate: string;

  /** Número de chasis */
  vehicle_chassis: string;

  /** Número de motor */
  vehicle_motor: string;

  /** Tipo de combustible */
  vehicle_fuel: string;

  /** Centímetros cúbicos */
  vehicle_cc: string;

  /** Número de cilindros */
  vehicle_cylinders: string;

  /** Número de asientos */
  vehicle_seats: string;

  /** Número de puertas */
  vehicle_doors: string;

  /** Número de ejes */
  vehicle_axles: string;

  /** Uso del vehículo (ej: "Particular", "Comercial") */
  vehicle_use: string;

  /** Serie del vehículo */
  vehicle_series: string;

  /** Código ISCV */
  vehicle_iscv: string;

  /** Valor estimado del vehículo en texto (ej: "ochenta mil quetzales") */
  vehicle_estimated_value_text: string;

  /** Valor estimado del vehículo en número (ej: "Q.80,000.00") */
  vehicle_estimated_value_number: string;
}

// ===== TIPOS UNION PARA TODOS LOS CONTRATOS =====
/**
 * Union type que incluye todos los tipos de contratos disponibles
 */
export type AnyContractData = UsoCarroUsadoData | GarantiaMobiliariaData; // | ReconocimientoDeudaData | ArrendamientoData | etc...

/**
 * Interfaz para la respuesta de generación de contrato
 */
export interface ContractGenerationResponse {
  success: boolean;
  contractType: ContractType;
  docx_path?: string;
  pdf_path?: string;
  docx_url?: string;
  pdf_url?: string;
  message: string;
  error?: string;
  generatedAt?: string;
}

/**
 * Opciones de configuración para el generador de contratos
 */
export interface ContractGeneratorOptions {
  /** URL del servicio Gotenberg para conversión PDF */
  gotenbergUrl?: string;

  /** Directorio de templates */
  templatesDir?: string;

  /** Directorio de salida */
  outputDir?: string;

  /** Generar PDF además de DOCX */
  generatePdf?: boolean;

  /** Prefijo para nombres de archivos */
  filenamePrefix?: string;
}

/**
 * Configuración de template para un tipo de contrato
 */
export interface ContractTemplateConfig {
  /** Tipo de contrato */
  type: ContractType;

  /** Nombre del archivo template en /templates */
  templateFilename: string;

  /** Descripción del contrato */
  description: string;

  /** Campos requeridos para validación */
  requiredFields: string[];
}

/**
 * Request para generación de contrato
 */
export interface GenerateContractRequest {
  /** Tipo de contrato a generar */
  contractType: ContractType;

  /** Datos específicos del contrato */
  data: Record<string, any>;

  /** Opciones adicionales */
  options?: {
    generatePdf?: boolean;
    filenamePrefix?: string;
  };
}
