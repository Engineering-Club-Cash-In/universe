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
