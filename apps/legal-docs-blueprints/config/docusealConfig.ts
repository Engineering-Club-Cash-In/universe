import { ContractType } from '../types/contract';

/**
 * Configuración de un firmante
 */
export interface Signer {
  role: string;
  required: boolean;
}

/**
 * Configuración de firmantes para un tipo de contrato
 */
export interface SignerConfig {
  signerCount: number;
  signers: Signer[];
}

/**
 * Mapa de configuración de firmantes por tipo de contrato
 * Define cuántos firmantes necesita cada tipo de documento y sus roles
 */
export const docusealConfig: Record<ContractType, SignerConfig> = {
  // Contratos de uso de vehículos - requieren 2 firmas (Cliente + CCI)
  [ContractType.USO_CARRO_USADO]: {
    signerCount: 2,
    signers: [
      { role: 'Cliente', required: true },
      { role: 'CCI_Representante', required: true },
    ],
  },

  [ContractType.CONTRATO_PRIVADO_USO]: {
    signerCount: 2,
    signers: [
      { role: 'Cliente', required: true },
      { role: 'CCI_Representante', required: true },
    ],
  },

  // Garantías y préstamos - requieren 2 firmas
  [ContractType.GARANTIA_MOBILIARIA]: {
    signerCount: 2,
    signers: [
      { role: 'Cliente', required: true },
      { role: 'CCI_Representante', required: true },
    ],
  },

  [ContractType.RECONOCIMIENTO_DEUDA]: {
    signerCount: 2,
    signers: [
      { role: 'Cliente', required: true },
      { role: 'CCI_Representante', required: true },
    ],
  },

  [ContractType.PAGARE_UNICO_LIBRE_PROTESTO]: {
    signerCount: 1,
    signers: [
      { role: 'Cliente', required: true },
    ],
  },

  // Cartas y solicitudes - requieren 1 firma (solo cliente)
  [ContractType.CARTA_EMISION_CHEQUES]: {
    signerCount: 1,
    signers: [
      { role: 'Cliente', required: true },
    ],
  },

  [ContractType.CARTA_CARRO_NUEVO]: {
    signerCount: 1,
    signers: [
      { role: 'Cliente', required: true },
    ],
  },

  [ContractType.CARTA_ACEPTACION_INSTALACION_GPS]: {
    signerCount: 1,
    signers: [
      { role: 'Cliente', required: true },
    ],
  },

  [ContractType.CARTA_SOLICITUD_TRASPASO_VEHICULO]: {
    signerCount: 1,
    signers: [
      { role: 'Cliente', required: true },
    ],
  },

  [ContractType.SOLICITUD_COMPRA_VEHICULO]: {
    signerCount: 1,
    signers: [
      { role: 'Cliente', required: true },
    ],
  },

  // Declaraciones y descargas - requieren 1 firma
  [ContractType.DECLARACION_DE_VENDEDOR]: {
    signerCount: 1,
    signers: [
      { role: 'Cliente', required: true },
    ],
  },

  [ContractType.DESCARGO_RESPONSABILIDADES]: {
    signerCount: 1,
    signers: [
      { role: 'Cliente', required: true },
    ],
  },

  // Coberturas - requieren 1 firma
  [ContractType.COBERTURA_INREXSA]: {
    signerCount: 1,
    signers: [
      { role: 'Cliente', required: true },
    ],
  },

  [ContractType.COBERTURA_INREXSA_COMERCIAL]: {
    signerCount: 1,
    signers: [
      { role: 'Cliente', required: true },
    ],
  },

  // ===== INVERSIONES =====
  [ContractType.ACUERDO_INVERSION_CASH_IN]: {
    signerCount: 1,
    signers: [
      { role: 'Inversionista', required: true },
    ],
  },

  [ContractType.CARTA_CONFIRMACION_INVERSION_INICIAL]: {
    signerCount: 1,
    signers: [
      { role: 'Inversionista', required: true },
    ],
  },

  [ContractType.CARTA_ELECCION_MODALIDAD_PAGO_REINVERSION]: {
    signerCount: 1,
    signers: [
      { role: 'Inversionista', required: true },
    ],
  },

  [ContractType.CESION_CREDITOS]: {
    signerCount: 1,
    signers: [
      { role: 'Cedente', required: true },
    ],
  },

  [ContractType.CARTA_INSTRUCCION_INVERSION_CARTERA_ACTIVA]: {
    signerCount: 1,
    signers: [
      { role: 'Inversionista', required: true },
    ],
  },

  [ContractType.CARTA_INCREMENTO_INVERSION]: {
    signerCount: 1,
    signers: [
      { role: 'Inversionista', required: true },
    ],
  },

  [ContractType.CARTA_INSTRUCCION_PAGO_ANTICIPADO]: {
    signerCount: 1,
    signers: [
      { role: 'Inversionista', required: true },
    ],
  },

  [ContractType.CONTRATO_SERVICIOS_CASH_IN_INVERSOR_GENERAL]: {
    signerCount: 1,
    signers: [
      { role: 'Inversionista', required: true },
    ],
  },

  [ContractType.DESIGNACION_BENEFICIARIO]: {
    signerCount: 1,
    signers: [
      { role: 'Inversionista', required: true },
    ],
  },

  [ContractType.CONTRATO_PARTICIPACION_ADMINISTRACION_CARTERA]: {
    signerCount: 1,
    signers: [
      { role: 'Inversionista', required: true },
    ],
  },

  // ===== INVERSIONES SOCIEDAD =====
  [ContractType.ACUERDO_INVERSION_CASH_IN_SOCIEDAD]: {
    signerCount: 1,
    signers: [
      { role: 'Inversionista', required: true },
    ],
  },

  [ContractType.CARTA_CONFIRMACION_INVERSION_INICIAL_SOCIEDAD]: {
    signerCount: 1,
    signers: [
      { role: 'Inversionista', required: true },
    ],
  },

  [ContractType.CARTA_ELECCION_MODALIDAD_PAGO_REINVERSION_SOCIEDAD]: {
    signerCount: 1,
    signers: [
      { role: 'Inversionista', required: true },
    ],
  },

  [ContractType.CARTA_INSTRUCCION_INVERSION_CARTERA_ACTIVA_SOCIEDAD]: {
    signerCount: 1,
    signers: [
      { role: 'Inversionista', required: true },
    ],
  },

  [ContractType.CARTA_INCREMENTO_INVERSION_SOCIEDAD]: {
    signerCount: 1,
    signers: [
      { role: 'Inversionista', required: true },
    ],
  },

  [ContractType.CARTA_INSTRUCCION_PAGO_ANTICIPADO_SOCIEDAD]: {
    signerCount: 1,
    signers: [
      { role: 'Inversionista', required: true },
    ],
  },

  [ContractType.CESION_CREDITOS_SOCIEDAD]: {
    signerCount: 1,
    signers: [
      { role: 'Cedente', required: true },
    ],
  },

  [ContractType.CONTRATO_SERVICIOS_CASH_IN_INVERSOR_GENERAL_SOCIEDAD]: {
    signerCount: 1,
    signers: [
      { role: 'Inversionista', required: true },
    ],
  },

  [ContractType.DESIGNACION_BENEFICIARIO_SOCIEDAD]: {
    signerCount: 1,
    signers: [
      { role: 'Inversionista', required: true },
    ],
  },

  // ===== CARTA PODER =====
  [ContractType.CARTA_CUBE_ANDRES]: {
    signerCount: 1,
    signers: [
      { role: 'Cliente', required: true },
    ],
  },

  [ContractType.CARTA_CUBE_DON_ALEX]: {
    signerCount: 1,
    signers: [
      { role: 'Cliente', required: true },
    ],
  },

  [ContractType.CARTA_RDBE_DON_ALEX]: {
    signerCount: 1,
    signers: [
      { role: 'Cliente', required: true },
    ],
  },

  [ContractType.CARTA_RDBE_RICHARD]: {
    signerCount: 1,
    signers: [
      { role: 'Cliente', required: true },
    ],
  },
};

/**
 * Obtiene la configuración de firmantes para un tipo de contrato
 * @param contractType - Tipo de contrato
 * @returns Configuración de firmantes o default si no existe
 */
export function getSignerConfig(contractType: ContractType): SignerConfig {
  return docusealConfig[contractType] || {
    signerCount: 1,
    signers: [{ role: 'Cliente', required: true }],
  };
}

/**
 * Obtiene el número de emails requeridos para un tipo de contrato
 * @param contractType - Tipo de contrato
 * @returns Número de emails necesarios
 */
export function getRequiredEmailCount(contractType: ContractType): number {
  return getSignerConfig(contractType).signerCount;
}
