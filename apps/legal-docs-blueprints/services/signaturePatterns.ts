import { ContractType } from '../types/contract';

/**
 * Configuración de patrones de firma para cada tipo de contrato
 * Estos patrones corresponden al texto de las líneas de firma que ya existen en los templates DOCX
 */

export interface SignaturePatternConfig {
  /** Patrón de texto a buscar en el PDF para ubicar la línea de firma */
  pattern: string;
  /** Número de firmantes esperados para este contrato */
  signerCount: number;
  /** Descripción de quién firma (opcional, para debugging) */
  signers?: string[];
  /** Offset en Y para ajustar posición vertical (opcional, en unidades Documenso) */
  yOffset?: number;
  /** Offset en X para ajustar posición horizontal (opcional, en unidades Documenso) */
  xOffset?: number;
  // Offset en X cuando las firmas están en la misma línea (opcional, en unidades Documenso) */
  xOffsetSignatureSameLine?: number;
}

export const signaturePatterns: Record<ContractType, SignaturePatternConfig> = {
  [ContractType.CARTA_ACEPTACION_INSTALACION_GPS]: {
    pattern: 'F)_______________________________________',
    signerCount: 1,
    signers: ['Cliente']
  },

  [ContractType.CARTA_CARRO_NUEVO]: {
    pattern: 'F)________________________',
    signerCount: 1,
    signers: ['Cliente'],
    xOffset: -2.5,  // Mover más a la izquierda
    yOffset: -1.0   // Subir un punto
  },

  [ContractType.CARTA_EMISION_CHEQUES]: {
    pattern: 'F)_______________________________________',
    signerCount: 1,
    signers: ['Cliente'],
    yOffset: -1.5  // Subir 1.5 puntos
  },

  [ContractType.CARTA_SOLICITUD_TRASPASO_VEHICULO]: {
    pattern: 'F)_______________________________________',
    signerCount: 1,
    signers: ['Cliente']
  },

  [ContractType.COBERTURA_INREXSA]: {
    pattern: 'f)_____________________',
    signerCount: 1,
    signers: ['Cliente'],
    yOffset: -4.0,  // Un poquito más arriba
    xOffset: -4.5   // Más a la izquierda
  },

  [ContractType.CONTRATO_PRIVADO_USO]: {
    pattern: 'f)_____________________________',
    signerCount: 2,
    signers: ['Deudor', 'Richard/CCI'],
    xOffset: 1.5,  // Un punto y medio a la derecha
    xOffsetSignatureSameLine: 220  // Mover firma 4 puntos a la derecha
  },

  [ContractType.USO_CARRO_USADO]: {
    pattern: 'f)_____________________________',
    signerCount: 2,
    signers: ['Deudor', 'Richard/CCI'],
    yOffset: -1.5,  // Subir 1.5 puntos
    xOffset: 0.5,    // Medio punto a la derecha
    xOffsetSignatureSameLine: 220  // Mover firma 4 puntos a la derecha

  },

  [ContractType.DECLARACION_DE_VENDEDOR]: {
    pattern: 'f)____________________________________',
    signerCount: 1,
    signers: ['Vendedor'],
    yOffset: -2  // Subir 2 puntos
  },

  [ContractType.DESCARGO_RESPONSABILIDADES]: {
    pattern: 'f)____________________________________',
    signerCount: 1,
    signers: ['Cliente']
  },

  [ContractType.GARANTIA_MOBILIARIA]: {
    pattern: 'f)_______________________________________',
    signerCount: 2,
    signers: ['Andrés', 'Deudor'],
    yOffset: -6,  // Bajar un punto más (era -7, ahora -6)
    xOffset: 0     // X parece estar bien
  },

  [ContractType.PAGARE_UNICO_LIBRE_PROTESTO]: {
    pattern: 'f. _______________________________',
    signerCount: 1,
    signers: ['Deudor']
  },

  [ContractType.RECONOCIMIENTO_DEUDA]: {
    pattern: 'f)___________________________',
    signerCount: 2,
    signers: ['Andrés', 'Deudor'],
    yOffset: -3.5,  // Subir 3.5 puntos,
    xOffsetSignatureSameLine: 250  // Mover firma 5 puntos a la derecha
  },

  [ContractType.SOLICITUD_COMPRA_VEHICULO]: {
    pattern: 'F)_______________________________________',
    signerCount: 1,
    signers: ['Cliente']
  }
};

/**
 * Obtiene la configuración de patrón de firma para un tipo de contrato
 */
export function getSignaturePattern(contractType: ContractType): SignaturePatternConfig {
  const config = signaturePatterns[contractType];

  if (!config) {
    console.warn(`⚠️ No signature pattern configured for contract type: ${contractType}`);
    // Fallback: asumir 1 firmante con patrón genérico
    return {
      pattern: 'f)_____',
      signerCount: 1,
      signers: ['Cliente']
    };
  }

  return config;
}
