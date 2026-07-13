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
    pattern: 'Firma:___________________________',
    signerCount: 1,
    signers: ['Cliente'],
    yOffset: -4.0,  // Un poquito más arriba
    xOffset: -4.5   // Más a la izquierda
  },

  [ContractType.COBERTURA_INREXSA_COMERCIAL]: {
    pattern: 'Firma:___________________________',
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
  },

  [ContractType.ACUERDO_INVERSION_CASH_IN]: {
    pattern: 'F_________________________________________________',
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CARTA_CONFIRMACION_INVERSION_INICIAL]: {
    pattern: 'Firma: ____________________',
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CARTA_ELECCION_MODALIDAD_PAGO_REINVERSION]: {
    pattern: 'Firma: __________________________',
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CESION_CREDITOS]: {
    pattern: '________________________________',
    signerCount: 1,
    signers: ['Cedente']
  },

  [ContractType.CARTA_INSTRUCCION_INVERSION_CARTERA_ACTIVA]: {
    pattern: 'Firma: _________________________________________',
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CARTA_INCREMENTO_INVERSION]: {
    pattern: 'Firma: __________________________________',
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CARTA_INSTRUCCION_PAGO_ANTICIPADO]: {
    pattern: 'Firma: ____________________________________',
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CONTRATO_SERVICIOS_CASH_IN_INVERSOR_GENERAL]: {
    pattern: 'f) __________________________________',
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.DESIGNACION_BENEFICIARIO]: {
    pattern: 'Firma: __________________________',
    signerCount: 1,
    signers: ['Inversionista']
  },

  // ===== INVERSIONES SOCIEDAD =====
  // Mismos patrones de firma que sus equivalentes de inversiones individuales
  [ContractType.ACUERDO_INVERSION_CASH_IN_SOCIEDAD]: {
    pattern: 'F_________________________________________________',
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CARTA_CONFIRMACION_INVERSION_INICIAL_SOCIEDAD]: {
    pattern: 'Firma: ____________________',
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CARTA_ELECCION_MODALIDAD_PAGO_REINVERSION_SOCIEDAD]: {
    pattern: 'Firma: __________________________',
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CARTA_INSTRUCCION_INVERSION_CARTERA_ACTIVA_SOCIEDAD]: {
    pattern: 'Firma: _________________________________________',
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CARTA_INCREMENTO_INVERSION_SOCIEDAD]: {
    pattern: 'Firma: __________________________________',
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CARTA_INSTRUCCION_PAGO_ANTICIPADO_SOCIEDAD]: {
    pattern: 'Firma: ____________________________________',
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.CESION_CREDITOS_SOCIEDAD]: {
    pattern: '________________________________',
    signerCount: 1,
    signers: ['Cedente']
  },

  [ContractType.CONTRATO_SERVICIOS_CASH_IN_INVERSOR_GENERAL_SOCIEDAD]: {
    pattern: 'f) __________________________________',
    signerCount: 1,
    signers: ['Inversionista']
  },

  [ContractType.DESIGNACION_BENEFICIARIO_SOCIEDAD]: {
    pattern: 'Firma: __________________________',
    signerCount: 1,
    signers: ['Inversionista']
  },

  // ===== CARTA PODER =====
  // Todas las cartas de poder usan el mismo patrón: F.___________________________ (29 underscores)
  [ContractType.CARTA_CUBE_ANDRES]: {
    pattern: 'F.___________________________',
    signerCount: 1,
    signers: ['Cliente']
  },

  [ContractType.CARTA_CUBE_DON_ALEX]: {
    pattern: 'F.___________________________',
    signerCount: 1,
    signers: ['Cliente']
  },

  [ContractType.CARTA_RDBE_DON_ALEX]: {
    pattern: 'F.___________________________',
    signerCount: 1,
    signers: ['Cliente']
  },

  [ContractType.CARTA_RDBE_RICHARD]: {
    pattern: 'F.___________________________',
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
