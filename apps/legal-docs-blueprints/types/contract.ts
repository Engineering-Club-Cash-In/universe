import { Gender, MaritalStatus } from '../services/GenderTranslator';

/**
 * Tipos de contratos soportados por el sistema
 */
export enum ContractType {
  USO_CARRO_USADO = 'uso_carro_usado',
  GARANTIA_MOBILIARIA = 'garantia_mobiliaria',
  CARTA_EMISION_CHEQUES = 'carta_emision_cheques',
  DESCARGO_RESPONSABILIDADES = 'descargo_responsabilidades',
  COBERTURA_INREXSA = 'cobertura_inrexsa',
  PAGARE_UNICO_LIBRE_PROTESTO = 'pagare_unico_libre_protesto',
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

// ===== CARTA DE EMISIÓN DE CHEQUES =====
/**
 * Datos para generar carta de emisión de cheques / solicitud de desembolso
 * Este documento NO requiere género dinámico (redacción neutral)
 */
export interface CartaEmisionChequesData extends BaseContractData {
  contractType: ContractType.CARTA_EMISION_CHEQUES;

  // ===== FECHA DEL DOCUMENTO =====
  /** Día del documento (ej: "23" o "veintitrés") */
  document_day: string;

  /** Mes del documento (ej: "octubre") */
  document_month: string;

  /** Año del documento - solo últimos 2 dígitos (ej: "25" para 2025) */
  document_year: string;

  // ===== FECHA DEL CONTRATO ORIGINAL =====
  /** Día del contrato original (ej: "15" o "quince") */
  original_contract_day: string;

  /** Mes del contrato original (ej: "enero") */
  original_contract_month: string;

  /** Año del contrato original - solo parte después de "dos mil" (ej: "veinticinco") */
  original_contract_year: string;

  // ===== PARTES DEL CONTRATO =====
  /** Nombre o razón social de la entidad acreedora (ej: "CREDITO CAPITALES IMMOBILIARIS, SOCIEDAD ANÓNIMA") */
  creditor_name: string;

  /** Nombre completo del deudor que firma (ej: "JUAN RAMIRO MORALES PINEDA") */
  debtor_name: string;

  /** DPI del deudor */
  debtor_dpi: string;

  // ===== MONTO Y CUENTA =====
  /** Monto del desembolso en texto completo (ej: "CIENTO CUARENTA Y SEIS MIL NOVECIENTOS SETENTA QUETZALES CON SESENTA CENTAVOS (Q.146,970.60)") */
  disbursement_amount_text: string;

  /** Monto del desembolso en formato numérico (ej: "Q.146,970.60") */
  disbursement_amount_number: string;

  // ===== BENEFICIARIOS (tabla con múltiples filas) =====
  /**
   * Lista de beneficiarios para la tabla de transferencias
   * Puede tener 1 o más beneficiarios. Si solo hay 1, solo se mostrará 1 fila.
   */
  beneficiarios: Array<{
    /** Cuenta bancaria o nombre del beneficiario */
    account_or_beneficiary: string;
    /** Monto a transferir (ej: "146,970.60" - sin "Q.") */
    amount: string;
  }>;
}

// ===== DESCARGO DE RESPONSABILIDADES =====
/**
 * Datos para generar descargo de responsabilidades de vehículo
 * Este documento NO requiere género dinámico (redacción neutral)
 */
export interface DescargoResponsabilidadesData extends BaseContractData {
  contractType: ContractType.DESCARGO_RESPONSABILIDADES;

  // ===== FECHA DEL DOCUMENTO =====
  /** Día del documento (ej: "28") */
  date_day: string;

  /** Mes del documento (ej: "octubre") */
  date_month: string;

  /** Año del documento (ej: "dos mil veinticinco") */
  date_year: string;

  // ===== DATOS DEL DEUDOR =====
  /** Nombre completo del deudor (ej: "JUAN RAMIRO MORALES PINEDA") */
  debtor_name: string;

  /** DPI en letras (ej: "DOS MIL TRESCIENTOS CUARENTA Y CINCO") */
  debtor_dpi_letters: string;

  /** DPI en número (ej: "2345 67890 1234") */
  debtor_dpi_number: string;

  // ===== DATOS DEL VEHÍCULO =====
  /** Tipo de vehículo (ej: "Automóvil", "Pickup", "SUV") */
  vehicle_type: string;

  /** Marca del vehículo */
  vehicle_brand: string;

  /** Color del vehículo */
  vehicle_color: string;

  /** Uso del vehículo (ej: "Particular", "Comercial") */
  vehicle_use: string;

  /** Número de chasis */
  vehicle_chassis: string;

  /** Tipo de combustible (ej: "Gasolina", "Diésel") */
  vehicle_fuel: string;

  /** Número de motor */
  vehicle_engine: string;

  /** Serie del vehículo */
  vehicle_series: string;

  /** Línea o modelo del vehículo */
  vehicle_line: string;

  /** Modelo (año) del vehículo */
  vehicle_model: string;

  /** Centímetros cúbicos */
  vehicle_cc: string;

  /** Número de asientos */
  vehicle_seats: string;

  /** Número de cilindros */
  vehicle_cylinders: string;

  /** Código ISCV */
  vehicle_iscv: string;
}

// ===== COBERTURA INREXSA =====
/**
 * Datos para generar carta de cobertura INREXSA
 * Documento simple con solo nombre y fecha completa
 */
export interface CoberturaInrexsaData extends BaseContractData {
  contractType: ContractType.COBERTURA_INREXSA;

  /** Nombre completo del deudor/solicitante */
  debtor_name: string;

  /** Fecha completa del documento (ej: "Guatemala 28 de octubre de dos mil veinticinco") */
  full_date: string;
}

// ===== PAGARÉ ÚNICO LIBRE DE PROTESTO =====
/**
 * Datos para generar pagaré único libre de protesto
 */
export interface PagareUnicoLibreProtestoData extends BaseContractData {
  contractType: ContractType.PAGARE_UNICO_LIBRE_PROTESTO;

  // ===== FECHA DEL DOCUMENTO =====
  /** Día del documento (ej: "28") */
  date_day: string;

  /** Mes del documento (ej: "octubre") */
  date_month: string;

  /** Año del documento en formato corto (ej: "25" para año 2025) */
  date_year: string;

  // ===== VALOR NOMINAL =====
  /** Valor nominal en letras (ej: "CINCUENTA MIL QUETZALES") */
  nominal_value_letters: string;

  /** Valor nominal en números (ej: "Q.50,000.00") */
  nominal_value_numbers: string;

  // ===== DATOS DEL DEUDOR =====
  /** Nombre completo del deudor */
  debtor_name: string;

  /** Edad en letras (ej: "treinta y cinco") */
  debtor_age_letters: string;

  /** Estado civil (ej: "soltero", "casado") */
  debtor_civil_status: string;

  /** Ocupación del deudor (ej: "comerciante", "ingeniero") */
  debtor_occupation: string;

  /** Nacionalidad del deudor (ej: "guatemalteco", "mexicano") */
  debtor_nationality: string;

  /** DPI en letras (ej: "DOS TRES CUATRO CINCO SEIS SIETE OCHO NUEVE CERO UNO DOS TRES CUATRO") */
  debtors_dpi_letters: string;

  /** DPI en números (ej: "2345 67890 1234") */
  debtors_dpi_numbers: string;

  /** Dirección completa del deudor para notificaciones */
  debtors_address: string;

  // ===== FECHA DE VENCIMIENTO =====
  /** Día de vencimiento (ej: "15") */
  due_date_day: string;

  /** Mes de vencimiento (ej: "diciembre") */
  due_date_month: string;

  /** Año de vencimiento en palabras (ej: "dos mil veintiséis") */
  due_date_year: string;

  // ===== PAGOS =====
  /** Valor de pago mensual en letras (ej: "DOS MIL QUINIENTOS QUETZALES") */
  payment_value_letters: string;

  /** Valor de pago mensual en números (ej: "Q.2,500.00") */
  payment_value_numbers: string;

  /** Día de pago mensual (ej: "15") */
  payment_date_day: string;
}

// ===== TIPOS UNION PARA TODOS LOS CONTRATOS =====
/**
 * Union type que incluye todos los tipos de contratos disponibles
 */
export type AnyContractData = UsoCarroUsadoData | GarantiaMobiliariaData | CartaEmisionChequesData | DescargoResponsabilidadesData | CoberturaInrexsaData | PagareUnicoLibreProtestoData; // | ReconocimientoDeudaData | ArrendamientoData | etc...

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
